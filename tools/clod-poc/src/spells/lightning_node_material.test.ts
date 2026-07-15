import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createLightningArcNodeMaterial } from "./lightning_node_material.js";

describe("lightning arc node material", () => {
  it("builds a WebGPU-compatible soft additive filament material", () => {
    const handle = createLightningArcNodeMaterial({
      name: "lightning-test",
      coreColor: [1, 1, 1],
      edgeColor: [0.18, 0.62, 1],
      opacity: 0.7,
      softness: 1.8,
    });

    expect(handle.material.name).toBe("lightning-test");
    expect(handle.material.transparent).toBe(true);
    expect(handle.material.depthWrite).toBe(false);
    expect(handle.material.blending).toBe(THREE.AdditiveBlending);
    expect(handle.material.toneMapped).toBe(false);
    expect(handle.material.colorNode).toBeTruthy();
    expect(handle.material.opacityNode).toBeTruthy();
    expect(handle.uTime.value).toBe(0);
    expect(handle.uOpacity.value).toBe(0.7);
  });
});
