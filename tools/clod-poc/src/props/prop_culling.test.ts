import { describe, expect, it } from "vitest";
import * as THREE from "three";
import customPropsYaml from "../../config/custom_props.yaml?raw";
import { parseCustomPropsConfig } from "./prop_config.js";
import { cullPropSpatialGrid } from "./prop_culling.js";
import { parsePropPlacements } from "./prop_placements.js";
import { extractPropAssetMetadata } from "./prop_asset_metadata.js";
import { PropSpatialGrid } from "./prop_spatial_grid.js";

describe("cullPropSpatialGrid", () => {
  it("frustum and distance culls far cells", () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    const scene = parsePropPlacements(`schema_version: 1
scene_id: cull_test
instances:
  - asset_id: crate_a
    position: [5000, 0, 5000]
    rotation_y: 0
    scale: 1
    seed: 1
    variation_id: 0`);
    const grid = PropSpatialGrid.fromInstances(scene.instances, settings.spatial.cellSizeM);
    const metadata = new Map([
      [
        "crate_a",
        extractPropAssetMetadata(
          (() => {
            const g = new THREE.Group();
            g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
            return g;
          })(),
          settings.props.find((p) => p.id === "crate_a")!,
        ),
      ],
    ]);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000);
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const result = cullPropSpatialGrid(
      grid,
      camera,
      settings,
      metadata,
      1,
    );
    expect(result.visibleCells).toBe(0);
    expect(result.culledCells).toBeGreaterThan(0);
  });
});
