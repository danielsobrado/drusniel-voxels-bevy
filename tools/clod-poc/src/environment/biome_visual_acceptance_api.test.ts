import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createBiomeVisualAcceptanceApi } from "./biome_visual_acceptance_api.js";

function root(name: string, visible = true): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.visible = visible;
  return group;
}

describe("biome visual acceptance API", () => {
  it("isolates capture roots and restores their original visibility", () => {
    const scene = new THREE.Scene();
    const grass = root("grass");
    const trees = root("trees", false);
    const understory = root("understory");
    const farCanopy = new THREE.Mesh();
    farCanopy.userData.canopyTextureSetRevision = 7;
    scene.add(grass, trees, understory, farCanopy);

    const api = createBiomeVisualAcceptanceApi(scene);
    expect(api.info()).toEqual({
      variant: "all",
      roots: { grass: true, trees: true, understory: true },
      farCanopyMeshes: 1,
    });

    api.setCaptureVariant("grass");
    expect(grass.visible).toBe(true);
    expect(trees.visible).toBe(false);
    expect(understory.visible).toBe(false);
    expect(farCanopy.visible).toBe(false);

    api.setCaptureVariant("trees");
    expect(grass.visible).toBe(false);
    expect(trees.visible).toBe(true);
    expect(understory.visible).toBe(false);
    expect(farCanopy.visible).toBe(true);

    api.setCaptureVariant("terrain");
    expect(grass.visible).toBe(false);
    expect(trees.visible).toBe(false);
    expect(understory.visible).toBe(false);
    expect(farCanopy.visible).toBe(false);

    api.restore();
    expect(grass.visible).toBe(true);
    expect(trees.visible).toBe(false);
    expect(understory.visible).toBe(true);
    expect(farCanopy.visible).toBe(true);
  });
});
