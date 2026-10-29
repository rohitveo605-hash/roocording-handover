/* roocording_seven_inventions_core.mjs
 * Pure, deterministic DSP cores for the Seven Quirky Inventions.
 * No DOM, no WebAudio — these run in Node (tests) and the browser (wired).
 * Spec source: RooCording__Seven_New_Quirky_Inventions.md (formulas verbatim).
 */

/* ---------- deterministic RNG (mulberry32) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =====================================================================
   1. ROO PHASE COMPASS — bounded PI phase-locked loop (BPM unchanged)
   ===================================================================== */
class RooPhaseCompass {
  constructor(bpm = 120, sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.setBpm(bpm);
    this.Kp = 0.18;
    this.Ki = 0.015;
    this.integral = 0;
    this.gridTime = 0;
    this.mode = 'free'; // lock | free | preview
    this.silenceSamples = 0;
    // spectral-flux onset state
    this.fftSize = 1024;
    this.hop = 256;
    this.window = new Float64Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.fftSize - 1));
      this.window[i] = w;
    }
    this.prevMag = new Float64Array(this.fftSize / 2);
    this.hist = [];       // ring of recent samples for FFT frames
    this.histLen = this.fftSize + this.hop;
    this.hist = new Float64Array(this.histLen);
    this.histPos = 0;
    this.samplesSinceHop = 0;
    this.fluxHist = [];
    this.lastPhaseError = 0;
    this.lastCorrection = 0;
    this.corrections = []; // log for tests/telemetry
  }

  setBpm(bpm) { this.bpm = bpm; this.T = 60.0 / bpm; }

  wrapHalf(x) { return x - Math.floor(x + 0.5); } // into [-0.5, 0.5)

  /* Small radix-2 FFT, in-place on re/im Float64Arrays. */
  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = re[i + j], ui = im[i + j];
          const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
          const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
          re[i + j] = ur + vr; im[i + j] = ui + vi;
          re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
          const nwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr; cwr = nwr;
        }
      }
    }
  }

  /* Feed a block of mono samples. Returns { onset, phaseError, correction, gridTime, bpm, mode }. */
  processBlock(block) {
    let result = { onset: false, phaseError: this.lastPhaseError, correction: 0, gridTime: this.gridTime, bpm: this.bpm, mode: this.mode };
    let blockEnergy = 0;
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      blockEnergy += x * x;
      this.hist[this.histPos] = x;
      this.histPos = (this.histPos + 1) % this.histLen;
      this.samplesSinceHop++;
      if (this.samplesSinceHop >= this.hop) {
        this.samplesSinceHop = 0;
        if (this.onsetFromFrame()) {
          result.onset = true;
        }
      }
    }
    const rms = Math.sqrt(blockEnergy / Math.max(1, block.length));
    if (rms < 1e-4) {
      this.silenceSamples += block.length;
      if (this.silenceSamples > this.sampleRate) this.integral = 0; // reset after long silence
    } else {
      this.silenceSamples = 0;
    }
    result.phaseError = this.lastPhaseError;
    result.correction = this.lastCorrection;
    result.gridTime = this.gridTime;
    return result;
  }

  onsetFromFrame() {
    // assemble last fftSize samples
    const re = new Float64Array(this.fftSize);
    const im = new Float64Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      const idx = (this.histPos - this.fftSize + i + this.histLen * 2) % this.histLen;
      re[i] = this.hist[idx] * this.window[i];
    }
    this.fft(re, im);
    let flux = 0;
    const half = this.fftSize / 2;
    for (let k = 1; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const d = mag - this.prevMag[k];
      if (d > 0) flux += d;
      this.prevMag[k] = mag;
    }
    const frameTime = ((this.histPos - this.fftSize + this.histLen * 2) % this.histLen) / this.sampleRate;
    this.fluxHist.push({ t: frameTime, f: flux });
    if (this.fluxHist.length > 8) this.fluxHist.shift();
    // local maximum of flux vs its neighbours, above adaptive threshold
    if (this.fluxHist.length === 8) {
      const cur = this.fluxHist[6];
      const mean = this.fluxHist.reduce((a, b) => a + b.f, 0) / this.fluxHist.length;
      if (cur.f > this.fluxHist[5].f && cur.f >= this.fluxHist[7].f && cur.f > mean * 1.6 && cur.f > 1e-3) {
        return this.onsetAt(cur.t);
      }
    }
    return false;
  }

  onsetAt(tOnset) {
    if (this.mode === 'free') { this.gridTime = tOnset; return true; } // free: follow onsets
    // grid: nearest multiple of T from origin 0
    const tGrid = Math.round((tOnset - this.gridTime) / this.T) * this.T + this.gridTime;
    const e = this.wrapHalf((tOnset - tGrid) / this.T); // [-0.5, 0.5)
    this.lastPhaseError = e;
    this.integral += e;
    const raw = this.Kp * e + this.Ki * this.integral;
    const corrT = Math.max(-0.08 * this.T, Math.min(0.08 * this.T, raw * this.T));
    if (this.mode === 'lock') {
      this.gridTime += corrT;
      this.lastCorrection = corrT / this.T; // in units of T for display
    } else {
      this.lastCorrection = 0; // preview: measure only
    }
    this.corrections.push({ t: tOnset, e, corr: corrT / this.T });
    if (this.corrections.length > 64) this.corrections.shift();
    return true;
  }
}

