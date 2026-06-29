import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_PROPS_SETTINGS } from "./prop_config.js";
import { propGpuStatus, propStreamingCenter } from "./prop_system.js";

describe("propStreamingCenter", () => {
  it("uses the vegetation ring center when provided", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 2, 3);
    const ringCenter = new THREE.Vector3(40, 5, -20);

    expect(propStreamingCenter(camera, ringCenter)).toEqual([40, 5, -20]);
  });

  it("falls back to the camera position", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 2, 3);

    expect(propStreamingCenter(camera)).toEqual([1, 2, 3]);
  });
});

describe("propGpuStatus", () => {
  it("reports disabled when prop GPU ring is off", () => {
    const settings = { ...DEFAULT_CUSTOM_PROPS_SETTINGS, gpu: { ...DEFAULT_CUSTOM_PROPS_SETTINGS.gpu } };

    expect(propGpuStatus(settings, false)).toBe("disabled");
  });

  it("reports ring only when the custom prop GPU backend is available", () => {
    const settings = {
      ...DEFAULT_CUSTOM_PROPS_SETTINGS,
      gpu: { ...DEFAULT_CUSTOM_PROPS_SETTINGS.gpu, enabled: true },
    };

    expect(propGpuStatus(settings, true)).toBe("ring");
  });

  it("reports CPU fallback when requested but no prop GPU backend exists", () => {
    const settings = {
      ...DEFAULT_CUSTOM_PROPS_SETTINGS,
      gpu: { ...DEFAULT_CUSTOM_PROPS_SETTINGS.gpu, enabled: true, fallbackToCpu: true },
    };

    expect(propGpuStatus(settings, false)).toBe("fallback-cpu");
  });

  it("reports unsupported when fallback is disabled and no prop GPU backend exists", () => {
    const settings = {
      ...DEFAULT_CUSTOM_PROPS_SETTINGS,
      gpu: { ...DEFAULT_CUSTOM_PROPS_SETTINGS.gpu, enabled: true, fallbackToCpu: false },
    };

    expect(propGpuStatus(settings, false)).toBe("unsupported");
  });
});
