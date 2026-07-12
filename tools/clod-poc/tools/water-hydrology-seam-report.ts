// Hydrology authority-seam report.
//
// In unified startup mode the traced/tile field owns both sides of the original finite
// world boundary. The startup grid remains a raster view for GPU consumers; this report
// compares that raster against the analytic authority and measures the effective samples
// consumers receive while walking across the former boundary.
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
// Force infinite-world sampling on: probes run under Node where URL-based scene detection
// is unavailable.
const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, sampler, { infiniteWorldSamples: true });

function flowAngle(fx: number, fz: number): number {
  return Math.atan2(fz, fx);
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// Compare the startup texture raster against the analytic authority around x=worldCells.
// In legacy mode this is the old finite-grid-vs-infinite disagreement; in unified mode it
// measures only expected raster interpolation error.
let maxWaterYError = 0;
let maxDepthError = 0;
let wetMismatch = 0;
let maxFlowAngleError = 0;
let bodyKindMismatch = 0;
let samples = 0;
const BAND = 24;
const STEP = 4;
for (let z = 0; z <= worldCells; z += 8) {
  for (let dx = -BAND; dx <= BAND; dx += STEP) {
    const x = worldCells + dx;
    const grid = sampleHydrologyGrid(hydrology.grid, x, z);
    const authority = sampleInfiniteHydrology(x, z, sampler, {
      drySentinelDepthM: waterConfig.hydrology.drySentinelDepth,
    });
    const gridWet = grid.bodyMask > 0.5;
    const authorityWet = authority.bodyMask > 0.5;
    if (gridWet !== authorityWet) wetMismatch++;
    if (gridWet && authorityWet) {
      maxWaterYError = Math.max(maxWaterYError, Math.abs(grid.waterY - authority.waterY));
      maxDepthError = Math.max(maxDepthError, Math.abs(grid.depth - authority.depth));
      maxFlowAngleError = Math.max(
        maxFlowAngleError,
        angleDiff(flowAngle(grid.flowX, grid.flowZ), flowAngle(authority.flowX, authority.flowZ)),
      );
    }
    if (grid.bodyKind !== authority.bodyKind) bodyKindMismatch++;
    samples++;
  }
}

let effMaxWaterYStep = 0;
let effMaxBodyMaskStep = 0;
const EFF_STEP = 1;
const EFF_BAND = Math.max(64, waterConfig.hydrology.infinite.boundaryBlendM * 2);
for (let z = 16; z < worldCells; z += 64) {
  let prev = hydrology.sample(worldCells - EFF_BAND, z);
  for (let x = worldCells - EFF_BAND + EFF_STEP; x <= worldCells + EFF_BAND; x += EFF_STEP) {
    const cur = hydrology.sample(x, z);
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
  unifiedStartup: hydrology.unifiedStartupActive(),
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
  note: hydrology.unifiedStartupActive()
    ? "The traced/tile authority owns both sides of x=worldCells. seam is startup-raster approximation error; effectiveContinuity has no authority blend or handoff."
    : "Legacy mode: seam is finite-grid vs traced-field disagreement; effectiveContinuity includes the configured boundary blend.",
};
console.log(JSON.stringify(report, null, 2));
