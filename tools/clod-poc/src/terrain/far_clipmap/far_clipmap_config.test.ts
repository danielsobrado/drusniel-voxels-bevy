import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_FAR_CLIPMAP_CONFIG,
  createFarClipmapController,
  createFarClipmapGridGeometry,
  createFarClipmapTerrainGeometry,
  farClipmapConfigFromSearchParams,
  farClipmapSnap,
  farClipmapTileKeysForSnap,
  resolveFarClipmapConfig,
  type FarClipmapSource,
} from "./index.js";

function query(text: string): URLSearchParams {
  return new URLSearchParams(text);
}

const sampledSource: FarClipmapSource = {
  sampleHeight: (x, z) => x * 0.1 + z * 0.01,
  sampleMaterial: (x) => Math.abs(Math.floor(x)) % 3,
  sampleBiome: () => 0,
  sampleWater: () => 0,
};

describe("far clipmap config", () => {
  it("uses deterministic defaults", () => {
    expect(resolveFarClipmapConfig()).toEqual(DEFAULT_FAR_CLIPMAP_CONFIG);
  });

  it("keeps missing numeric query params at defaults instead of coercing null to zero", () => {
    const config = farClipmapConfigFromSearchParams(query("farClipmap=1"));

    expect(config.heightScale).toBe(DEFAULT_FAR_CLIPMAP_CONFIG.heightScale);
    expect(config.yOffset).toBe(DEFAULT_FAR_CLIPMAP_CONFIG.yOffset);
    expect(config.shaderDisplacement).toBe(DEFAULT_FAR_CLIPMAP_CONFIG.shaderDisplacement);
  });

  it("accepts explicit zero y offset without flattening height scale", () => {
    const config = farClipmapConfigFromSearchParams(query("farClipmap=1&farClipmapYOffset=0"));

    expect(config.yOffset).toBe(0);
    expect(config.heightScale).toBe(DEFAULT_FAR_CLIPMAP_CONFIG.heightScale);
  });

  it("accepts query params and clamps outer radius to CLOD coverage", () => {
    const config = farClipmapConfigFromSearchParams(
      query("farClipmap=1&farClipmapInnerRadius=384&farClipmapOuterRadius=1024&farClipmapRingCount=3"),
      { liveCollisionRadiusM: 200, clodCoverageRadiusM: 2048 },
    );

    expect(config.enabled).toBe(true);
    expect(config.innerRadiusM).toBe(384);
    expect(config.outerRadiusM).toBeGreaterThanOrEqual(2048);
    expect(config.ringCount).toBe(3);
  });
});

describe("far clipmap snapping", () => {
  it("keeps the same keys inside a snap cell", () => {
    const config = resolveFarClipmapConfig({ ringCount: 2, snapSizeM: 128 });
    const a = farClipmapTileKeysForSnap(config, farClipmapSnap(5, 7, config.snapSizeM));
    const b = farClipmapTileKeysForSnap(config, farClipmapSnap(120, 126, config.snapSizeM));
    expect(a).toEqual(b);
  });

  it("changes keys deterministically across snap boundaries", () => {
    const config = resolveFarClipmapConfig({ ringCount: 2, snapSizeM: 128 });
    const a = farClipmapTileKeysForSnap(config, farClipmapSnap(127, 0, config.snapSizeM));
    const b = farClipmapTileKeysForSnap(config, farClipmapSnap(128, 0, config.snapSizeM));
    expect(a).not.toEqual(b);
  });

  it("snaps negative coordinates down", () => {
    const snap = farClipmapSnap(-1, -129, 128);
    expect(snap.snapX).toBe(-128);
    expect(snap.snapZ).toBe(-256);
  });
});

