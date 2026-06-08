use super::{
    ChunkMeshResult, LodShape1, LodShape2, LodShape3, MeshData, MeshGenerationTimingStats,
    PaddedChunkShape, SMOOTH_TERRAIN_SDF_LOD0, TerrainMeshSectionStats, WaterAirExposureMode,
    append_seam_stitches, apply_snap_or_morph, compute_vertex_material_weights,
    compute_vertex_material_weights_lod_transition_aware, extract_export_boundary_strips,
    generate_sdf, generate_sdf_lod1, generate_sdf_lod2, generate_sdf_lod3, generate_water_mesh,
    pad_morph_targets_identity, recompute_morphed_seam_normals, scale_vertex_from_center,
    sdf_gradient_normal_at_local,
    skirt_depth_for_lod, terrain_morph_config,
};
use crate::constants::{
    CHUNK_SIZE, LOD1_PADDED_SIZE, LOD1_STEP_SIZE, LOD2_PADDED_SIZE, LOD2_STEP_SIZE,
    LOD3_PADDED_SIZE, LOD3_STEP_SIZE, VOXEL_SIZE,
};
use crate::rendering::ao_config::BakedAoConfig;
use crate::voxel::baked_ao::compute_surface_nets_ao;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::skirt::{
    NeighborLods, SkirtConfig, extract_boundary_edges, generate_skirts_with_sealed_faces,
};
use crate::voxel::types::Voxel;
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::prelude::{IVec3, Vec3};
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};
use std::time::Instant;

fn elapsed_us(start: Option<Instant>) -> u64 {
    start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0)
}

fn surface_nets_triangle_positions(
    buffer: &SurfaceNetsBuffer,
    tri_idx: usize,
) -> Option<[[f32; 3]; 3]> {
    let Some(&i0) = buffer.indices.get(tri_idx) else {
        debug_assert!(false, "missing Surface Nets triangle index {tri_idx}");
        return None;
    };
    let Some(&i1) = buffer.indices.get(tri_idx + 1) else {
        debug_assert!(false, "incomplete Surface Nets triangle at index {tri_idx}");
        return None;
    };
    let Some(&i2) = buffer.indices.get(tri_idx + 2) else {
        debug_assert!(false, "incomplete Surface Nets triangle at index {tri_idx}");
        return None;
    };

    let fetch = |index: u32| -> Option<[f32; 3]> {
        let index = index as usize;
        let Some(position) = buffer.positions.get(index).copied() else {
            debug_assert!(
                false,
                "Surface Nets triangle references missing position {index}"
            );
            return None;
        };
        if !position.iter().all(|component| component.is_finite()) {
            debug_assert!(
                false,
                "Surface Nets emitted non-finite position {position:?}"
            );
            return None;
        }
        Some(position)
    };

    Some([fetch(i0)?, fetch(i1)?, fetch(i2)?])
}

