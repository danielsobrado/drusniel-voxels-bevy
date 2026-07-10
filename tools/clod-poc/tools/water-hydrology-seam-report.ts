// Hydrology authority-seam report.
//
// Quantifies the discontinuity between the two hydrology authorities that meet at the
// original finite-world boundary: the precomputed finite grid (used inside [0,worldCells])
// vs sampleInfiniteHydrology (used outside). It samples matched points straddling the
// x=worldCells edge and reports how far the two authorities disagree on water height, wet
// mask, flow direction and body kind. A large disagreement is the streaming seam that the
// tile-based authority (Phase 3) must remove; this tool records the current magnitude and
// is the regression gate for that work.
//
// Imports specific modules (never the water barrel) so it runs under bare `tsx` — the
// barrel pulls `*.wgsl?raw`, which only resolves under Vite.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { surfaceHeight } from "../src/terrain/terrain.js";
import { HydrologySystem } from "../src/water/hydrologySystem.js";
import { sampleHydrologyGrid } from "../src/water/hydrologyGrid.js";
import { sampleInfiniteHydrology } from "../src/water/infinite_hydrology.js";
import { parseWaterConfig, resolveWaterConfig } from "../src/water/water_config_parsing.js";

const root = resolve(import.meta.dirname, "..");
const worldCells = Number(process.argv[2] ?? 1024);
const waterConfig = resolveWaterConfig(
  parseWaterConfig(readFileSync(resolve(root, "config/water.yaml"), "utf8"), console.warn),
  worldCells,
);
const sampler = { surfaceHeight };
// Force infinite-world sampling on: probes run under Node where the URL-based
// infinite-islands detection is unavailable, but the seam under test only exists in that
// mode.
const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, sampler, { infiniteWorldSamples: true });

function flowAngle(fx: number, fz: number): number {
  return Math.atan2(fz, fx);
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// Walk the x = worldCells seam along z, comparing grid authority (clamped to its edge
// outside the world) against the infinite authority at the same coordinate.
let maxWaterYError = 0;
let maxDepthError = 0;
let wetMismatch = 0;
let maxFlowAngleError = 0;
let bodyKindMismatch = 0;
let samples = 0;
const BAND = 24; // metres either side of the seam
const STEP = 4;
for (let z = 0; z <= worldCells; z += 8) {
  for (let dx = -BAND; dx <= BAND; dx += STEP) {
    const x = worldCells + dx;
    const grid = sampleHydrologyGrid(hydrology.grid, x, z);
    const inf = sampleInfiniteHydrology(x, z, sampler, { drySentinelDepthM: waterConfig.hydrology.drySentinelDepth });
    const gridWet = grid.bodyMask > 0.5;
    const infWet = inf.bodyMask > 0.5;
    if (gridWet !== infWet) wetMismatch++;
    if (gridWet && infWet) {
      maxWaterYError = Math.max(maxWaterYError, Math.abs(grid.waterY - inf.waterY));
      maxDepthError = Math.max(maxDepthError, Math.abs(grid.depth - inf.depth));
      maxFlowAngleError = Math.max(maxFlowAngleError, angleDiff(flowAngle(grid.flowX, grid.flowZ), flowAngle(inf.flowX, inf.flowZ)));
    }
    if (grid.bodyKind !== inf.bodyKind) bodyKindMismatch++;
    samples++;
  }
}

// Effective-authority continuity: walk fine-grained lines across the boundary sampling
// what consumers actually see (HydrologySystem.sample with the blend band active) and
// measure the worst step between adjacent samples. This is the metric that maps to a
// visible seam; the raw algorithm disagreement above is the Phase 3 gate.
let effMaxWaterYStep = 0;
let effMaxBodyMaskStep = 0;
const EFF_STEP = 1;
const EFF_BAND = Math.max(64, waterConfig.hydrology.infinite.boundaryBlendM * 2);
for (let z = 16; z < worldCells; z += 64) {
  let prev = hydrology.sample(worldCells - EFF_BAND, z);
  for (let x = worldCells - EFF_BAND + EFF_STEP; x <= worldCells + EFF_BAND; x += EFF_STEP) {
    const cur = hydrology.sample(x, z);
    // Compare surfaces only where at least one side renders water; dry sentinel drift is invisible.
    if (prev.bodyMask > 0.05 || cur.bodyMask > 0.05) {
      effMaxWaterYStep = Math.max(effMaxWaterYStep, Math.abs(cur.waterY - prev.waterY));
    }
    effMaxBodyMaskStep = Math.max(effMaxBodyMaskStep, Math.abs(cur.bodyMask - prev.bodyMask));
    prev = cur;
  }
}

const report = {
  worldCells,
  samples,
  seam: {
    maxWaterYError: Number(maxWaterYError.toFixed(4)),
    maxDepthError: Number(maxDepthError.toFixed(4)),
    wetMaskMismatchCount: wetMismatch,
    maxFlowDirectionErrorRadians: Number(maxFlowAngleError.toFixed(4)),
    bodyKindMismatchCount: bodyKindMismatch,
  },
  effectiveContinuity: {
    stepM: EFF_STEP,
    bandM: EFF_BAND,
    maxWaterYStep: Number(effMaxWaterYStep.toFixed(4)),
    maxBodyMaskStep: Number(effMaxBodyMaskStep.toFixed(4)),
  },
  tileCache: hydrology.tileCacheStats(),
  note:
    "seam = raw disagreement between the finite grid and the infinite field at x=worldCells " +
    "(finding #1; Phase 3 tile-authority gate). effectiveContinuity = worst adjacent-sample " +
    "step of the blended authority consumers actually read; large steps there are visible seams.",
};
console.log(JSON.stringify(report, null, 2));
