import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { renderableIndirectDrawCountForGeometry } from "../gpu/indirect_draw_geometry.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";
import { buildPropGpuRingSource } from "./prop_gpu_ring_draw.js";
import { PropSpatialGrid } from "./prop_spatial_grid.js";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropCategoryBudget, PropInstance } from "./prop_types.js";

const CATEGORY_BUDGET: PropCategoryBudget = {
  maxTriangles: 1000,
  maxMaterials: 4,
  maxDrawParts: 4,
  maxTexturePx: 1024,
};

function validGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

function invalidGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

function propDef(id: string, distances = [0]): PropAssetDef {
  return {
    id,
    source: `${id}.glb`,
    category: "medium_static",
    placement: { alignToTerrain: true, terrainConform: false, snapToGrid: false },
    lod: { mode: "generated", distances, triangleRatios: distances.map(() => 1), hysteresis: 2 },
    culling: { maxDistance: 200, shadowDistance: 60, reflectionDistance: 80, minScreenPx: 4 },
    collision: { mode: "none", distance: 0 },
  };
}

function metadata(id: string): PropAssetMetadata {
  return {
    id,
    sourcePath: `${id}.glb`,
    meshCount: 1,
    materialCount: 1,
    localBounds: { min: [0, 0, 0], max: [1, 1, 1], center: [0.5, 0.5, 0.5], radius: 1 },
    boundingSphereRadius: 1,
    triangleCount: 1,
    hasAlphaMaterial: false,
    hasAnimation: false,
    hasCollisionMesh: false,
    lodAvailability: "generated",
    drawCallParts: 1,
    maxTextureSize: 1,
    hasNormals: true,
    scaleUniform: true,
  };
}

function loadedAsset(def: PropAssetDef, ...geometries: THREE.BufferGeometry[]): LoadedPropAsset {
  return {
    def,
    root: new THREE.Group(),
    metadata: metadata(def.id),
    lodChain: {
      levels: geometries.map((geometry, lod) => ({ lod, geometry, triangleCount: 1, errorWorld: 0 })),
      billboardGeometry: null,
    },
    lodErrorWorld: geometries.map(() => 0),
    sourceMaterial: new THREE.MeshBasicMaterial(),
  };
}

function settings(props: PropAssetDef[]): CustomPropsSettings {
  return {
    enabled: true,
    props,
    spatial: {
      cellSizeM: 16,
      maxInstancesPerCellWarning: 16,
      farCellUpdateIntervalFrames: 8,
      ringRadiusM: 0,
      cellUpdateBudgetPerFrame: 4,
      matrixUploadBudgetPerFrame: 16,
      lodRefreshDistanceM: 4,
    },
    culling: {
      cellFrustumCulling: true,
      cellDistanceCulling: true,
      perInstanceFrustumCullingForLargeProps: true,
      perInstanceCullingMinRadius: 2,
      farUpdateIntervalFrames: 8,
      hysteresisM: 2,
    },
    shadows: { maxShadowProps: 16 },
    occlusion: {
      enabled: true,
      cellSizeM: 4,
      buildCellsPerFrame: 256,
      footprintPaddingM: 0.35,
      minimumHeightM: 1.5,
      mistClipStrength: 0.85,
    },
    gpu: {
      enabled: true,
      preferWebGpu: true,
      fallbackToCpu: true,
      debugForceCpu: false,
      maxVisible: 64,
      workgroupSize: 64,
      debugShowGpuCounts: false,
    },
    categoryBudgets: {
      small_decor: CATEGORY_BUDGET,
      medium_static: CATEGORY_BUDGET,
      large_static: CATEGORY_BUDGET,
      vegetation: CATEGORY_BUDGET,
      interactive: CATEGORY_BUDGET,
    },
    debug: { showCells: false, showBounds: false, lodColorOverlay: false, billboardOverlay: false },
  };
}

function instance(assetId: string, x: number): PropInstance {
  return {
    assetId,
    position: [x, 0, 0],
    rotationY: 0,
    scale: 1,
    seed: 1,
    variationId: 0,
    flags: 0,
    revision: 0,
  };
}

describe("prop GPU ring draw source", () => {
  it("skips instances whose asset has no renderable LOD geometry", () => {
    const valid = propDef("valid");
    const invalid = propDef("invalid");
    const loaded = new Map<string, LoadedPropAsset>([
      [valid.id, loadedAsset(valid, validGeometry())],
      [invalid.id, loadedAsset(invalid, invalidGeometry())],
    ]);
    const grid = PropSpatialGrid.fromInstances([instance(valid.id, 1), instance(invalid.id, 2)], 16);

    const source = buildPropGpuRingSource({
      grid,
      settings: settings([valid, invalid]),
      loadedAssets: loaded,
      indexCountFor: renderableIndirectDrawCountForGeometry,
    });

    expect(source.sourceCount).toBe(1);
    expect(source.groupCount).toBe(1);
    expect(source.groupMeta[2]).toBe(3);
  });

  it("skips assets with partially invalid LOD chains", () => {
    const valid = propDef("valid", [0, 50]);
    const partial = propDef("partial", [0, 50]);
    const loaded = new Map<string, LoadedPropAsset>([
      [valid.id, loadedAsset(valid, validGeometry(), validGeometry())],
      [partial.id, loadedAsset(partial, validGeometry(), invalidGeometry())],
    ]);
    const grid = PropSpatialGrid.fromInstances([instance(valid.id, 1), instance(partial.id, 2)], 16);

    const source = buildPropGpuRingSource({
      grid,
      settings: settings([valid, partial]),
      loadedAssets: loaded,
      indexCountFor: renderableIndirectDrawCountForGeometry,
    });

    expect(source.sourceCount).toBe(1);
    expect(source.groupCount).toBe(2);
    expect(Array.from(source.groupMeta)).toEqual([0, 0, 3, 0, 0, 1, 3, 0]);
  });

  it("returns an empty source when no loaded asset has renderable LOD geometry", () => {
    const invalid = propDef("invalid");
    const loaded = new Map<string, LoadedPropAsset>([
      [invalid.id, loadedAsset(invalid, invalidGeometry())],
    ]);
    const grid = PropSpatialGrid.fromInstances([instance(invalid.id, 1)], 16);

    const source = buildPropGpuRingSource({
      grid,
      settings: settings([invalid]),
      loadedAssets: loaded,
      indexCountFor: renderableIndirectDrawCountForGeometry,
    });

    expect(source.sourceCount).toBe(0);
    expect(source.groupCount).toBe(0);
  });
});