/// Generate mesh using Surface Nets algorithm for smooth terrain.
pub fn generate_chunk_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
    timing_enabled: bool,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(2048, 3072);
    solid_mesh.wireframe_lod_index = my_lod.wireframe_lod_index();
    let mut local_positions: Vec<Vec3> = Vec::new();
    let mut generation_timing = MeshGenerationTimingStats::default();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    let chunk_origin_vec = chunk_origin.as_vec3();

    let density_sampler = |sample_pos: Vec3| -> f32 {
        let world_pos = chunk_origin_vec + sample_pos;
        let voxel_pos = IVec3::new(
            world_pos.x.floor() as i32,
            world_pos.y.floor() as i32,
            world_pos.z.floor() as i32,
        );
        match world.sample_voxel_for_terrain_meshing(voxel_pos) {
            VoxelSample::InBounds(voxel) if voxel.is_solid() => -1.0,
            VoxelSample::OutsideBelowWorld
            | VoxelSample::OutsideHorizontalWorld
            | VoxelSample::MissingChunkInsideBounds => -1.0,
            VoxelSample::InBounds(_) | VoxelSample::OutsideAboveWorld => 1.0,
        }
    };

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate SDF from voxel data
    let start = timing_enabled.then(Instant::now);
    let sdf = generate_sdf(
        chunk,
        world,
        my_lod,
        &neighbor_lods,
        SMOOTH_TERRAIN_SDF_LOD0,
    );
    generation_timing.sdf_us += elapsed_us(start);

    // Run surface nets on the SDF
    // Extract the full padded region [0,0,0] to [17,17,17)
    // Including the padding lets the mesh extend half a voxel past each edge,
    // so neighboring chunks meet without leaving a one-voxel gap.
    let mut buffer = SurfaceNetsBuffer::default();
    let start = timing_enabled.then(Instant::now);
    surface_nets(
        &sdf,
        &PaddedChunkShape {},
        [0; 3],  // Start at 0 (include negative padding)
        [17; 3], // End at 17 (include positive padding)
        &mut buffer,
    );
    generation_timing.surface_nets_us += elapsed_us(start);

    let low_cost_transition_shading = my_lod == LodLevel::Lod0
        && [
            neighbor_lods.neg_x,
            neighbor_lods.pos_x,
            neighbor_lods.neg_y,
            neighbor_lods.pos_y,
            neighbor_lods.neg_z,
            neighbor_lods.pos_z,
        ]
        .into_iter()
        .flatten()
        .any(|lod| lod != LodLevel::Culled && lod.is_lower_detail_than(my_lod));

    // Convert surface nets output to MeshData
    // Use per-triangle vertices to ensure consistent material indices (no interpolation artifacts)
    let start = timing_enabled.then(Instant::now);
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        for tri_idx in (0..buffer.indices.len()).step_by(3) {
            let Some([p0, p1, p2]) = surface_nets_triangle_positions(&buffer, tri_idx) else {
                continue;
            };

            // Calculate local positions (offset for padding)
            let local0 = Vec3::new(p0[0] - 1.0, p0[1] - 1.0, p0[2] - 1.0);
            let local1 = Vec3::new(p1[0] - 1.0, p1[1] - 1.0, p1[2] - 1.0);
            let local2 = Vec3::new(p2[0] - 1.0, p2[1] - 1.0, p2[2] - 1.0);

            // Shade terrain from the smoothed SDF rather than Surface Nets'
            // cell normals. The cell normals quantize with the meshing grid and
            // show up as horizontal terrace bands under triplanar lighting.
            let normal0 = sdf_gradient_normal_at_local(world, chunk_origin, local0);
            let normal1 = sdf_gradient_normal_at_local(world, chunk_origin, local1);
            let normal2 = sdf_gradient_normal_at_local(world, chunk_origin, local2);

            // Calculate material weights for each vertex
            let weights0 = compute_vertex_material_weights(local0, chunk, world, chunk_origin);
            let weights1 = compute_vertex_material_weights(local1, chunk, world, chunk_origin);
            let weights2 = compute_vertex_material_weights(local2, chunk, world, chunk_origin);

            // Compute AO for each vertex
            let compute_ao = |local: Vec3, normal: [f32; 3]| -> f32 {
                if low_cost_transition_shading || !ao_config.enabled {
                    return 1.0;
                }
                let normal = Vec3::from_array(normal).normalize_or_zero();
                compute_surface_nets_ao(local, normal, 0.5, &density_sampler, ao_config)
            };

            let ao0 = compute_ao(local0, normal0);
            let ao1 = compute_ao(local1, normal1);
            let ao2 = compute_ao(local2, normal2);

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao0, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao1, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao2, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
        }
    }
    generation_timing.emit_surface_us += elapsed_us(start);

    let morph = terrain_morph_config();
    let start = timing_enabled.then(Instant::now);
    let lod_transition_snap_stats = apply_snap_or_morph(
        &mut solid_mesh,
        &mut local_positions,
        chunk,
        world,
        chunk_origin,
        chunk_center,
        my_lod,
        &neighbor_lods,
        morph,
        neighbor_strips,
    );
    generation_timing.lod_seam_us += elapsed_us(start);

    let mut mesh_section_stats = TerrainMeshSectionStats::from_main_surface(&solid_mesh);
    // Export boundary strips from the MAIN SURFACE (before skirts) for a finer
    // neighbour to weld to. Gated/no-op unless morph is on and a finer neighbour borders.
    let start = timing_enabled.then(Instant::now);
    let boundary_strips = extract_export_boundary_strips(
        morph,
        &local_positions,
        &solid_mesh,
        chunk_origin,
        chunk,
        my_lod,
        &neighbor_lods,
    );
    generation_timing.boundary_strip_us += elapsed_us(start);

    // Stage 4: stitch the fine boundary to coarser neighbours (closes steep-side gaps
    // and the 2:1 density T-junction the morph weld alone can't). Seals stitched faces.
    let start = timing_enabled.then(Instant::now);
    let stitched_face_mask = append_seam_stitches(
        &mut solid_mesh,
        &local_positions,
        chunk_origin,
        chunk_center,
        chunk,
        my_lod,
        neighbor_strips,
    );
    generation_timing.seam_stitch_us += elapsed_us(start);

    let start = timing_enabled.then(Instant::now);
    if !solid_mesh.indices.is_empty() {
        let boundary_band = my_lod.step_size() as f32;
        let boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
            boundary_band,
        );

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        let skirt_stats = generate_skirts_with_sealed_faces(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
            (lod_transition_snap_stats.snapped_face_mask
                & !lod_transition_snap_stats.fallback_face_mask)
                | stitched_face_mask,
        );
        mesh_section_stats.add_skirt_stats(skirt_stats);
    }
    generation_timing.skirt_us += elapsed_us(start);

    // Generate water mesh using the extracted helper
    // Skirts/aprons appended after morph baking get identity targets so
    // morph_targets stays parallel to positions (into_mesh upload invariant).
    if morph.enabled {
        // Stage 5: recompute normals for still-welded boundary verts at their welded
        // position, so the seam is lit by the geometry it renders on (no flat-dark
        // welds). After the skirt, so the apron keeps its original boundary normals.
        recompute_morphed_seam_normals(&mut solid_mesh, world, chunk_origin, chunk_center);
        pad_morph_targets_identity(&mut solid_mesh);
    }

    let start = timing_enabled.then(Instant::now);
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );
    generation_timing.water_us += elapsed_us(start);

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats,
        mesh_section_stats,
        mc_transvoxel_stats: None,
        mc_triangle_sources: None,
        generation_timing,
        boundary_strips,
    }
}