/* =====================================================================
   2. ROO HARMONIC WEATHER — centroid/flatness -> climate controls
   ===================================================================== */
class RooHarmonicWeather {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.wind = 0; this.storm = 0; this.rain = 0; this.flash = 0;
    this.prevLow = 0; this.lastTime = null;
  }
  /* magnitudes: linear FFT magnitudes (Uint8 from AnalyserNode or Float64). */
  compute(magnitudes, dtSec) {
    const n = magnitudes.length;
    const nyq = this.sampleRate / 2;
    const binHz = nyq / n;
    let sumMag = 0, sumFMag = 0, sumLog = 0, lowMag = 0, lowCount = 0;
    const eps = 1e-12;
    for (let k = 1; k < n; k++) {
      let m = magnitudes[k];
      if (m <= 0) continue;
      if (m > 1e6) m = 1e6; // clamp analyser-derived magnitudes defensively
      const f = k * binHz;
      sumMag += m;
      sumFMag += f * m;
      sumLog += Math.log(m + eps);
      if (f < 500) { lowMag += m; lowCount++; }
    }
    if (sumMag < 1e-9) {
      this.wind = this._smooth(this.wind, 0, dtSec, 0.45);
      this.storm = this._smooth(this.storm, 0, dtSec, 0.45);
      this.rain = this._smooth(this.rain, 0, dtSec, 0.45);
      this.flash = this._smooth(this.flash, 0, dtSec, 0.12);
      return this.state();
    }
    const centroid = sumFMag / sumMag;
    const flatness = Math.exp(sumLog / (n - 1)) / (sumMag / (n - 1) + eps);
    const lowRms = lowCount ? lowMag / lowCount : 0;
    const flux = Math.max(0, lowRms - this.prevLow);
    this.prevLow = lowRms;

    const windT = Math.max(0, Math.min(1, (centroid - 200) / 7800));
    const stormT = Math.max(0, Math.min(1, flatness * 1.8));
    const rainT = Math.max(0, Math.min(1, lowRms * 2));
    const flashT = Math.max(0, Math.min(1, flux * 12));

    this.wind = this._smooth(this.wind, windT, dtSec, 0.45);
    this.storm = this._smooth(this.storm, stormT, dtSec, 0.45);
    this.rain = this._smooth(this.rain, rainT, dtSec, 0.45);
    this.flash = this._smooth(this.flash, flashT, dtSec, 0.12);
    return this.state();
  }
  _smooth(y, x, dt, tau) { const a = 1 - Math.exp(-dt / tau); return a * x + (1 - a) * y; }
  state() { return { wind: this.wind, storm: this.storm, rain: this.rain, flash: this.flash }; }
}

/* =====================================================================
   3. ROO POCKET WAVEGUIDE — Karplus-Strong plucked string
   ===================================================================== */
