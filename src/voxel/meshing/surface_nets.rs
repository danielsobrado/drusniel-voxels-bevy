use super::seam_audit::{SeamFaceAudit, XZ_FACE_COUNT};
use super::{
    ChunkMeshResult, LodShape1, LodShape2, LodShape3, MeshData, MeshGenerationTimingStats,
    MeshSdfCache, PaddedChunkShape, SMOOTH_TERRAIN_SDF_LOD0, TerrainMeshSectionStats,
    TerrainSeamStripDebug, WaterAirExposureMode, apply_lod_snap, compute_vertex_material_weights,
    compute_vertex_material_weights_lod_transition_aware, generate_sdf, generate_sdf_lod1,
    generate_sdf_lod2, generate_sdf_lod3, generate_water_mesh, scale_vertex_from_center,
};
use crate::constants::{
    CHUNK_SIZE, LOD1_PADDED_SIZE, LOD1_STEP_SIZE, LOD2_PADDED_SIZE, LOD2_STEP_SIZE,
    LOD3_PADDED_SIZE, LOD3_STEP_SIZE, VOXEL_SIZE,
};
use crate::rendering::ao_config::BakedAoConfig;
use crate::voxel::baked_ao::compute_surface_nets_ao;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::skirt::NeighborLods;
use crate::voxel::types::Voxel;
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::prelude::Vec3;
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};
use std::time::Instant;

fn elapsed_us(start: Option<Instant>) -> u64 {
    start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0)
}

/// Which sampling grid a Surface Nets mesh is extracted on. Selected by the
/// public per-LOD entry points; everything downstream of extraction is shared.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SurfaceNetsGrid {
    Lod0,
    Lod1,
    Lod2,
    Lod3,
}

impl SurfaceNetsGrid {
    /// Voxels per grid cell on this extraction grid.
    fn step(self) -> u32 {
        match self {
            Self::Lod0 => 1,
            Self::Lod1 => LOD1_STEP_SIZE,
            Self::Lod2 => LOD2_STEP_SIZE,
            Self::Lod3 => LOD3_STEP_SIZE,
        }
    }

    /// Index capacity hint. Vertices are emitted per-triangle (3 per tri, see
    /// the barycentric wireframe contract in `push_triangle_barycentrics`), so
    /// the vertex capacity equals the index capacity.
    fn index_capacity(self) -> usize {
        match self {
            Self::Lod0 => 3072,
            Self::Lod1 => 768,
            Self::Lod2 => 384,
            Self::Lod3 => 192,
        }
    }
}

/// Generate mesh using Surface Nets algorithm for smooth terrain.
pub fn generate_chunk_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    generate_chunk_mesh_surface_nets_impl(
        SurfaceNetsGrid::Lod0,
        chunk,
        world,
        my_lod,
        neighbor_lods,
        ao_config,
        water_exposure_mode,
        timing_enabled,
    )
}

/// Generate mesh using Surface Nets at LOD1 (half resolution).
/// This function samples every 2nd voxel, reducing vertex count by ~75%.
/// Vertices are scaled by step_size (2) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod1(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    generate_chunk_mesh_surface_nets_impl(
        SurfaceNetsGrid::Lod1,
        chunk,
        world,
        my_lod,
        neighbor_lods,
        ao_config,
        water_exposure_mode,
        timing_enabled,
    )
}

/// Generate mesh using Surface Nets at LOD2 (quarter resolution).
/// This function samples every 4th voxel, reducing vertex count by ~94%.
/// Vertices are scaled by step_size (4) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod2(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    generate_chunk_mesh_surface_nets_impl(
        SurfaceNetsGrid::Lod2,
        chunk,
        world,
        my_lod,
        neighbor_lods,
        ao_config,
        water_exposure_mode,
        timing_enabled,
    )
}

/// Generate mesh using Surface Nets at LOD3 (eighth resolution).
/// This function samples every 8th voxel, reducing vertex count by ~98%.
/// Vertices are scaled by step_size (8) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod3(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    generate_chunk_mesh_surface_nets_impl(
        SurfaceNetsGrid::Lod3,
        chunk,
        world,
        my_lod,
        neighbor_lods,
        ao_config,
        water_exposure_mode,
        timing_enabled,
    )
}

