import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshBasicNodeMaterial, StorageInstancedBufferAttribute } from "three/webgpu";
import { vec3 } from "three/tsl";
import {
  cloneForestLightingSettings,
  type ForestLightingMaterialState,
} from "../forest_lighting/index.js";
import { cloneTreeSettings, type TreeLod } from "./tree_config.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import { decorateTreeMaterialHandle } from "./tree_material_parity.js";

const LODS: TreeLod[] = ["near", "mid", "far", "impostor"];

describe("generic GPU ring forest-lighting parity", () => {
  it("uses packed and auxiliary channels with the canonical debug mapping", () => {
    const source = materialParitySource();

    expect(source).toContain("forestLightingDebugModeValue");
    expect(source).toContain("packed.x.mul(aoStrength)");
    expect(source).toContain("packed.y.mul(shadowStrength)");
    expect(source).toContain("packed.z.mul(fogStrength)");
    expect(source).toContain("packed.w.mul(RING_FOREST_SHAFT_HINT)");
    expect(source).toContain("vec3(aux.x)");
    expect(source).toContain("max(packed.z, aux.y)");
    expect(source).toContain("state.textureHandle.auxTexture");
  });

  it("rebinds neutral textures and resets mutable state on teardown", () => {
    const source = materialParitySource();

    expect(source).toContain("packed.value = neutralPackedTexture");
    expect(source).toContain("aux.value = neutralAuxTexture");
    expect(source).toContain("enabled.value = 0");
    expect(source).toContain("worldSize.value = 1");
    expect(source).toContain("aoStrength.value = 1");
    expect(source).toContain("shadowStrength.value = 1");
    expect(source).toContain("fogStrength.value = 0");
    expect(source).toContain("debugMode.value = 0");
  });

  it("releases borrowed field textures before disposing owned neutral textures", () => {
    const originalUpdate = vi.fn();
    const handle = decorateTreeMaterialHandle(fakeHandle(originalUpdate), {
      foliageAtlas: foliageAtlas(),
      ring: {
        settings: cloneTreeSettings(),
        buffers: {
          cell: new StorageInstancedBufferAttribute(4, 4),
          capacity: 4,
        },
        forestLighting: true,
      },
    });
    const live = forestState();

    handle.updateForestLighting?.(live);
    handle.updateForestLighting?.(null);
    live.textureHandle.dispose();

    expect(originalUpdate).toHaveBeenNthCalledWith(1, live);
    expect(originalUpdate).toHaveBeenNthCalledWith(2, null);

    const disposeSpy = vi.spyOn(THREE.DataTexture.prototype, "dispose");
    handle.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(2);
    disposeSpy.mockRestore();
  });
});

function materialParitySource(): string {
  return readFileSync(new URL("./tree_material_parity.ts", import.meta.url), "utf8");
}

function fakeHandle(updateForestLighting: (state: ForestLightingMaterialState | null) => void): TreeMaterialHandle {
  const regular = new MeshBasicNodeMaterial();
  regular.colorNode = vec3(1, 1, 1);
  const debug = new MeshBasicNodeMaterial();
  debug.colorNode = vec3(1, 0, 0);
  const debugMaterials = Object.fromEntries(LODS.map((lod) => [lod, debug])) as unknown as Record<TreeLod, THREE.Material>;
  return {
    regularMaterial: regular,
    debugMaterials,
    setTime() {},
    updateSettings() {},
    updateForestLighting,
    dispose() {
      regular.dispose();
      debug.dispose();
    },
  };
}

function foliageAtlas(): TreeFoliageAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    texture,
    columns: 1,
    rows: 1,
    cellSize: 1,
    dispose() {
      texture.dispose();
    },
  };
}

function forestState(): ForestLightingMaterialState {
  const texture = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
  const auxTexture = new THREE.DataTexture(new Uint8Array([5, 6, 7, 8]), 1, 1);
  const settings = cloneForestLightingSettings();
  settings.materialIntegration.debugMode = "combined";
  return {
    worldCells: 64,
    settings,
    textureHandle: {
      texture,
      auxTexture,
      update() {},
      dispose() {
        texture.dispose();
        auxTexture.dispose();
      },
    },
  };
}