class RooPocketWaveguide {
  /* Render a pluck offline (deterministic). Same math the AudioWorklet runs. */
  static renderPluck(freq, brightness = 0.998, damping = 0.35, seconds = 1.5, sampleRate = 48000, seed = 1337) {
    const f = Math.max(40, Math.min(sampleRate / 2, freq));
    const D = sampleRate / f;
    const Di = Math.floor(D);
    const d = D - Di; // fractional-delay interpolation coefficient
    const N = Math.floor(seconds * sampleRate);
    const buf = new Float64Array(Di + 2 + N); // bounded: Di <= Fs/40
    const rand = mulberry32(seed);
    for (let i = 0; i < Di + 2; i++) buf[i] = rand() * 2 - 1;
    const out = new Float64Array(N);
    const g = Math.max(0.9, Math.min(0.999, brightness));
    const a = Math.max(0, Math.min(0.9, damping)) * 0.5; // one-pole lowpass coeff
    let prev = 0;
    for (let n = 0; n < N; n++) {
      const i = Di + 2 + n;
      const v = g * ((1 - d) * buf[i - Di] + d * buf[i - Di - 1]);
      // one-pole lowpass inside the loop (energy loss at high frequencies)
      const y = (1 - a) * v + a * prev;
      buf[i] = y; prev = y;
      out[n] = Math.max(-1, Math.min(1, y));
    }
    return out;
  }
  /* Fundamental period via autocorrelation peak (raw zero crossings are
     unreliable on a harmonic-rich pluck — the waveform is sawtooth-like).
     Search lags bracketing the expected period +/-35%. */
  static measuredPeriod(samples, sampleRate, startSec = 0.05, durSec = 0.1, expectedFreq = 110) {
    const s0 = Math.floor(startSec * sampleRate);
    const N = Math.floor(durSec * sampleRate);
    if (s0 + N * 2 >= samples.length) return NaN;
    const expLag = sampleRate / expectedFreq;
    const lo = Math.max(2, Math.floor(expLag * 0.65)), hi = Math.ceil(expLag * 1.35);
    let best = -Infinity, bestLag = NaN;
    for (let lag = lo; lag <= hi; lag++) {
      let acc = 0;
      for (let n = 0; n < N; n++) acc += samples[s0 + n] * samples[s0 + n + lag];
      if (acc > best) { best = acc; bestLag = lag; }
    }
    return bestLag / sampleRate;
  }
}

/* =====================================================================
   4. ROO MASK LANTERN — masking-aware per-band duck (heuristic, honest)
   ===================================================================== */
class RooMaskLantern {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    // Bark-like band edges (Hz), 11 bands
    this.edges = [0, 200, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000];
    this.thresholdDb = 6;
    this.ratio = 0.35;
    this.maxReductionDb = 6;
    this.gainDb = new Float64Array(this.bandCount());
    this.enabled = true;
  }
  bandCount() { return this.edges.length - 1; }
  /* Band powers from linear FFT magnitudes. Returns dB per band. */
  bandLevels(magnitudes) {
    const n = magnitudes.length;
    const binHz = (this.sampleRate / 2) / n;
    const levels = new Float64Array(this.bandCount());
    const counts = new Float64Array(this.bandCount());
    for (let k = 1; k < n; k++) {
      const f = k * binHz;
      if (f >= 20000) break;
      const m = magnitudes[k];
      for (let b = 0; b < this.bandCount(); b++) {
        if (f >= this.edges[b] && f < this.edges[b + 1]) {
          levels[b] += m * m; counts[b]++; break;
        }
      }
    }
    const out = new Float64Array(this.bandCount());
    for (let b = 0; b < this.bandCount(); b++) {
      const p = counts[b] > 0 ? levels[b] / counts[b] : 0;
      out[b] = 10 * Math.log10(p + 1e-12);
    }
    return out;
  }
  /* target gains in dB from source/target band levels, with 8ms/120ms smoothing.
     srcLevels/dstLevels: dB per band (see bandLevels). dtSec: control rate step. */
  computeGains(srcLevels, dstLevels, dtSec = 1 / 30) {
    const atk = 1 - Math.exp(-dtSec / 0.008);
    const rel = 1 - Math.exp(-dtSec / 0.120);
    const out = new Float64Array(this.bandCount());
    for (let b = 0; b < this.bandCount(); b++) {
      const m = Math.max(0, srcLevels[b] - dstLevels[b] - this.thresholdDb);
      const targetDb = this.enabled ? -Math.min(m * this.ratio, this.maxReductionDb) : 0;
      const a = targetDb < this.gainDb[b] ? atk : rel; // attack when reducing more
      this.gainDb[b] += (targetDb - this.gainDb[b]) * a;
      out[b] = this.gainDb[b];
    }
    return out;
  }
}

