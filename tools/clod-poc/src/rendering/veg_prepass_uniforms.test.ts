import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { depthPrepassTwin } from "./veg_prepass.js";

describe("depthPrepassTwin shader uniform ownership", () => {
  it("keeps cloned color-pass uniforms linked to the source material", () => {
    const sourceMaterial = new THREE.ShaderMaterial({
      uniforms: { uTick: { value: 1 } },
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), sourceMaterial);

    depthPrepassTwin(mesh, { positionNode: {}, side: THREE.DoubleSide });

    const colorMaterial = mesh.material as THREE.ShaderMaterial;
    expect(colorMaterial).not.toBe(sourceMaterial);
    expect(colorMaterial.uniforms).toBe(sourceMaterial.uniforms);
    sourceMaterial.uniforms.uTick.value = 7;
    expect(colorMaterial.uniforms.uTick.value).toBe(7);
  });
});
