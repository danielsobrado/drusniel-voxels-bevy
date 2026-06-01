use bevy::prelude::*;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct McTransvoxelStats {
    pub regular_chunks_meshed: u32,
    pub transition_faces_meshed: [u32; 6],
    pub transition_triangles_total: u32,
    pub skipped_lod_delta_gt_one: u32,
    pub skipped_missing_neighbor: u32,
    pub mesh_generation_ms_total: f32,
    pub triangle_count_regular: u32,
    pub triangle_count_transition: u32,
}

impl McTransvoxelStats {
    pub fn record_transition_face(&mut self, face_index: usize, triangles: u32) {
        if face_index < 6 {
            self.transition_faces_meshed[face_index] += 1;
        }
        self.transition_triangles_total = self.transition_triangles_total.saturating_add(triangles);
        self.triangle_count_transition = self.triangle_count_transition.saturating_add(triangles);
    }

    pub fn record_regular_triangles(&mut self, triangles: u32) {
        self.triangle_count_regular = self.triangle_count_regular.saturating_add(triangles);
    }
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct McTransvoxelRuntimeStats {
    pub aggregated: McTransvoxelStats,
    pub chunks_meshed_this_frame: u32,
}
