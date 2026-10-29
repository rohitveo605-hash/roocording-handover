#!/usr/bin/env node
/**
 * FILE: roocording_osc_stage_tdd.mjs
 * Acceptance tests for the Stream Deck -> OSC -> UE5 stunt-override layer.
 * Run: node roocording_osc_stage_tdd.mjs
 */
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import './roocording_osc_stage_core.mjs';

const S = globalThis.RooOSCStage;

let pass = 0;
function ok(name) { pass++; console.log(`[PASS] ${name}`); }

/* Deterministic clock */
function makeClock(start = 1000.0) {
  let t = start;
  return {
    now: () => t,
    advance: (dt) => { t += dt; }
  };
}

// ---------------------------------------------------------------- TEST 1
// Wire format: every one of the 16 stage-map addresses encodes and decodes
// losslessly with value 1.0, on 4-byte-aligned buffers.
{
  for (const entry of S.STAGE_MAP) {
    const buf = S.encodeOscMessage(entry.address, 1.0);
    assert.equal(buf.length % 4, 0, `${entry.address}: buffer 4-byte aligned`);
    const dec = S.decodeOscMessage(buf);
    assert.equal(dec.address, entry.address);
    assert.equal(dec.args.length, 1);
    assert.ok(Math.abs(dec.args[0] - 1.0) < 1e-6, `${entry.address}: value 1.0 round-trips`);
    assert.equal(dec.bytesRead, buf.length, `${entry.address}: no trailing garbage`);
  }
  ok(`Test 1: OSC wire format — all ${S.STAGE_MAP.length} stage-map addresses round-trip (4-byte aligned)`);
}

// ---------------------------------------------------------------- TEST 2
// Malformed packets are rejected, not crashed: truncated, no address, bad tag.
{
  assert.throws(() => S.decodeOscMessage(Buffer.from('/kimmy\x00xx')), /type tag|unterminated/);
  assert.throws(() => S.decodeOscMessage(Buffer.from('not-an-address\x00\x00')), /not an OSC address/);
  const truncated = S.encodeOscMessage('/kimmy/vfx/flames', 1.0).subarray(0, 8);
  assert.throws(() => S.decodeOscMessage(truncated), /truncated|unterminated/);
  ok('Test 2: malformed OSC packets rejected with honest errors (no silent accept)');
}

// ---------------------------------------------------------------- TEST 3
// Backflip stunt: blend ramps to 1, montage fires, auto-releases at 2.5 s,
// blend returns to 0 — live MoCap restored. (Blueprint: delay 2.5 s -> weight 0.)
{
  const clock = makeClock();
  const m = new S.StageOSCManager({ nowSec: clock.now });
  m.handleMessage('/kimmy/stunt/backflip', 1.0);
  assert.equal(m.montageLog.at(-1).type, 'montage');
  assert.equal(m.montageLog.at(-1).name, 'AM_Backflip');
  for (let i = 0; i < 30; i++) { clock.advance(1 / 60); m.tick(1 / 60); }
  assert.ok(m.blendWeight > 0.9, `blend must be ~1 during stunt (got ${m.blendWeight.toFixed(3)})`);
  clock.advance(2.2);
  m.tick(1 / 60);
  assert.ok(m.blendWeight > 0.5, 'still holding near the end of the stunt');
  clock.advance(0.4); // past 2.5 s release
  m.tick(1 / 60);
  for (let i = 0; i < 120; i++) { clock.advance(1 / 60); m.tick(1 / 60); }
  assert.equal(m.active.size, 0, 'stunt released after its window');
  assert.ok(m.blendWeight < 0.05, `blend must return to 0 for live MoCap (got ${m.blendWeight.toFixed(3)})`);
  ok('Test 3: backflip — blend 0->1, AM_Backflip fires, auto-release at 2.5 s, blends back to live');
}

// ---------------------------------------------------------------- TEST 4
// Flames VFX spawns both hand sockets; second press toggles off. Blueprint parity.
{
  const clock = makeClock();
  const m = new S.StageOSCManager({ nowSec: clock.now });
  m.handleMessage('/kimmy/vfx/flames', 1.0);
  const attaches = m.montageLog.filter(e => e.type === 'attach');
  assert.deepEqual(attaches.map(a => a.socket).sort(), ['hand_l_socket', 'hand_r_socket']);
  assert.ok(m.vfx.has('NS_HandFlames'));
  m.handleMessage('/kimmy/vfx/flames', 1.0); // toggle off
  assert.ok(!m.vfx.has('NS_HandFlames'), 'second press deactivates the emitters');
  ok('Test 4: flame hands — spawns on hand_l_socket + hand_r_socket, toggle-off works');
}

