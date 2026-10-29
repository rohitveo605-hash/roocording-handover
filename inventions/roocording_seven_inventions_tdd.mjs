#!/usr/bin/env node
/**
 * FILE: roocording_seven_inventions_tdd.mjs
 * Acceptance tests from RooCording__Seven_New_Quirky_Inventions.md, one per invention.
 * Run: node roocording_seven_inventions_tdd.mjs   (after importing the core)
 */
import assert from 'node:assert/strict';
import './roocording_seven_inventions_core.mjs';

const C = globalThis.RooInventions;
const SR = 48000;

function sine(freq, sec, amp, phase = 0) {
  const n = Math.floor(sec * SR);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR + phase);
  return out;
}
function whiteNoise(sec, amp, seed = 7) {
  const n = Math.floor(sec * SR);
  const out = new Float64Array(n);
  const rnd = C.mulberry32(seed);
  for (let i = 0; i < n; i++) out[i] = amp * (rnd() * 2 - 1);
  return out;
}
/* synthetic linear magnitudes (as from an AnalyserNode getFloatFrequencyData converted) */
function fftMagnitudesOf(signal) {
  const size = 2048;
  const re = new Float64Array(size), im = new Float64Array(size);
  const compass = new C.RooPhaseCompass(120, SR); // reuse its FFT
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)); // Hann, as AnalyserNode windows
    re[i] = signal[i % signal.length] * w;
  }
  compass.fft(re, im);
  const mags = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
  return mags;
}

let pass = 0;
function ok(name) { pass++; console.log(`[PASS] ${name}`); }

// ---------------------------------------------------------------- TEST 1
// Click track, 23 ms late hit. Next grid correction: positive, < 0.08T, BPM unchanged.
{
  const bpm = 120, T = 60 / bpm;
  const lateSec = 0.023;
  const sec = 4;
  const n = Math.floor(sec * SR);
  const sig = new Float64Array(n);
  for (let b = 1; b < 8; b++) {
    const t0 = Math.floor((b * T + lateSec) * SR); // every beat late by 23 ms
    for (let i = 0; i < 64; i++) sig[t0 + i] = Math.exp(-i / 8) * 0.9 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  }
  const compass = new C.RooPhaseCompass(bpm, SR);
  compass.mode = 'lock';
  for (let i = 0; i < n; i += 512) {
    compass.processBlock(sig.subarray(i, Math.min(i + 512, n)));
  }
  assert.ok(compass.corrections.length > 0, 'must produce at least one correction');
  const corrT = compass.corrections[compass.corrections.length - 1].corr; // in units of T
  assert.ok(corrT > 0, `correction must be positive for late hit (got ${corrT})`);
  assert.ok(corrT < 0.08, `correction must be < 0.08T (got ${corrT})`);
  assert.equal(compass.bpm, bpm, 'declared BPM must not change');
  ok(`Test 1: Phase Compass — 23 ms late click -> correction +${(corrT * T * 1000).toFixed(2)} ms, < 0.08T, BPM locked at ${bpm}`);
}

// ---------------------------------------------------------------- TEST 2
// 100 Hz sine -> low wind/storm; white noise -> higher flatness and storm. Deterministic.
{
  const w = new C.RooHarmonicWeather(SR);
  const sineMags = fftMagnitudesOf(sine(100, 0.1, 0.8));
  const noiseMags = fftMagnitudesOf(whiteNoise(0.1, 0.5));
  let s, nn;
  for (let i = 0; i < 40; i++) { s = w.compute(sineMags, 1 / 30); }
  for (let i = 0; i < 40; i++) { nn = w.compute(noiseMags, 1 / 30); }
  assert.ok(s.wind < 0.05, `100 Hz sine wind must be low (got ${s.wind.toFixed(3)})`);
  assert.ok(s.storm < 0.25, `100 Hz sine storm must be low (got ${s.storm.toFixed(3)})`);
  assert.ok(nn.storm > s.storm, `white noise storm (${nn.storm.toFixed(3)}) must exceed sine storm (${s.storm.toFixed(3)})`);
  // determinism: same input sequence -> same trace
  const w2 = new C.RooHarmonicWeather(SR);
  let a2, b2;
  for (let i = 0; i < 40; i++) a2 = w2.compute(sineMags, 1 / 30);
  for (let i = 0; i < 40; i++) b2 = w2.compute(noiseMags, 1 / 30);
  assert.deepEqual([a2.wind, a2.storm, a2.rain], [s.wind, s.storm, s.rain], 'same input must give same control trace');
  ok(`Test 2: Harmonic Weather — sine (wind ${s.wind.toFixed(3)}, storm ${s.storm.toFixed(3)}) vs noise (storm ${nn.storm.toFixed(3)}), deterministic`);
}