/// Generate mesh using Surface Nets at LOD1 (half resolution).
/// This function samples every 2nd voxel, reducing vertex count by ~75%.
/// Vertices are scaled by step_size (2) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod1(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    _ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
    timing_enabled: bool,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(512, 768);
    solid_mesh.wireframe_lod_index = my_lod.wireframe_lod_index();
    let mut local_positions: Vec<Vec3> = Vec::new();
    let mut generation_timing = MeshGenerationTimingStats::default();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD1 - each grid cell covers 2 voxels
    let step = LOD1_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (10x10x10 grid)
    let start = timing_enabled.then(Instant::now);
    let sdf = generate_sdf_lod1(chunk, world, &neighbor_lods);
    generation_timing.sdf_us += elapsed_us(start);

    // Run surface nets on the smaller SDF grid
    let mut buffer = SurfaceNetsBuffer::default();
    let start = timing_enabled.then(Instant::now);
    surface_nets(
        &sdf,
        &LodShape1 {},
        [0; 3],
        [(LOD1_PADDED_SIZE - 1) as u32; 3], // [9, 9, 9]
        &mut buffer,
    );
    generation_timing.surface_nets_us += elapsed_us(start);

    // Convert surface nets output to MeshData with vertex scaling
    let start = timing_enabled.then(Instant::now);
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        for tri_idx in (0..buffer.indices.len()).step_by(3) {
            let Some([p0, p1, p2]) = surface_nets_triangle_positions(&buffer, tri_idx) else {
                continue;
            };

            // Calculate local positions with step scaling:
            // - Subtract 1.0 to remove padding offset (grid pos 1 = chunk start)
            // - Multiply by step to scale to actual voxel coordinates
            let local0 = Vec3::new(
                (p0[0] - 1.0) * step,
                (p0[1] - 1.0) * step,
                (p0[2] - 1.0) * step,
            );
            let local1 = Vec3::new(
                (p1[0] - 1.0) * step,
                (p1[1] - 1.0) * step,
                (p1[2] - 1.0) * step,
            );
            let local2 = Vec3::new(
                (p2[0] - 1.0) * step,
                (p2[1] - 1.0) * step,
                (p2[2] - 1.0) * step,
            );

            // Shade low-LOD terrain from the fine smoothed SDF. The coarse
            // Surface Nets normals quantize at the LOD sample step and show up
            // as horizontal terrace bands even when the mesh is watertight.
            let normal0 = sdf_gradient_normal_at_local(world, chunk_origin, local0);
            let normal1 = sdf_gradient_normal_at_local(world, chunk_origin, local1);
            let normal2 = sdf_gradient_normal_at_local(world, chunk_origin, local2);

            // Calculate material weights with larger sampling radius for LOD1
            let weights0 = compute_vertex_material_weights_lod_transition_aware(
                local0,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD1_STEP_SIZE,
            );
            let weights1 = compute_vertex_material_weights_lod_transition_aware(
                local1,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD1_STEP_SIZE,
            );
            let weights2 = compute_vertex_material_weights_lod_transition_aware(
                local2,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD1_STEP_SIZE,
            );

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
        }
    }
    generation_timing.emit_surface_us += elapsed_us(start);

    let morph = terrain_morph_config();
    let start = timing_enabled.then(Instant::now);
    let lod_transition_snap_stats = apply_snap_or_morph(
        &mut solid_mesh,
        &mut local_positions,
        chunk,
        world,
        chunk_origin,
        chunk_center,
        my_lod,
        &neighbor_lods,
        morph,
        neighbor_strips,
    );
    generation_timing.lod_seam_us += elapsed_us(start);

    let mut mesh_section_stats = TerrainMeshSectionStats::from_main_surface(&solid_mesh);
    // Export boundary strips from the MAIN SURFACE (before skirts) for a finer
    // neighbour to weld to. Gated/no-op unless morph is on and a finer neighbour borders.
    let start = timing_enabled.then(Instant::now);
    let boundary_strips = extract_export_boundary_strips(
        morph,
        &local_positions,
        &solid_mesh,
        chunk_origin,
        chunk,
        my_lod,
        &neighbor_lods,
    );
    generation_timing.boundary_strip_us += elapsed_us(start);

    // Stage 4: stitch the fine boundary to coarser neighbours (closes steep-side gaps
    // and the 2:1 density T-junction the morph weld alone can't). Seals stitched faces.
    let start = timing_enabled.then(Instant::now);
    let stitched_face_mask = append_seam_stitches(
        &mut solid_mesh,
        &local_positions,
        chunk_origin,
        chunk_center,
        chunk,
        my_lod,
        neighbor_strips,
    );
    generation_timing.seam_stitch_us += elapsed_us(start);

    // Generate skirts for LOD boundaries
    let start = timing_enabled.then(Instant::now);
    if !solid_mesh.indices.is_empty() {
        let boundary_band = my_lod.step_size() as f32;
        let boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
            boundary_band,
        );

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        let skirt_stats = generate_skirts_with_sealed_faces(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
            (lod_transition_snap_stats.snapped_face_mask
                & !lod_transition_snap_stats.fallback_face_mask)
                | stitched_face_mask,
        );
        mesh_section_stats.add_skirt_stats(skirt_stats);
    }
    generation_timing.skirt_us += elapsed_us(start);

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    // Skirts/aprons appended after morph baking get identity targets so
    // morph_targets stays parallel to positions (into_mesh upload invariant).
    if morph.enabled {
        // Stage 5: recompute normals for still-welded boundary verts at their welded
        // position, so the seam is lit by the geometry it renders on (no flat-dark
        // welds). After the skirt, so the apron keeps its original boundary normals.
        recompute_morphed_seam_normals(&mut solid_mesh, world, chunk_origin, chunk_center);
        pad_morph_targets_identity(&mut solid_mesh);
    }

    let start = timing_enabled.then(Instant::now);
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );
    generation_timing.water_us += elapsed_us(start);

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats,
        mesh_section_stats,
        mc_transvoxel_stats: None,
        mc_triangle_sources: None,
        generation_timing,
        boundary_strips,
    }
}

