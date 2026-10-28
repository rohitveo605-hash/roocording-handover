# ROOCORDING // HANDOVER PACKAGE (Phase 2)

Complete, verified build for the RooCording platform. Everything here is tested and
working. Give this whole package to the next AI with: "Continue from HANDOVER.md."

## WHERE THE BIG FILES LIVE
The three large binaries are NOT in this repo (GitHub content-API size limits):
- KingRoo-MegaStage.html (668,943 bytes) — MUSIC / DJ / LIVE
- RooKombat-OutbackBloodbath.html (30,559 bytes) — 18+ fighting game
- SpaceForce-CommandModule.html (659,414 bytes) — 3D visual scene
- RooCording-Tour-Stinger-140BPM.wav (658,328 bytes) — -1.0 dBTP stinger

They are staged in the shared persistent volume:
  /mnt/automation/1a18444c-9272-8b97-8000-00ec1aace58f/scripts/pkg/
and a cron job copies them to /mnt/agents/output/roocording-package/ the moment the
output mount heals. Everything in pkg/ is a single self-contained file — double-click to run.

Small files (this repo):
- roocording_kombat_chess_limiter_tdd.mjs — 3/3 suites PASS (node <file>)
- roocording_offline_jingle_synth.py — regenerates the stinger, zero credentials

## HOUSE RULES (non-negotiable)
- Only speaking English. Add only; close hides; never delete desk suites.
- Ceiling -1.0 dBTP = 0.891250938 linear. NEVER DynamicsCompressorNode.
  Limiter: 20 kHz band-limit -> dual detection -> 96-sample lookahead ->
  120 ms release -> 0.97 internal margin.
- No CDN — every deliverable is one self-contained file that opens over file://.
- No raw RTMP from browser. No voice cloning. Honest labels: CODE-REAL or SPEC-ONLY.
- No hate symbols. No fabricated quantum/holographic/AI-certified claims.
- User sound imports never uploaded or redistributed.
- Do NOT use the "88Streams" brand anywhere. No emojis in UI.
- Earth/Moon/UFO easter egg on top, takes no taps.

## WHAT WAS DELIVERED THIS PHASE (all headless-browser verified, zero console errors)
1. KingRoo-MegaStage.html — the user's 3D animatronic mega-stage, finished:
   de-CDN'd (three.js r128 inlined), DynamicsCompressor replaced with the real Roo
   true-peak limiter (AudioWorklet over http, identical ScriptProcessor fallback over
   file:// — HUD shows which is live), 20 kHz band-limit, master gain clamped,
   12-DoF animatronic + Mother synth + FFT-reactive stage + 4 camera passes.
2. RooKombat-OutbackBloodbath.html — brutal 18+ fighter on the TDD-verified engine:
   best-of-3, Straya Flex 1.5x, FINISH_HIM -> Outback Finisher, cartoon gore
   (toggleable), synth SFX at -1.0 dBTP. Verified through the real game path.
3. SpaceForce-CommandModule.html — night approach (under/beside/top/front/chase),
   hyperspace tunnel (warp flash, 26 rings, 900 star streaks), nebula run,
   cockpit POV + panorama. Clean branding per the 88Streams ban.
4. TDD suite — limiter clamps +12 dBFS & NaN/Inf to 0.891250938; chess miracle
   mechanic + devil-never-wins; kombat round flow. 0 failures.
5. Stinger WAV — 140 BPM, 2 bars, measured peak 0.797510690 (under ceiling).

## GENERATION STATE (OpenArt MCP, live-verified)
- Balance: 0 credits (free). Handover audit claiming 40 was STALE — verified live.
- Keyframe 2 (performer streamer-side, 2752x1536): COMPLETED, project
  4BI6xHU3XrQXzjOVDmVf, historyId cRMm4itBHKu0YtAzaHJv, watermarked URL:
  https://cdn.openart.ai/watermarked_images/fMfUPhsCld4re9dOSCY9/thumbnail_7f9b1a8d_1793219593812.webp
- Keyframe 1 payload (fire on top-up, 20 cr): model nano-banana-2, mode text2image,
  resolution 2752x1536 — prompt in git history / full HANDOVER in pkg/.
- TOUR VIDEO: 50 cr PixVerse V6 (startFrame/endFrame) or 100 cr Wan 3.0 (30 s,
  audio). Then remake frames watermark-free on any paid plan.
- Canva poster: https://canva.link/cezsr1qnroq5m30 (design DAHZVGYOIFw).

## STILL BLOCKED
- agent-gw plugins (model3d_generation, audio_generation, video_generation):
  credential symlink on dead FUSE mount (errno 107). OpenArt MCP is the only
  generation route until the platform heals.
- 12-asset 3D hive: /mnt/automation/1a18444c-9272-8b97-8000-00ec1aace58f/scripts/
  (hive_manifest.json + run_hive.py) — run when agent-gw heals.
- RooCording Desk app source on dead output mount (saved versions 5138d2c + 4f8d9a8).
- roo-pads-lab.js: waiting on user paste.

## NEXT AI: PICK UP HERE
1. Top up OpenArt -> Keyframe 1 -> Wan 3.0/PixVerse tour video -> watermark-free remakes.
2. When mounts heal: run hive, restore Desk, integrate these three apps as suites.
3. Keep every limiter at -1.0 dBTP and every label honest.
