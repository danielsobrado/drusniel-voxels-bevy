import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  REALTIME_SUN_SHADOW_CASTER_LAYER,
  REALTIME_SUN_SHADOW_CASTER_LAYER_BASE,
  enableRealtimeSunShadowCasterLayer,
  markAsRealtimeSunShadowCaster,
  realtimeSunShadowCasterLayer,
} from "./realtime_sun_shadows.js";

describe("realtime sun shadow caster layers", () => {
  it("marks a subtree as shadow-only caster layer", () => {
    const root = new THREE.Object3D();
    const child = new THREE.Object3D();
    root.add(child);

    markAsRealtimeSunShadowCaster(root, 1);

    const layer = REALTIME_SUN_SHADOW_CASTER_LAYER_BASE + 1;
    expect(root.layers.isEnabled(layer)).toBe(true);
    expect(child.layers.isEnabled(layer)).toBe(true);
    expect(root.layers.isEnabled(0)).toBe(false);
    expect(root.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER)).toBe(false);
  });

  it("enables the caster layer on shadow cameras", () => {
    const camera = new THREE.OrthographicCamera();

    enableRealtimeSunShadowCasterLayer(camera, 2);

    expect(camera.layers.isEnabled(0)).toBe(true);
    expect(camera.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER_BASE + 2)).toBe(true);
    expect(camera.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER_BASE + 1)).toBe(false);
  });

  it("clamps cascade layer selection", () => {
    expect(realtimeSunShadowCasterLayer(-1)).toBe(REALTIME_SUN_SHADOW_CASTER_LAYER_BASE);
    expect(realtimeSunShadowCasterLayer(99)).toBe(REALTIME_SUN_SHADOW_CASTER_LAYER_BASE + 3);
  });
});
