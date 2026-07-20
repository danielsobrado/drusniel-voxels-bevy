import { describe, expect, it } from "vitest";
import {
  buildPropOccluderSnapshot,
  emptyPropOccluderSnapshot,
} from "./prop_occluder_snapshot.js";
import type {
  PropAssetDef,
  PropAssetMetadata,
  PropInstance,
  PropOcclusionSettings,
} from "./prop_types.js";

const settings: PropOcclusionSettings = {
  enabled: true,
  cellSizeM: 4,
  buildOccludersPerFrame: 8,
  footprintPaddingM: 0.5,
  minimumHeightM: 1.5,
  mistClipStrength: 0.85,
};

function asset(id: string, proxy = true): PropAssetDef {
  return {
    id,
    source: `${id}.glb`,
    category: "large_static",
    placement: {
      alignToTerrain: true,
      terrainConform: false,
      snapToGrid: false,
    },
    lod: {
      mode: "generated",
      distances: [0, 50],
      triangleRatios: [1, 0.5],
      hysteresis: 8,
    },
    culling: {
      maxDistance: 200,
      shadowDistance: 64,
      reflectionDistance: 100,
      minScreenPx: 4,
    },
    collision: {
      mode: "box",
      distance: 48,
    },
    lightingProxy: proxy
      ? { mode: "coarse_bounds", affectGi: true, affectFog: true }
      : { mode: "none", affectGi: false, affectFog: false },
  };
}

function metadata(id: string, maxY = 3): PropAssetMetadata {
  return {
    id,
    sourcePath: `${id}.glb`,
    meshCount: 1,
    materialCount: 1,
    localBounds: {
      min: [-2, 0, -1],
      max: [2, maxY, 1],
      center: [0, maxY * 0.5, 0],
      radius: 3,
    },
    boundingSphereRadius: 3,
    triangleCount: 12,
    hasAlphaMaterial: false,
    hasAnimation: false,
    hasCollisionMesh: true,
    lodAvailability: "generated",
    drawCallParts: 1,
    maxTextureSize: 1024,
    hasNormals: true,
    scaleUniform: true,
  };
}

function instance(assetId: string, overrides: Partial<PropInstance> = {}): PropInstance {
  return {
    assetId,
    position: [10, 5, 20],
    rotationY: Math.PI * 0.5,
    scale: 2,
    seed: 1,
    variationId: 0,
    flags: 0,
    revision: 7,
    ...overrides,
  };
}

describe("prop occluder snapshot", () => {
  it("transforms local bounds conservatively through scale and yaw", () => {
    const def = asset("ruin");
    const meta = metadata("ruin");
    const snapshot = buildPropOccluderSnapshot({
      enabled: true,
      revision: 3,
      sceneId: "test",
      instances: [instance("ruin")],
      assetById: new Map([[def.id, def]]),
      metadataByAssetId: new Map([[meta.id, meta]]),
      settings,
    });

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.revision).toBe(3);
    expect(snapshot.occluders).toHaveLength(1);
    expect(snapshot.occluders[0]).toMatchObject({
      key: "ruin:0",
      assetId: "ruin",
      instanceIndex: 0,
      instanceRevision: 7,
      heightM: 6,
      affectGi: true,
      affectFog: true,
    });
    expect(snapshot.occluders[0]!.bounds.minX).toBeCloseTo(7.5);
    expect(snapshot.occluders[0]!.bounds.maxX).toBeCloseTo(12.5);
    expect(snapshot.occluders[0]!.bounds.minZ).toBeCloseTo(15.5);
    expect(snapshot.occluders[0]!.bounds.maxZ).toBeCloseTo(24.5);
    expect(snapshot.occluders[0]!.bounds.minY).toBeCloseTo(5);
    expect(snapshot.occluders[0]!.bounds.maxY).toBeCloseTo(11);
  });

  it("filters disabled, non-proxy, missing-metadata, and short instances", () => {
    const proxy = asset("proxy");
    const plain = asset("plain", false);
    const short = metadata("short", 0.5);
    const shortDef = asset("short");

    const snapshot = buildPropOccluderSnapshot({
      enabled: true,
      revision: 4,
      sceneId: "test",
      instances: [
        instance("proxy"),
        instance("plain"),
        instance("missing"),
        instance("short", { scale: 1 }),
      ],
      assetById: new Map([
        [proxy.id, proxy],
        [plain.id, plain],
        [shortDef.id, shortDef],
      ]),
      metadataByAssetId: new Map([
        ["proxy", metadata("proxy")],
        ["plain", metadata("plain")],
        ["short", short],
      ]),
      settings,
    });

    expect(snapshot.occluders.map((entry) => entry.assetId)).toEqual(["proxy"]);
    expect(buildPropOccluderSnapshot({
      enabled: false,
      revision: 5,
      sceneId: "test",
      instances: [instance("proxy")],
      assetById: new Map([[proxy.id, proxy]]),
      metadataByAssetId: new Map([["proxy", metadata("proxy")]]),
      settings,
    })).toEqual(emptyPropOccluderSnapshot(5, "test"));
  });

  it("is deterministic for an unchanged placement snapshot", () => {
    const def = asset("ruin");
    const meta = metadata("ruin");
    const input = {
      enabled: true,
      revision: 9,
      sceneId: "stable",
      instances: [instance("ruin", { position: [-4, 2, 11], rotationY: 0.37 })],
      assetById: new Map([[def.id, def]]),
      metadataByAssetId: new Map([[meta.id, meta]]),
      settings,
    };

    expect(buildPropOccluderSnapshot(input)).toEqual(buildPropOccluderSnapshot(input));
  });
});
