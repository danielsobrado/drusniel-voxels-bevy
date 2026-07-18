import assert from "node:assert/strict";
import { buildHeightfieldTile } from "../src/world/heightfield_tiles/heightfield_tile.js";
import { compileFeatureStamps } from "../src/world/feature_stamps.js";
import { deriveEnvironmentalPropId, enumerateTreeCandidatesForTile } from "../src/world/prop_identity.js";
import { SparsePropExclusionBitsets } from "../src/world/prop_exclusion.js";
import type { SavedPropInstance, WorldMetadataRecord } from "../src/save/save_schema.js";
import { canonicalConstructionPieces } from "../src/construction/construction_semantic.js";
import { reevaluateConstructionSupport } from "../src/construction/support_reevaluation.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "../src/construction/types.js";

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

/**
 * Dig-under → unsupported semantic state, then reorder-tolerant canonicalize.
 * Full mesh/collider store round-trip stays in playable_world_p4_construction.test.ts
 * (tsx cannot load construction.yaml / PBR assets).
 */
function verifyConstructionSemanticRoundTrip(): {
  pieces: number;
  unsupported: number;
  semanticMatch: boolean;
  digUnderApplied: boolean;
} {
  const FLOOR: ConstructionPieceDef = {
    id: "floor",
    label: "Floor",
    category: "floor",
    dimensionsM: [1, 0.2, 1],
    canGround: true,
    material: "wood",
    snapPoints: [],
  };
  const piecesById = new Map([[FLOOR.id, FLOOR]]);
  const source: PlacedConstructionPiece[] = [];
  for (let index = 0; index < 30; index += 1) {
    const connectionIds = index === 0
      ? []
      : index === 29
        ? [`piece-${index - 1}`]
        : [`piece-${index + 1}`, `piece-${index - 1}`];
    source.push({
      id: `piece-${index}`,
      typeId: FLOOR.id,
      position: [10 + (index % 6) * 2, 0.1, 10 + Math.floor(index / 6) * 2],
      rotationQuarterTurns: 0,
      material: index % 2 === 0 ? "wood" : "stone",
      grounded: true,
      connectionIds,
      stability: 1,
    });
  }

  const support = reevaluateConstructionSupport({
    pieces: source,
    piecesById,
    aabb: { minX: 0, maxX: 40, minZ: 0, maxZ: 40 },
    groundSolidAt: () => false,
  });
  assert.ok(support.groundedLost.length > 0, "dig-under must clear grounded support");
  for (const piece of source) {
    if (support.groundedLost.includes(piece.id)) {
      piece.grounded = false;
      piece.unsupported = true;
      piece.stability = 0;
    }
  }

  const reloaded = [...source].reverse().map((piece) => ({ ...piece }));
  const expected = canonicalConstructionPieces(source);
  const actual = canonicalConstructionPieces(reloaded);
  assert.deepEqual(actual, expected, "construction semantic round-trip drifted");
  const unsupported = actual.filter((piece) => piece.unsupported).length;
  assert.ok(unsupported > 0, "dig-under must leave unsupported pieces");
  assert.equal(actual[1]!.connectionIds.join(","), "piece-0,piece-2");
  return {
    pieces: actual.length,
    unsupported,
    semanticMatch: true,
    digUnderApplied: true,
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
const construction = verifyConstructionSemanticRoundTrip();

console.log(JSON.stringify({
  ok: true,
  profile: "continent-v1",
  tilesChecked: samples,
  uniqueTileHashes: new Set(hashes).size,
  propIdsChecked,
  prop_delta_count: exclusions.counters().prop_delta_count,
  prop_exclusion_tiles: exclusions.counters().prop_exclusion_tiles,
  featureStampHash: stamps.hash,
  constructionPieces: construction.pieces,
  constructionUnsupported: construction.unsupported,
  constructionSemanticMatch: construction.semanticMatch,
  constructionDigUnderApplied: construction.digUnderApplied,
}, null, 2));