// ---------------------------------------------------------------- TEST 3
// 110 Hz at 48 kHz: measured period ~ 1/110 s, finite, no output above full scale.
{
  const out = C.RooPocketWaveguide.renderPluck(110, 0.998, 0.3, 1.0, SR);
  let finite = true, maxAbs = 0;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) finite = false;
    const a = Math.abs(out[i]);
    if (a > maxAbs) maxAbs = a;
  }
  assert.ok(finite, 'all samples finite');
  assert.ok(maxAbs <= 1.0, `no output above full scale (got ${maxAbs})`);
  const period = C.RooPocketWaveguide.measuredPeriod(out, SR);
  const expected = 1 / 110;
  const err = Math.abs(period - expected) / expected;
  assert.ok(err < 0.03, `period ${period.toFixed(6)} s should be near ${expected.toFixed(6)} s (err ${(err * 100).toFixed(2)}%)`);
  // delay line bound: buffer for 40 Hz at 48 kHz is clamped
  const low = C.RooPocketWaveguide.renderPluck(40, 0.998, 0.3, 0.05, SR);
  assert.equal(low.length, Math.floor(0.05 * SR), 'lowest clamped freq renders without overflow');
  ok(`Test 3: Pocket Waveguide — 110 Hz measured period ${period.toFixed(5)} s (target 0.00909 s), max ${maxAbs.toFixed(3)}, finite`);
}

// ---------------------------------------------------------------- TEST 4
// Loud 1 kHz source + quiet 1 kHz target reduces only the overlapping band;
// 5 kHz target stays within 0.5 dB of bypass for a 1 kHz-only source.
{
  const mask = new C.RooMaskLantern(SR);
  const src1k = mask.bandLevels(fftMagnitudesOf(sine(1000, 0.1, 0.9)));
  const tgt1k = mask.bandLevels(fftMagnitudesOf(sine(1000, 0.1, 0.02)));
  const tgt5k = mask.bandLevels(fftMagnitudesOf(sine(5000, 0.1, 0.02)));
  // band index for 1 kHz: edges [...,630,1000,1600,...] -> band 4 (1000-1600)
  const g1 = mask.computeGains(src1k, tgt1k, 1 / 30);
  for (let i = 0; i < 30; i++) mask.computeGains(src1k, tgt1k, 1 / 30); // settle attack
  const g1f = mask.gainDb.slice();
  assert.ok(g1f[4] < -0.5, `overlapping 1 kHz band must be ducked (got ${g1f[4].toFixed(2)} dB)`);
  const mask2 = new C.RooMaskLantern(SR);
  for (let i = 0; i < 31; i++) mask2.computeGains(src1k, tgt5k, 1 / 30);
  const g2 = mask2.gainDb.slice();
  // 5 kHz band (4000-6300 -> index 7) must stay within 0.5 dB of bypass (0 dB)
  assert.ok(Math.abs(g2[7]) <= 0.5, `5 kHz band must stay within 0.5 dB of bypass (got ${g2[7].toFixed(2)} dB)`);
  ok(`Test 4: Mask Lantern — 1 kHz overlap ducked ${g1f[4].toFixed(2)} dB; 5 kHz band untouched (${g2[7].toFixed(2)} dB)`);
}

