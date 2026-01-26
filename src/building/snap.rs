//! Snap point detection and scoring for piece placement.

use bevy::prelude::*;

use super::grid::{IndexedSnapPoint, SnapConfig, SnapPointIndex};
use super::types::{
    BuildingPieceRegistry, BuildingState, PieceTypeId, SnapPointDef,
    SnapResult, SnapTarget,
};

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
            if !source_def.snap_group.is_compatible_with(&target.snap_group) {
                continue;
            }

            // Calculate where the piece would need to be for these snap points to connect
            let (position, alignment_score) = calculate_snap_transform(
                target,
                source_def,
                rotation,
                config,
            );

            // Skip if alignment is too poor
            if alignment_score < config.min_alignment {
                continue;
            }

            // Calculate distance score (closer to cursor is better for disambiguation)
            let dist = cursor_world_pos.distance(position);
            let distance_score = 1.0 - (dist / config.snap_radius).min(1.0);

            // Combined score
            let score = config.alignment_weight * alignment_score
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
    _config: &SnapConfig,
) -> (Vec3, f32) {
    // The source snap point's position in world space (relative to piece origin)
    let rotated_source_offset = rotation * source.local_offset;
    let rotated_source_direction = rotation * source.direction;

    // For a snap connection, the directions should be opposite
    // (one pointing "out" connects to another pointing "in" from opposite side)
    let alignment = -rotated_source_direction.dot(target.world_direction);

    // Calculate where the piece origin should be:
    // target_position = piece_origin + rotated_source_offset
    // Therefore: piece_origin = target_position - rotated_source_offset
    let piece_origin = target.world_position - rotated_source_offset;

    (piece_origin, alignment)
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

    #[test]
    fn test_snap_group_compatibility() {
        use SnapGroup::*;

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
            Vec3::Z,      // target pointing +Z
            Vec3::NEG_Z,  // source pointing -Z (perfect opposite)
            0.1,          // close
            1.0,          // max distance
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
}
