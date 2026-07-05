import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_FAR_CLIPMAP_CONFIG,
  createFarClipmapController,
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
  it("builds sampled annular terrain geometry", () => {
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
    const color = geometry.getAttribute("color");
    const normal = geometry.getAttribute("normal");
    expect(position.count).toBe(25);
    expect(color.count).toBe(25);
    expect(normal.count).toBe(25);
    expect((geometry.getIndex()?.count ?? 0)).toBeGreaterThan(0);
    expect(position.getY(0)).toBeCloseTo(-0.44);
    geometry.dispose();
  });
});

describe("far clipmap controller", () => {
  it("rebuilds sampled rings with the custom shader and becomes ready across budgeted frames", () => {
    const scene = new THREE.Scene();
    const config = resolveFarClipmapConfig({
      ringCount: 3,
      maxRebuildsPerFrame: 2,
      gridResolution: 5,
      innerRadiusM: 8,
      outerRadiusM: 64,
      snapSizeM: 16,
    });
    const controller = createFarClipmapController(scene, config, sampledSource);

    const first = controller.update(new THREE.Vector3(1, 0, 1));
    const second = controller.update(new THREE.Vector3(1, 0, 1));
    const firstMesh = scene.children[0] as THREE.Mesh;
    const material = firstMesh.material as THREE.ShaderMaterial;

    expect(first.readyTiles).toBe(2);
    expect(first.pendingTiles).toBe(1);
    expect(second.readyTiles).toBe(3);
    expect(firstMesh.geometry.getAttribute("position").count).toBe(25);
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.name).toBe("FarClipmapTerrainShader");
    expect(controller.ownershipSnapshot().ready).toBe(true);
    controller.setDebugMode("ownership");
    expect(material.uniforms["uDebugMode"].value).toBe(3);
    controller.setVisible(false);
    controller.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
