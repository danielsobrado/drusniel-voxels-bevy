// Infinite-islands streaming-determinism report.
//
// The acceptance target requires that the same world coordinate yields identical
// hydrology after streaming (root unload/reload, clipmap snap, quality change). At the
// CPU-sampling layer that reduces to: rebuilding the hydrology authority from the same
// seed/config must reproduce the same field, bit-for-bit within float tolerance. This
// probe rebuilds twice and compares the grid fields plus a set of fixed probe coordinates
// along a deterministic camera path crossing the world. It is the headless gate that must
// pass before the browser streaming acceptance can be trusted.
//
// Imports specific modules (never the water barrel) so it runs under bare `tsx`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { surfaceHeight } from "../src/terrain/terrain.js";
import { HydrologySystem } from "../src/water/hydrologySystem.js";
import { sampleHydrologyGrid } from "../src/water/hydrologyGrid.js";
import { checkHydrologyInvariants } from "../src/water/hydrologyInvariants.js";
import { parseWaterConfig, resolveWaterConfig } from "../src/water/water_config_parsing.js";

const root = resolve(import.meta.dirname, "..");
const worldCells = Number(process.argv[2] ?? 1024);
const waterConfig = resolveWaterConfig(
  parseWaterConfig(readFileSync(resolve(root, "config/water.yaml"), "utf8"), console.warn),
  worldCells,
);
const sampler = { surfaceHeight };

function build(): HydrologySystem {
  // Force infinite-world sampling: probes run under Node where the URL-based
  // infinite-islands detection is unavailable.
  return HydrologySystem.build(waterConfig.hydrology, worldCells, sampler, { infiniteWorldSamples: true });
}

const a = build();
const b = build();

function maxFieldDelta(x: Float32Array, y: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - y[i]);
    if (d > m) m = d;
  }
  return m;
}

const fieldDeltas = {
  waterY: maxFieldDelta(a.grid.waterY, b.grid.waterY),
  carvedBed: maxFieldDelta(a.grid.carvedBed, b.grid.carvedBed),
  wetMask: maxFieldDelta(a.grid.wetMask, b.grid.wetMask),
  flowStrength: maxFieldDelta(a.grid.flowStrength, b.grid.flowStrength),
};

// Deterministic diagonal camera path; sample fixed probe coords and confirm both builds
// agree at every one.
const probes: Array<{ x: number; z: number; waterY: number; depth: number; wet: boolean; bodyId: number }> = [];
let probeMaxDelta = 0;
for (let t = 0; t <= 16; t++) {
  const x = (worldCells * t) / 16;
  const z = (worldCells * (16 - t)) / 16;
  const sa = sampleHydrologyGrid(a.grid, x, z);
  const sb = sampleHydrologyGrid(b.grid, x, z);
  probeMaxDelta = Math.max(probeMaxDelta, Math.abs(sa.waterY - sb.waterY), Math.abs(sa.depth - sb.depth));
  probes.push({
    x: Number(x.toFixed(1)),
    z: Number(z.toFixed(1)),
    waterY: Number(sa.waterY.toFixed(3)),
    depth: Number(sa.depth.toFixed(3)),
    wet: sa.bodyMask > 0.5,
    bodyId: sa.bodyId,
  });
}

// Streaming eviction determinism: sample fixed coordinates outside the startup world,
// then force LRU evictions by sweeping distant tiles, then resample. The CPU analog of
// "reloading a streamed root does not change water": an evicted-and-rebuilt hydrology
// tile must reproduce identical values.
const outsideCoords: Array<[number, number]> = [];
for (let t = 1; t <= 8; t++) {
  outsideCoords.push([worldCells + t * 137.5, worldCells * 0.5 + t * 91.25]);
  outsideCoords.push([-t * 113.75, t * 217.5]);
}
const before = outsideCoords.map(([x, z]) => a.sample(x, z));
// Sweep far tiles to churn the LRU well past its resident budget.
for (let i = 0; i < 256; i++) {
  a.sample(worldCells + 10_000 + i * 256, -10_000 - i * 256);
}
let evictionMaxDelta = 0;
outsideCoords.forEach(([x, z], i) => {
  const after = a.sample(x, z);
  evictionMaxDelta = Math.max(
    evictionMaxDelta,
    Math.abs(after.waterY - before[i].waterY),
    Math.abs(after.depth - before[i].depth),
    Math.abs(after.bodyMask - before[i].bodyMask),
    after.bodyId === before[i].bodyId ? 0 : 1,
  );
});

const deterministic =
  fieldDeltas.waterY === 0 &&
  fieldDeltas.carvedBed === 0 &&
  fieldDeltas.wetMask === 0 &&
  fieldDeltas.flowStrength === 0 &&
  probeMaxDelta === 0 &&
  evictionMaxDelta === 0;

const invariants = checkHydrologyInvariants(a.grid);

const report = {
  worldCells,
  deterministic,
  fieldDeltas,
  probeMaxDelta,
  evictionMaxDelta,
  tileCache: a.tileCacheStats(),
  invariantsPassed: invariants.passed,
  invariantFailures: invariants.failures,
  probes,
};
console.log(JSON.stringify(report, null, 2));
if (!deterministic || !invariants.passed) process.exitCode = 1;
