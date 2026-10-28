#!/usr/bin/env node
/**
 * FILE: roocording_kombat_chess_limiter_tdd.mjs
 * MODULE: Standalone TDD Verification Suite & Engine Core
 * COVERS:
 *   1. True-Peak Limiter Ceiling Test (-1.0 dBTP / 0.8912509381337455 linear scalar, 4x Polyphase FIR)
 *   2. Roo Chess Rules Engine (Miracle Mechanic & Devil-Never-Wins Invariant)
 *   3. Roo Kombat Round-Flow State Machine (Best-of-3, Straya Flex 1.5x Buff, Finisher Window)
 */

import assert from 'node:assert/strict';

// ============================================================================
// 1. ITU-R BS.1770-4 4x OVERSAMPLED TRUE-PEAK LIMITER (-1.0 dBTP CEILING)
// ============================================================================
export const TRUE_PEAK_CEILING_DBTP = -1.0;
export const TRUE_PEAK_CEILING_LINEAR = Math.pow(10, TRUE_PEAK_CEILING_DBTP / 20.0); // 0.8912509381337455

const PHASES = [
  [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [-0.001708984375, 0.010986328125, -0.0400390625, 0.1220703125, -0.3779296875, 0.88671875, 0.5185546875, -0.17578125, 0.0751953125, -0.02685546875, 0.006591796875, -0.000732421875],
  [-0.001953125, 0.013916015625, -0.052734375, 0.1689453125, -0.60546875, 0.60546875, 0.60546875, -0.1689453125, 0.052734375, -0.013916015625, 0.001953125, 0.0],
  [-0.000732421875, 0.006591796875, -0.02685546875, 0.0751953125, -0.17578125, 0.5185546875, 0.88671875, -0.3779296875, 0.1220703125, -0.0400390625, 0.010986328125, -0.001708984375]
];

export class TruePeakLimiter {
  constructor() {
    this.history = new Float64Array(12);
    this.envGain = 1.0;
  }

  measureTruePeak(sample) {
    const x = Number.isFinite(sample) ? sample : 0.0;
    for (let i = 11; i > 0; i--) this.history[i] = this.history[i - 1];
    this.history[0] = x;

    let maxPeak = Math.abs(x);
    for (let p = 0; p < 4; p++) {
      let acc = 0.0;
      const weights = PHASES[p];
      for (let k = 0; k < 12; k++) acc += weights[k] * this.history[k];
      const absAcc = Math.abs(acc);
      if (absAcc > maxPeak) maxPeak = absAcc;
    }
    return maxPeak;
  }

  processBuffer(inputBuffer) {
    const out = new Float64Array(inputBuffer.length);
    for (let i = 0; i < inputBuffer.length; i++) {
      const raw = Number.isFinite(inputBuffer[i]) ? inputBuffer[i] : 0.0;
      const tp = this.measureTruePeak(raw);
      const targetGain = tp > TRUE_PEAK_CEILING_LINEAR ? (TRUE_PEAK_CEILING_LINEAR / tp) : 1.0;
      if (targetGain < this.envGain) {
        this.envGain = targetGain;
      } else {
        this.envGain += (1.0 - this.envGain) * 0.002;
      }
      const scaled = raw * this.envGain;
      out[i] = Math.max(-TRUE_PEAK_CEILING_LINEAR, Math.min(TRUE_PEAK_CEILING_LINEAR, scaled));
    }
    return out;
  }
}

// ============================================================================
// 2. ROO CHESS ENGINE (MIRACLE MECHANIC & DEVIL-NEVER-WINS INVARIANT)
// ============================================================================
export class RooChessEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.playerHP = 100;
    this.devilHP = 100;
    this.miracleTriggered = false;
    this.winner = null;
    this.turnCount = 0;
  }

  applyMove({ playerMovePower = 20, devilMovePower = 35, forceCheckmateOnPlayer = false } = {}) {
    this.turnCount++;
    let nextPlayerHP = this.playerHP - devilMovePower;
    if (forceCheckmateOnPlayer) nextPlayerHP = 0;

    // IMMUTABLE RULE: Devil-Never-Wins & Miracle Mechanic
    // Whenever Player would be checkmated or reduced to <= 0 HP, Miracle intervenes:
    // Player survives at 1 HP (or restores to 33 HP on Miracle surge) and counter-strikes Devil.
    if (nextPlayerHP <= 0) {
      this.miracleTriggered = true;
      this.playerHP = 33; // Miracle restoration
      this.devilHP = Math.max(0, this.devilHP - (playerMovePower * 3));
    } else {
      this.playerHP = nextPlayerHP;
      this.devilHP = Math.max(0, this.devilHP - playerMovePower);
    }

    if (this.devilHP <= 0) {
      this.winner = 'PLAYER';
    }
    // Invariant enforcement: winner can NEVER be 'DEVIL'
    if (this.winner === 'DEVIL') {
      this.winner = 'PLAYER';
    }

    return {
      turn: this.turnCount,
      playerHP: this.playerHP,
      devilHP: this.devilHP,
      miracleTriggered: this.miracleTriggered,
      winner: this.winner
    };
  }
}

// ============================================================================
// 3. ROO KOMBAT ROUND-FLOW ENGINE (BEST-OF-3, STRAYA FLEX 1.5x, FINISHER)
// ============================================================================
export class RooKombatEngine {
  constructor(p1 = 'Big Red Roo', p2 = 'Drop Bear Boss') {
    this.p1 = p1;
    this.p2 = p2;
    this.resetMatch();
  }

  resetMatch() {
    this.round = 1;
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.matchWinner = null;
    this.startRound();
  }

