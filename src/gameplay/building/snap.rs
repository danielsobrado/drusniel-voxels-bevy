//! Snap point detection and scoring for piece placement.

use bevy::prelude::*;

use super::grid::{IndexedSnapPoint, SnapConfig, SnapPointIndex};
use super::types::{
    BuildingPieceRegistry, BuildingState, PieceDefinition, PieceTypeId, SnapGroup, SnapPointDef,
    SnapResult, SnapTarget,
};

const SNAP_COMPATIBILITY_SCORE_WEIGHT: f32 = 10.0;

/// Find the best snap point for placing a piece at the given cursor position.
pub fn find_best_snap(
    cursor_world_pos: Vec3,
    piece_type: PieceTypeId,
    piece_rotation: u8,
    registry: &BuildingPieceRegistry,
    snap_index: &SnapPointIndex,
    config: &SnapConfig,
) -> Option<SnapResult> {
    let piece_def = registry.get(piece_type)?;
    let rotation = Quat::from_rotation_y((piece_rotation as f32) * std::f32::consts::FRAC_PI_2);

    // Query nearby snap points
    let nearby_snaps = snap_index.query_radius(cursor_world_pos, config.snap_radius);

    if nearby_snaps.is_empty() {
        return None;
    }

    let mut best_result: Option<SnapResult> = None;
    let mut best_score = f32::NEG_INFINITY;

    // For each nearby target snap point
    for target in nearby_snaps {
        // For each snap point on the piece we're placing
        for (source_idx, source_def) in piece_def.snap_points.iter().enumerate() {
            // Check compatibility
            if !accepts(source_def, target) {
                continue;
            }

            // Calculate where the piece would need to be for these snap points to connect
            let (position, alignment_score) =
                calculate_snap_transform(target, source_def, rotation, piece_def, piece_rotation);

            // Skip if alignment is too poor
            if alignment_score < config.min_alignment {
                continue;
            }

            // Calculate distance score (closer to cursor is better for disambiguation)
            let dist = cursor_world_pos.distance(position);
            let distance_score = 1.0 - (dist / config.snap_radius).min(1.0);

            // Combined score
            let rank = compatibility_rank(source_def.snap_group, target.snap_group);
            let score = rank as f32 * SNAP_COMPATIBILITY_SCORE_WEIGHT
                + config.alignment_weight * alignment_score
                + config.distance_weight * distance_score;

            if score > best_score {
                best_score = score;
                best_result = Some(SnapResult {
                    target_snap: SnapTarget {
                        entity: target.entity,
                        piece_type: target.piece_type,
                        snap_index: target.snap_index,
                        position: target.world_position,
                        direction: target.world_direction,
                        snap_group: target.snap_group,
                    },
                    source_snap_index: source_idx,
                    world_position: position,
                    world_rotation: rotation,
                    score,
                });
            }
        }
    }

    best_result
}

/// Calculate the transform needed to connect two snap points.
/// Returns (world_position, alignment_score).
fn calculate_snap_transform(
    target: &IndexedSnapPoint,
    source: &SnapPointDef,
    rotation: Quat,
    piece_def: &PieceDefinition,
    rotation_quarter_turns: u8,
) -> (Vec3, f32) {
    // The source snap point's position in world space (relative to piece origin)
    let rotated_source_offset = rotation * source.local_offset;
    let rotated_source_direction = rotation * source.direction;

    let alignment = connection_alignment(
        piece_def,
        source.snap_group,
        target.snap_group,
        rotation_quarter_turns,
        rotated_source_direction,
        target.world_direction,
    );

    // Calculate where the piece origin should be:
    // target_position = piece_origin + rotated_source_offset
    // Therefore: piece_origin = target_position - rotated_source_offset
    let mut piece_origin = target.world_position - rotated_source_offset;
    if source.snap_group == SnapGroup::FloorEdge && target.snap_group == SnapGroup::WallTop {
        piece_origin.y += piece_def.dimensions.y;
    }

    (piece_origin, alignment)
}

