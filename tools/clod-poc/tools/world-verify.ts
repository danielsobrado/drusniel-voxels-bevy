import assert from "node:assert/strict";
import { buildHeightfieldTile } from "../src/world/heightfield_tiles/heightfield_tile.js";
import { compileFeatureStamps } from "../src/world/feature_stamps.js";
import { deriveEnvironmentalPropId, enumerateTreeCandidatesForTile } from "../src/world/prop_identity.js";
import { SparsePropExclusionBitsets } from "../src/world/prop_exclusion.js";
import type { SavedPropInstance, WorldMetadataRecord } from "../src/save/save_schema.js";

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function hashFloats(values: Float32Array): string {
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
}

const samples = arg("--tiles", 16);
const next = rng(0x6c6f6406);
const metadata: WorldMetadataRecord = {
  schemaVersion: 2,
  cities: [], districts: [], caveEntrances: [], caveSystems: [], criticalPaths: [], revision: 1,
  roads: [{ id: "verify-road", points: [[-128, 10, 0], [128, 10, 0]], widthM: 8, materialId: 1, roadType: "dirt", connectedCityIds: [], revision: 1 }],
};
const stamps = compileFeatureStamps(metadata);
const hashes: string[] = [];
let propIdsChecked = 0;

for (let index = 0; index < samples; index++) {
  const key = { x: (next() % 65) - 32, z: (next() % 65) - 32 };
  const field = { sampleHeight: (x: number, z: number) => Math.sin(x * 0.003) * 20 + Math.cos(z * 0.005) * 12 };
  const first = buildHeightfieldTile(key, field);
  const second = buildHeightfieldTile(key, field);
  const firstHash = hashFloats(first.heights);
  assert.equal(hashFloats(second.heights), firstHash, `tile drift at ${key.x},${key.z}`);
  hashes.push(firstHash);

  const candidates = enumerateTreeCandidatesForTile(key, 16);
  const ids = candidates.map((candidate) => deriveEnvironmentalPropId("verify:continent", candidate));
  assert.equal(new Set(ids).size, ids.length, `duplicate prop id at ${key.x},${key.z}`);
  assert.deepEqual(ids, candidates.map((candidate) => deriveEnvironmentalPropId("verify:continent", candidate)));
  propIdsChecked += ids.length;
}

const delta: SavedPropInstance = {
  id: "env_verify", prefabId: "environment/tree", position: [1, 0, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
  regionKey: "r_0_0", state: "destroyed", tags: ["environmental"],
  environmental: { tileKey: { x: 0, z: 0 }, layer: "tree", candidateIndex: 17 },
};
const exclusions = SparsePropExclusionBitsets.fromSavedProps([delta]);
assert.equal(exclusions.isExcluded(delta.environmental!), true, "prop delta was not applied");
assert.equal(stamps.sampleHeight(0, 0, 80), 10, "road stamp missing");
assert.equal(stamps.excludesScatter(0, 0), true, "road scatter exclusion missing");

console.log(JSON.stringify({
  ok: true,
  profile: "continent-v1",
  tilesChecked: samples,
  uniqueTileHashes: new Set(hashes).size,
  propIdsChecked,
  prop_delta_count: exclusions.counters().prop_delta_count,
  prop_exclusion_tiles: exclusions.counters().prop_exclusion_tiles,
  featureStampHash: stamps.hash,
}, null, 2));