/// Run Surface Nets extraction on the grid that matches `grid`, recording SDF
/// and extraction timings. The shape types are compile-time constants, so each
/// grid keeps its own monomorphized call.
fn run_surface_nets_for_grid(
    grid: SurfaceNetsGrid,
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    timing_enabled: bool,
    timing: &mut MeshGenerationTimingStats,
) -> SurfaceNetsBuffer {
    let mut buffer = SurfaceNetsBuffer::default();
    match grid {
        SurfaceNetsGrid::Lod0 => {
            let start = timing_enabled.then(Instant::now);
            let sdf = generate_sdf(chunk, world, my_lod, neighbor_lods, SMOOTH_TERRAIN_SDF_LOD0);
            timing.sdf_us += elapsed_us(start);

            // Extract the full padded region [0,0,0] to [17,17,17).
            // Including the padding lets the mesh extend half a voxel past each
            // edge, so neighboring chunks meet without leaving a one-voxel gap.
            let start = timing_enabled.then(Instant::now);
            surface_nets(&sdf, &PaddedChunkShape {}, [0; 3], [17; 3], &mut buffer);
            timing.surface_nets_us += elapsed_us(start);
        }
        SurfaceNetsGrid::Lod1 => {
            let start = timing_enabled.then(Instant::now);
            let sdf = generate_sdf_lod1(chunk, world, neighbor_lods);
            timing.sdf_us += elapsed_us(start);

            let start = timing_enabled.then(Instant::now);
            surface_nets(
                &sdf,
                &LodShape1 {},
                [0; 3],
                [(LOD1_PADDED_SIZE - 1) as u32; 3],
                &mut buffer,
            );
            timing.surface_nets_us += elapsed_us(start);
        }
        SurfaceNetsGrid::Lod2 => {
            let start = timing_enabled.then(Instant::now);
            let sdf = generate_sdf_lod2(chunk, world, neighbor_lods);
            timing.sdf_us += elapsed_us(start);

            let start = timing_enabled.then(Instant::now);
            surface_nets(
                &sdf,
                &LodShape2 {},
                [0; 3],
                [(LOD2_PADDED_SIZE - 1) as u32; 3],
                &mut buffer,
            );
            timing.surface_nets_us += elapsed_us(start);
        }
        SurfaceNetsGrid::Lod3 => {
            let start = timing_enabled.then(Instant::now);
            let sdf = generate_sdf_lod3(chunk, world, neighbor_lods);
            timing.sdf_us += elapsed_us(start);

            let start = timing_enabled.then(Instant::now);
            surface_nets(
                &sdf,
                &LodShape3 {},
                [0; 3],
                [(LOD3_PADDED_SIZE - 1) as u32; 3],
                &mut buffer,
            );
            timing.surface_nets_us += elapsed_us(start);
        }
    }
    buffer
}

/// Per-unique-vertex attributes computed once and fanned out to the duplicated
/// per-triangle corners at emit time. A Surface Nets vertex is shared by ~6
/// triangles, and every attribute here is a pure function of the vertex
/// position, so computing per corner (the previous behavior) repeated the same
/// gradient/material/AO work ~6×.
struct VertexAttributes {
    valid: Vec<bool>,
    local: Vec<Vec3>,
    normal: Vec<[f32; 3]>,
    weights: Vec<[f32; 4]>,
    ao: Vec<f32>,
}

