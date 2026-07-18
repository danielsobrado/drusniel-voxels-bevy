import type { CameraPoseArgs, CdpPage } from "./water-harness.js";

export type WaterShotScene =
  | "single"
  | "lake-shoreline"
  | "river-bend"
  | "dry-to-water-crossing"
  | "clipmap-boundary"
  | "shallow-glacial-river"
  | "rapid-bed-step"
  | "deep-glacial-lake"
  | "low-sun-glitter";

export type WaterShotDebugMode =
  | "final"
  | "depth"
  | "foam"
  | "fresnel"
  | "flow"
  | "clipmapLevel"
  | "refraction"
  | "reflection"
  | "ssrHit";

export interface WaterShotCandidatePose extends CameraPoseArgs {
  depth: number;
  wetFraction: number;
  kind: "lake" | "river";
  flowSpeed: number;
  flowDrop: number;
  score: number;
}

export interface WaterShotScenePolicy {
  kind: "lake" | "river" | "any";
  minDepth: number;
  maxDepth: number;
  targetDepth: number;
  minFlow: number;
  minDrop: number;
  minWetFraction: number;
  flowWeight: number;
  dropWeight: number;
  calmWeight: number;
  crossingTargetM: number | null;
  viewMode: "bank" | "downstream";
  fixedYawRad: number | null;
  distance: number;
  pitch: number;
}

const DEFAULT_POLICY: WaterShotScenePolicy = Object.freeze({
  kind: "any",
  minDepth: 0.08,
  maxDepth: 0.7,
  targetDepth: 0.32,
  minFlow: 0,
  minDrop: 0,
  minWetFraction: 0.25,
  flowWeight: 0,
  dropWeight: 0,
  calmWeight: 0,
  crossingTargetM: null,
  viewMode: "bank",
  fixedYawRad: null,
  distance: 26,
  pitch: -0.35,
});

export const WATER_SHOT_SCENE_POLICIES: Readonly<Record<WaterShotScene, WaterShotScenePolicy>> = Object.freeze({
  single: DEFAULT_POLICY,
  "lake-shoreline": Object.freeze({ ...DEFAULT_POLICY, kind: "lake" }),
  "river-bend": Object.freeze({ ...DEFAULT_POLICY, kind: "river", minFlow: 0.001, flowWeight: 0.2 }),
  "dry-to-water-crossing": Object.freeze({ ...DEFAULT_POLICY, crossingTargetM: 7 }),
  "clipmap-boundary": DEFAULT_POLICY,
  "shallow-glacial-river": Object.freeze({
    ...DEFAULT_POLICY,
    kind: "river",
    minDepth: 0.06,
    maxDepth: 0.6,
    targetDepth: 0.24,
    minFlow: 0.002,
    flowWeight: 0.65,
    viewMode: "downstream",
    distance: 24,
    pitch: -0.28,
  }),
  "rapid-bed-step": Object.freeze({
    ...DEFAULT_POLICY,
    kind: "river",
    minDepth: 0.04,
    maxDepth: 0.9,
    targetDepth: 0.22,
    minFlow: 0.02,
    minDrop: 0.08,
    flowWeight: 0.65,
    dropWeight: 1.15,
    viewMode: "downstream",
    distance: 20,
    pitch: -0.24,
  }),
  "deep-glacial-lake": Object.freeze({
    ...DEFAULT_POLICY,
    kind: "lake",
    minDepth: 0.55,
    maxDepth: 20,
    targetDepth: 1.6,
    minWetFraction: 0.45,
    calmWeight: 0.8,
    distance: 34,
    pitch: -0.38,
  }),
  "low-sun-glitter": Object.freeze({
    ...DEFAULT_POLICY,
    kind: "lake",
    minDepth: 0.25,
    maxDepth: 20,
    targetDepth: 1.2,
    minWetFraction: 0.4,
    calmWeight: 0.55,
    fixedYawRad: 4.101523742,
    distance: 30,
    pitch: -0.18,
  }),
});

export const STANDARD_WATER_SHOT_SCENES: readonly WaterShotScene[] = Object.freeze([
  "lake-shoreline",
  "river-bend",
  "dry-to-water-crossing",
  "clipmap-boundary",
]);

export const GLACIAL_WATER_SHOT_SCENES: readonly WaterShotScene[] = Object.freeze([
  "shallow-glacial-river",
  "rapid-bed-step",
  "deep-glacial-lake",
]);

export const WATER_SHOT_DEBUG_MODES: readonly WaterShotDebugMode[] = Object.freeze([
  "final",
  "depth",
  "foam",
  "fresnel",
  "flow",
  "clipmapLevel",
  "refraction",
  "reflection",
  "ssrHit",
]);

export function parseWaterShotScene(value: string): WaterShotScene {
  if (value in WATER_SHOT_SCENE_POLICIES) return value as WaterShotScene;
  throw new Error(`unknown --scene ${value}; expected single, all, glacial, or a registered water scene`);
}

