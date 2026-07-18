import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import {
  createFarClipmapMaterial,
  setFarClipmapMaterialDebugMode,
  type FarClipmapMaterial,
} from "./far_clipmap_material.js";

type TraversableNode = { traverse(callback: (node: unknown) => void): void };

function createWebGpuMaterial(): FarClipmapMaterial {
  return createFarClipmapMaterial({
    debugMode: "final",
    clipInnerRadiusM: 100,
    clipOuterRadiusM: 1000,
    webGpuCompatible: true,
    gridResolution: 4,
  });
}

function colorNodeReaches(material: FarClipmapMaterial, target: unknown): boolean {
  const colorNode = (material as { colorNode?: TraversableNode }).colorNode;
  if (!colorNode) return false;
  let found = false;
  colorNode.traverse((node) => {
    if (node === target) found = true;
    if ((node as { value?: unknown }).value === target) found = true;
  });
  return found;
}

function colorNodeHasType(material: FarClipmapMaterial, typeName: string): boolean {
  const colorNode = (material as { colorNode?: TraversableNode }).colorNode;
  if (!colorNode) return false;
  let found = false;
  colorNode.traverse((node) => {
    if ((node as { constructor?: { name?: string } }).constructor?.name === typeName) found = true;
  });
  return found;
}

describe("far clipmap WebGPU material debug modes", () => {
  it("colorNode consumes the uDebugMode uniform so debug modes render differently", () => {
    const material = createWebGpuMaterial();
    const nodeUniforms = material.userData.farClipmapNodeUniforms as { uDebugMode: unknown };
    expect(nodeUniforms?.uDebugMode).toBeDefined();
    expect(colorNodeReaches(material, nodeUniforms.uDebugMode)).toBe(true);
  });

  it("colorNode consumes the ownership mask so ownership mode can prove sector hand-off", () => {
    const material = createWebGpuMaterial();
    const ownershipStorage = material.userData.farClipmapOwnershipStorage as THREE.BufferAttribute;
    expect(ownershipStorage).toBeDefined();
    expect(colorNodeReaches(material, ownershipStorage)).toBe(true);
  });

  it("interpolates per-vertex storage samples instead of indexing storage per fragment", () => {
    const material = createWebGpuMaterial();
    expect(colorNodeHasType(material, "VaryingNode")).toBe(true);
  });

  it("setFarClipmapMaterialDebugMode updates the node uniform value", () => {
    const material = createWebGpuMaterial();
    const nodeUniforms = material.userData.farClipmapNodeUniforms as { uDebugMode: { value: number } };
    expect(nodeUniforms.uDebugMode.value).toBe(0);
    setFarClipmapMaterialDebugMode(material, "ownership");
    expect(nodeUniforms.uDebugMode.value).toBe(3);
    setFarClipmapMaterialDebugMode(material, "final");
    expect(nodeUniforms.uDebugMode.value).toBe(0);
  });
});