/// Generate mesh using Surface Nets at LOD2 (quarter resolution).
/// This function samples every 4th voxel, reducing vertex count by ~94%.
/// Vertices are scaled by step_size (4) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod2(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    _ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
    timing_enabled: bool,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(256, 384);
    solid_mesh.wireframe_lod_index = my_lod.wireframe_lod_index();
    let mut local_positions: Vec<Vec3> = Vec::new();
    let mut generation_timing = MeshGenerationTimingStats::default();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD2 - each grid cell covers 4 voxels
    let step = LOD2_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (6x6x6 grid)
    let start = timing_enabled.then(Instant::now);
    let sdf = generate_sdf_lod2(chunk, world, &neighbor_lods);
    generation_timing.sdf_us += elapsed_us(start);

    // Run surface nets on the smaller SDF grid
    let mut buffer = SurfaceNetsBuffer::default();
    let start = timing_enabled.then(Instant::now);
    surface_nets(
        &sdf,
        &LodShape2 {},
        [0; 3],
        [(LOD2_PADDED_SIZE - 1) as u32; 3],
        &mut buffer,
    );
    generation_timing.surface_nets_us += elapsed_us(start);

    // Convert surface nets output to MeshData with vertex scaling
    let start = timing_enabled.then(Instant::now);
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        for tri_idx in (0..buffer.indices.len()).step_by(3) {
            let Some([p0, p1, p2]) = surface_nets_triangle_positions(&buffer, tri_idx) else {
                continue;
            };

            // Calculate local positions with step scaling:
            // - Subtract 1.0 to remove padding offset (grid pos 1 = chunk start)
            // - Multiply by step to scale to actual voxel coordinates
            let local0 = Vec3::new(
                (p0[0] - 1.0) * step,
                (p0[1] - 1.0) * step,
                (p0[2] - 1.0) * step,
            );
            let local1 = Vec3::new(
                (p1[0] - 1.0) * step,
                (p1[1] - 1.0) * step,
                (p1[2] - 1.0) * step,
            );
            let local2 = Vec3::new(
                (p2[0] - 1.0) * step,
                (p2[1] - 1.0) * step,
                (p2[2] - 1.0) * step,
            );

            // Shade low-LOD terrain from the fine smoothed SDF. The coarse
            // Surface Nets normals quantize at the LOD sample step and show up
            // as horizontal terrace bands even when the mesh is watertight.
            let normal0 = sdf_gradient_normal_at_local(world, chunk_origin, local0);
            let normal1 = sdf_gradient_normal_at_local(world, chunk_origin, local1);
            let normal2 = sdf_gradient_normal_at_local(world, chunk_origin, local2);

            // Calculate material weights with larger sampling radius for LOD2
            let weights0 = compute_vertex_material_weights_lod_transition_aware(
                local0,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD2_STEP_SIZE,
            );
            let weights1 = compute_vertex_material_weights_lod_transition_aware(
                local1,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD2_STEP_SIZE,
            );
            let weights2 = compute_vertex_material_weights_lod_transition_aware(
                local2,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD2_STEP_SIZE,
            );

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
        }
    }
    generation_timing.emit_surface_us += elapsed_us(start);

    let morph = terrain_morph_config();
    let start = timing_enabled.then(Instant::now);
    let lod_transition_snap_stats = apply_snap_or_morph(
        &mut solid_mesh,
        &mut local_positions,
        chunk,
        world,
        chunk_origin,
        chunk_center,
        my_lod,
        &neighbor_lods,
        morph,
        neighbor_strips,
    );
    generation_timing.lod_seam_us += elapsed_us(start);

    let mut mesh_section_stats = TerrainMeshSectionStats::from_main_surface(&solid_mesh);
    // Export boundary strips from the MAIN SURFACE (before skirts) for a finer
    // neighbour to weld to. Gated/no-op unless morph is on and a finer neighbour borders.
    let start = timing_enabled.then(Instant::now);
    let boundary_strips = extract_export_boundary_strips(
        morph,
        &local_positions,
        &solid_mesh,
        chunk_origin,
        chunk,
        my_lod,
        &neighbor_lods,
    );
    generation_timing.boundary_strip_us += elapsed_us(start);

    // Stage 4: stitch the fine boundary to coarser neighbours (closes steep-side gaps
    // and the 2:1 density T-junction the morph weld alone can't). Seals stitched faces.
    let start = timing_enabled.then(Instant::now);
    let stitched_face_mask = append_seam_stitches(
        &mut solid_mesh,
        &local_positions,
        chunk_origin,
        chunk_center,
        chunk,
        my_lod,
        neighbor_strips,
    );
    generation_timing.seam_stitch_us += elapsed_us(start);

    // Generate skirts for LOD boundaries
    let start = timing_enabled.then(Instant::now);
    if !solid_mesh.indices.is_empty() {
        let boundary_band = my_lod.step_size() as f32;
        let boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
            boundary_band,
        );

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        let skirt_stats = generate_skirts_with_sealed_faces(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
            (lod_transition_snap_stats.snapped_face_mask
                & !lod_transition_snap_stats.fallback_face_mask)
                | stitched_face_mask,
        );
        mesh_section_stats.add_skirt_stats(skirt_stats);
    }
    generation_timing.skirt_us += elapsed_us(start);

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    // Skirts/aprons appended after morph baking get identity targets so
    // morph_targets stays parallel to positions (into_mesh upload invariant).
    if morph.enabled {
        // Stage 5: recompute normals for still-welded boundary verts at their welded
        // position, so the seam is lit by the geometry it renders on (no flat-dark
        // welds). After the skirt, so the apron keeps its original boundary normals.
        recompute_morphed_seam_normals(&mut solid_mesh, world, chunk_origin, chunk_center);
        pad_morph_targets_identity(&mut solid_mesh);
    }

    let start = timing_enabled.then(Instant::now);
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );
    generation_timing.water_us += elapsed_us(start);

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats,
        mesh_section_stats,
        mc_transvoxel_stats: None,
        mc_triangle_sources: None,
        generation_timing,
        boundary_strips,
    }
}

