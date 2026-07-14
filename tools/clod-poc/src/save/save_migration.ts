import type { WorldManifest } from "../world/world_manifest.js";
import type { SavedPropInstance, SaveWorldManifest } from "./save_schema.js";

export interface SaveManifestMigrationResult {
  readonly manifest: SaveWorldManifest;
  readonly migrated: boolean;
  readonly notes: readonly string[];
}

export interface PinnedWorldLoadDecision {
  readonly kind: "pinned-compatible" | "migration-required";
  readonly manifest: WorldManifest;
  readonly reason?: string;
}

export interface PropReconciliationReport {
  readonly checked: number;
  readonly retained: string[];
  readonly missing: string[];
}

function legacyWorldManifest(manifest: SaveWorldManifest): WorldManifest {
  return Object.freeze({
    worldId: manifest.worldId,
    seed: manifest.seed,
    generatorVersion: "legacy:infinite-islands-v1",
    terrainSourceHash: `legacy:${manifest.worldId}:${manifest.seed}`,
    mode: "infinite_islands",
    sizeM: null,
    seaLevelM: 0,
    startupWorld: Object.freeze({ pages: 0, cells: 0 }),
    artifacts: Object.freeze({}),
  });
}

/** Explicit, deterministic v1 -> v2 adapter. It never substitutes the current generator. */
export function migrateSaveManifest(manifest: SaveWorldManifest): SaveManifestMigrationResult {
  if (manifest.schemaVersion === 2) {
    if (!manifest.worldManifest) throw new Error("schema v2 save manifest is missing pinned worldManifest");
    return { manifest, migrated: false, notes: [] };
  }
  return {
    manifest: {
      ...manifest,
      schemaVersion: 2,
      proceduralProfile: "continent-v1",
      worldManifest: legacyWorldManifest(manifest),
    },
    migrated: true,
    notes: ["v1 manifest pinned to the legacy infinite-islands generator contract"],
  };
}

export function decidePinnedWorldLoad(saved: SaveWorldManifest, current: WorldManifest): PinnedWorldLoadDecision {
  const pinned = saved.worldManifest;
  if (!pinned) throw new Error("save has no pinned world manifest; run manifest migration first");
  if (pinned.worldId !== current.worldId || pinned.seed !== current.seed) {
    return { kind: "migration-required", manifest: pinned, reason: "world identity changed" };
  }
  if (pinned.generatorVersion !== current.generatorVersion || pinned.terrainSourceHash !== current.terrainSourceHash) {
    return { kind: "migration-required", manifest: pinned, reason: "generator inputs changed" };
  }
  return { kind: "pinned-compatible", manifest: pinned };
}

export function reconcileEnvironmentalPropDeltas(
  props: readonly SavedPropInstance[],
  candidateExists: (prop: SavedPropInstance) => boolean,
): PropReconciliationReport {
  const environmental = props.filter((prop) => prop.environmental !== undefined);
  const retained: string[] = [];
  const missing: string[] = [];
  for (const prop of environmental) (candidateExists(prop) ? retained : missing).push(prop.id);
  return { checked: environmental.length, retained: retained.sort(), missing: missing.sort() };
}
