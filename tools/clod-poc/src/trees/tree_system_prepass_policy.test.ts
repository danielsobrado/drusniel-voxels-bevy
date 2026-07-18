import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import { selectTreeCpuPrepassNodes } from "./tree_system_prepass_policy.js";

const baseNodes: PrepassNodes = {
  positionNode: { kind: "base-position" },
  maskNode: { kind: "base-mask" },
  side: THREE.FrontSide,
};

describe("tree CPU prepass policy", () => {
  it("keeps base prepass nodes for non-impostor LODs", () => {
    expect(selectTreeCpuPrepassNodes({
      lod: "far",
      bakedImpostor: true,
      baseNodes,
    })).toBe(baseNodes);
  });

  it("keeps base prepass nodes while impostors use the fallback geometry", () => {
    expect(selectTreeCpuPrepassNodes({
      lod: "impostor",
      bakedImpostor: false,
      baseNodes,
    })).toBe(baseNodes);
  });

  it("uses baked node-material position and mask nodes", () => {
    const material = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {
      positionNode?: unknown;
      maskNode?: unknown;
    };
    const positionNode = { kind: "billboard-position" };
    const maskNode = { kind: "billboard-mask" };
    material.positionNode = positionNode as never;
    material.maskNode = maskNode as never;
    material.side = THREE.DoubleSide;

    expect(selectTreeCpuPrepassNodes({
      lod: "impostor",
      bakedImpostor: true,
      impostorMaterial: material,
      baseNodes,
    })).toEqual({ positionNode, maskNode, side: THREE.DoubleSide });
  });

  it("disables the baked impostor prepass when the material exposes no node position", () => {
    expect(selectTreeCpuPrepassNodes({
      lod: "impostor",
      bakedImpostor: true,
      impostorMaterial: new THREE.ShaderMaterial(),
      baseNodes,
    })).toBeUndefined();
  });
});