describe("far clipmap geometry", () => {
  it("builds reusable flat GPU grid geometry", () => {
    const geometry = createFarClipmapGridGeometry({
      gridResolution: 5,
    });

    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    expect(position.count).toBe(25);
    expect(geometry.getAttribute("color")).toBeUndefined();
    expect(normal.count).toBe(25);
    expect((geometry.getIndex()?.count ?? 0)).toBeGreaterThan(0);
    expect(position.getX(0)).toBe(0);
    expect(position.getY(0)).toBe(0);
    expect(position.getZ(0)).toBe(0);
    geometry.dispose();
  });

  it("builds deformed CPU terrain geometry", () => {
    const geometry = createFarClipmapTerrainGeometry({
      gridResolution: 5,
      centerX: 0,
      centerZ: 0,
      innerRadiusM: 2,
      outerRadiusM: 4,
      heightScale: 1,
      yOffset: 0,
      source: sampledSource,
    });

    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const color = geometry.getAttribute("color");
    expect(position.count).toBeGreaterThan(0);
    expect(normal.count).toBeGreaterThan(0);
    expect(color).toBeDefined();
    geometry.dispose();
  });
});

describe("far clipmap controller", () => {
  it("keeps CPU-baked fallback rings budgeted across frames", () => {
    const scene = new THREE.Scene();
    const config = resolveFarClipmapConfig({
      ringCount: 3,
      maxRebuildsPerFrame: 2,
      gridResolution: 5,
      innerRadiusM: 8,
      outerRadiusM: 64,
      snapSizeM: 16,
      shaderDisplacement: false,
    });
    const controller = createFarClipmapController(scene, config, sampledSource);

    const firstMesh = scene.children[0] as THREE.Mesh;
    const initialGeometry = firstMesh.geometry;
    const first = controller.update(new THREE.Vector3(1, 0, 1));
    const second = controller.update(new THREE.Vector3(1, 0, 1));

    expect(first.readyTiles).toBe(2);
    expect(first.pendingTiles).toBe(1);
    expect(first.sourceReady).toBe(1);
    expect(second.readyTiles).toBe(3);
    expect(firstMesh.geometry).not.toBe(initialGeometry);
    expect(firstMesh.geometry.getAttribute("position").getY(0)).not.toBe(0);
    expect(firstMesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(controller.ownershipSnapshot().ready).toBe(true);
    controller.setVisible(false);
    controller.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("keeps rings pending until the source is ready", () => {
    let ready = false;
    const scene = new THREE.Scene();
    const source: FarClipmapSource = { ...sampledSource, isReady: () => ready };
    const config = resolveFarClipmapConfig({
      ringCount: 3,
      maxRebuildsPerFrame: 2,
      gridResolution: 5,
      innerRadiusM: 8,
      outerRadiusM: 64,
      snapSizeM: 16,
    });
    const controller = createFarClipmapController(scene, config, source);

    const blocked = controller.update(new THREE.Vector3(1, 0, 1));
    ready = true;
    const firstReady = controller.update(new THREE.Vector3(1, 0, 1));

    expect(blocked.sourceReady).toBe(0);
    expect(blocked.readyTiles).toBe(0);
    expect(blocked.pendingTiles).toBe(3);
    expect(blocked.rebuiltTilesThisFrame).toBe(0);
    expect(firstReady.sourceReady).toBe(1);
    expect(firstReady.readyTiles).toBe(3);
    expect(firstReady.pendingTiles).toBe(0);
    controller.dispose();
  });

  it("marks ring ready after snap even when summary samples fall back", () => {
    const scene = new THREE.Scene();
    const source: FarClipmapSource = {
      ...sampledSource,
      sampleSummaryInto: () => false,
      isReady: () => true,
    };
    const config = resolveFarClipmapConfig({
      ringCount: 1,
      maxRebuildsPerFrame: 1,
      gridResolution: 5,
      innerRadiusM: 8,
      outerRadiusM: 64,
      snapSizeM: 16,
    });
    const controller = createFarClipmapController(scene, config, source);

    const stats = controller.update(new THREE.Vector3(1, 0, 1));

    expect(stats.sourceReady).toBe(1);
    expect(stats.readyTiles).toBe(1);
    expect(stats.pendingTiles).toBe(0);
    expect(stats.rebuiltTilesThisFrame).toBe(0);
    expect(stats.fallbackSamplesThisFrame).toBeGreaterThanOrEqual(0);
    controller.dispose();
  });
});
