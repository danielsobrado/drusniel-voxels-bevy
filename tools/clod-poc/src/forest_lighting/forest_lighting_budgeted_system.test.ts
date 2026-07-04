import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cloneForestLightingSettings, ForestLightingSystem, type ForestLightingTreeProxy } from "./index.js";

function proxy(overrides: Partial<ForestLightingTreeProxy> = {}): ForestLightingTreeProxy {
  return {
    x: 32,
    z: 32,
    height: 16,
    scale: 1,
    crownRadius: 7,
    species: "oak",
    ...overrides,
  };
}

function oldDeadline(): number {
  return performance.now() - 1;
}

describe("budgeted forest lighting field build", () => {
  it("matches monolithic update and keeps the previous texture until completion", () => {
    const settings = cloneForestLightingSettings();
    settings.field.resolution = 16;
    const proxies = [proxy(), proxy({ x: 12, z: 40 }), proxy({ x: 50, z: 20 })];
    const sun = new THREE.Vector3(1, 1, 0).normalize();
    const center = new THREE.Vector3(32, 0, 32);

    const monolithic = new ForestLightingSystem({ worldCells: 64, settings });
    monolithic.update(0, center, { treeProxies: proxies, sunDirection: sun, force: true });

    const stepped = new ForestLightingSystem({ worldCells: 64, settings });
    const bytesBefore = [...(stepped.getTextureHandle().texture.image.data as Uint8Array)];
    stepped.beginBuild(center, { treeProxies: proxies, sunDirection: sun });
    expect(stepped.hasBuildInProgress()).toBe(true);

    let done = stepped.stepBuild(oldDeadline());
    expect(done).toBe(false);
    expect([...(stepped.getTextureHandle().texture.image.data as Uint8Array)]).toEqual(bytesBefore);
    expect(stepped.getStats().textureUpdates).toBe(0);

    let guard = 0;
    while (!done && ++guard < 1_000_000) done = stepped.stepBuild(oldDeadline());
    expect(done).toBe(true);
    expect(stepped.hasBuildInProgress()).toBe(false);
    expect([...(stepped.getTextureHandle().texture.image.data as Uint8Array)])
      .toEqual([...(monolithic.getTextureHandle().texture.image.data as Uint8Array)]);
    expect(stepped.getStats().treeProxies).toBe(3);
    expect(stepped.getStats().textureUpdates).toBe(1);

    monolithic.dispose();
    stepped.dispose();
  });

  it("settings updates cancel an in-progress build", () => {
    const settings = cloneForestLightingSettings();
    settings.field.resolution = 16;
    const system = new ForestLightingSystem({ worldCells: 64, settings });
    system.beginBuild(new THREE.Vector3(32, 0, 32), {
      treeProxies: [proxy()],
      sunDirection: new THREE.Vector3(1, 1, 0).normalize(),
    });
    expect(system.hasBuildInProgress()).toBe(true);
    system.updateSettings(settings);
    expect(system.hasBuildInProgress()).toBe(false);
    expect(system.stepBuild(Number.POSITIVE_INFINITY)).toBe(false);
    system.dispose();
  });
});
