import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WEATHER_MODE_OPTIONS } from "../app/clod_constants.js";
import { parseWeatherQueryContext } from "../app/bootstrap/query_context.js";
import { createWindShaderMaterial } from "./windShaderMaterial.js";
import { WindWeatherSystem } from "./wind.js";

describe("wind weather", () => {
  it("is exposed as a selectable weather mode", () => {
    expect(WEATHER_MODE_OPTIONS).toContain("wind");
    const context = parseWeatherQueryContext(new URLSearchParams("weather=wind&windIntensity=1.2&windX=3&windZ=0.5"));
    expect(context.queryWeatherMode).toBe("wind");
    expect(context.queryWeatherIntensity).toBe(1.2);
    expect(context.queryWeatherWindX).toBe(3);
    expect(context.queryWeatherWindZ).toBe(0.5);
  });

  it("creates a transparent wind shader material", () => {
    const handle = createWindShaderMaterial();
    expect(handle.material.transparent).toBe(true);
    expect(handle.material.depthWrite).toBe(false);
    expect(handle.material.depthTest).toBe(true);
    expect(handle.material.side).toBe(THREE.DoubleSide);
    handle.dispose();
  });

  it("shows and hides the wind ribbon system", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const system = new WindWeatherSystem({ scene, camera, isWebGpu: false, seed: 1 });
    const mesh = scene.getObjectByName("weather-wind-ribbons") as THREE.Mesh;
    expect(mesh).toBeTruthy();
    expect(system.getStats().ribbons).toBeGreaterThan(0);
    expect(mesh.parent?.visible).toBe(false);

    system.applySettings({ enabled: true, intensity: 1, windX: 2, windZ: 0.4 });
    expect(mesh.parent?.visible).toBe(true);

    system.update(0.016, 1.25, new THREE.Vector3(1, 2, 3));
    system.applySettings({ enabled: false, intensity: 1, windX: 2, windZ: 0.4 });
    expect(mesh.parent?.visible).toBe(false);

    system.dispose();
    expect(scene.getObjectByName("weather-wind-ribbons")).toBeFalsy();
  });
});
