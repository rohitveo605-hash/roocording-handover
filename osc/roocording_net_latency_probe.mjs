/* roocording_net_latency_probe.mjs
 * CODE-REAL UDP latency probe for the MoCap -> render machine network path.
 * Sequenced echo probes: reports min/avg/max/p99 RTT, jitter, and loss %.
 *
 * HONEST SCOPE: this measures the UDP network path only (e.g., tracking
 * workstation -> UE5 render PC). End-to-end MoCap-to-pixel latency includes
 * capture hardware, Live Link evaluation, and render/display stages that
 * require hardware timestamps — never claim this number as total latency.
 *
 * Usage:
 *   listen side:  node roocording_net_latency_probe.mjs listen [port]
 *   probe side:   node roocording_net_latency_probe.mjs probe <host> <port> [count] [intervalMs]
 */
import dgram from 'node:dgram';

const PREAMBLE = 'ROOPING';

function encodeProbe(seq, t0Nanos) {
  const buf = Buffer.alloc(4 + PREAMBLE.length + 4 + 8);
  buf.writeUInt32BE(0x524f4f21, 0);                 // magic "ROO!"
  buf.write(PREAMBLE, 4, 'ascii');
  buf.writeUInt32BE(seq, 4 + PREAMBLE.length);
  buf.writeBigUInt64BE(BigInt(t0Nanos), 4 + PREAMBLE.length + 4);
  return buf;
}
function decodeProbe(buf) {
  if (buf.length < 4 + PREAMBLE.length + 12) return null;
  if (buf.readUInt32BE(0) !== 0x524f4f21) return null;
  if (buf.toString('ascii', 4, 4 + PREAMBLE.length) !== PREAMBLE) return null;
  return {
    seq: buf.readUInt32BE(4 + PREAMBLE.length),
    t0Nanos: buf.readBigUInt64BE(4 + PREAMBLE.length + 4)
  };
}

/* Echo server: replies with the identical payload. */
function startListener({ port = 6301, host = '0.0.0.0', udp = dgram } = {}) {
  const sock = udp.createSocket('udp4');
  sock.on('message', (msg, rinfo) => { sock.send(msg, rinfo.port, rinfo.address); });
  sock.bind(port, host);
  return sock;
}

/* Run a probe session. Returns a Promise<report>. Pure timing logic is in
 * computeStats() so the math is unit-testable without sockets. */
function runProbe({ host, port, count = 100, intervalMs = 10, udp = dgram, nowNanos = () => process.hrtime.bigint() } = {}) {
  return new Promise((resolve, reject) => {
    const sock = udp.createSocket('udp4');
    const rtts = new Map(); // seq -> rttNanos
    let sent = 0, finished = false;
    const timer = setInterval(() => {
      if (sent >= count) { clearInterval(timer); return; }
      const seq = sent++;
      sock.send(encodeProbe(seq, nowNanos()), port, host);
    }, intervalMs);
    const deadline = setTimeout(() => finish(), intervalMs * count + 2000);
    function finish() {
      if (finished) return; finished = true;
      clearInterval(timer); clearTimeout(deadline);
      sock.close();
      resolve(computeStats(sent, rtts));
    }
    sock.on('message', (msg) => {
      const p = decodeProbe(msg);
      if (p && p.seq < sent && !rtts.has(p.seq)) rtts.set(p.seq, Number(nowNanos() - p.t0Nanos));
      if (rtts.size >= count) finish();
    });
    sock.on('error', (e) => { clearInterval(timer); clearTimeout(deadline); sock.close(); reject(e); });
  });
}

function computeStats(sent, rttsNanos) {
  const values = [...rttsNanos.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = values.length;
  const ms = values.map(v => Number(v) / 1e6);
  const min = n ? ms[0] : NaN;
  const max = n ? ms[n - 1] : NaN;
  const avg = n ? ms.reduce((a, b) => a + b, 0) / n : NaN;
  const p99 = n ? ms[Math.min(n - 1, Math.floor(n * 0.99))] : NaN;
  let jitter = 0;
  for (let i = 1; i < n; i++) jitter += Math.abs(ms[i] - ms[i - 1]);
  jitter = n > 1 ? jitter / (n - 1) : 0;
  const lossPct = sent > 0 ? ((sent - n) / sent) * 100 : 100;
  return {
    sent, received: n, lossPct,
    rttMs: { min, avg, max, p99 }, jitterMs: jitter,
    scope: 'UDP network path only — not end-to-end MoCap-to-pixel latency'
  };
}

globalThis.RooNetProbe = { encodeProbe, decodeProbe, startListener, runProbe, computeStats, PREAMBLE };

/* CLI */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, a1, a2, a3, a4] = process.argv.slice(2);
  if (mode === 'listen') {
    const port = Number(a1 || 6301);
    startListener({ port });
    console.log(`[ROO-PING] listening on 0.0.0.0:${port} (echo)`);
  } else if (mode === 'probe') {
    const report = await runProbe({ host: a1, port: Number(a2), count: Number(a3 || 100), intervalMs: Number(a4 || 10) });
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('usage: node roocording_net_latency_probe.mjs listen [port]');
    console.log('       node roocording_net_latency_probe.mjs probe <host> <port> [count] [intervalMs]');
  }
}
