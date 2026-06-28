import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  attachTreeImpostorBlendAttributes,
  createTreeImpostorBlendGeometry,
  TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES,
  TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME,
  type TreeImpostorBlendAttributes,
} from "./index.js";

describe("tree impostor blend geometry attributes", () => {
  it("creates a cloned instanced geometry with blend attributes", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    source.name = "oak-billboard";
    source.computeBoundingBox();
    source.computeBoundingSphere();
    const geometry = createTreeImpostorBlendGeometry(source, fakeAttributes());

    expect(geometry.name).toBe("oak-billboard-impostor-blend");
    expect(geometry.getAttribute("position")).toBeDefined();
    expect(geometry.getAttribute("uv")).toBeDefined();
    expect(geometry.getAttribute("treeImpostorUvRect0")).toBeDefined();
    expect(geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME)).toBeDefined();
    expect(geometry.boundingBox).not.toBe(source.boundingBox);
    expect(geometry.boundingSphere).not.toBe(source.boundingSphere);
  });

  it("attaches four uv rect attributes and one weight attribute", () => {
    const geometry = new THREE.InstancedBufferGeometry();
    const attributes = fakeAttributes();

    attachTreeImpostorBlendAttributes(geometry, attributes);

    for (const name of TREE_IMPOSTOR_BLEND_UV_ATTRIBUTE_NAMES) {
      const attribute = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      expect(attribute).toBeDefined();
      expect(attribute.itemSize).toBe(4);
      expect(attribute.count).toBe(2);
    }
    const rect0 = geometry.getAttribute("treeImpostorUvRect0") as THREE.InstancedBufferAttribute;
    const rect3 = geometry.getAttribute("treeImpostorUvRect3") as THREE.InstancedBufferAttribute;
    expect(rect0.getX(0)).toBeCloseTo(0.0);
    expect(rect0.getZ(1)).toBeCloseTo(0.4);
    expect(rect3.getX(0)).toBeCloseTo(0.1);
    expect(rect3.getW(1)).toBeCloseTo(0.5);

    const weights = geometry.getAttribute(TREE_IMPOSTOR_BLEND_WEIGHT_ATTRIBUTE_NAME) as THREE.InstancedBufferAttribute;
    expect(weights.itemSize).toBe(4);
    expect(weights.count).toBe(2);
    expect(weights.getX(1)).toBeCloseTo(0.1);
    expect(weights.getW(1)).toBeCloseTo(0.4);
  });

  it("rejects mismatched buffer sizes", () => {
    const geometry = new THREE.InstancedBufferGeometry();
    expect(() => attachTreeImpostorBlendAttributes(geometry, {
      uvRects: new Float32Array(4),
      weights: new Float32Array(3),
    })).toThrow(/four weights per instance/);
    expect(() => attachTreeImpostorBlendAttributes(geometry, {
      uvRects: new Float32Array(4),
      weights: new Float32Array(4),
    })).toThrow(/four vec4 rects per instance/);
  });
});

function fakeAttributes(): TreeImpostorBlendAttributes {
  return {
    uvRects: new Float32Array([
      0.0, 0.0, 0.1, 0.1,
      0.1, 0.0, 0.2, 0.1,
      0.0, 0.1, 0.1, 0.2,
      0.1, 0.1, 0.2, 0.2,
      0.3, 0.3, 0.4, 0.4,
      0.4, 0.3, 0.5, 0.4,
      0.3, 0.4, 0.4, 0.5,
      0.4, 0.4, 0.5, 0.5,
    ]),
    weights: new Float32Array([0.25, 0.25, 0.25, 0.25, 0.1, 0.2, 0.3, 0.4]),
  };
}
