import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createStableSpellController } from "./stable_spell_controller.js";
import type { SpellVfxController } from "./spell_vfx_controller.js";

function fakeController(onPlay: () => void): SpellVfxController {
  return {
    playFire: vi.fn(onPlay),
    playWater: vi.fn(onPlay),
    playAir: vi.fn(onPlay),
    playEarth: vi.fn(() => {
      onPlay();
      return true;
    }),
    playLightning: vi.fn(onPlay),
    playFireball: vi.fn(onPlay),
    update: vi.fn(onPlay),
    precompile: vi.fn(onPlay),
    dispose: vi.fn(),
  };
}

describe("stable spell controller", () => {
  it("keeps spell point lights out of the scene lighting pipeline", () => {
    const scene = new THREE.Scene();
    const spellLight = new THREE.PointLight(0xffffff, 0);
    spellLight.name = "fire-spell-glow";
    const worldLight = new THREE.PointLight(0xffffff, 2);
    worldLight.name = "sun-fill";
    scene.add(spellLight, worldLight);

    const target = fakeController(() => {
      spellLight.visible = true;
      spellLight.intensity = 8;
    });
    const controller = createStableSpellController(target, scene);

    controller.playFire(600);
    expect(spellLight.visible).toBe(false);
    expect(spellLight.intensity).toBe(0);
    expect(worldLight.visible).toBe(true);
    expect(worldLight.intensity).toBe(2);

    controller.update(1000);
    expect(spellLight.visible).toBe(false);
    expect(spellLight.intensity).toBe(0);
  });
});