// ---------------------------------------------------------------- TEST 5
// Synthetic 5 ms echo -> ~0.8575 m; silent input -> no reliable echo.
{
  const echo = new C.RooEchoLantern(SR);
  const chirp = echo.makeChirp();
  const pre = Math.floor(0.01 * SR);          // 10 ms direct path
  const gap = Math.floor(0.005 * SR);         // +5 ms echo
  const total = pre + gap + chirp.length + 64;
  const rec = new Float64Array(total);
  for (let i = 0; i < chirp.length; i++) {
    rec[pre + i] += chirp[i];
    rec[pre + gap + i] += chirp[i] * 0.6;
  }
  const est = echo.estimateDistance(rec, chirp, pre / SR);
  assert.ok(est.reliable, 'synthetic echo must be detected');
  assert.ok(Math.abs(est.distanceM - 0.8575) < 0.05, `distance ~0.8575 m (got ${est.distanceM.toFixed(4)} m)`);
  const silent = new Float64Array(Math.floor(0.3 * SR));
  const est2 = echo.estimateDistance(silent, chirp, 0);
  assert.ok(!est2.reliable, 'silent input must return no reliable echo');
  ok(`Test 5: Echo Lantern — 5 ms echo -> ${est.distanceM.toFixed(4)} m (target 0.8575 m); silent input honestly rejected`);
}

// ---------------------------------------------------------------- TEST 6
// Simulated gravity at 0 deg / 22.5 deg / 45 deg -> three ordered subdivisions; clamped [0,3].
{
  const arp = new C.RooGravityArpeggiator();
  function tilt(deg) {
    const r = (deg * Math.PI) / 180;
    return { gx: 0, gy: Math.sin(r), gz: Math.cos(r) }; // normalized |g| = 1
  }
  const r0 = arp.subdivisionFromTilt(tilt(0).gx, tilt(0).gy, tilt(0).gz);
  const r1 = arp.subdivisionFromTilt(tilt(22.5).gx, tilt(22.5).gy, tilt(22.5).gz);
  const r2 = arp.subdivisionFromTilt(tilt(45).gx, tilt(45).gy, tilt(45).gz);
  // dead-zone: re-feed 1 deg (within 3 deg) must not change index
  const rHold = arp.subdivisionFromTilt(tilt(44).gx, tilt(44).gy, tilt(44).gz);
  assert.ok(r0.index < r1.index && r1.index <= r2.index, `ordered: ${r0.index} < ${r1.index} <= ${r2.index}`);
  assert.ok(rHold.index === r2.index, 'dead zone holds last subdivision');
  const rNeg = arp.subdivisionFromTilt(0, -0.7071, 0.7071);
  assert.ok(rNeg.index >= 0, 'clamped low');
  const rOver = arp.subdivisionFromTilt(0, 10, 0); // extreme tilt
  assert.ok(rOver.index <= 3, 'clamped high');
  ok(`Test 6: Gravity Arpeggiator — 0 deg -> ${r0.name}, 22.5 deg -> ${r1.name}, 45 deg -> ${r2.name}; dead-zone + clamp held`);
}

// ---------------------------------------------------------------- TEST 7
// Near-Nyquist tone: forecast >= sample peak; safe signal: non-negative margin.
{
  // 6 kHz tone at 48 kHz (Nyquist/4), amplitude 0.92, phase pi/4 so samples are NOT at peaks
  const tone = sine(6000, 0.05, 0.92, Math.PI / 4);
  let samplePeak = 0;
  for (let i = 0; i < tone.length; i++) samplePeak = Math.max(samplePeak, Math.abs(tone[i]));
  const f1 = C.RooPeakForecast.forecast(tone, SR);
  assert.ok(f1.maxPeak >= samplePeak - 1e-9, `forecast ${f1.maxPeak.toFixed(4)} must be >= sample peak ${samplePeak.toFixed(4)}`);
  assert.ok(f1.risk, '0.92 near-Nyquist tone must forecast risk');
  const safe = sine(6000, 0.05, 0.7, Math.PI / 4);
  const f2 = C.RooPeakForecast.forecast(safe, SR);
  assert.ok(f2.marginDb >= 0, `safe signal margin must be non-negative (got ${f2.marginDb.toFixed(2)} dB)`);
  assert.ok(f2.note.includes('not a certified'), 'must never claim certified measurement');
  ok(`Test 7: Peak Forecast — tone: maxPeak ${f1.maxPeak.toFixed(4)} >= sample ${samplePeak.toFixed(4)}, margin ${f1.marginDb.toFixed(2)} dB (risk); safe margin ${f2.marginDb.toFixed(2)} dB`);
}

console.log('====================================================================');
console.log(` ALL ${pass}/7 INVENTION ACCEPTANCE TESTS PASSED (0 FAILURES)`);
console.log('====================================================================');