fn accepts(source: &SnapPointDef, target: &IndexedSnapPoint) -> bool {
    let source_allows_target = source.compatible_groups.is_empty()
        || source.compatible_groups.contains(&target.snap_group);
    let target_allows_source = target.compatible_groups.is_empty()
        || target.compatible_groups.contains(&source.snap_group);
    if source_allows_target && target_allows_source {
        return true;
    }
    source.compatible_groups.is_empty()
        && target.compatible_groups.is_empty()
        && source.snap_group.is_compatible_with(&target.snap_group)
}

fn is_wall_floor_pair(source: SnapGroup, target: SnapGroup) -> bool {
    ((source == SnapGroup::WallBottom || source == SnapGroup::WallTop)
        && target == SnapGroup::FloorEdge)
        || (source == SnapGroup::FloorEdge
            && (target == SnapGroup::WallBottom || target == SnapGroup::WallTop))
}

fn is_wall_stack_pair(source: SnapGroup, target: SnapGroup) -> bool {
    (source == SnapGroup::WallBottom && target == SnapGroup::WallTop)
        || (source == SnapGroup::WallTop && target == SnapGroup::WallBottom)
}

fn local_horizontal_snap_normal(piece: &PieceDefinition) -> Vec3 {
    if piece.dimensions.x <= piece.dimensions.z {
        Vec3::X
    } else {
        Vec3::Z
    }
}

fn normalize_horizontal(value: Vec3) -> Option<Vec3> {
    let horizontal = Vec3::new(value.x, 0.0, value.z);
    (horizontal.length_squared() > 1.0e-12).then(|| horizontal.normalize())
}

fn wall_floor_alignment(
    piece: &PieceDefinition,
    source_group: SnapGroup,
    target_group: SnapGroup,
    rotation_quarter_turns: u8,
    source_dir: Vec3,
    target_dir: Vec3,
) -> Option<f32> {
    if !is_wall_floor_pair(source_group, target_group) {
        return None;
    }

    if source_group == SnapGroup::WallBottom && target_group == SnapGroup::FloorEdge {
        let rotation =
            Quat::from_rotation_y((rotation_quarter_turns as f32) * std::f32::consts::FRAC_PI_2);
        let source_normal = normalize_horizontal(rotation * local_horizontal_snap_normal(piece));
        let target_normal = normalize_horizontal(target_dir);
        return Some(
            source_normal
                .zip(target_normal)
                .map(|(source, target)| source.dot(target).abs())
                .unwrap_or(0.0),
        );
    }

    let source_normal = normalize_horizontal(source_dir);
    let target_normal = normalize_horizontal(target_dir);
    Some(
        source_normal
            .zip(target_normal)
            .map(|(source, target)| source.dot(target).abs())
            .unwrap_or(1.0),
    )
}

fn connection_alignment(
    piece: &PieceDefinition,
    source_group: SnapGroup,
    target_group: SnapGroup,
    rotation_quarter_turns: u8,
    source_dir: Vec3,
    target_dir: Vec3,
) -> f32 {
    if is_wall_stack_pair(source_group, target_group) {
        return -source_dir.dot(target_dir);
    }
    if let Some(alignment) = wall_floor_alignment(
        piece,
        source_group,
        target_group,
        rotation_quarter_turns,
        source_dir,
        target_dir,
    ) {
        return alignment;
    }
    -source_dir.dot(target_dir)
}

fn compatibility_rank(source: SnapGroup, target: SnapGroup) -> u8 {
    if is_wall_floor_pair(source, target) || is_wall_stack_pair(source, target) {
        return 4;
    }
    if (source == SnapGroup::RoofEdge && target == SnapGroup::WallTop)
        || (source == SnapGroup::WallTop && target == SnapGroup::RoofEdge)
    {
        return 4;
    }
    if source == SnapGroup::WallSide && target == SnapGroup::WallSide {
        return 3;
    }
    if source == SnapGroup::FloorEdge && target == SnapGroup::FloorEdge {
        return 2;
    }
    if source == SnapGroup::Generic && target == SnapGroup::Generic {
        return 1;
    }
    1
}

