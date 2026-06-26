import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG, DEFAULT_SHADOW_PROXY_CONFIG } from "../config/longViewDefaults.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import { createShadowProxyController } from "./shadowProxyController.js";
import * as shadowProxyBuilder from "./shadowProxyBuilder.js";

const summary = buildTerrainSummary([], 512, 8);

function makeDeps(overrides: Partial<Parameters<typeof createShadowProxyController>[1]> = {}) {
  const scene = new THREE.Scene();
  return {
    scene,
    renderer: { shadowMap: { enabled: false } } as unknown as THREE.WebGLRenderer,
    getTerrainSummary: () => summary,
    worldSize: 512,
    isLongView: true,
    streamingCentered: true,
    rebuildSnapMeters: 1024,
    getSunShadowsEnabled: () => false,
    getConfig: () => ({ ...DEFAULT_SHADOW_PROXY_CONFIG, debugFreezeProxy: false }),
    getLighting: () => ({
      sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
      sunColor: new THREE.Color(1, 0.95, 0.85),
      skyLight: new THREE.Color(0.4, 0.5, 0.65),
      groundLight: new THREE.Color(0.2, 0.18, 0.14),
    }),
    getCoverageCenter: () => ({ x: 0, z: 0 }),
    ...overrides,
  };
}

describe("shadow proxy controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not rebuild geometry when debugFreezeProxy is set and the camera moves", () => {
    const buildSpy = vi.spyOn(shadowProxyBuilder, "buildShadowProxyMesh");
    const controller = createShadowProxyController(
      DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG,
      makeDeps({
        getConfig: () => ({ ...DEFAULT_SHADOW_PROXY_CONFIG, debugFreezeProxy: true }),
        getCoverageCenter: () => ({ x: 0, z: 0 }),
      }),
    );
    const initialBuilds = buildSpy.mock.calls.length;
    controller.updateFrame(1500, 0);
    expect(buildSpy.mock.calls.length).toBe(initialBuilds);
    controller.dispose();
  });

  it("fires onSunShadowsChanged once when sun shadows are toggled", () => {
    const handler = vi.fn();
    const controller = createShadowProxyController(
      DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG,
      makeDeps({ onSunShadowsChanged: handler }),
    );
    handler.mockClear();
    controller.setSunShadowsEnabled(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(true);
    controller.dispose();
  });

  it("rebuilds only when rebuild snap changes in streaming mode", () => {
    const buildSpy = vi.spyOn(shadowProxyBuilder, "buildShadowProxyMesh");
    let cameraX = 0;
    const controller = createShadowProxyController(
      DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG,
      makeDeps({
        rebuildSnapMeters: 1024,
        getCoverageCenter: () => ({ x: cameraX, z: 0 }),
      }),
    );
    const buildsAfterInit = buildSpy.mock.calls.length;
    cameraX = 200;
    controller.updateFrame(cameraX, 0);
    expect(buildSpy.mock.calls.length).toBe(buildsAfterInit);
    cameraX = 1100;
    controller.updateFrame(cameraX, 0);
    expect(buildSpy.mock.calls.length).toBeGreaterThan(buildsAfterInit);
    controller.dispose();
  });

  it("positions relative-built proxy at the snapped build center", () => {
    let cameraX = 0;
    const controller = createShadowProxyController(
      DEFAULT_LONG_VIEW_SUN_SHADOWS_CONFIG,
      makeDeps({
        rebuildSnapMeters: 1024,
        getCoverageCenter: () => ({ x: cameraX, z: 0 }),
      }),
    );
    expect(controller.runtime.mesh?.position.x).toBe(0);

    cameraX = 1100;
    controller.updateFrame(cameraX, 0);
    expect(controller.runtime.mesh?.position.x).toBe(1024);
    expect(controller.runtime.mesh?.position.x).not.toBe(1024 - cameraX);
    controller.dispose();
  });
});