export function parseWaterShotDebugModes(value: string): WaterShotDebugMode[] {
  if (value === "all") return [...WATER_SHOT_DEBUG_MODES];
  const normalized = value === "clipmap-level" ? "clipmapLevel" : value;
  if (WATER_SHOT_DEBUG_MODES.includes(normalized as WaterShotDebugMode)) {
    return [normalized as WaterShotDebugMode];
  }
  throw new Error(`unknown --debug ${value}; expected all or a registered water debug mode`);
}

export async function findWaterShotPose(
  page: Pick<CdpPage, "evaluate">,
  scene: WaterShotScene,
  worldCells: number,
): Promise<WaterShotCandidatePose> {
  const policy = WATER_SHOT_SCENE_POLICIES[scene];
  const pose = await page.evaluate<WaterShotCandidatePose | null>(`(() => {
    const worldCells = ${JSON.stringify(worldCells)};
    const policy = ${JSON.stringify(policy)};
    const probe = window.waterProbe;
    const dirs = Array.from({ length: 24 }, (_, i) => {
      const a = i / 24 * Math.PI * 2;
      return [Math.cos(a), Math.sin(a)];
    });
    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    const wetFraction = (x, z) => {
      let wet = 0;
      let total = 0;
      for (let dz = -8; dz <= 8; dz += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          const px = x + dx;
          const pz = z + dz;
          if (px < 0 || pz < 0 || px > worldCells || pz > worldCells) continue;
          const sample = probe(px, pz);
          total += 1;
          if (sample.depth > 0.02 && sample.bodyMask > 0.05) wet += 1;
        }
      }
      return total > 0 ? wet / total : 0;
    };
    const nearestBank = (x, z) => {
      let best = null;
      for (const [dx, dz] of dirs) {
        for (let r = 5; r <= 18; r += 1) {
          const px = x + dx * r;
          const pz = z + dz * r;
          if (px < 0 || pz < 0 || px > worldCells || pz > worldCells) continue;
          const sample = probe(px, pz);
          if (sample.depth <= 0 || sample.bodyMask <= 0.02) {
            if (!best || r < best.distance) best = { distance: r, dx, dz };
            break;
          }
        }
      }
      return best;
    };
    let best = null;
    for (let z = 0; z <= worldCells; z += 2) {
      for (let x = 0; x <= worldCells; x += 2) {
        const sample = probe(x, z);
        const flowDrop = Math.abs(sample.flowDrop);
        if (sample.depth < policy.minDepth || sample.depth > policy.maxDepth || sample.bodyMask <= 0.05) continue;
        const kind = sample.flowSpeed > 0.001 ? "river" : "lake";
        if (policy.kind !== "any" && kind !== policy.kind) continue;
        if (sample.flowSpeed < policy.minFlow || flowDrop < policy.minDrop) continue;
        const bank = nearestBank(x, z);
        if (!bank) continue;
        const wet = wetFraction(x, z);
        if (wet < policy.minWetFraction) continue;

        const depthRange = Math.max(0.1, policy.maxDepth - policy.minDepth);
        const depthScore = 1 - Math.min(1, Math.abs(sample.depth - policy.targetDepth) / Math.min(depthRange, Math.max(0.4, policy.targetDepth)));
        const flowScore = policy.minFlow > 0
          ? clamp01((sample.flowSpeed - policy.minFlow) / Math.max(0.02, policy.minFlow * 6))
          : 0;
        const dropScore = policy.minDrop > 0
          ? clamp01((flowDrop - policy.minDrop) / Math.max(0.12, policy.minDrop * 4))
          : 0;
        const calmScore = kind === "lake" ? 1 - clamp01(sample.flowSpeed / 0.02) : 0;
        const crossingScore = policy.crossingTargetM === null
          ? 0
          : Math.max(0, 1 - Math.abs(bank.distance - policy.crossingTargetM) / Math.max(1, policy.crossingTargetM));
        const score = wet * 2 + depthScore + crossingScore
          + flowScore * policy.flowWeight
          + dropScore * policy.dropWeight
          + calmScore * policy.calmWeight;

        let yaw = policy.fixedYawRad;
        if (yaw === null) {
          let viewX = -bank.dx;
          let viewZ = -bank.dz;
          const flowLength = Math.hypot(sample.flowX, sample.flowZ);
          if (policy.viewMode === "downstream" && flowLength > 0.0001) {
            viewX = sample.flowX / flowLength;
            viewZ = sample.flowZ / flowLength;
          }
          yaw = Math.atan2(viewX, -viewZ);
        }
        const candidate = {
          x,
          z,
          yaw,
          distance: policy.distance,
          pitch: policy.pitch,
          depth: sample.depth,
          wetFraction: wet,
          kind,
          flowSpeed: sample.flowSpeed,
          flowDrop,
          score,
        };
        const betterScore = !best || candidate.score > best.score + 1e-9;
        const stableTie = best && Math.abs(candidate.score - best.score) <= 1e-9
          && (candidate.z < best.z || (candidate.z === best.z && candidate.x < best.x));
        if (betterScore || stableTie) best = candidate;
      }
    }
    return best;
  })()`);
  if (!pose) throw new Error(`could not find a ${scene} water shot`);
  return pose;
}
