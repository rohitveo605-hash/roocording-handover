/* roocording_osc_stage_core.mjs
 * Stream Deck -> OSC -> UE5 stunt-override layer.
 * CODE-REAL: OSC 1.0 wire encode/decode, UDP listener, 16-button address map,
 * and the override state machine that BP_StageOSCManager will mirror in UE5.
 * No dependencies. Runs in Node (tests + render-machine validator).
 * Spec source: user blueprint "Stream Deck via MIDI/OSC -> UE5" (2026-10-29).
 */
import dgram from 'node:dgram';

/* =====================================================================
   STAGE MAP — single source of truth for the 4x4 Stream Deck layout.
   The Stream Deck profile and the UE5 Switch-on-String both consume this.
   ===================================================================== */
const STAGE_MAP = [
  { slot: 'R1C1', label: 'RESET / LIVE MOCAP',  address: '/kimmy/override/reset',    kind: 'override', behavior: 'clear-all' },
  { slot: 'R1C2', label: 'BACKFLIP STUNT',      address: '/kimmy/stunt/backflip',    kind: 'stunt',    montage: 'AM_Backflip',  durationSec: 2.5 },
  { slot: 'R1C3', label: 'SPIN DANCE',          address: '/kimmy/stunt/spindance',   kind: 'stunt',    montage: 'AM_SpinDance', durationSec: 2.0 },
  { slot: 'R1C4', label: 'FLOAT / LEVITATE',    address: '/kimmy/stunt/levitate',    kind: 'stunt',    toggle: 'anti-gravity mesh offset' },
  { slot: 'R2C1', label: 'FIERCE EXPRESSION',   address: '/kimmy/emote/fierce',      kind: 'emote',    curves: ['BrowDown', 'JawTight'] },
  { slot: 'R2C2', label: 'SMILE / POP',         address: '/kimmy/emote/smile',       kind: 'emote',    curves: ['MouthSmile', 'CheekSquint'] },
  { slot: 'R2C3', label: 'SHOCK / GASP',        address: '/kimmy/emote/shock',       kind: 'emote',    curves: ['JawOpen', 'EyeWide'] },
  { slot: 'R2C4', label: 'GLITCH EMOTE',        address: '/kimmy/emote/glitch',      kind: 'emote',    curves: ['random-blendshape-jitter'] },
  { slot: 'R3C1', label: 'FLAME HANDS',         address: '/kimmy/vfx/flames',        kind: 'vfx',      system: 'NS_HandFlames',  sockets: ['hand_l_socket', 'hand_r_socket'] },
  { slot: 'R3C2', label: 'LIGHTNING BURST',     address: '/kimmy/vfx/lightning',     kind: 'vfx',      system: 'NS_LightningArc' },
  { slot: 'R3C3', label: 'SPECTRAL DUST',       address: '/kimmy/vfx/dust',          kind: 'vfx',      system: 'NS_SpectralDust' },
  { slot: 'R3C4', label: 'HOLO-GLITCH FX',      address: '/kimmy/vfx/hologlitch',    kind: 'vfx',      system: 'material-rgb-split-shader' },
  { slot: 'R4C1', label: 'CAM 1: FRONT FULL',   address: '/kimmy/cam/front',         kind: 'cam',      cam: 'Front Camera' },
  { slot: 'R4C2', label: 'CAM 2: CLOSEUP',      address: '/kimmy/cam/closeup',       kind: 'cam',      cam: 'Head Camera' },
  { slot: 'R4C3', label: 'CAM 3: SIDE PROFILE', address: '/kimmy/cam/side',          kind: 'cam',      cam: '45 Degree Camera' },
  { slot: 'R4C4', label: 'EMERGENCY T-POSE',    address: '/kimmy/override/tpose',    kind: 'override', behavior: 'safety-tpose' }
];
const ADDRESS_INDEX = new Map(STAGE_MAP.map(e => [e.address, e]));

/* =====================================================================
   OSC 1.0 ENCODER / DECODER (messages with float args, e.g. ",f" 1.0)
   Wire format: address string (NUL-padded to 4), typetag string
   (NUL-padded to 4), args big-endian. This is what the Stream Deck
   OSC plugin must produce and what UE5's OSC server parses.
   ===================================================================== */
