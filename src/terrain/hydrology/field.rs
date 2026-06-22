use bevy::prelude::*;

use crate::voxel::terrain::GeneratedWaterBodyKind;

#[derive(Clone, Debug, PartialEq)]
pub struct VisualHydrologyMetadata {
    pub resolution: usize,
    pub far_resolution: usize,
    pub world_min: Vec2,
    pub world_size: Vec2,
    pub cell_size: Vec2,
}

#[derive(Resource, Clone, Debug)]
pub struct VisualHydrologyField {
    pub water_y: Vec<f32>,
    pub water_y_far: Vec<f32>,
    pub wet_mask: Vec<u8>,
    pub flow_dir_speed: Vec<Vec2>,
    pub flow_strength: Vec<f32>,
    pub river_depth: Vec<f32>,
    pub moisture: Vec<f32>,
    pub body_kind: Vec<GeneratedWaterBodyKind>,
    pub metadata: VisualHydrologyMetadata,
}

impl VisualHydrologyField {
    pub fn len(&self) -> usize {
        self.metadata.resolution * self.metadata.resolution
    }

    pub fn far_len(&self) -> usize {
        self.metadata.far_resolution * self.metadata.far_resolution
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn index(&self, x: usize, z: usize) -> usize {
        z * self.metadata.resolution + x
    }

    #[inline]
    pub fn far_index(&self, x: usize, z: usize) -> usize {
        z * self.metadata.far_resolution + x
    }
}
