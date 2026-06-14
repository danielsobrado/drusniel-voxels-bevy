use super::{
    ChunkMeshResult, LodTransitionSnapStats, MeshData, MeshGenerationTimingStats, MeshSdfCache,
    PaddedChunkShape, SMOOTH_TERRAIN_SDF_LOD0, TerrainMeshSectionStats, WaterAirExposureMode,
    compute_vertex_material_weights, generate_sdf, generate_water_mesh,
};
use crate::constants::{CHUNK_SIZE, VOXEL_SIZE};
use crate::rendering::ao_config::BakedAoConfig;
use crate::voxel::baked_ao::compute_surface_nets_ao;
use crate::voxel::chunk::{Chunk, LodLevel};
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

/// Generate mesh using Surface Nets algorithm for smooth terrain.
pub fn generate_chunk_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    generate_chunk_mesh_surface_nets_impl(
        chunk,
        world,
        ao_config,
        water_exposure_mode,
        timing_enabled,
    )
}

fn run_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    timing_enabled: bool,
    timing: &mut MeshGenerationTimingStats,
) -> SurfaceNetsBuffer {
    let mut buffer = SurfaceNetsBuffer::default();
    let start = timing_enabled.then(Instant::now);
    let sdf = generate_sdf(chunk, world, SMOOTH_TERRAIN_SDF_LOD0);
    timing.sdf_us += elapsed_us(start);

    let start = timing_enabled.then(Instant::now);
    surface_nets(&sdf, &PaddedChunkShape {}, [0; 3], [17; 3], &mut buffer);
    timing.surface_nets_us += elapsed_us(start);
    buffer
}

pub(crate) fn scale_vertex_from_center(local: Vec3, chunk_center: Vec3) -> [f32; 3] {
    (chunk_center + (local - chunk_center) * VOXEL_SIZE).to_array()
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

fn compute_unique_vertex_attributes(
    buffer: &SurfaceNetsBuffer,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: bevy::prelude::IVec3,
    ao_config: &BakedAoConfig,
    sdf_cache: &mut MeshSdfCache,
) -> VertexAttributes {
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
    let ao_enabled = ao_config.enabled;

    for (i, position) in buffer.positions.iter().enumerate() {
        if !position.iter().all(|component| component.is_finite()) {
            debug_assert!(
                false,
                "Surface Nets emitted non-finite position {position:?}"
            );
            continue;
        }
        attrs.valid[i] = true;

        // Subtract 1.0 to remove the padding offset (grid position 1 is the chunk start).
        let local = Vec3::new(position[0] - 1.0, position[1] - 1.0, position[2] - 1.0);
        attrs.local[i] = local;

        // Shade terrain from the smoothed SDF rather than Surface Nets' cell
        // normals. The cell normals quantize with the meshing grid (at the LOD
        // sample step on coarse grids) and show up as horizontal terrace bands
        // under triplanar lighting even when the mesh is watertight.
        attrs.normal[i] = sdf_cache.gradient_normal_at_local(world, local);

        attrs.weights[i] = compute_vertex_material_weights(local, chunk, world, chunk_origin);

        // AO only on the high-detail grid — distance makes it imperceptible on
        // coarse LODs, so they keep full brightness (1.0).
        if ao_enabled {
            let normal = Vec3::from_array(attrs.normal[i]).normalize_or_zero();
            attrs.ao[i] = compute_surface_nets_ao(local, normal, 0.5, &density_sampler, ao_config);
        }
    }

    attrs
}

/// LOD0 Surface Nets meshing pipeline.
#[allow(clippy::too_many_arguments)]
fn generate_chunk_mesh_surface_nets_impl(
    chunk: &Chunk,
    world: &VoxelWorld,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
    timing_enabled: bool,
) -> ChunkMeshResult {
    let index_cap = 3072;
    let mut solid_mesh = MeshData::with_capacity(index_cap, index_cap);
    solid_mesh.wireframe_lod_index = LodLevel::Lod0.wireframe_lod_index();
    let mut generation_timing = MeshGenerationTimingStats::default();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    let buffer = run_surface_nets(chunk, world, timing_enabled, &mut generation_timing);

    // Memoized smoothed-SDF field shared by vertex normals and the post-morph
    // seam normal recompute. Replaces per-tap world hashmap sampling.
    let mut sdf_cache = MeshSdfCache::new(chunk_origin, LodLevel::Lod0);

    // Convert surface nets output to MeshData. Vertices are emitted per
    // triangle (not shared) because the barycentric wireframe encoding in UV1
    // needs unshared corners; attributes are computed once per unique vertex.
    let start = timing_enabled.then(Instant::now);
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        let attrs = compute_unique_vertex_attributes(
            &buffer,
            chunk,
            world,
            chunk_origin,
            ao_config,
            &mut sdf_cache,
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
            }
            solid_mesh
                .indices
                .extend_from_slice(&[base_idx, base_idx + 1, base_idx + 2]);
            solid_mesh.push_triangle_barycentrics();
        }
    }
    generation_timing.emit_surface_us += elapsed_us(start);

    let lod_transition_snap_stats = LodTransitionSnapStats::default();

    let mesh_section_stats = TerrainMeshSectionStats::from_main_surface(&solid_mesh);
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
    }
}