#[allow(clippy::too_many_arguments)]
fn compute_unique_vertex_attributes(
    grid: SurfaceNetsGrid,
    buffer: &SurfaceNetsBuffer,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: bevy::prelude::IVec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    ao_config: &BakedAoConfig,
    sdf_cache: &mut MeshSdfCache,
    low_cost_transition_shading: bool,
) -> VertexAttributes {
    let step = grid.step() as f32;
    let vert_count = buffer.positions.len();
    let mut attrs = VertexAttributes {
        valid: vec![false; vert_count],
        local: vec![Vec3::ZERO; vert_count],
        normal: vec![[0.0, 1.0, 0.0]; vert_count],
        weights: vec![[0.0; 4]; vert_count],
        ao: vec![1.0; vert_count],
    };

    let chunk_origin_vec = chunk_origin.as_vec3();
    let density_sampler = |sample_pos: Vec3| -> f32 {
        let world_pos = chunk_origin_vec + sample_pos;
        let voxel_pos = bevy::prelude::IVec3::new(
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
    let ao_enabled =
        grid == SurfaceNetsGrid::Lod0 && ao_config.enabled && !low_cost_transition_shading;

    for (i, position) in buffer.positions.iter().enumerate() {
        if !position.iter().all(|component| component.is_finite()) {
            debug_assert!(
                false,
                "Surface Nets emitted non-finite position {position:?}"
            );
            continue;
        }
        attrs.valid[i] = true;

        // Local position: subtract 1.0 to remove the padding offset (grid pos 1
        // = chunk start), then scale by the grid step to voxel coordinates.
        let local = Vec3::new(
            (position[0] - 1.0) * step,
            (position[1] - 1.0) * step,
            (position[2] - 1.0) * step,
        );
        attrs.local[i] = local;

        // Shade terrain from the smoothed SDF rather than Surface Nets' cell
        // normals. The cell normals quantize with the meshing grid (at the LOD
        // sample step on coarse grids) and show up as horizontal terrace bands
        // under triplanar lighting even when the mesh is watertight.
        attrs.normal[i] = sdf_cache.gradient_normal_at_local(world, local);

        attrs.weights[i] = match grid {
            SurfaceNetsGrid::Lod0 => {
                compute_vertex_material_weights(local, chunk, world, chunk_origin)
            }
            // Larger sampling radius for coarse grids, except in LOD transition
            // bands where the fine neighborhood keeps seam materials aligned.
            _ => compute_vertex_material_weights_lod_transition_aware(
                local,
                chunk,
                world,
                chunk_origin,
                my_lod,
                neighbor_lods,
                grid.step(),
            ),
        };

        // AO only on the high-detail grid — distance makes it imperceptible on
        // coarse LODs, so they keep full brightness (1.0).
        if ao_enabled {
            let normal = Vec3::from_array(attrs.normal[i]).normalize_or_zero();
            attrs.ao[i] = compute_surface_nets_ao(local, normal, 0.5, &density_sampler, ao_config);
        }
    }

    attrs
}

/// Shared Surface Nets meshing pipeline: extract on the selected grid, emit
/// per-triangle vertices from per-unique-vertex attributes, then run the seam
/// weld/stitch/skirt/audit/water stages (identical across all grids).
#[allow(clippy::too_many_arguments)]
fn generate_chunk_mesh_surface_nets_impl(
    grid: SurfaceNetsGrid,
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    let index_cap = grid.index_capacity();
    let mut solid_mesh = MeshData::with_capacity(index_cap, index_cap);
    solid_mesh.wireframe_lod_index = my_lod.wireframe_lod_index();
    let mut local_positions: Vec<Vec3> = Vec::with_capacity(index_cap);
    let mut generation_timing = MeshGenerationTimingStats::default();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    let buffer = run_surface_nets_for_grid(
        grid,
        chunk,
        world,
        my_lod,
        &neighbor_lods,
        timing_enabled,
        &mut generation_timing,
    );

    let low_cost_transition_shading = grid == SurfaceNetsGrid::Lod0
        && my_lod == LodLevel::Lod0
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

    // Memoized smoothed-SDF field shared by vertex normals and the post-morph
    // seam normal recompute. Replaces per-tap world hashmap sampling.
    let mut sdf_cache = MeshSdfCache::new(chunk_origin, my_lod);

    // Convert surface nets output to MeshData. Vertices are emitted per
    // triangle (not shared) because the barycentric wireframe encoding in UV1
    // needs unshared corners; attributes are computed once per unique vertex.
    let start = timing_enabled.then(Instant::now);
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        let attrs = compute_unique_vertex_attributes(
            grid,
            &buffer,
            chunk,
            world,
            chunk_origin,
            my_lod,
            &neighbor_lods,
            ao_config,
            &mut sdf_cache,
            low_cost_transition_shading,
        );

        debug_assert!(
            buffer.indices.len() % 3 == 0,
            "Surface Nets emitted incomplete triangle list ({} indices)",
            buffer.indices.len()
        );
        for tri in buffer.indices.chunks_exact(3) {
            let corners = [tri[0] as usize, tri[1] as usize, tri[2] as usize];
            if corners
                .iter()
                .any(|&i| i >= attrs.valid.len() || !attrs.valid[i])
            {
                debug_assert!(
                    false,
                    "Surface Nets triangle references missing/invalid vertex {corners:?}"
                );
                continue;
            }

            let base_idx = solid_mesh.positions.len() as u32;
            for &i in &corners {
                solid_mesh
                    .positions
                    .push(scale_vertex_from_center(attrs.local[i], chunk_center));
                solid_mesh.normals.push(attrs.normal[i]);
                solid_mesh.uvs.push([attrs.ao[i], 0.0]);
                solid_mesh.colors.push(attrs.weights[i]);
                local_positions.push(attrs.local[i]);
            }
            solid_mesh
                .indices
                .extend_from_slice(&[base_idx, base_idx + 1, base_idx + 2]);
            solid_mesh.push_triangle_barycentrics();
        }
    }
    generation_timing.emit_surface_us += elapsed_us(start);

    let start = timing_enabled.then(Instant::now);
    let (lod_transition_snap_stats, _) = apply_lod_snap(
        &mut solid_mesh,
        &mut local_positions,
        chunk,
        world,
        chunk_origin,
        chunk_center,
        my_lod,
        &neighbor_lods,
    );
    generation_timing.lod_seam_us += elapsed_us(start);

    let mesh_section_stats = TerrainMeshSectionStats::from_main_surface(&solid_mesh);
    let boundary_strips = Vec::new();
    let seam_face_audit = [SeamFaceAudit::default(); XZ_FACE_COUNT];
    let seam_strip_debug = TerrainSeamStripDebug::default();

    // Generate water mesh at full resolution (water is usually flat, so LOD
    // doesn't help much).
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
        seam_face_audit,
        seam_strip_debug,
    }
}
