import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { defaultSpellConfig } from "./spell_config.js";
import { createSpellVfxController, type SpellVfxMeshConfig } from "./spell_vfx_controller.js";

function meshConfig(): SpellVfxMeshConfig {
  return {
    worldWidth: 1,
    worldHeight: 2,
    flameScale: 1,
    handForwardM: 0.5,
    handRightM: 0.35,
    handUpM: -0.35,
    glowColor: [1, 0.5, 0.2],
    glowIntensity: 1,
    glowDistance: 4,
    glowDecay: 2,
    glowLocalYRatio: 0.35,
  };
}

describe("spell VFX controller lightning wiring", () => {
  it("casts from the configured hand offset toward the supplied target", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(2, 3, 4);
    camera.lookAt(2, 3, -10);
    camera.updateMatrixWorld();
    const target = new THREE.Vector3(2, 0, -9);
    let clock = 1000;
    const beam = meshConfig();

    const controller = createSpellVfxController({
      scene,
      getCamera: () => camera,
      fire: beam,
      water: beam,
      air: beam,
      earth: { ...defaultSpellConfig.earth.vfx, shardCount: 0 },
      getEarthTarget: () => null,
      lightning: {
        ...defaultSpellConfig.lightning.vfx,
        segmentCount: 12,
        branchCount: 2,
        sparkCount: 4,
      },
      getLightningTarget: () => ({ point: target, normal: new THREE.Vector3(0, 1, 0) }),
      now: () => clock,
    });

    const core = scene.getObjectByName("lightning-spell-core") as THREE.Mesh;
    const impactLight = scene.getObjectByName("lightning-spell-impact-light") as THREE.PointLight;
    expect(core.visible).toBe(false);

    controller.playLightning(1000);
    clock = 1016;
    controller.update(clock);
    expect(core.visible).toBe(true);
    expect(impactLight.position.x).toBeCloseTo(target.x);
    expect(impactLight.position.z).toBeCloseTo(target.z);
    expect(impactLight.intensity).toBeGreaterThan(0);

    const positions = core.geometry.getAttribute("position") as THREE.BufferAttribute;
    const firstVertex = new THREE.Vector3().fromBufferAttribute(positions, 0);
    expect(firstVertex.distanceTo(camera.position)).toBeLessThan(2);

    clock = 2100;
    controller.update(clock);
    expect(core.visible).toBe(false);
    expect(impactLight.visible).toBe(false);

    controller.dispose();
    expect(scene.getObjectByName("lightning-spell-core")).toBeFalsy();
  });
});