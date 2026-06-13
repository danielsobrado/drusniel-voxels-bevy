use super::*;

/// Runtime chunk statistics for debug overlay and performance monitoring.
///
/// This resource tracks chunk counts by uniformity type, mesh entities,
/// and per-frame statistics for the debug overlay (F3).
#[derive(Resource, Default, Debug)]
pub struct RuntimeChunkStats {
    // Total chunk counts by uniformity
    pub total_chunks: u32,
    pub empty_chunks: u32,
    pub solid_chunks: u32,
    pub mixed_chunks: u32,

    // Mesh statistics
    pub mesh_entities: u32,
    pub water_mesh_entities: u32,
    pub water_air_boundaries_total: u64,
    pub water_air_boundaries_exposed: u64,
    pub water_air_boundaries_sealed: u64,
    pub water_triangles_removed_sealed: u64,
    pub invalid_water_meshes_suppressed: u64,
    pub edge_water_faces_suppressed: u64,
    pub water_flood_fill_boundary_hits: u64,
    pub water_exposure_outside_world_rejected: u64,
    pub terrain_mesh_empty_but_solid_voxels: u64,
    pub terrain_mesh_boundary_missing_neighbor: u64,
    pub terrain_mesh_degenerate_triangles_removed: u64,
    pub terrain_mesh_lod_seam_repairs: u64,

    // Per-frame statistics (reset each frame in the meshing system)
    pub chunks_meshed_this_frame: u32,
    pub chunks_skipped_this_frame: u32,
    pub chunks_skipped_page_owned: u32,
    pub dirty_chunks_queued: u32,
    pub generation_dirty_chunks_queued: u32,
    pub surface_nets_chunks_deferred_for_halo: u32,

    // LOD statistics
    pub high_lod_chunks: u32,
    pub low_lod_chunks: u32,
    pub culled_chunks: u32,

    // Vertex count statistics (for measuring LOD effectiveness)
    pub high_lod_vertices: u64,
    pub low_lod_vertices: u64,
    pub total_vertices: u64,

    // Chunk counts for averaging (how many chunks contributed to vertex counts)
    pub high_lod_mesh_count: u32,
    pub low_lod_mesh_count: u32,

    // Per-frame meshing time tracking (microseconds)
    pub meshing_time_us: u64,
}

impl RuntimeChunkStats {
    /// Recompute all statistics from the world state.
    pub fn recompute_from_world(&mut self, world: &VoxelWorld) {
        self.total_chunks = 0;
        self.empty_chunks = 0;
        self.solid_chunks = 0;
        self.mixed_chunks = 0;
        self.mesh_entities = 0;
        self.water_mesh_entities = 0;
        self.high_lod_chunks = 0;
        self.low_lod_chunks = 0;
        self.culled_chunks = 0;
        self.terrain_mesh_empty_but_solid_voxels = 0;
        self.terrain_mesh_boundary_missing_neighbor = 0;
        self.terrain_mesh_degenerate_triangles_removed = 0;
        self.terrain_mesh_lod_seam_repairs = 0;
        self.invalid_water_meshes_suppressed = 0;
        self.edge_water_faces_suppressed = 0;
        self.water_flood_fill_boundary_hits = 0;
        self.water_exposure_outside_world_rejected = 0;
        // Note: vertex counts are tracked during mesh generation, not here

        for (_, chunk) in world.chunk_entries() {
            self.total_chunks += 1;

            match chunk.uniformity() {
                ChunkUniformity::Empty => self.empty_chunks += 1,
                ChunkUniformity::Solid => self.solid_chunks += 1,
                ChunkUniformity::Mixed => self.mixed_chunks += 1,
                ChunkUniformity::Unknown => {} // Count as mixed for display purposes
            }

            if chunk.mesh_entity().is_some() {
                self.mesh_entities += 1;
            }
            if chunk.water_mesh_entity().is_some() {
                self.water_mesh_entities += 1;
            }

            match chunk.lod_level() {
                LodLevel::Lod0 => self.high_lod_chunks += 1,
                LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 => self.low_lod_chunks += 1,
                LodLevel::Culled => self.culled_chunks += 1,
            }
        }
    }

    /// Reset per-frame counters.
    pub fn reset_frame_counters(&mut self) {
        self.chunks_meshed_this_frame = 0;
        self.chunks_skipped_this_frame = 0;
        self.chunks_skipped_page_owned = 0;
        self.dirty_chunks_queued = 0;
        self.generation_dirty_chunks_queued = 0;
        self.surface_nets_chunks_deferred_for_halo = 0;
        self.meshing_time_us = 0;
    }

    /// Reset vertex count statistics (called when recomputing all stats).
    pub fn reset_vertex_counts(&mut self) {
        self.high_lod_vertices = 0;
        self.low_lod_vertices = 0;
        self.total_vertices = 0;
        self.high_lod_mesh_count = 0;
        self.low_lod_mesh_count = 0;
    }

    /// Add vertex count for a mesh at a given LOD level.
    pub fn add_mesh_vertices(&mut self, vertex_count: u32, lod_level: LodLevel) {
        // Only count non-empty meshes for averaging
        if vertex_count == 0 {
            return;
        }
        let count = vertex_count as u64;
        self.total_vertices += count;
        match lod_level {
            LodLevel::Lod0 => {
                self.high_lod_vertices += count;
                self.high_lod_mesh_count += 1;
            }
            LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 => {
                self.low_lod_vertices += count;
                self.low_lod_mesh_count += 1;
            }
            LodLevel::Culled => {} // No vertices for culled chunks
        }
    }

    /// Get average vertices per chunk for high LOD meshes.
    pub fn avg_high_lod_vertices(&self) -> u32 {
        if self.high_lod_mesh_count > 0 {
            (self.high_lod_vertices / self.high_lod_mesh_count as u64) as u32
        } else {
            0
        }
    }

    /// Get average vertices per chunk for low LOD meshes.
    pub fn avg_low_lod_vertices(&self) -> u32 {
        if self.low_lod_mesh_count > 0 {
            (self.low_lod_vertices / self.low_lod_mesh_count as u64) as u32
        } else {
            0
        }
    }

    /// Get LOD reduction ratio (0.0 to 1.0, lower = more reduction).
    pub fn lod_reduction_ratio(&self) -> f32 {
        let hi_avg = self.avg_high_lod_vertices();
        let lo_avg = self.avg_low_lod_vertices();
        if hi_avg > 0 && lo_avg > 0 {
            lo_avg as f32 / hi_avg as f32
        } else {
            1.0 // No data, assume no reduction
        }
    }
}
