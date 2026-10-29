/* roocording_livelink_remap.mjs
 * CODE-REAL data module: Live Link remap tables for Kimmy's avatar.
 * Mirrors UCustomLiveLinkRemapAsset::GetRemappedBoneName_Implementation /
 * GetRemappedCurveName_Implementation semantics exactly (TMap find, passthrough
 * fallback). The C++/Blueprint table pasted into UE5 should be generated from
 * THIS data — single source of truth, validated before it ever reaches the engine.
 */

/* Body: MoCap stream joint name -> Kimmy target skeleton bone name */
const BODY_BONE_MAP = new Map(Object.entries({
  Hips: 'pelvis',
  Spine: 'spine_01',
  Spine1: 'spine_02',
  Chest: 'spine_03',
  Neck: 'neck_01',
  Head: 'head',
  LeftShoulder: 'clavicle_l',
  LeftArm: 'upperarm_l',
  LeftForeArm: 'lowerarm_l',
  LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r',
  RightArm: 'upperarm_r',
  RightForeArm: 'lowerarm_r',
  RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l',
  LeftLeg: 'calf_l',
  LeftFoot: 'foot_l',
  LeftToeBase: 'ball_l',
  RightUpLeg: 'thigh_r',
  RightLeg: 'calf_r',
  RightFoot: 'foot_r',
  RightToeBase: 'ball_r'
}));

/* Face: incoming ARKit/FACS curve name -> Kimmy blendshape name */
const CURVE_MAP = new Map(Object.entries({
  EyeBlink_L: 'EyeBlinkLeft',
  EyeBlink_R: 'EyeBlinkRight',
  Jaw_Open: 'JawOpen',
  Mouth_Smile_L: 'MouthSmileLeft',
  Mouth_Smile_R: 'MouthSmileRight',
  BrowDown_L: 'BrowDownLeft',
  BrowDown_R: 'BrowDownRight',
  JawTight: 'JawTight',
  CheekSquint_L: 'CheekSquintLeft',
  CheekSquint_R: 'CheekSquintRight',
  EyeWide_L: 'EyeWideLeft',
  EyeWide_R: 'EyeWideRight'
}));

/* UE semantics: find in map, else return the incoming name unchanged. */
function createRemapper({ boneMap = BODY_BONE_MAP, curveMap = CURVE_MAP } = {}) {
  return {
    remapBone(name) { return boneMap.get(name) ?? name; },
    remapCurve(name) { return curveMap.get(name) ?? name; },
    /* true when the name passes through unmapped (falls back to identity) */
    isBoneMapped(name) { return boneMap.has(name); },
    isCurveMapped(name) { return curveMap.has(name); }
  };
}

/* Corrected 2-bone analytic IK (the blueprint's printed formula computes only
 * the root elevation angle; both angles are needed):
 *   D  = clamp(distance(root, target), |d1-d2|+eps, d1+d2)
 *   alpha (elbow/knee bend) = acos((d1^2 + d2^2 - D^2) / (2 d1 d2))
 *   beta  (root elevation)  = acos((d1^2 + D^2 - d2^2) / (2 d1 D))  [+ pole yaw]
 * Degenerate targets (D near 0) are clamped, never NaN. */
function solveTwoBoneIK(d1, d2, D) {
  const eps = 1e-9;
  const lo = Math.abs(d1 - d2) + eps, hi = d1 + d2; // exact straight reach stays exactly straight
  const Dc = Math.min(hi, Math.max(lo, D));
  const alpha = Math.acos(Math.min(1, Math.max(-1, (d1 * d1 + d2 * d2 - Dc * Dc) / (2 * d1 * d2))));
  const beta = Math.acos(Math.min(1, Math.max(-1, (d1 * d1 + Dc * Dc - d2 * d2) / (2 * d1 * Dc))));
  /* Convention (matches UE TwoBoneIK): alpha is the INTERIOR angle at the
     middle joint — straight reach = pi, fully folded = 0. bend is the
     colloquial elbow/knee flexion: 0 = straight, pi = folded. */
  return { alpha, bend: Math.PI - alpha, beta, clampedDistance: Dc };
}

/* Preflight validator: run BEFORE pasting the table into UE5.
 * targetBones: iterable of bone names present in Kimmy's skeleton.
 * Returns { ok, problems[] } — duplicate targets, targets missing from the
 * skeleton, and empty-table mistakes are reported, never silently shipped. */
function validateRemapTables({ boneMap = BODY_BONE_MAP, curveMap = CURVE_MAP, targetBones = [] } = {}) {
  const problems = [];
  const boneSet = new Set(targetBones);
  const seenTargets = new Map(); // target -> source that claimed it first
  if (boneMap.size === 0) problems.push('bone map is empty');
  if (curveMap.size === 0) problems.push('curve map is empty');
  for (const [src, dst] of boneMap) {
    if (seenTargets.has(dst)) problems.push(`duplicate target: "${dst}" claimed by both "${seenTargets.get(dst)}" and "${src}"`);
    else seenTargets.set(dst, src);
    if (boneSet.size > 0 && !boneSet.has(dst)) problems.push(`target bone "${dst}" not found in skeleton (${src})`);
  }
  return { ok: problems.length === 0, problems };
}

globalThis.RooLiveLinkRemap = {
  BODY_BONE_MAP,
  CURVE_MAP,
  createRemapper,
  solveTwoBoneIK,
  validateRemapTables
};
