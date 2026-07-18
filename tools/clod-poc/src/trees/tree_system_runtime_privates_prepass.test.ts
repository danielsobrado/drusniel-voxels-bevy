import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import { treeCpuPatchInput } from "./tree_system_runtime_privates.js";

const baseNodes: PrepassNodes = {
  positionNode: { kind: "base-position" },
  maskNode: { kind: "base-mask" },
  side: THREE.FrontSide,
};

describe("tree CPU patch prepass wiring", () => {
  it("uses the ready species impostor material for the impostor LOD", () => {
    const material = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {
      positionNode?: unknown;
      maskNode?: unknown;
    };
    const positionNode = { kind: "billboard-position" };
    const maskNode = { kind: "billboard-mask" };
    material.positionNode = positionNode;
    material.maskNode = maskNode;
    material.side = THREE.DoubleSide;

    const self = {
      settings: { impostors: { enabled: true } },
      assets: {
        impostorAtlases: { oak: { ready: true } },
        impostorMaterials: { oak: material },
        materialHandle: { prepassNodesFor: () => baseNodes },
      },
      useCpuTreePrepass: true,
      treePrepassMaxLod: "impostor",
    } as unknown as Parameters<typeof treeCpuPatchInput>[0];

    const input = treeCpuPatchInput(self);
    expect(input.prepassNodesFor?.("oak", "impostor")).toEqual({
      positionNode,
      maskNode,
      side: THREE.DoubleSide,
    });
  });
});
