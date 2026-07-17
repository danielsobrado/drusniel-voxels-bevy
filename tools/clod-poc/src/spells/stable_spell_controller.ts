import * as THREE from "three";
import type { SpellVfxController } from "./spell_vfx_controller.js";

function isSpellPointLight(object: THREE.Object3D): object is THREE.PointLight {
  return (object as THREE.PointLight).isPointLight === true && object.name.includes("spell");
}

function collectSpellPointLights(scene: THREE.Scene): THREE.PointLight[] {
  const lights: THREE.PointLight[] = [];
  scene.traverse((object) => {
    if (isSpellPointLight(object)) lights.push(object);
  });
  return lights;
}

function suppressSpellPointLights(lights: readonly THREE.PointLight[]): void {
  for (const light of lights) {
    light.intensity = 0;
    light.visible = false;
  }
}

/**
 * Spell meshes carry their own additive glow. Dynamic PointLight visibility changes are
 * suppressed because they invalidate scene-wide lighting pipelines in Three.js/WebGPU.
 */
export function createStableSpellController(
  target: SpellVfxController,
  scene: THREE.Scene,
): SpellVfxController {
  const spellLights = collectSpellPointLights(scene);
  const stabilize = (): void => suppressSpellPointLights(spellLights);
  stabilize();

  return {
    playFire: (durationMs) => {
      target.playFire(durationMs);
      stabilize();
    },
    playWater: (durationMs) => {
      target.playWater(durationMs);
      stabilize();
    },
    playAir: (durationMs) => {
      target.playAir(durationMs);
      stabilize();
    },
    playEarth: (durationMs) => {
      const fired = target.playEarth(durationMs);
      stabilize();
      return fired;
    },
    playLightning: (durationMs) => {
      target.playLightning(durationMs);
      stabilize();
    },
    playFireball: (durationMs) => {
      target.playFireball(durationMs);
      stabilize();
    },
    update: (nowMs) => {
      target.update(nowMs);
      stabilize();
    },
    precompile: (renderer) => {
      target.precompile(renderer);
      stabilize();
    },
    dispose: () => target.dispose(),
  };
}
