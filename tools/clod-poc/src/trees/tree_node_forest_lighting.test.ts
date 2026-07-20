import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { vec3 } from "three/tsl";
import {
  cloneForestLightingSettings,
  type ForestLightingMaterialState,
} from "../forest_lighting/index.js";
import type { TreeLod } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import { decorateTreeNodeForestLighting } from "./tree_node_forest_lighting.js";

const LODS: TreeLod[] = ["near", "mid", "far", "impostor"];

describe("CPU WebGPU tree forest-lighting wrapper", () => {
  it("replaces the legacy updater with the packed and auxiliary node contract", () => {
    const legacyUpdate = vi.fn();
    const handle = decorateTreeNodeForestLighting(fakeHandle(legacyUpdate));
    const live = forestState();

    handle.updateForestLighting?.(live);
    handle.updateForestLighting?.(null);

    expect(legacyUpdate).not.toHaveBeenCalled();
    live.textureHandle.dispose();
    handle.dispose();
  });

  it("releases both decorator-owned neutral textures when the material is disposed", () => {
    const handle = decorateTreeNodeForestLighting(fakeHandle(vi.fn()));
    const disposeSpy = vi.spyOn(THREE.DataTexture.prototype, "dispose");

    handle.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(2);
    disposeSpy.mockRestore();
  });

  it("fails closed when the material does not own the node forest contract", () => {
    const regularMaterial = new THREE.MeshBasicMaterial();
    const handle = fakeHandle(vi.fn(), regularMaterial);

    expect(() => decorateTreeNodeForestLighting(handle)).toThrow(
      "tree impostor node material does not expose a color node",
    );

    handle.dispose();
  });
});

function fakeHandle(
  updateForestLighting: (state: ForestLightingMaterialState | null) => void,
  regularMaterial: THREE.Material = nodeMaterial(),
): TreeMaterialHandle {
  const debug = new THREE.MeshBasicMaterial();
  const debugMaterials = Object.fromEntries(LODS.map((lod) => [lod, debug])) as unknown as Record<TreeLod, THREE.Material>;
  return {
    regularMaterial,
    debugMaterials,
    setTime() {},
    updateSettings() {},
    updateForestLighting,
    dispose() {
      regularMaterial.dispose();
      debug.dispose();
    },
  };
}

function nodeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec3(1, 1, 1);
  return material;
}

function forestState(): ForestLightingMaterialState {
  const texture = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
  const auxTexture = new THREE.DataTexture(new Uint8Array([5, 6, 7, 8]), 1, 1);
  const detailTexture = new THREE.DataTexture(new Uint8Array([9, 10, 11, 12]), 1, 1);
  const settings = cloneForestLightingSettings();
  settings.materialIntegration.debugMode = "combined";
  return {
    worldCells: 64,
    settings,
    textureHandle: {
      texture,
      auxTexture,
      detailTexture,
      resolution: 1,
      worldCells: 2048,
      canopyHeightScaleM: 20,
      update() {},
      dispose() {
        texture.dispose();
        auxTexture.dispose();
        detailTexture.dispose();
      },
    },
  };
}
