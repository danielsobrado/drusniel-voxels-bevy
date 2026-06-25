import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PropColliderSet, type PropColliderInstanceInput } from "./prop_collider.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";
import type { PropAssetDef, PropAssetMetadata } from "./prop_types.js";
import { validatePropShotStats } from "./prop_acceptance.js";

function boxAsset(): LoadedPropAsset {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  geometry.translate(0, 1, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  const metadata: PropAssetMetadata = {
    id: "test_box",
    sourcePath: "test.glb",
    meshCount: 1,
    materialCount: 1,
    localBounds: {
      min: [-1, 0, -1],
      max: [1, 2, 1],
      center: [0, 1, 0],
      radius: Math.sqrt(3),
    },
    boundingSphereRadius: Math.sqrt(3),
    triangleCount: 12,
    hasAlphaMaterial: false,
    hasAnimation: false,
    hasCollisionMesh: false,
    lodAvailability: "none",
    drawCallParts: 1,
    maxTextureSize: 1,
    hasNormals: true,
    scaleUniform: true,
  };
  const def: PropAssetDef = {
    id: "test_box",
    source: "test.glb",
    category: "small_decor",
    placement: { alignToTerrain: false, terrainConform: false, snapToGrid: false },
    lod: { mode: "provided", distances: [0], triangleRatios: [1], hysteresis: 1 },
    culling: { maxDistance: 100, shadowDistance: 50, reflectionDistance: 50, minScreenPx: 4 },
    collision: { mode: "box", distance: 48 },
  };
  return {
    def,
    root,
    metadata,
    lodChain: null,
    lodErrorWorld: [],
    sourceMaterial: mesh.material as THREE.Material,
  };
}

function colliderInput(asset: LoadedPropAsset, y = 0): PropColliderInstanceInput {
  return {
    key: "0",
    mode: "box",
    position: [0, y, 0],
    rotationY: 0,
    scale: 1,
    asset,
  };
}

describe("PropColliderSet", () => {
  it("resolves capsule against a box prop above the player", () => {
    const set = new PropColliderSet();
    const asset = boxAsset();
    set.sync([colliderInput(asset, 0)]);

    const position = new THREE.Vector3(0, 3, 0);
    const velocity = new THREE.Vector3(0, -10, 0);
    const result = set.resolveCapsule(position, velocity, {
      capsuleRadius: 0.45,
      capsuleHeight: 1.8,
      maxSlopeDegrees: 60,
    });

    expect(result.position.y).toBeGreaterThan(1.9);
    expect(result.velocity.y).toBeLessThanOrEqual(0);
    expect(set.activeCount()).toBe(1);
  });

  it("drops colliders when sync removes them", () => {
    const set = new PropColliderSet();
    const asset = boxAsset();
    set.sync([colliderInput(asset)]);
    expect(set.activeCount()).toBe(1);
    set.sync([]);
    expect(set.activeCount()).toBe(0);
  });
});

describe("validatePropShotStats", () => {
  it("flags missing instance totals", () => {
    const failures = validatePropShotStats("500", { counters: { "props.instances_total": 10 } }, {
      scenes: { "500": { min_instances_total: 500 } },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.metric).toBe("props.instances_total");
  });
});