/// Generate mesh using Surface Nets at LOD3 (eighth resolution).
/// This function samples every 8th voxel, reducing vertex count by ~98%.
/// Vertices are scaled by step_size (8) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod3(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    _ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
    timing_enabled: bool,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(128, 192);
    solid_mesh.wireframe_lod_index = my_lod.wireframe_lod_index();
    let mut local_positions: Vec<Vec3> = Vec::new();
    let mut generation_timing = MeshGenerationTimingStats::default();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD3 - each grid cell covers 8 voxels
    let step = LOD3_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (4x4x4 grid)
    let start = timing_enabled.then(Instant::now);
    let sdf = generate_sdf_lod3(chunk, world, &neighbor_lods);
    generation_timing.sdf_us += elapsed_us(start);

    // Run surface nets on the smaller SDF grid
    let mut buffer = SurfaceNetsBuffer::default();
    let start = timing_enabled.then(Instant::now);
    surface_nets(
        &sdf,
        &LodShape3 {},
        [0; 3],
        [(LOD3_PADDED_SIZE - 1) as u32; 3],
        &mut buffer,
    );
    generation_timing.surface_nets_us += elapsed_us(start);

    // Convert surface nets output to MeshData with vertex scaling
    let start = timing_enabled.then(Instant::now);
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        for tri_idx in (0..buffer.indices.len()).step_by(3) {
            let Some([p0, p1, p2]) = surface_nets_triangle_positions(&buffer, tri_idx) else {
                continue;
            };

            // Calculate local positions with step scaling:
            // - Subtract 1.0 to remove padding offset (grid pos 1 = chunk start)
            // - Multiply by step to scale to actual voxel coordinates
            let local0 = Vec3::new(
                (p0[0] - 1.0) * step,
                (p0[1] - 1.0) * step,
                (p0[2] - 1.0) * step,
            );
            let local1 = Vec3::new(
                (p1[0] - 1.0) * step,
                (p1[1] - 1.0) * step,
                (p1[2] - 1.0) * step,
            );
            let local2 = Vec3::new(
                (p2[0] - 1.0) * step,
                (p2[1] - 1.0) * step,
                (p2[2] - 1.0) * step,
            );

            // Shade low-LOD terrain from the fine smoothed SDF. The coarse
            // Surface Nets normals quantize at the LOD sample step and show up
            // as horizontal terrace bands even when the mesh is watertight.
            let normal0 = sdf_gradient_normal_at_local(world, chunk_origin, local0);
            let normal1 = sdf_gradient_normal_at_local(world, chunk_origin, local1);
            let normal2 = sdf_gradient_normal_at_local(world, chunk_origin, local2);

            // Calculate material weights with larger sampling radius for LOD3
            let weights0 = compute_vertex_material_weights_lod_transition_aware(
                local0,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD3_STEP_SIZE,
            );
            let weights1 = compute_vertex_material_weights_lod_transition_aware(
                local1,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD3_STEP_SIZE,
            );
            let weights2 = compute_vertex_material_weights_lod_transition_aware(
                local2,
                chunk,
                world,
                chunk_origin,
                my_lod,
                &neighbor_lods,
                LOD3_STEP_SIZE,
            );

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
        }
    }
    generation_timing.emit_surface_us += elapsed_us(start);

    let morph = terrain_morph_config();
    let start = timing_enabled.then(Instant::now);
    let lod_transition_snap_stats = apply_snap_or_morph(
        &mut solid_mesh,
        &mut local_positions,
        chunk,
        world,
        chunk_origin,
        chunk_center,
        my_lod,
        &neighbor_lods,
        morph,
        neighbor_strips,
    );
    generation_timing.lod_seam_us += elapsed_us(start);

    let mut mesh_section_stats = TerrainMeshSectionStats::from_main_surface(&solid_mesh);
    // Export boundary strips from the MAIN SURFACE (before skirts) for a finer
    // neighbour to weld to. Gated/no-op unless morph is on and a finer neighbour borders.
    let start = timing_enabled.then(Instant::now);
    let boundary_strips = extract_export_boundary_strips(
        morph,
        &local_positions,
        &solid_mesh,
        chunk_origin,
        chunk,
        my_lod,
        &neighbor_lods,
    );
    generation_timing.boundary_strip_us += elapsed_us(start);

    // Stage 4: stitch the fine boundary to coarser neighbours (closes steep-side gaps
    // and the 2:1 density T-junction the morph weld alone can't). Seals stitched faces.
    let start = timing_enabled.then(Instant::now);
    let stitched_face_mask = append_seam_stitches(
        &mut solid_mesh,
        &local_positions,
        chunk_origin,
        chunk_center,
        chunk,
        my_lod,
        neighbor_strips,
    );
    generation_timing.seam_stitch_us += elapsed_us(start);

    // Generate skirts for LOD boundaries
    let start = timing_enabled.then(Instant::now);
    if !solid_mesh.indices.is_empty() {
        let boundary_band = my_lod.step_size() as f32;
        let boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
            boundary_band,
        );

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        let skirt_stats = generate_skirts_with_sealed_faces(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
            (lod_transition_snap_stats.snapped_face_mask
                & !lod_transition_snap_stats.fallback_face_mask)
                | stitched_face_mask,
        );
        mesh_section_stats.add_skirt_stats(skirt_stats);
    }
    generation_timing.skirt_us += elapsed_us(start);

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    // Skirts/aprons appended after morph baking get identity targets so
    // morph_targets stays parallel to positions (into_mesh upload invariant).
    if morph.enabled {
        // Stage 5: recompute normals for still-welded boundary verts at their welded
        // position, so the seam is lit by the geometry it renders on (no flat-dark
        // welds). After the skirt, so the apron keeps its original boundary normals.
        recompute_morphed_seam_normals(&mut solid_mesh, world, chunk_origin, chunk_center);
        pad_morph_targets_identity(&mut solid_mesh);
    }

    let start = timing_enabled.then(Instant::now);
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );
    generation_timing.water_us += elapsed_us(start);

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats,
        mesh_section_stats,
        mc_transvoxel_stats: None,
        mc_triangle_sources: None,
        generation_timing,
        boundary_strips,
    }
}
