import { describe, expect, it } from "vitest";
import {
  projectPropsToPropPlacementScene,
  propPlacementSceneToProjectProps,
} from "./project_props.js";
import type { PropPlacementScene } from "../props/prop_types.js";

const scene: PropPlacementScene = {
  schemaVersion: 1,
  sceneId: "test-scene",
  instances: [{
    assetId: "props/stone-large",
    position: [10, 20, 30],
    rotationY: Math.PI / 2,
    scale: 1.5,
    seed: 42,
    variationId: 3,
    flags: 7,
    revision: 9,
    cellCoord: [1, 2],
  }],
};

describe("project prop placement adapters", () => {
  it("exports runtime prop instances as stable project props", () => {
    const props = propPlacementSceneToProjectProps(scene);

    expect(props).toEqual([{ 
      id: "test-scene:0:props/stone-large",
      prefabId: "props/stone-large",
      position: [10, 20, 30],
      rotation: [0, expect.any(Number), 0, expect.any(Number)],
      scale: [1.5, 1.5, 1.5],
      anchor: "terrain",
      seed: 42,
      variationId: 3,
      flags: 7,
      revision: 9,
    }]);
  });

  it("restores archived project props as a runtime placement scene", () => {
    const restored = projectPropsToPropPlacementScene(propPlacementSceneToProjectProps(scene), "archive");

    expect(restored.schemaVersion).toBe(1);
    expect(restored.sceneId).toBe("archive");
    expect(restored.instances).toHaveLength(1);
    expect(restored.instances[0]).toMatchObject({
      assetId: "props/stone-large",
      position: [10, 20, 30],
      scale: 1.5,
      seed: 42,
      variationId: 3,
      flags: 7,
      revision: 9,
    });
    expect(restored.instances[0]!.rotationY).toBeCloseTo(Math.PI / 2, 6);
  });
});