function pad4(n) { return (n + 3) & ~3; }

function writeOscString(buf, offset, s) {
  const bytes = Buffer.from(s, 'ascii');
  bytes.copy(buf, offset);
  buf[offset + bytes.length] = 0;
  return offset + pad4(bytes.length + 1);
}

function encodeOscMessage(address, ...args) {
  if (!address.startsWith('/')) throw new Error('OSC address must start with /');
  let tags = ',';
  let argBytes = 0;
  for (const a of args) {
    if (typeof a === 'number') { tags += 'f'; argBytes += 4; }
    else if (typeof a === 'string') { tags += 's'; argBytes += pad4(Buffer.byteLength(a, 'ascii') + 1); }
    else throw new Error('unsupported OSC arg type');
  }
  const size = pad4(address.length + 1) + pad4(tags.length + 1) + argBytes;
  const buf = Buffer.alloc(size);
  let off = writeOscString(buf, 0, address);
  off = writeOscString(buf, off, tags);
  for (const a of args) {
    if (typeof a === 'number') { buf.writeFloatBE(a, off); off += 4; }
    else { off = writeOscString(buf, off, a); }
  }
  return buf;
}

/* Returns { address, args, bytesRead } or throws on malformed input. */
function decodeOscMessage(buf) {
  function readString(off) {
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    if (end >= buf.length) throw new Error('unterminated OSC string');
    return { s: buf.toString('ascii', off, end), next: off + pad4(end - off + 1) };
  }
  const a = readString(0);
  if (!a.s.startsWith('/')) throw new Error('not an OSC address: ' + a.s);
  const t = readString(a.next);
  if (!t.s.startsWith(',')) throw new Error('missing OSC type tag');
  const args = [];
  let off = t.next;
  for (const tag of t.s.slice(1)) {
    if (tag === 'f') {
      if (off + 4 > buf.length) throw new Error('truncated float arg');
      args.push(buf.readFloatBE(off)); off += 4;
    } else if (tag === 'i') {
      if (off + 4 > buf.length) throw new Error('truncated int arg');
      args.push(buf.readInt32BE(off)); off += 4;
    } else if (tag === 's') {
      const r = readString(off); args.push(r.s); off = r.next;
    } else {
      throw new Error('unsupported OSC type tag: ' + tag);
    }
  }
  return { address: a.s, args, bytesRead: off };
}

/* =====================================================================
   STAGE OSC MANAGER — the BP_StageOSCManager state machine.
   Mirrors the UE5 blueprint semantics so behavior is testable headless:
   - timed stunts ramp StuntBlendWeight to 1, auto-release after duration
   - toggle stunts/vfx persist until pressed again or reset
   - emotes persist until replaced or reset
   - cameras are mutually exclusive
   - reset clears everything back to 100% live MoCap
   Time is injected (nowSec) so tests are deterministic.
   ===================================================================== */
class StageOSCManager {
  constructor({ nowSec = () => Date.now() / 1000 } = {}) {
    this.nowSec = nowSec;
    this.blendWeight = 0;          // 0 = 100% live MoCap, 1 = full override
    this.rampUpPerSec = 12;        // ~80 ms to full override
    this.rampDownPerSec = 6;       // smooth release back to live
    this.active = new Map();       // address -> { sinceSec, releaseAtSec|null }
    this.toggles = new Set();      // addresses of persistent toggle overrides
    this.emote = null;             // current emote entry or null
    this.vfx = new Set();          // active vfx system ids
    this.cam = null;               // current camera name
    this.tpose = false;
    this.montageLog = [];          // ordered events for tests/telemetry
    this.unknownLog = [];          // honest record of unrouted addresses
  }

