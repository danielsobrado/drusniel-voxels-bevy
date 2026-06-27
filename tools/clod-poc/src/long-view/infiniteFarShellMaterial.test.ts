import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createInfiniteFarShellMaterial, updateFarShellMaterialMaterial } from "./infiniteFarShellMaterial.js";

function makeMaterial() {
  return createInfiniteFarShellMaterial({
    lighting: {
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(1, 1, 1),
      groundLight: new THREE.Color(0.2, 0.2, 0.2),
    },
    innerMeters: 16,
    outerMeters: 32,
    nearBlendMeters: 1,
    farFadeMeters: 8,
    debugShowMissingFallback: false,
  });
}

describe("infinite far shell material", () => {
  it("keeps vertex color flag disabled", () => {
    const material = makeMaterial();

    expect(material.vertexColors).toBe(false);
    material.dispose();
  });

  it("updates the missing-fallback debug uniform without rebuilding material", () => {
    const material = makeMaterial();

    const refs = material.userData.farShellMaterialUniforms as { uDebugFallback: { value: number } };
    expect(refs.uDebugFallback.value).toBe(0);

    updateFarShellMaterialMaterial(material, { debugShowMissingFallback: true });

    expect(refs.uDebugFallback.value).toBe(1);
    material.dispose();
  });
});