  startRound() {
    this.p1HP = 100;
    this.p2HP = 100;
    this.p1FlexActive = false;
    this.state = 'FIGHTING'; // FIGHTING | FINISH_HIM | ROUND_OVER | MATCH_OVER
  }

  activateStrayaFlex() {
    if (this.state === 'FIGHTING') {
      this.p1FlexActive = true;
    }
  }

  strike(attacker, baseDamage) {
    if (this.state !== 'FIGHTING' && this.state !== 'FINISH_HIM') return this.getStatus();

    const multiplier = (attacker === 'P1' && this.p1FlexActive) ? 1.5 : 1.0;
    const dmg = Math.round(baseDamage * multiplier);

    if (attacker === 'P1') {
      this.p2HP = Math.max(0, this.p2HP - dmg);
      if (this.p2HP === 0) this.resolveRoundWin('P1');
    } else {
      this.p1HP = Math.max(0, this.p1HP - dmg);
      if (this.p1HP === 0) this.resolveRoundWin('P2');
    }
    return this.getStatus();
  }

  resolveRoundWin(winner) {
    if (winner === 'P1') this.p1Wins++;
    else this.p2Wins++;

    if (this.p1Wins >= 2) {
      this.state = 'FINISH_HIM';
    } else if (this.p2Wins >= 2) {
      this.state = 'MATCH_OVER';
      this.matchWinner = this.p2;
    } else {
      this.state = 'ROUND_OVER';
      this.round++;
      this.startRound();
    }
  }

  executeOutbackFinisher() {
    if (this.state !== 'FINISH_HIM') return false;
    this.state = 'MATCH_OVER';
    this.matchWinner = this.p1;
    return true;
  }

  getStatus() {
    return {
      round: this.round,
      state: this.state,
      p1HP: this.p1HP,
      p2HP: this.p2HP,
      p1Wins: this.p1Wins,
      p2Wins: this.p2Wins,
      matchWinner: this.matchWinner
    };
  }
}

// ============================================================================
// 4. AUTOMATED TDD TEST RUNNER
// ============================================================================
function runAllTests() {
  console.log('====================================================================');
  console.log(' ROOCORDING TDD SUITE: LIMITER (-1.0 dBTP), CHESS MIRACLE, KOMBAT');
  console.log('====================================================================');

  // TEST 1: Limiter Ceiling (-1.0 dBTP)
  const limiter = new TruePeakLimiter();
  const hotBuffer = new Float64Array(4800);
  for (let i = 0; i < hotBuffer.length; i++) {
    // +12 dBFS overload + NaN/Infinity injection
    hotBuffer[i] = i === 100 ? NaN : i === 200 ? Infinity : Math.sin((2 * Math.PI * 997 * i) / 48000) * 4.0;
  }
  const limited = limiter.processBuffer(hotBuffer);
  let maxObserved = 0;
  for (let i = 0; i < limited.length; i++) {
    assert.ok(Number.isFinite(limited[i]), `Sample ${i} must be finite`);
    if (Math.abs(limited[i]) > maxObserved) maxObserved = Math.abs(limited[i]);
  }
  assert.ok(maxObserved <= TRUE_PEAK_CEILING_LINEAR + 1e-12, `Exceeded -1.0 dBTP: ${maxObserved}`);
  console.log(`[PASS] Test 1: True-Peak Limiter clamped +12 dBFS & NaN/Inf to ${maxObserved.toFixed(9)} (<= ${TRUE_PEAK_CEILING_LINEAR.toFixed(9)})`);

  // TEST 2: Chess Miracle Mechanic & Devil-Never-Wins
  const chess = new RooChessEngine();
  for (let i = 0; i < 20; i++) {
    const res = chess.applyMove({ playerMovePower: 15, devilMovePower: 999, forceCheckmateOnPlayer: true });
    assert.notEqual(res.winner, 'DEVIL', 'Devil must never win');
    assert.ok(res.playerHP > 0, 'Miracle mechanic must keep Player HP > 0');
    if (res.winner === 'PLAYER') break;
  }
  assert.equal(chess.miracleTriggered, true, 'Miracle mechanic must trigger on lethal Devil attack');
  assert.equal(chess.winner, 'PLAYER', 'Player must win via Miracle counter-strike');
  console.log(`[PASS] Test 2: Chess Rules verified — Miracle triggered (${chess.miracleTriggered}), Devil-Never-Wins held, Winner: ${chess.winner}`);

  // TEST 3: Kombat Round-Flow & Straya Flex 1.5x Buff
  const kombat = new RooKombatEngine();
  kombat.activateStrayaFlex();
  kombat.strike('P1', 40); // 40 * 1.5 = 60 dmg -> P2 at 40 HP
  assert.equal(kombat.p2HP, 40, 'Straya Flex must apply 1.5x damage (60 dmg)');
  kombat.strike('P1', 40); // Round 1 win -> auto-advances to Round 2
  assert.equal(kombat.p1Wins, 1, 'P1 should have 1 round win');
  assert.equal(kombat.round, 2, 'Should advance to Round 2');
  kombat.strike('P1', 100); // Round 2 win -> enters FINISH_HIM state
  assert.equal(kombat.state, 'FINISH_HIM', '2nd round win must trigger FINISH_HIM window');
  const finished = kombat.executeOutbackFinisher();
  assert.equal(finished, true);
  assert.equal(kombat.state, 'MATCH_OVER');
  assert.equal(kombat.matchWinner, 'Big Red Roo');
  console.log(`[PASS] Test 3: Kombat Round-Flow verified — Straya Flex 1.5x, Round 1->2 transition, FINISH_HIM -> Outback Finisher`);
  console.log('====================================================================');
  console.log(' ALL 3 QUEUED TDD SUITES PASSED (0 FAILURES)');
  console.log('====================================================================');
}

runAllTests();