  /* Route one decoded OSC message. Unknown addresses are logged, never crash. */
  handleMessage(address, value = 1.0) {
    const entry = ADDRESS_INDEX.get(address);
    if (!entry) { this.unknownLog.push({ address, value, at: this.nowSec() }); return false; }
    const t = this.nowSec();
    if (entry.kind === 'override' && entry.behavior === 'clear-all') return this._reset(t);
    if (entry.kind === 'override' && entry.behavior === 'safety-tpose') {
      this.tpose = true;
      this.active.set(address, { sinceSec: t, releaseAtSec: null });
      this.montageLog.push({ type: 'tpose', at: t });
      return true;
    }
    if (entry.kind === 'stunt') {
      if (entry.toggle) {
        if (this.toggles.has(address)) { this.toggles.delete(address); this.active.delete(address); }
        else { this.toggles.add(address); this.active.set(address, { sinceSec: t, releaseAtSec: null }); }
        this.montageLog.push({ type: 'toggle', label: entry.label, on: this.toggles.has(address), at: t });
      } else {
        // retrigger: restart the window
        this.active.set(address, { sinceSec: t, releaseAtSec: t + entry.durationSec });
        this.montageLog.push({ type: 'montage', name: entry.montage, durationSec: entry.durationSec, at: t });
      }
      return true;
    }
    if (entry.kind === 'emote') {
      this.emote = entry;
      this.active.set(address, { sinceSec: t, releaseAtSec: null });
      this.montageLog.push({ type: 'emote', label: entry.label, curves: entry.curves, at: t });
      return true;
    }
    if (entry.kind === 'vfx') {
      const key = entry.system;
      if (this.vfx.has(key)) { this.vfx.delete(key); this.montageLog.push({ type: 'vfx-off', system: key, at: t }); }
      else {
        this.vfx.add(key);
        this.montageLog.push({ type: 'vfx-on', system: key, at: t });
        for (const socket of entry.sockets || []) {
          this.montageLog.push({ type: 'attach', system: key, socket, at: t });
        }
      }
      return true;
    }
    if (entry.kind === 'cam') {
      this.cam = entry.cam;
      this.montageLog.push({ type: 'cam', cam: entry.cam, at: t });
      return true;
    }
    return false;
  }

  _reset(t) {
    this.active.clear();
    this.toggles.clear();
    this.emote = null;
    this.vfx.clear();
    this.cam = null;
    this.tpose = false;
    this.montageLog.push({ type: 'reset', at: t });
    return true;
  }

  /* Advance the manager by dtSec; process releases and blend ramp. */
  tick(dtSec) {
    const t = this.nowSec();
    for (const [address, st] of this.active) {
      if (st.releaseAtSec !== null && t >= st.releaseAtSec) this.active.delete(address);
    }
    const target = (this.active.size > 0 || this.tpose) ? 1 : 0;
    const rate = target > this.blendWeight ? this.rampUpPerSec : this.rampDownPerSec;
    const step = rate * dtSec;
    if (Math.abs(target - this.blendWeight) <= step) this.blendWeight = target;
    else this.blendWeight += Math.sign(target - this.blendWeight) * step;
    return { blendWeight: this.blendWeight, activeCount: this.active.size, target };
  }

  snapshot() {
    return {
      blendWeight: this.blendWeight,
      active: [...this.active.keys()],
      toggles: [...this.toggles],
      emote: this.emote ? this.emote.label : null,
      vfx: [...this.vfx],
      cam: this.cam,
      tpose: this.tpose,
      unknownCount: this.unknownLog.length
    };
  }
}

/* =====================================================================
   UDP LISTENER — what runs on the render machine to validate the
   Stream Deck plugin before UE5 is in the loop.
   ===================================================================== */
function listen({ port = 8000, host = '0.0.0.0', manager = new StageOSCManager(), udp = dgram } = {}) {
  const sock = udp.createSocket('udp4');
  sock.on('message', (msg) => {
    let decoded;
    try { decoded = decodeOscMessage(msg); }
    catch (e) { manager.unknownLog.push({ malformed: true, error: e.message, at: manager.nowSec() }); return; }
    manager.handleMessage(decoded.address, decoded.args[0]);
  });
  sock.on('error', (e) => { manager.unknownLog.push({ socketError: e.message, at: manager.nowSec() }); });
  sock.bind(port, host);
  return { socket: sock, manager, close: () => sock.close() };
}

globalThis.RooOSCStage = {
  STAGE_MAP,
  ADDRESS_INDEX,
  encodeOscMessage,
  decodeOscMessage,
  StageOSCManager,
  listen,
  pad4
};