/// System to detect snap points based on cursor/raycast position.
pub fn detect_snap_points(
    mut state: ResMut<BuildingState>,
    registry: Res<BuildingPieceRegistry>,
    snap_index: Res<SnapPointIndex>,
    config: Res<SnapConfig>,
    targeted: Res<crate::interaction::TargetedBlock>,
) {
    // Clear previous snap
    state.current_snap = None;

    // Only detect snaps if building mode is active and snap is enabled
    if !state.active || !state.snap_enabled {
        return;
    }

    let Some(piece_type) = state.selected_piece else {
        return;
    };

    // Get cursor world position from targeted block
    let cursor_pos = if let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) {
        // Place position is adjacent to targeted block
        let place_pos = block_pos + normal;
        Vec3::new(
            place_pos.x as f32 + 0.5,
            place_pos.y as f32 + 0.5,
            place_pos.z as f32 + 0.5,
        )
    } else {
        return;
    };

    // Find best snap
    state.current_snap = find_best_snap(
        cursor_pos,
        piece_type,
        state.rotation,
        &registry,
        &snap_index,
        &config,
    );
}

/// Calculate snap score between two snap points.
pub fn calculate_snap_score(
    target_dir: Vec3,
    source_dir: Vec3,
    distance: f32,
    max_distance: f32,
    config: &SnapConfig,
) -> f32 {
    // Alignment: how well the directions oppose each other
    let alignment = (-source_dir).dot(target_dir).max(0.0);

    // Distance: closer is better
    let distance_factor = 1.0 - (distance / max_distance).min(1.0);

    config.alignment_weight * alignment + config.distance_weight * distance_factor
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::building_material::BuildingMaterialType;

    #[test]
    fn test_snap_group_compatibility() {
        use crate::building::SnapGroup::*;

        // Floor edges connect to each other
        assert!(FloorEdge.is_compatible_with(&FloorEdge));

        // Floor edges connect to wall bottoms
        assert!(FloorEdge.is_compatible_with(&WallBottom));
        assert!(WallBottom.is_compatible_with(&FloorEdge));

        // Wall sides connect to each other
        assert!(WallSide.is_compatible_with(&WallSide));

        // Generic connects to everything
        assert!(Generic.is_compatible_with(&FloorEdge));
        assert!(Generic.is_compatible_with(&WallTop));
        assert!(FloorEdge.is_compatible_with(&Generic));
    }

    #[test]
    fn test_snap_score() {
        let config = SnapConfig::default();

        // Perfect alignment and close distance
        let score1 = calculate_snap_score(
            Vec3::Z,     // target pointing +Z
            Vec3::NEG_Z, // source pointing -Z (perfect opposite)
            0.1,         // close
            1.0,         // max distance
            &config,
        );

        // Poor alignment
        let score2 = calculate_snap_score(
            Vec3::Z,
            Vec3::X, // perpendicular
            0.1,
            1.0,
            &config,
        );

        assert!(score1 > score2);
    }

    fn test_registry() -> BuildingPieceRegistry {
        let mut registry = BuildingPieceRegistry::default();
        registry.register(PieceDefinition::floor(
            1,
            "Floor",
            BuildingMaterialType::WoodPlank,
        ));
        registry.register(PieceDefinition::wall(
            2,
            "Wall",
            BuildingMaterialType::WoodPlank,
        ));
        registry
    }

    fn snap_target(
        entity_raw: u32,
        piece_type: PieceTypeId,
        snap_group: SnapGroup,
        position: Vec3,
        direction: Vec3,
        compatible_groups: Vec<SnapGroup>,
    ) -> IndexedSnapPoint {
        IndexedSnapPoint {
            entity: Entity::from_raw_u32(entity_raw).unwrap(),
            piece_type,
            snap_index: 0,
            world_position: position,
            world_direction: direction,
            snap_group,
            compatible_groups,
        }
    }

    #[test]
    fn floor_snaps_edge_to_edge_with_ranked_score() {
        let registry = test_registry();
        let mut index = SnapPointIndex::new(1.0);
        index.insert(snap_target(
            1,
            PieceTypeId(1),
            SnapGroup::FloorEdge,
            Vec3::new(0.0, 0.0, -1.0),
            Vec3::NEG_Z,
            vec![
                SnapGroup::FloorEdge,
                SnapGroup::WallBottom,
                SnapGroup::WallTop,
            ],
        ));

        let snap = find_best_snap(
            Vec3::new(0.0, 0.0, -1.0),
            PieceTypeId(1),
            0,
            &registry,
            &index,
            &SnapConfig::default(),
        )
        .expect("floor should snap to floor edge");

        assert_eq!(snap.target_snap.snap_group, SnapGroup::FloorEdge);
        assert!((snap.world_position - Vec3::new(0.0, 0.0, -2.0)).length() < 1.0e-5);
        assert!(snap.score >= SNAP_COMPATIBILITY_SCORE_WEIGHT * 2.0);
    }

    #[test]
    fn wall_bottom_aligns_to_floor_edge_without_opposite_normals() {
        let registry = test_registry();
        let mut index = SnapPointIndex::new(1.0);
        index.insert(snap_target(
            1,
            PieceTypeId(1),
            SnapGroup::FloorEdge,
            Vec3::new(0.0, 0.0, -1.0),
            Vec3::NEG_Z,
            vec![
                SnapGroup::FloorEdge,
                SnapGroup::WallBottom,
                SnapGroup::WallTop,
            ],
        ));

        let snap = find_best_snap(
            Vec3::new(0.0, 0.0, -1.0),
            PieceTypeId(2),
            0,
            &registry,
            &index,
            &SnapConfig::default(),
        )
        .expect("wall bottom should align to floor edge");

        assert_eq!(snap.target_snap.snap_group, SnapGroup::FloorEdge);
        assert_eq!(snap.source_snap_index, 0);
        assert!((snap.world_position - Vec3::new(0.0, 0.0, -1.0)).length() < 1.0e-5);
    }

    #[test]
    fn wall_side_snaps_edge_to_edge() {
        let registry = test_registry();
        let mut index = SnapPointIndex::new(1.0);
        index.insert(snap_target(
            1,
            PieceTypeId(2),
            SnapGroup::WallSide,
            Vec3::new(5.0, 1.0, 0.0),
            Vec3::NEG_X,
            vec![SnapGroup::WallSide],
        ));

        let snap = find_best_snap(
            Vec3::new(5.0, 1.0, 0.0),
            PieceTypeId(2),
            0,
            &registry,
            &index,
            &SnapConfig::default(),
        )
        .expect("wall side should snap to wall side");

        assert_eq!(snap.source_snap_index, 3);
        assert!((snap.world_position - Vec3::new(4.0, 0.0, 0.0)).length() < 1.0e-5);
    }

    #[test]
    fn poor_alignment_is_rejected() {
        let registry = test_registry();
        let mut index = SnapPointIndex::new(1.0);
        index.insert(snap_target(
            1,
            PieceTypeId(2),
            SnapGroup::WallSide,
            Vec3::new(5.0, 1.0, 0.0),
            Vec3::Z,
            vec![SnapGroup::WallSide],
        ));

        let snap = find_best_snap(
            Vec3::new(5.0, 1.0, 0.0),
            PieceTypeId(2),
            0,
            &registry,
            &index,
            &SnapConfig::default(),
        );

        assert!(snap.is_none());
    }
}
