import { describe, expect, it } from "vitest";
import type { ProjectPropInstance } from "../../project/project_props.js";
import type { PropAssetDef, PropPlacementScene } from "../../props/prop_types.js";
import { createSaveIdFactory } from "../save_ids.js";
import {
  mergeSavedPropsFromRegions,
  partitionSavedPropsByRegion,
  savedPropsFromPlacementScene,
  savedPropsFromProjectProps,
  savedPropsToPlacementScene,
} from "../prop_partition.js";

const assetDefs = [
  { id: "stone_ruin_wall", category: "large_static" },
  { id: "oak_scatter", category: "vegetation" },
] satisfies readonly Pick<PropAssetDef, "id" | "category">[];

function legacyProp(overrides: Partial<ProjectPropInstance> = {}): ProjectPropInstance {
  return {
    id: "scene:0:stone_ruin_wall",
    prefabId: "stone_ruin_wall",
    position: [10, 20, 30],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    anchor: "terrain",
    seed: 42,
    variationId: 3,
    flags: 7,
    revision: 9,
    ...overrides,
  };
}

describe("saved prop partition", () => {
  it("migrates legacy scene ids to factory ids on first save", () => {
    const result = savedPropsFromProjectProps([legacyProp()], {
      nextId: createSaveIdFactory(7),
      assetDefs,
    });

    expect(result.migratedIds).toBe(1);
    expect(result.savedProps[0]?.id).toMatch(/^p_[0-9a-z]{6}_[0-9a-f]{4}$/);
    expect(result.savedProps[0]).toMatchObject({
      prefabId: "stone_ruin_wall",
      position: [10, 20, 30],
      regionKey: "r_0_0",
      state: "active",
      tags: [],
    });
  });

  it("preserves factory ids and excludes scatter vegetation", () => {
    const result = savedPropsFromProjectProps([
      legacyProp({ id: "p_000001_ab12" }),
      legacyProp({ id: "scene:1:oak_scatter", prefabId: "oak_scatter" }),
    ], { nextId: createSaveIdFactory(7), assetDefs });

    expect(result.migratedIds).toBe(0);
    expect(result.skippedVegetation).toBe(1);
    expect(result.savedProps.map((prop) => prop.id)).toEqual(["p_000001_ab12"]);
  });

  it("sources props from the same placement-scene adapter as project archives", () => {
    const scene: PropPlacementScene = {
      schemaVersion: 1,
      sceneId: "props-test",
      instances: [{
        assetId: "stone_ruin_wall",
        position: [512, 4, -1],
        rotationY: Math.PI / 3,
        scale: 2,
        seed: 12,
        variationId: 1,
        flags: 0,
        revision: 5,
      }],
    };

    const result = savedPropsFromPlacementScene(scene, { nextId: createSaveIdFactory(1), assetDefs });

    expect(result.savedProps[0]).toMatchObject({
      prefabId: "stone_ruin_wall",
      position: [512, 4, -1],
      scale: [2, 2, 2],
      regionKey: "r_1_-1",
    });
  });

  it("partitions and merges saved props by region", () => {
    const result = savedPropsFromProjectProps([
      legacyProp({ id: "p_000001_ab12", position: [0, 1, 0] }),
      legacyProp({ id: "p_000002_cd34", position: [512, 1, -1] }),
    ], { assetDefs });

    const byRegion = partitionSavedPropsByRegion(result.savedProps);
    const merged = mergeSavedPropsFromRegions(byRegion.values());

    expect([...byRegion.keys()].sort()).toEqual(["r_0_0", "r_1_-1"]);
    expect(merged.map((prop) => prop.id)).toEqual(["p_000001_ab12", "p_000002_cd34"]);
  });

  it("reloads active saved props into a placement scene and skips hidden/destroyed props", () => {
    const result = savedPropsFromProjectProps([
      legacyProp({ id: "p_000001_ab12", position: [10, 20, 30] }),
      legacyProp({ id: "p_000002_cd34", position: [20, 20, 30] }),
    ], { assetDefs });
    result.savedProps[1] = { ...result.savedProps[1]!, state: "destroyed" };

    const scene = savedPropsToPlacementScene(result.savedProps, "saved-world");

    expect(scene.sceneId).toBe("saved-world");
    expect(scene.instances).toHaveLength(1);
    expect(scene.instances[0]).toMatchObject({
      assetId: "stone_ruin_wall",
      scale: 1,
      seed: 42,
      variationId: 3,
      flags: 7,
      revision: 9,
    });
  });

  it("rejects a saved prop stored under the wrong region", () => {
    const result = savedPropsFromProjectProps([legacyProp({ id: "p_000001_ab12" })], { assetDefs });
    const broken = [{ ...result.savedProps[0]!, regionKey: "r_99_99" }];

    expect(() => partitionSavedPropsByRegion(broken)).toThrow(/belongs/i);
  });
});
