import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WorldManifest } from "../../world/world_manifest.js";
import type { SavedPropInstance, SaveWorldManifest } from "../save_schema.js";
import { decidePinnedWorldLoad, migrateSaveManifest, reconcileEnvironmentalPropDeltas } from "../save_migration.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/save-manifest-v1.json", import.meta.url), "utf8")) as SaveWorldManifest;

describe("save manifest migration and pinning", () => {
  it("loads the v1 fixture through an explicit pinned v2 migration", () => {
    const result = migrateSaveManifest(fixture);
    expect(result.migrated).toBe(true);
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.proceduralProfile).toBe("continent-v1");
    expect(result.manifest.worldManifest?.generatorVersion).toBe("legacy:infinite-islands-v1");
  });

  it("keeps identical generator inputs pinned and requires migration when changed", () => {
    const saved = migrateSaveManifest(fixture).manifest;
    const current = saved.worldManifest as WorldManifest;
    expect(decidePinnedWorldLoad(saved, current).kind).toBe("pinned-compatible");
    expect(decidePinnedWorldLoad(saved, { ...current, generatorVersion: "next" }).kind).toBe("migration-required");
  });

  it("reports environmental deltas whose candidates no longer exist", () => {
    const props = [1, 2].map((candidateIndex): SavedPropInstance => ({
      id: `env_${candidateIndex}`, prefabId: "environment/tree", position: [0, 0, 0],
      rotation: [0, 0, 0, 1], scale: [1, 1, 1], regionKey: "r_0_0", state: "destroyed", tags: [],
      environmental: { tileKey: { x: 0, z: 0 }, layer: "tree", candidateIndex },
    }));
    expect(reconcileEnvironmentalPropDeltas(props, (prop) => prop.environmental?.candidateIndex === 1)).toEqual({
      checked: 2, retained: ["env_1"], missing: ["env_2"],
    });
  });
});