/* =====================================================================
   5. ROO ECHO LANTERN — safe acoustic probe (chirp + cross-correlation)
   ===================================================================== */
class RooEchoLantern {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.cAir = 343;       // m/s at ~20 deg C (assumption shown in UI)
    this.relativeThreshold = 3.0; // peak must exceed mean |C| by this factor
  }
  /* Hann-windowed linear chirp, audible band (1.8k -> 3.4k), 50 ms. */
  makeChirp(duration = 0.05, f0 = 1800, f1 = 3400) {
    const N = Math.floor(duration * this.sampleRate);
    const out = new Float64Array(N);
    const k = (f1 - f0) / duration; // Hz/s sweep rate
    for (let n = 0; n < N; n++) {
      const t = n / this.sampleRate;
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
      out[n] = 0.8 * hann * Math.sin(2 * Math.PI * (f0 * t + k * t * t / 2));
    }
    return out;
  }
  /* Cross-correlate recorded with chirp. The FIRST significant local maximum is
     the direct path, the NEXT one is the first echo:
     distance = c_air * (tau_echo - tau_direct) / 2.
     Returns { reliable, delaySec, distanceM, quality }; honest 'no reliable echo'
     when fewer than two significant peaks exist. directSec is a hint only. */
  estimateDistance(recorded, chirp, directSec = 0) {
    const r = recorded, c = chirp;
    const Nr = r.length, Nc = c.length;
    if (Nr < Nc || Nc < 16) return { reliable: false, reason: 'insufficient-signal' };
    const maxLag = Nr - Nc;
    const corr = new Float64Array(maxLag + 1);
    let sumAbs = 0;
    for (let tau = 0; tau <= maxLag; tau++) {
      let acc = 0;
      for (let n = 0; n < Nc; n++) acc += r[tau + n] * c[n];
      corr[tau] = acc;
      sumAbs += Math.abs(acc);
    }
    const meanAbs = sumAbs / (maxLag + 1);
    if (meanAbs <= 0) return { reliable: false, reason: 'insufficient-signal' };
    const thresh = meanAbs * this.relativeThreshold;
    // collect significant local maxima in arrival order
    const minSep = Math.max(8, Math.floor(0.001 * this.sampleRate)); // >= 1 ms apart
    const peaks = [];
    for (let tau = 1; tau < maxLag; tau++) {
      if (corr[tau] > thresh && corr[tau] >= corr[tau - 1] && corr[tau] > corr[tau + 1]) {
        if (peaks.length === 0 || tau - peaks[peaks.length - 1].tau >= minSep) {
          peaks.push({ tau, v: corr[tau] });
        } else if (corr[tau] > peaks[peaks.length - 1].v) {
          peaks[peaks.length - 1] = { tau, v: corr[tau] };
        }
      }
    }
    if (peaks.length < 2) return { reliable: false, reason: 'no-reliable-echo', peaks: peaks.length };
    const tauDirect = peaks[0].tau / this.sampleRate;
    const tauEcho = peaks[1].tau / this.sampleRate;
    const dt = Math.max(0, tauEcho - tauDirect);
    const distance = (this.cAir * dt) / 2;
    return {
      reliable: true,
      directSec: tauDirect, delaySec: dt, distanceM: distance,
      quality: peaks[1].v / meanAbs,
      assumes: '343 m/s at 20 deg C'
    };
  }
}