// ---------------------------------------------------------------- TEST 5
// Cameras are mutually exclusive; emotes persist until replaced; reset clears all.
{
  const clock = makeClock();
  const m = new S.StageOSCManager({ nowSec: clock.now });
  m.handleMessage('/kimmy/cam/front', 1.0);
  m.handleMessage('/kimmy/cam/closeup', 1.0);
  assert.equal(m.cam, 'Head Camera', 'latest camera wins');
  m.handleMessage('/kimmy/emote/fierce', 1.0);
  clock.advance(30);
  m.tick(1 / 60);
  assert.equal(m.emote.label, 'FIERCE EXPRESSION', 'emote persists over time');
  m.handleMessage('/kimmy/emote/smile', 1.0);
  assert.equal(m.emote.label, 'SMILE / POP', 'new emote replaces the old');
  m.handleMessage('/kimmy/override/reset', 1.0);
  const s = m.snapshot();
  assert.deepEqual([s.emote, s.cam, s.vfx.length, s.active.length, s.tpose], [null, null, 0, 0, false]);
  assert.equal(m.montageLog.at(-1).type, 'reset');
  ok('Test 5: cameras exclusive, emotes persist/replace, RESET returns to 100% live MoCap');
}

// ---------------------------------------------------------------- TEST 6
// Emergency T-pose holds the override until reset; blend stays 1.
{
  const clock = makeClock();
  const m = new S.StageOSCManager({ nowSec: clock.now });
  m.handleMessage('/kimmy/override/tpose', 1.0);
  clock.advance(10);
  for (let i = 0; i < 120; i++) { clock.advance(1 / 60); m.tick(1 / 60); }
  const s = m.snapshot();
  assert.equal(s.tpose, true);
  assert.ok(s.blendWeight > 0.99, 'tpose holds full override');
  m.handleMessage('/kimmy/override/reset', 1.0);
  assert.equal(m.snapshot().tpose, false);
  ok('Test 6: emergency T-pose latches until reset (safety behavior preserved)');
}

// ---------------------------------------------------------------- TEST 7
// Unknown addresses never crash and are honestly logged; a real UDP packet
// sent over loopback lands in the manager (Stream Deck plugin parity).
{
  const clock = makeClock();
  const m = new S.StageOSCManager({ nowSec: clock.now });
  m.handleMessage('/kimmy/stunt/notastunt', 1.0);
  assert.equal(m.snapshot().unknownCount, 1, 'unknown address logged, not executed');

  const server = S.listen({ port: 0, host: '127.0.0.1', manager: m });
  await new Promise((res) => server.socket.on('listening', res));
  const port = server.socket.address().port;
  const client = dgram.createSocket('udp4');
  const payload = S.encodeOscMessage('/kimmy/cam/side', 1.0);
  client.send(payload, port, '127.0.0.1');
  await new Promise((res) => setTimeout(res, 200));
  client.close(); server.close();
  assert.equal(m.cam, '45 Degree Camera', 'UDP datagram decoded and dispatched end-to-end');
  ok('Test 7: unknown address logged honestly; loopback UDP round-trip dispatches to the manager');
}

// ---------------------------------------------------------------- TEST 8
// Levitate is a toggle (no auto-release); blend weight follows state; the full
// 16-address map has no duplicates and every kind is reachable.
{
  const clock = makeClock();
  const m = new S.StageOSCManager({ nowSec: clock.now });
  m.handleMessage('/kimmy/stunt/levitate', 1.0);
  clock.advance(5);
  m.tick(1 / 60);
  assert.equal(m.snapshot().toggles.length, 1, 'levitate stays active without retrigger');
  m.handleMessage('/kimmy/stunt/levitate', 1.0);
  assert.equal(m.snapshot().toggles.length, 0, 'second press lands the avatar');

  const addrs = S.STAGE_MAP.map(e => e.address);
  assert.equal(new Set(addrs).size, addrs.length, 'no duplicate addresses in the map');
  const kinds = new Set(S.STAGE_MAP.map(e => e.kind));
  assert.deepEqual([...kinds].sort(), ['cam', 'emote', 'override', 'stunt', 'vfx']);
  ok('Test 8: levitate toggle persists/lands; 16-address map is duplicate-free, all 5 kinds covered');
}

console.log('====================================================================');
console.log(` ALL ${pass}/8 OSC STAGE ACCEPTANCE TESTS PASSED (0 FAILURES)`);
console.log('====================================================================');
