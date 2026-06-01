use crate::voxel::chunk::LodLevel;
use crate::voxel::meshing::lod_delta_gt_one_face_mask;
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use std::sync::atomic::{AtomicU32, Ordering};

static LOD_DELTA_GT_ONE_WARNINGS: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TransvoxelFaceMask {
    pub neg_x: bool,
    pub pos_x: bool,
    pub neg_y: bool,
    pub pos_y: bool,
    pub neg_z: bool,
    pub pos_z: bool,
}

impl TransvoxelFaceMask {
    pub fn get(self, face: ChunkFace) -> bool {
        match face {
            ChunkFace::NegX => self.neg_x,
            ChunkFace::PosX => self.pos_x,
            ChunkFace::NegY => self.neg_y,
            ChunkFace::PosY => self.pos_y,
            ChunkFace::NegZ => self.neg_z,
            ChunkFace::PosZ => self.pos_z,
        }
    }

    pub fn set(&mut self, face: ChunkFace, value: bool) {
        match face {
            ChunkFace::NegX => self.neg_x = value,
            ChunkFace::PosX => self.pos_x = value,
            ChunkFace::NegY => self.neg_y = value,
            ChunkFace::PosY => self.pos_y = value,
            ChunkFace::NegZ => self.neg_z = value,
            ChunkFace::PosZ => self.pos_z = value,
        }
    }

    pub fn any(self) -> bool {
        self.neg_x || self.pos_x || self.neg_y || self.pos_y || self.neg_z || self.pos_z
    }
}

fn neighbor_lod_for_face(neighbor_lods: &NeighborLods, face: ChunkFace) -> Option<LodLevel> {
    match face {
        ChunkFace::NegX => neighbor_lods.neg_x,
        ChunkFace::PosX => neighbor_lods.pos_x,
        ChunkFace::NegY => neighbor_lods.neg_y,
        ChunkFace::PosY => neighbor_lods.pos_y,
        ChunkFace::NegZ => neighbor_lods.neg_z,
        ChunkFace::PosZ => neighbor_lods.pos_z,
    }
}

/// Transition faces on the high-resolution side when the neighbor is exactly one LOD coarser.
pub fn compute_transvoxel_face_mask(
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> (TransvoxelFaceMask, u32) {
    let mut mask = TransvoxelFaceMask::default();
    let mut skipped_lod_delta_gt_one = 0u32;
    let Some(my_index) = my_lod.lod_index() else {
        return (mask, skipped_lod_delta_gt_one);
    };

    let delta_mask = lod_delta_gt_one_face_mask(my_lod, neighbor_lods);
    if delta_mask != 0 && LOD_DELTA_GT_ONE_WARNINGS.fetch_add(1, Ordering::Relaxed) < 8 {
        log::warn!(
            "MC+Transvoxel: lod_delta_gt_one_face_mask=0x{delta_mask:02x} for {my_lod:?}; skipping transition on those faces"
        );
    }

    for face in ChunkFace::ALL {
        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        let Some(neighbor_index) = neighbor_lod.lod_index() else {
            continue;
        };
        let delta = my_index.abs_diff(neighbor_index);
        if delta > 1 {
            skipped_lod_delta_gt_one += 1;
            continue;
        }
        if neighbor_index == my_index + 1 {
            mask.set(face, true);
        }
    }

    (mask, skipped_lod_delta_gt_one)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::LodLevel;

    #[test]
    fn transition_mask_matches_coarser_neighbor() {
        let neighbors = NeighborLods {
            pos_y: Some(LodLevel::Lod1),
            ..Default::default()
        };
        let (mask, skipped) = compute_transvoxel_face_mask(LodLevel::Lod0, &neighbors);
        assert!(mask.pos_y);
        assert!(!mask.neg_y);
        assert_eq!(skipped, 0);
    }

    #[test]
    fn skips_lod_delta_gt_one() {
        let neighbors = NeighborLods {
            pos_y: Some(LodLevel::Lod2),
            ..Default::default()
        };
        let (mask, skipped) = compute_transvoxel_face_mask(LodLevel::Lod0, &neighbors);
        assert!(!mask.pos_y);
        assert_eq!(skipped, 1);
    }
}