/* =====================================================================
   6. ROO GRAVITY ARPEGGIATOR — tilt selects subdivision (pitch stays safe)
   ===================================================================== */
class RooGravityArpeggiator {
  constructor() {
    this.subdivisions = [1, 0.5, 1 / 3, 0.25]; // quarter, eighth, triplet, sixteenth
    this.names = ['1/4', '1/8', '1/8T', '1/16'];
    this.index = 1;
    this.accent = 0;
    this.lastTheta = 0;
  }
  /* Map normalized gravity to subdivision index [0,3] with +/-3 deg dead zone. */
  subdivisionFromTilt(gx, gy, gz) {
    const theta = Math.atan2(gy, Math.sqrt(gx * gx + gz * gz)) * 180 / Math.PI; // [-90, 90]
    if (Math.abs(theta - this.lastTheta) >= 3 || this.lastTheta === 0) {
      const idx = Math.max(0, Math.min(3, Math.floor(((theta + 45) / 90) * 3.0000001)));
      this.index = idx;
      this.lastTheta = theta;
    }
    const g = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const a = Math.max(0, Math.min(1, (g - 1) / 0.35));
    this.accent += (a - this.accent) * 0.2; // smoothed
    return { index: this.index, name: this.names[this.index], theta, accent: this.accent };
  }
  noteDurationSec(bpm) { return this.subdivisions[this.index] * (60 / bpm); }
}

/* =====================================================================
   7. ROO PEAK FORECAST — 4x polyphase inter-sample true-peak estimate
   ===================================================================== */
const FORECAST_PHASES = [
  [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [-0.001708984375, 0.010986328125, -0.0400390625, 0.1220703125, -0.3779296875, 0.88671875, 0.5185546875, -0.17578125, 0.0751953125, -0.02685546875, 0.006591796875, -0.000732421875],
  [-0.001953125, 0.013916015625, -0.052734375, 0.1689453125, -0.60546875, 0.60546875, 0.60546875, -0.1689453125, 0.052734375, -0.013916015625, 0.001953125, 0.0],
  [-0.000732421875, 0.006591796875, -0.02685546875, 0.0751953125, -0.17578125, 0.5185546875, 0.88671875, -0.3779296875, 0.1220703125, -0.0400390625, 0.010986328125, -0.001708984375]
];
const HOUSE_CEILING = 0.8912509381337455; // -1.0 dBTP

class RooPeakForecast {
  /* buffer: Float32Array/Float64Array mono. Returns forecast report (never a "certified" label). */
  static forecast(samples, sampleRate) {
    const hist = new Float64Array(12);
    let maxPeak = 0;
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const x = Number.isFinite(samples[i]) ? samples[i] : 0;
      for (let j = 11; j > 0; j--) hist[j] = hist[j - 1];
      hist[0] = x;
      const ax = Math.abs(x);
      if (ax > maxPeak) maxPeak = ax;
      // evaluate reconstruction estimate at phases 0.25 / 0.5 / 0.75
      for (let p = 1; p < 4; p++) {
        let acc = 0;
        const w = FORECAST_PHASES[p];
        for (let k = 0; k < 12; k++) acc += w[k] * hist[k];
        const aa = Math.abs(acc);
        if (aa > maxPeak) maxPeak = aa;
      }
    }
    const marginDb = -1.0 - 20 * Math.log10(Math.max(maxPeak, 1e-12));
    return {
      sampleRate,
      kernel: '4x-polyphase-12tap (BS.1770-style reconstruction estimate)',
      maxPeak,
      marginDb,
      risk: marginDb < 0,
      ceiling: HOUSE_CEILING,
      note: 'Estimate, not a certified true-peak measurement.'
    };
  }
}

globalThis.RooInventions = {
  RooPhaseCompass,
  RooHarmonicWeather,
  RooPocketWaveguide,
  RooMaskLantern,
  RooEchoLantern,
  RooGravityArpeggiator,
  RooPeakForecast,
  HOUSE_CEILING,
  mulberry32
};
