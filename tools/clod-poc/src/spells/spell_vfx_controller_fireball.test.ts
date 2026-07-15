import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { defaultSpellConfig } from "./spell_config.js";
import { createSpellVfxController, type SpellVfxMeshConfig } from "./spell_vfx_controller.js";

const beam: SpellVfxMeshConfig = {
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

describe("spell VFX controller fireball wiring", () => {
  it("launches from the configured hand pose and sweeps editable terrain", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(2, 3, 4);
    camera.lookAt(2, 3, -10);
    camera.updateMatrixWorld();
    let clock = 1000;
    let raycastCount = 0;

    const controller = createSpellVfxController({
      scene,
      getCamera: () => camera,
      fire: beam,
      water: beam,
      air: beam,
      earth: { ...defaultSpellConfig.earth.vfx, shardCount: 0 },
      getEarthTarget: () => null,
      fireball: {
        ...defaultSpellConfig.fireball.vfx,
        launchSpeed: 12,
        liftSpeed: 0,
        gravity: 10,
      },
      raycastFireballTerrain: () => {
        raycastCount++;
        return null;
      },
      now: () => clock,
    });

    const projectile = scene.getObjectByName("fireball-spell-projectile") as THREE.Group;
    controller.playFireball(3000);
    clock = 1250;
    controller.update(clock);

    expect(projectile.visible).toBe(true);
    expect(projectile.position.x).toBeCloseTo(2.35);
    expect(projectile.position.y).toBeLessThan(2.65);
    expect(projectile.position.z).toBeLessThan(1);
    expect(raycastCount).toBeGreaterThan(0);

    controller.dispose();
    expect(scene.getObjectByName("fireball-spell-projectile")).toBeFalsy();
  });
});
