import { describe, expect, it } from "vitest";
import { defaultConstructionConfig, parseConstructionConfig } from "./config.js";

describe("construction config", () => {
  it("keeps required runtime pieces in the split catalogue", () => {
    const ids = defaultConstructionConfig.pieces.map((piece) => piece.id);
    expect(ids).toEqual(expect.arrayContaining([
      "wood-floor-2x2",
      "wood-wall-2x2",
      "wood-fence-2x1",
      "wood-pillar-2m",
    ]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(4);
  });

  it("normalizes snap frames, proxies, and support overrides", () => {
    const config = parseConstructionConfig(`
construction:
  support_profiles:
    wood:
      max_support: 2
      vertical_decay: 0.08
      horizontal_decay: 0.14
      support_class: wood
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
      support_profile:
        max_support: 1.5
        vertical_decay: 0.02
        horizontal_decay: 0.04
        support_class: ground
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
    expect(config.supportProfiles.wood.maxSupport).toBe(2);
    expect(config.pieces[1]?.supportProfile).toEqual({
      maxSupport: 1.5,
      verticalDecay: 0.02,
      horizontalDecay: 0.04,
      supportClass: "ground",
    });
  });

  it("clamps numeric stability values to safe ranges", () => {
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
  stability:
    collapse_threshold: 2
    epsilon: 0
    max_island_size: 2
    max_collapses_per_frame: 0
    connection_tolerance_m: 0
    vertical_connection_min_ratio: 2
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
    expect(config.stability.collapseThreshold).toBe(1);
    expect(config.stability.epsilon).toBe(0.000001);
    expect(config.stability.maxIslandSize).toBe(16);
    expect(config.stability.maxCollapsesPerFrame).toBe(1);
    expect(config.stability.connectionToleranceM).toBe(0.005);
    expect(config.stability.verticalConnectionMinRatio).toBe(1);
    expect(config.ghost.opacity).toBe(0.95);
  });
});
