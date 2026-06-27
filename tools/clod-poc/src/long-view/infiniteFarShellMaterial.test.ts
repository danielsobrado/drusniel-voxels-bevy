import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createInfiniteFarShellMaterial, updateFarShellMaterialMaterial } from "./infiniteFarShellMaterial.js";

describe("infinite far shell material", () => {
  it("updates the missing-fallback debug uniform without rebuilding material", () => {
    const material = createInfiniteFarShellMaterial({
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

    const refs = material.userData.farShellMaterialUniforms as { uDebugFallback: { value: number } };
    expect(refs.uDebugFallback.value).toBe(0);

    updateFarShellMaterialMaterial(material, { debugShowMissingFallback: true });

    expect(refs.uDebugFallback.value).toBe(1);
    material.dispose();
  });
});
