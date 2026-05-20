use bevy::prelude::*;

use crate::rendering::naadf::cache::NaadfCache;
use crate::rendering::naadf::cpu_trace::NaadfCpuRayBackend;
use crate::rendering::naadf::dirty::NaadfDirtyChunkQueue;
use crate::rendering::naadf::gpu_tests::{NaadfGpuRayInputRecord, NaadfGpuRayOutputRecord};
use crate::rendering::naadf::layout::NaadfChunk;
use crate::rendering::naadf::{NaadfConfig, NaadfStats};
use crate::rendering::voxel_ray_backend::{VoxelRayHit, VoxelRayPurpose};
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfOccupancyMismatch {
    pub local: UVec3,
    pub world_occupied: bool,
    pub naadf_occupied: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NaadfRayComparison {
    pub current_hit: Option<VoxelRayHit>,
    pub naadf_hit: Option<VoxelRayHit>,
    pub current_steps: u32,
    pub naadf_steps: u32,
    pub matches: bool,
}

#[derive(Resource, Clone, Debug, Default, PartialEq)]
pub struct NaadfDebugRayVisuals {
    pub rays: Vec<NaadfDebugRayVisual>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NaadfDebugRayVisual {
    pub origin: Vec3,
    pub end: Vec3,
    pub hit_position: Option<Vec3>,
    pub normal: Vec3,
    pub steps: u32,
}

impl NaadfDebugRayVisuals {
    pub fn replace_from_gpu_outputs(
        &mut self,
        inputs: &[NaadfGpuRayInputRecord],
        outputs: &[NaadfGpuRayOutputRecord],
        stats: &mut NaadfStats,
    ) {
        self.rays.clear();
        let mut total_steps = 0u32;

        for (input, output) in inputs.iter().zip(outputs.iter().copied()) {
            let origin = Vec3::new(
                input.origin_max_distance[0],
                input.origin_max_distance[1],
                input.origin_max_distance[2],
            );
            let direction = Vec3::new(
                input.direction_purpose[0],
                input.direction_purpose[1],
                input.direction_purpose[2],
            )
            .normalize_or_zero();
            let max_distance = input.origin_max_distance[3];
            let distance = if output.hit_flag() {
                output.distance()
            } else {
                max_distance
            };
            let end = origin + direction * distance;
            total_steps = total_steps.saturating_add(output.steps());
            self.rays.push(NaadfDebugRayVisual {
                origin,
                end,
                hit_position: output.hit_flag().then_some(end),
                normal: Vec3::new(output.normal[0], output.normal[1], output.normal[2]),
                steps: output.steps(),
            });
        }

        stats.gpu_avg_ray_steps_last_frame = if outputs.is_empty() {
            0.0
        } else {
            total_steps as f32 / outputs.len() as f32
        };
    }
}

pub fn draw_debug_ray_hits(
    config: Res<NaadfConfig>,
    visuals: Res<NaadfDebugRayVisuals>,
    mut gizmos: Gizmos,
) {
    if !config.debug.visualize_ray_steps {
        return;
    }

    for ray in &visuals.rays {
        let ray_color = if ray.hit_position.is_some() {
            Color::srgb(0.15, 0.85, 0.95)
        } else {
            Color::srgb(0.9, 0.55, 0.15)
        };
        gizmos.line(ray.origin, ray.end, ray_color);
        if let Some(hit_position) = ray.hit_position {
            gizmos.arrow(
                hit_position,
                hit_position + ray.normal.normalize_or_zero() * 0.5,
                Color::srgb(1.0, 0.2, 0.2),
            );
        }
    }
}

pub fn draw_debug_chunks(
    config: Res<NaadfConfig>,
    cache: Res<NaadfCache>,
    queue: Res<NaadfDirtyChunkQueue>,
    mut gizmos: Gizmos,
) {
    if !config.debug.visualize_chunks {
        return;
    }

    // Cool-toned palette so NAADF chunk states never read as terrain LOD
    // colours (the Alt+B LOD overlay uses green/yellow/orange/red).
    for (chunk_pos, _) in cache.iter() {
        draw_chunk_outline(&mut gizmos, *chunk_pos, 0.0, Color::srgb(0.2, 0.5, 1.0));
    }
    for chunk_pos in queue.pending_chunks() {
        draw_chunk_outline(&mut gizmos, chunk_pos, 0.35, Color::srgb(0.7, 0.3, 1.0));
    }
    for chunk_pos in queue.in_flight_chunks() {
        draw_chunk_outline(&mut gizmos, chunk_pos, 0.7, Color::srgb(1.0, 0.3, 0.85));
    }
}

fn draw_chunk_outline(gizmos: &mut Gizmos, chunk_pos: IVec3, inflate: f32, color: Color) {
    let size = crate::constants::CHUNK_SIZE as f32 + inflate;
    let center = chunk_pos.as_vec3() * crate::constants::CHUNK_SIZE as f32
        + Vec3::splat(crate::constants::CHUNK_SIZE as f32 * 0.5);
    let cuboid = Cuboid::from_size(Vec3::splat(size));
    gizmos.primitive_3d(&cuboid, Isometry3d::from_translation(center), color);
}

pub fn compare_chunk_occupancy(
    world: &VoxelWorld,
    naadf_chunk: &NaadfChunk,
    max_mismatches: usize,
) -> Vec<NaadfOccupancyMismatch> {
    let Some(chunk) = world.get_chunk(naadf_chunk.position) else {
        return Vec::new();
    };

    let mut mismatches = Vec::new();
    for (local, voxel) in chunk.iter() {
        let world_occupied = voxel.is_solid();
        let naadf_occupied = naadf_chunk.is_occupied(local);
        if world_occupied != naadf_occupied {
            mismatches.push(NaadfOccupancyMismatch {
                local,
                world_occupied,
                naadf_occupied,
            });
            if mismatches.len() >= max_mismatches {
                break;
            }
        }
    }
    mismatches
}

pub fn compare_backend_ray(
    world: &VoxelWorld,
    cache: &NaadfCache,
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
    purpose: VoxelRayPurpose,
) -> NaadfRayComparison {
    let naadf_backend = NaadfCpuRayBackend::new(
        cache
            .iter()
            .map(|(_, chunk)| chunk.clone())
            .collect::<Vec<_>>(),
    );
    let (current_hit, current_steps) = crate::rendering::voxel_ray_backend::trace_voxel_world_cpu(
        world,
        origin,
        dir,
        max_distance,
        purpose,
    );
    let (naadf_hit, naadf_steps) =
        naadf_backend.trace_with_stats(origin, dir, max_distance, purpose);
    let matches = ray_hits_match(current_hit.as_ref(), naadf_hit.as_ref());

    NaadfRayComparison {
        current_hit,
        naadf_hit,
        current_steps,
        naadf_steps,
        matches,
    }
}

fn ray_hits_match(current: Option<&VoxelRayHit>, naadf: Option<&VoxelRayHit>) -> bool {
    match (current, naadf) {
        (None, None) => true,
        (Some(current), Some(naadf)) => {
            current.world_voxel == naadf.world_voxel
                && current.material_id == naadf.material_id
                && (current.distance - naadf.distance).abs() <= 0.001
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::cache::NaadfCache;
    use crate::rendering::naadf::cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
    use crate::rendering::naadf::gpu_tests::{NaadfGpuRayInputRecord, NaadfGpuRayOutputRecord};
    use crate::rendering::naadf::layout::voxel_index_in_chunk;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    #[test]
    fn matching_chunk_reports_no_occupancy_mismatches() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(2, 3, 4), VoxelType::Rock);
        let naadf_chunk = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        world.insert_chunk(chunk);

        assert!(compare_chunk_occupancy(&world, &naadf_chunk, 16).is_empty());
    }

    #[test]
    fn mismatch_report_respects_limit() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(1, 1, 1), VoxelType::Rock);
        chunk.set(UVec3::new(2, 2, 2), VoxelType::Rock);
        let mut naadf_chunk = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        world.insert_chunk(chunk);

        naadf_chunk.occupancy[voxel_index_in_chunk(UVec3::new(1, 1, 1))] = false;
        naadf_chunk.occupancy[voxel_index_in_chunk(UVec3::new(2, 2, 2))] = false;

        let mismatches = compare_chunk_occupancy(&world, &naadf_chunk, 1);

        assert_eq!(mismatches.len(), 1);
        assert!(mismatches[0].world_occupied);
        assert!(!mismatches[0].naadf_occupied);
    }

    #[test]
    fn backend_ray_comparison_matches_for_same_chunk_data() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(4, 4, 4), VoxelType::Rock);
        let naadf_chunk = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        world.insert_chunk(chunk);
        let mut cache = NaadfCache::default();
        cache.insert_chunk(naadf_chunk);

        let comparison = compare_backend_ray(
            &world,
            &cache,
            Vec3::new(0.5, 4.5, 4.5),
            Vec3::X,
            16.0,
            VoxelRayPurpose::Debug,
        );

        assert!(comparison.matches);
        assert_eq!(
            comparison.current_hit.map(|hit| hit.world_voxel),
            Some(IVec3::new(4, 4, 4))
        );
        assert_eq!(
            comparison.naadf_hit.map(|hit| hit.world_voxel),
            Some(IVec3::new(4, 4, 4))
        );
    }

    #[test]
    fn backend_ray_comparison_reports_hit_miss_mismatch() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(4, 4, 4), VoxelType::Rock);
        world.insert_chunk(chunk);
        let cache = NaadfCache::default();

        let comparison = compare_backend_ray(
            &world,
            &cache,
            Vec3::new(0.5, 4.5, 4.5),
            Vec3::X,
            16.0,
            VoxelRayPurpose::Debug,
        );

        assert!(!comparison.matches);
        assert!(comparison.current_hit.is_some());
        assert!(comparison.naadf_hit.is_none());
    }

    #[test]
    fn debug_visuals_convert_gpu_outputs_and_average_steps() {
        let inputs = [NaadfGpuRayInputRecord::new(
            Vec3::new(1.0, 2.0, 3.0),
            Vec3::X,
            10.0,
            VoxelRayPurpose::Debug,
            IVec3::ZERO,
            0,
            0,
            64,
        )];
        let outputs = [NaadfGpuRayOutputRecord::hit(
            4.0,
            2,
            8,
            IVec3::new(5, 2, 3),
            UVec3::new(5, 2, 3),
            Vec3::NEG_X,
        )];
        let mut visuals = NaadfDebugRayVisuals::default();
        let mut stats = NaadfStats::default();

        visuals.replace_from_gpu_outputs(&inputs, &outputs, &mut stats);

        assert_eq!(visuals.rays.len(), 1);
        assert_eq!(visuals.rays[0].origin, Vec3::new(1.0, 2.0, 3.0));
        assert_eq!(visuals.rays[0].end, Vec3::new(5.0, 2.0, 3.0));
        assert_eq!(visuals.rays[0].normal, Vec3::NEG_X);
        assert_eq!(visuals.rays[0].steps, 8);
        assert_eq!(stats.gpu_avg_ray_steps_last_frame, 8.0);
    }
}
