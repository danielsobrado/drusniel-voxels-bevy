//! Surgical terrain mesh dirty propagation for Surface Nets' 1-voxel halo.
//!
//! Neighbor chunks are marked only when the edit lies within the halo band on
//! every axis that the neighbor offset moves along (AND across axes, not OR).

use crate::constants::CHUNK_SIZE_I32;
use bevy::prelude::{IVec3, UVec3};

/// Voxels within this distance of a chunk face can affect that face's padded halo.
pub const MESH_HALO_BAND: u32 = 1;

const NEAR_POSITIVE_FACE: u32 = (CHUNK_SIZE_I32 - 1 - MESH_HALO_BAND as i32) as u32;

/// Returns true when `neighbor_offset` shares a padded-halo band with `local`.
///
/// Example: edit at local `(15, 8, 8)` only affects the `+X` face neighbor
/// `(1, 0, 0)`, not `(1, 0, -1)`.
#[inline]
pub fn mesh_invalidation_touches_neighbor(local: UVec3, neighbor_offset: IVec3) -> bool {
    if neighbor_offset == IVec3::ZERO {
        return false;
    }

    let touches_axis = |coord: u32, delta: i32| -> bool {
        match delta.cmp(&0) {
            std::cmp::Ordering::Less => coord <= MESH_HALO_BAND,
            std::cmp::Ordering::Greater => coord >= NEAR_POSITIVE_FACE,
            std::cmp::Ordering::Equal => true,
        }
    };

    touches_axis(local.x, neighbor_offset.x)
        && touches_axis(local.y, neighbor_offset.y)
        && touches_axis(local.z, neighbor_offset.z)
}

/// Face-adjacent chunk offsets (6). Used when an entire chunk boundary becomes
/// available to neighbors (async generation), not for single-voxel edits.
pub const CHUNK_FACE_NEIGHBOR_OFFSETS: [IVec3; 6] = [
    IVec3::NEG_X,
    IVec3::X,
    IVec3::NEG_Y,
    IVec3::Y,
    IVec3::NEG_Z,
    IVec3::Z,
];

/// Iterates chunk-coordinate offsets (excluding zero) that need remeshing after
/// a voxel change at `local`.
pub fn mesh_invalidation_neighbor_offsets(local: UVec3) -> impl Iterator<Item = IVec3> {
    (-1..=1).flat_map(move |dz| {
        (-1..=1).flat_map(move |dy| {
            (-1..=1).filter_map(move |dx| {
                let offset = IVec3::new(dx, dy, dz);
                mesh_invalidation_touches_neighbor(local, offset).then_some(offset)
            })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CHUNK_SIZE_U32;
    use bevy::prelude::UVec3;
    use std::collections::HashSet;

    fn offsets_for(local: UVec3) -> Vec<IVec3> {
        mesh_invalidation_neighbor_offsets(local).collect()
    }

    #[test]
    fn interior_edit_marks_no_neighbors() {
        assert!(offsets_for(UVec3::new(8, 8, 8)).is_empty());
    }

    #[test]
    fn face_edit_marks_single_face_neighbor() {
        let local = UVec3::new(CHUNK_SIZE_U32 - 1, 8, 8);
        assert_eq!(offsets_for(local), vec![IVec3::X]);
    }

    #[test]
    fn corner_edit_marks_face_edge_and_corner_neighbors_only() {
        let local = UVec3::ZERO;
        let offsets: HashSet<IVec3> = offsets_for(local).into_iter().collect();
        assert_eq!(offsets.len(), 7);
        assert!(offsets.contains(&IVec3::NEG_X));
        assert!(offsets.contains(&IVec3::NEG_Y));
        assert!(offsets.contains(&IVec3::NEG_Z));
        assert!(offsets.contains(&IVec3::new(-1, -1, 0)));
        assert!(offsets.contains(&IVec3::new(-1, 0, -1)));
        assert!(offsets.contains(&IVec3::new(0, -1, -1)));
        assert!(offsets.contains(&IVec3::new(-1, -1, -1)));
        assert!(!offsets.contains(&IVec3::new(1, 0, -1)));
        assert!(!offsets.contains(&IVec3::new(-1, 0, 1)));
    }

    #[test]
    fn opposite_face_offset_not_marked_at_positive_corner() {
        let local = UVec3::splat(CHUNK_SIZE_U32 - 1);
        let offsets = offsets_for(local);
        assert!(!offsets.contains(&IVec3::new(1, 0, -1)));
        assert!(!offsets.contains(&IVec3::NEG_X));
    }
}
