import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_SHADOW_PROXY_CONFIG } from "../config/longViewDefaults.js";
import { configureLongViewSunShadows, createLongViewSunLight } from "./longViewSunShadows.js";

describe("long view sun shadows", () => {
  it("configureLongViewSunShadows respects castShadow option", () => {
    const light = new THREE.DirectionalLight(0xffffff, 1);
    configureLongViewSunShadows(light, DEFAULT_SHADOW_PROXY_CONFIG, { castShadow: false });
    expect(light.castShadow).toBe(false);
    configureLongViewSunShadows(light, DEFAULT_SHADOW_PROXY_CONFIG, { castShadow: true });
    expect(light.castShadow).toBe(true);
  });

  it("createLongViewSunLight honors initial castShadow=false", () => {
    const light = createLongViewSunLight(DEFAULT_SHADOW_PROXY_CONFIG, { castShadow: false });
    expect(light.castShadow).toBe(false);
    light.dispose();
  });
});
