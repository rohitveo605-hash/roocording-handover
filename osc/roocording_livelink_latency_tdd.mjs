#!/usr/bin/env node
/**
 * FILE: roocording_livelink_latency_tdd.mjs
 * Acceptance tests: Live Link remap tables + corrected 2-bone IK + UDP latency probe.
 * Run: node roocording_livelink_latency_tdd.mjs
 */
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import './roocording_livelink_remap.mjs';
import './roocording_net_latency_probe.mjs';

const R = globalThis.RooLiveLinkRemap;
const P = globalThis.RooNetProbe;

let pass = 0;
function ok(name) { pass++; console.log(`[PASS] ${name}`); }

// ---------------------------------------------------------------- TEST 1
// Remapper mirrors UE semantics: mapped names translate, unknown names pass
// through unchanged (the exact behavior of GetRemappedBoneName_Implementation).
{
  const rm = R.createRemapper();
  assert.equal(rm.remapBone('Hips'), 'pelvis');
  assert.equal(rm.remapBone('LeftForeArm'), 'lowerarm_l');
  assert.equal(rm.remapBone('LeftPinky1'), 'LeftPinky1', 'unmapped bones pass through');
  assert.equal(rm.remapBone('Prop_Sword'), 'Prop_Sword');
  assert.equal(rm.remapCurve('Jaw_Open'), 'JawOpen');
  assert.equal(rm.remapCurve('TongueOut'), 'TongueOut');
  assert.ok(rm.isBoneMapped('Chest') && !rm.isBoneMapped('LeftPinky1'));
  ok('Test 1: remap semantics match UE (TMap find + identity fallback), bones and curves');
}

// ---------------------------------------------------------------- TEST 2
// Validator is honest: duplicate targets, missing skeleton bones, and empty
// tables are reported — never shipped silently into UE5.
{
  const fullSkeleton = [...R.BODY_BONE_MAP.values()];
  const good = R.validateRemapTables({ targetBones: fullSkeleton });
  assert.equal(good.ok, true);
  assert.equal(good.problems.length, 0);
  /* a curve-only check: bones validated against the full skeleton, no dupes */
  assert.equal(new Set(fullSkeleton).size, fullSkeleton.length, 'shipped table has no duplicate targets');

  const dup = R.validateRemapTables({
    boneMap: new Map([['Hips', 'pelvis'], ['Root', 'pelvis']]),
    curveMap: new Map([['A', 'B']]),
    targetBones: ['pelvis']
  });
  assert.ok(!dup.ok && dup.problems.some(p => p.includes('duplicate target')));

  const missing = R.validateRemapTables({
    boneMap: new Map([['Hips', 'pelvis'], ['Chest', 'spine_99']]),
    curveMap: new Map([['A', 'B']]),
    targetBones: ['pelvis']
  });
  assert.ok(!missing.ok && missing.problems.some(p => p.includes('spine_99')));

  const empty = R.validateRemapTables({ boneMap: new Map(), curveMap: new Map(), targetBones: [] });
  assert.ok(!empty.ok && empty.problems.some(p => p.includes('empty')));
  ok('Test 2: validator catches duplicate targets, missing skeleton bones, empty tables');
}

// ---------------------------------------------------------------- TEST 3
// Corrected 2-bone IK (UE TwoBoneIK convention): straight reach -> interior
// angle alpha = pi (bend 0); folded target -> alpha 0 (bend pi); the blueprint's
// mislabeled formula is the root elevation beta, and both are produced.
{
  const d1 = 0.30, d2 = 0.30;
  const straight = R.solveTwoBoneIK(d1, d2, 0.60);
  assert.ok(Math.abs(straight.bend) < 1e-6, 'straight reach: zero flexion');
  assert.ok(Math.abs(straight.alpha - Math.PI) < 1e-6, 'straight reach: interior angle = pi');
  const folded = R.solveTwoBoneIK(d1, d2, 0.0);
  assert.ok(Math.abs(folded.bend - Math.PI) < 1e-3, 'degenerate target: full fold');
  const mid = R.solveTwoBoneIK(d1, d2, Math.hypot(d1, d2)); // right triangle
  assert.ok(Math.abs(mid.alpha - Math.PI / 2) < 1e-9, 'right-angle reach: alpha = pi/2');
  const normal = R.solveTwoBoneIK(0.3, 0.3, 0.35);
  assert.ok(Number.isFinite(normal.alpha) && Number.isFinite(normal.beta));
  /* beta must satisfy the law of cosines identity against alpha */
  const D = normal.clampedDistance;
  const betaCheck = Math.acos((d1 * d1 + D * D - d2 * d2) / (2 * d1 * D));
  assert.ok(Math.abs(normal.beta - betaCheck) < 1e-12, 'beta is the root elevation angle');
  ok('Test 3: 2-bone IK — alpha (interior), bend (flexion), beta (root elevation) all correct');
}

// ---------------------------------------------------------------- TEST 4
// Probe codec round-trips; computeStats math verified on synthetic data.
{
  const buf = P.encodeProbe(42, 123456789n);
  const dec = P.decodeProbe(buf);
  assert.equal(dec.seq, 42);
  assert.equal(dec.t0Nanos, 123456789n);
  assert.equal(P.decodeProbe(Buffer.from('garbage-bytes-here!!')), null, 'non-probe datagram ignored');

  const synthetic = new Map(Array.from({ length: 98 }, (_, i) => [i, 2_000_000n]));
  const stats = P.computeStats(100, synthetic);
  assert.equal(stats.sent, 100);
  assert.equal(stats.received, 98);
  assert.ok(Math.abs(stats.lossPct - 2.0) < 1e-9);
  assert.ok(Math.abs(stats.rttMs.avg - 2.0) < 1e-9);
  assert.equal(stats.rttMs.min, 2.0);
  assert.equal(stats.rttMs.max, 2.0);
  assert.ok(stats.scope.includes('not end-to-end'), 'scope disclaimer always attached');
  ok('Test 4: probe codec + stats math (loss %, avg/min/max, honest scope note)');
}

// ---------------------------------------------------------------- TEST 5
// End-to-end over loopback UDP: listener echoes, runProbe reports ~0 loss and
// finite RTT. Proves the wire protocol both sides of the stage network.
{
  const sock = P.startListener({ port: 0, host: '127.0.0.1' });
  await new Promise((res) => sock.on('listening', res));
  const port = sock.address().port;
  const report = await P.runProbe({ host: '127.0.0.1', port, count: 20, intervalMs: 5 });
  sock.close();
  assert.equal(report.received, 20, 'no loss on loopback');
  assert.ok(Number.isFinite(report.rttMs.avg) && report.rttMs.avg >= 0);
  ok(`Test 5: loopback UDP probe end-to-end — 20/20 received, avg RTT ${report.rttMs.avg.toFixed(3)} ms`);
}

console.log('====================================================================');
console.log(` ALL ${pass}/5 LIVELINK/LATENCY ACCEPTANCE TESTS PASSED (0 FAILURES)`);
console.log('====================================================================');
