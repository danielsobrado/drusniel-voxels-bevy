import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  REALTIME_SUN_SHADOW_CASTER_LAYER,
  enableRealtimeSunShadowCasterLayer,
  markAsRealtimeSunShadowCaster,
} from "./realtime_sun_shadows.js";

describe("realtime sun shadow caster layers", () => {
  it("marks a subtree as shadow-only caster layer", () => {
    const root = new THREE.Object3D();
    const child = new THREE.Object3D();
    root.add(child);

    markAsRealtimeSunShadowCaster(root);

    expect(root.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER)).toBe(true);
    expect(child.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER)).toBe(true);
    expect(root.layers.isEnabled(0)).toBe(false);
  });

  it("enables the caster layer on shadow cameras", () => {
    const camera = new THREE.OrthographicCamera();

    enableRealtimeSunShadowCasterLayer(camera);

    expect(camera.layers.isEnabled(0)).toBe(true);
    expect(camera.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER)).toBe(true);
  });
});
