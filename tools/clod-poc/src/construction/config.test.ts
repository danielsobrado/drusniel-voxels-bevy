import { describe, expect, it } from "vitest";
import { parseConstructionConfig } from "./config.js";

describe("construction config", () => {
  it("normalizes snap frames and rejects invalid piece dimensions", () => {
    const config = parseConstructionConfig(`
construction:
  pieces:
    - id: bad-piece
      label: Bad Piece
      category: floor
      dimensions_m: [2, 0, -1]
      can_ground: true
      material: stone
      snap_points:
        - id: zero-direction
          local_pos: [1, 2, 3]
          direction: [0, 0, 0]
          tangent: [0, 0, 0]
          allowed_twist_degrees: [0, 181]
          group: floor_edge
          accepts: [wall_bottom]
    - id: normalized-piece
      label: Normalized Piece
      category: wall
      dimensions_m: [2, 2, 0.2]
      can_ground: false
      material: wood
      geometry_kind: wedge
      placement_boxes:
        - center: [0, 0, 0]
          dimensions_m: [2, 1, 0.2]
          rotation_y_degrees: 45
      snap_points:
        - id: diagonal
          local_pos: [0, 0, 0]
          direction: [10, 0, 0]
          tangent: [10, 10, 0]
          group: wall-side
          accepts: [wall-side]
`);

    expect(config.pieces[0]?.dimensionsM).toEqual([1, 1, 1]);
    expect(config.pieces[0]?.snapPoints[0]?.direction).toEqual([0, 1, 0]);
    expect(config.pieces[0]?.snapPoints[0]?.tangent).toEqual([0, 0, 1]);
    expect(config.pieces[0]?.snapPoints[0]?.allowedTwistDegrees).toEqual([0, 180]);
    expect(config.pieces[0]?.snapPoints[0]?.group).toBe("floor-edge");
    expect(config.pieces[0]?.snapPoints[0]?.accepts).toEqual(["wall-bottom"]);
    expect(config.pieces[1]?.snapPoints[0]?.direction).toEqual([1, 0, 0]);
    expect(config.pieces[1]?.snapPoints[0]?.tangent).toEqual([0, 1, 0]);
    expect(config.pieces[1]?.geometryKind).toBe("wedge");
    expect(config.pieces[1]?.placementBoxes?.[0]?.rotationYDegrees).toBe(45);
  });

  it("clamps numeric config values to safe ranges", () => {
    const config = parseConstructionConfig(`
construction:
  snap:
    radius_m: -10
    spatial_cell_m: 0
    min_alignment: 2
    alignment_weight: -1
    tangent_weight: 99
    distance_weight: 99
    release_radius_multiplier: 0
    max_ray_distance_m: 999
  placement:
    max_ray_distance_m: 0
    terrain_step_m: 99
    overlap_padding_m: -1
    overlap_spatial_cell_m: 999
  ghost:
    opacity: 2
`);

    expect(config.snap.radiusM).toBe(0.1);
    expect(config.snap.spatialCellM).toBe(0.1);
    expect(config.snap.minAlignment).toBe(1);
    expect(config.snap.alignmentWeight).toBe(0);
    expect(config.snap.tangentWeight).toBe(10);
    expect(config.snap.distanceWeight).toBe(10);
    expect(config.snap.releaseRadiusMultiplier).toBe(1);
    expect(config.snap.maxRayDistanceM).toBe(256);
    expect(config.placement.maxRayDistanceM).toBe(1);
    expect(config.placement.terrainStepM).toBe(16);
    expect(config.placement.overlapPaddingM).toBe(0);
    expect(config.placement.overlapSpatialCellM).toBe(64);
    expect(config.ghost.opacity).toBe(0.95);
  });
});
