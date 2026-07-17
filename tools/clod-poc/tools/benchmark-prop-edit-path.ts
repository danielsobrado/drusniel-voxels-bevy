import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LoadedSavedWorld } from "../src/save/save_service.js";
import type { SavedPropInstance } from "../src/save/save_schema.js";
import { regionKeyForWorld } from "../src/save/region_key.js";
import {
  clearSaveRuntime,
  initSaveRuntime,
  upsertSaveRuntimeProp,
} from "../src/save/save_runtime.js";
import type { PropCandidateAddress } from "../src/world/prop_identity.js";
import { deriveEnvironmentalPropId } from "../src/world/prop_identity.js";

/**
 * D0 micro-bench (rpg-content-density-scaling plan): ms/edit through the save-runtime
 * prop mutation path at N loaded props. Re-runnable: npm run bench:prop-edits -- --case <label>
 */

const PROP_COUNTS = [1_000, 10_000, 50_000];
const EDITS = 200;
const WORLD_ID = "prop-edit-bench-world";

interface EditStats {
  props_loaded: number;
  edits: number;
  init_ms: number;
  edit_ms_mean: number;
  edit_ms_p50: number;
  edit_ms_p95: number;
  edit_ms_max: number;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] ?? 0;
}

function addressFor(index: number): PropCandidateAddress {
  // Injective: index = candidateIndex * 4096 + tileZ * 64 + tileX.
  return {
    tileKey: { x: index % 64, z: Math.floor(index / 64) % 64 },
    layer: "tree",
    candidateIndex: Math.floor(index / 4096),
  };
}

function environmentalProp(index: number, state: "active" | "destroyed"): SavedPropInstance {
  const address = addressFor(index);
  const x = address.tileKey.x * 512 + 8;
  const z = address.tileKey.z * 512 + 8;
  return {
    id: deriveEnvironmentalPropId(WORLD_ID, address),
    prefabId: "environment/tree",
    position: [x, 0, z],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: regionKeyForWorld(x, z),
    state,
    tags: ["environmental"],
    environmental: address,
  };
}

function placedProp(index: number): SavedPropInstance {
  const x = (index % 128) * 4;
  const z = Math.floor(index / 128) * 4;
  return {
    id: `placed-${index}`,
    prefabId: "props/rock",
    position: [x, 0, z],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: regionKeyForWorld(x, z),
    state: "active",
    tags: [],
  };
}

function loadedWorldWithProps(props: SavedPropInstance[]): LoadedSavedWorld {
  const now = "2026-07-17T00:00:00.000Z";
  return {
    saveId: "prop-edit-bench",
    manifest: {
      schemaVersion: 1,
      saveId: "prop-edit-bench",
      worldId: WORLD_ID,
      seed: 7,
      proceduralProfile: "infinite-islands-v1",
      regionSizeM: 512,
      chunkSizeM: 16,
      regionKeys: ["r_0_0"],
      createdAt: now,
      updatedAt: now,
    },
    metadata: {
      schemaVersion: 1,
      cities: [],
      districts: [],
      roads: [],
      caveEntrances: [],
      caveSystems: [],
      criticalPaths: [],
      revision: 1,
    },
    regions: [
      {
        manifest: {
          schemaVersion: 1,
          regionKey: "r_0_0",
          rx: 0,
          rz: 0,
          revision: 1,
          authorityRevision: 0,
          voxelDeltaCount: 0,
          propCount: props.length,
          updatedAt: now,
        },
        voxelDeltas: { schemaVersion: 1, regionKey: "r_0_0", format: "json", deltas: [] },
        props,
      },
    ],
    voxelSnapshot: { schemaVersion: 1, edits: [] } as unknown as LoadedSavedWorld["voxelSnapshot"],
    voxelDeltaCount: 0,
    propInstanceCount: props.length,
    criticalPathValidation: { ok: true, issues: [] } as unknown as LoadedSavedWorld["criticalPathValidation"],
    loadMs: 0,
  };
}

function benchCase(propCount: number): EditStats {
  const props: SavedPropInstance[] = [];
  for (let i = 0; i < propCount; i++) {
    props.push(i % 2 === 0 ? environmentalProp(i, "destroyed") : placedProp(i));
  }
  const initStarted = performance.now();
  initSaveRuntime(loadedWorldWithProps(props));
  const initMs = performance.now() - initStarted;

  const durations: number[] = [];
  for (let edit = 0; edit < EDITS; edit++) {
    // Alternate the two gameplay-shaped mutations: destroy a fresh environmental
    // candidate, and restore/destroy-toggle an already-loaded one.
    const prop = edit % 2 === 0
      ? environmentalProp(propCount + edit, "destroyed")
      : environmentalProp((edit * 2) % propCount, edit % 4 === 1 ? "active" : "destroyed");
    const started = performance.now();
    upsertSaveRuntimeProp(prop);
    durations.push(performance.now() - started);
  }
  clearSaveRuntime();

  const sorted = [...durations].sort((a, b) => a - b);
  return {
    props_loaded: propCount,
    edits: EDITS,
    init_ms: Number(initMs.toFixed(2)),
    edit_ms_mean: Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(4)),
    edit_ms_p50: Number(quantile(sorted, 0.5).toFixed(4)),
    edit_ms_p95: Number(quantile(sorted, 0.95).toFixed(4)),
    edit_ms_max: Number(quantile(sorted, 1).toFixed(4)),
  };
}

function main(): void {
  const caseArgIndex = process.argv.indexOf("--case");
  const caseLabel = caseArgIndex >= 0 ? process.argv[caseArgIndex + 1] ?? "run" : "run";
  const results = PROP_COUNTS.map(benchCase);
  const outDir = resolve(import.meta.dirname, "../perf-runs/prop-edit-bench");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${caseLabel}.json`);
  writeFileSync(outPath, `${JSON.stringify({ case: caseLabel, edits: EDITS, results }, null, 2)}\n`);
  console.log(`case: ${caseLabel} (${EDITS} edits per N)`);
  console.log("props_loaded | init_ms | edit_ms_mean | edit_ms_p50 | edit_ms_p95 | edit_ms_max");
  for (const row of results) {
    console.log(
      `${String(row.props_loaded).padStart(12)} | ${String(row.init_ms).padStart(7)} | ${String(row.edit_ms_mean).padStart(12)} | ${String(row.edit_ms_p50).padStart(11)} | ${String(row.edit_ms_p95).padStart(11)} | ${String(row.edit_ms_max).padStart(11)}`,
    );
  }
  console.log(`written: ${outPath}`);
}

main();
