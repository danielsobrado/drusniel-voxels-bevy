import { describe, expect, it } from "vitest";
import type { SaveWorldManifest } from "./save_schema.js";
import type { WorldManifest } from "../world/world_manifest.js";
import {
  installSavedWorldManifestCompatibilityGuard,
  savedWorldManifestCompatibilityFailures,
  type WorldManifestTarget,
} from "./saved_world_startup_compatibility.js";

function worldManifest(overrides: Partial<WorldManifest> = {}): WorldManifest {
  return {
    worldId: "ephemeral:1",
    seed: 1,
    generatorVersion: "world-modes-v9-feature-stamps",
    terrainSourceHash: "mutable-hash-a",
    mode: "finite",
    sizeM: { x: 4096, z: 4096 },
    seaLevelM: 18,
    startupWorld: { pages: 4, cells: 4096 },
    artifacts: { hydrologyGraph: { id: "graph-1", hash: "graph-hash" } },
    ...overrides,
  };
}

function saveManifest(pinned: WorldManifest | undefined = worldManifest()): SaveWorldManifest {
  return {
    schemaVersion: 2,
    saveId: "save-1",
    worldId: "ephemeral:1",
    seed: 1,
    proceduralProfile: "continent-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys: [],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    worldManifest: pinned,
  };
}

const mismatchCases: Array<[string, Partial<WorldManifest>]> = [
  ["generator version", { generatorVersion: "next-generator" }],
  ["world mode", { mode: "infinite_islands" }],
  ["world size", { sizeM: { x: 8192, z: 8192 } }],
  ["sea level", { seaLevelM: 20 }],
  ["artifact", { artifacts: { hydrologyGraph: { id: "graph-2", hash: "different" } } }],
];

describe("saved world startup compatibility", () => {
  it("accepts mutable cache-hash and startup-budget differences", () => {
    const saved = worldManifest({
      terrainSourceHash: "before-edits",
      startupWorld: { pages: 4, cells: 4096 },
    });
    const current = worldManifest({
      terrainSourceHash: "after-edits",
      startupWorld: { pages: 8, cells: 8192 },
    });
    expect(savedWorldManifestCompatibilityFailures(saved, current)).toEqual([]);
  });

  it.each(mismatchCases)("rejects a changed %s", (_label, overrides) => {
    const target: WorldManifestTarget = {};
    installSavedWorldManifestCompatibilityGuard(target, saveManifest());
    expect(() => {
      target.__drusnielWorldManifest = worldManifest(overrides);
    }).toThrow(/saved world is incompatible/i);
    expect(target.__drusnielWorldManifest).toBeUndefined();
  });

  it("validates an already-published manifest during installation", () => {
    const target: WorldManifestTarget = {
      __drusnielWorldManifest: worldManifest({ generatorVersion: "wrong" }),
    };
    expect(() => installSavedWorldManifestCompatibilityGuard(target, saveManifest()))
      .toThrow(/generatorVersion changed/);
  });

  it("requires a pinned schema-v2 manifest", () => {
    const invalid = { ...saveManifest(undefined), schemaVersion: 1 as const };
    expect(() => installSavedWorldManifestCompatibilityGuard({}, invalid))
      .toThrow(/pinned schema-v2 world manifest/);
  });

  it("rejects a later incompatible diagnostic publication", () => {
    const target: WorldManifestTarget = {};
    const initial = worldManifest();
    installSavedWorldManifestCompatibilityGuard(target, saveManifest(initial));
    target.__drusnielWorldManifest = initial;

    expect(() => {
      target.__drusnielWorldManifest = worldManifest({ generatorVersion: "wrong" });
    }).toThrow(/generatorVersion changed/);
    expect(target.__drusnielWorldManifest).toBe(initial);
  });

  it("restores the previous diagnostics property when disposed", () => {
    const previous = worldManifest();
    const target: WorldManifestTarget = { __drusnielWorldManifest: previous };
    const dispose = installSavedWorldManifestCompatibilityGuard(target, saveManifest(previous));
    const current = worldManifest({ terrainSourceHash: "new-cache-hash" });
    target.__drusnielWorldManifest = current;

    dispose();
    dispose();

    expect(target.__drusnielWorldManifest).toBe(previous);
    const descriptor = Object.getOwnPropertyDescriptor(target, "__drusnielWorldManifest");
    expect(descriptor?.get).toBeUndefined();
  });
});
