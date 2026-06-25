import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_CUSTOM_PROPS_SETTINGS } from "./prop_config.js";
import { extractPropAssetMetadata } from "./prop_asset_metadata.js";
import { validatePropAssetMetadata } from "./prop_asset_validate.js";
import type { PropAssetDef } from "./prop_types.js";

function sampleDef(overrides: Partial<PropAssetDef> = {}): PropAssetDef {
  return {
    id: "test_crate",
    source: "models/custom_props/crates/crate_a.glb",
    category: "medium_static",
    placement: { alignToTerrain: true, terrainConform: false, snapToGrid: false },
    lod: { mode: "generated", distances: [0, 40, 90], triangleRatios: [1, 0.5, 0.25], hysteresis: 10 },
    culling: { maxDistance: 140, shadowDistance: 48, reflectionDistance: 80, minScreenPx: 4 },
    collision: { mode: "box", distance: 48 },
    ...overrides,
  };
}

function makeBoxMesh(withNormals = true): THREE.Mesh {
  const geom = new THREE.BoxGeometry(1, 1, 1);
  if (!withNormals) geom.deleteAttribute("normal");
  return new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xffffff }));
}

describe("extractPropAssetMetadata", () => {
  it("counts meshes, triangles, and bounds from a loaded scene root", () => {
    const root = new THREE.Group();
    root.add(makeBoxMesh());
    const metadata = extractPropAssetMetadata(root, sampleDef());
    expect(metadata.meshCount).toBe(1);
    expect(metadata.triangleCount).toBe(12);
    expect(metadata.hasNormals).toBe(true);
    expect(metadata.localBounds.radius).toBeGreaterThan(0);
  });

  it("rejects assets missing normals or bounds", () => {
    const root = new THREE.Group();
    root.add(makeBoxMesh(false));
    const metadata = extractPropAssetMetadata(root, sampleDef());
    const report = validatePropAssetMetadata(sampleDef(), metadata, DEFAULT_CUSTOM_PROPS_SETTINGS);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === "MISSING_NORMALS")).toBe(true);
  });

  it("flags triangle budget violations for dense meshes", () => {
    const root = new THREE.Group();
    root.add(makeBoxMesh());
    const metadata = extractPropAssetMetadata(root, sampleDef({ category: "small_decor" }));
    const report = validatePropAssetMetadata(
      sampleDef({ category: "small_decor" }),
      { ...metadata, triangleCount: 5000 },
      DEFAULT_CUSTOM_PROPS_SETTINGS,
    );
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === "TRIANGLE_BUDGET_EXCEEDED")).toBe(true);
  });
});
