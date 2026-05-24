use crate::constants::{CHUNK_SIZE, VOXEL_SIZE};
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::meshing::mc_support;
use crate::voxel::meshing::{
    generate_water_mesh, ChunkMeshResult, MeshData, TerrainMeshSectionStats, WaterAirExposureMode,
};
use crate::voxel::skirt::NeighborLods;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use std::time::Instant;

use super::config::McTransvoxelSettings;
use super::face_mask::{compute_transvoxel_face_mask, TransvoxelFaceMask};
use super::normals::sdf_gradient_normal_at_world;
use super::stats::McTransvoxelStats;
use super::tables::{
    CUBE_CORNERS, REGULAR_CELL_CLASS, REGULAR_CELL_DATA, REGULAR_VERTEX_DATA,
};
use super::transvoxel::append_transition_meshes;

pub struct McMeshInput<'a> {
    pub world: &'a VoxelWorld,
    pub chunk: &'a Chunk,
    pub chunk_pos: IVec3,
    pub lod: LodLevel,
    pub neighbor_lods: NeighborLods,
    pub settings: &'a McTransvoxelSettings,
    pub water_exposure_mode: WaterAirExposureMode,
}

pub struct McMeshOutput {
    pub result: ChunkMeshResult,
    pub stats: McTransvoxelStats,
}

pub fn generate_mc_chunk_mesh(input: McMeshInput<'_>) -> McMeshOutput {
    let started = Instant::now();
    let mut stats = McTransvoxelStats {
        regular_chunks_meshed: 1,
        ..Default::default()
    };

    let step = input.lod.step_size() as i32;
    let subdivisions = (CHUNK_SIZE as u32 / input.lod.step_size()) as usize;
    let padded = subdivisions + 2;
    let chunk_origin = VoxelWorld::chunk_to_world(input.chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let (transition_mask, skipped) =
        compute_transvoxel_face_mask(input.lod, &input.neighbor_lods);
    stats.skipped_lod_delta_gt_one = skipped;

    let sdf = SdfGrid::new(
        input.chunk,
        input.world,
        input.lod,
        &input.neighbor_lods,
        chunk_origin,
    );
    let mut mesh = MeshData::with_capacity(4096, 6144);
    // Tag the LOD index so the wireframe-debug material can colour MC chunks
    // by LOD (matches the SN paths in meshing.rs that do the same). Without
    // this, every MC chunk renders as LOD0 (white) under Alt+F7, hiding the
    // LOD0↔LOD1 transition the user is trying to debug.
    mesh.wireframe_lod_index = input.lod.wireframe_lod_index();

    extract_regular_mc(
        &sdf,
        &mut mesh,
        input.chunk,
        input.world,
        chunk_origin,
        chunk_center,
        subdivisions,
        step,
        transition_mask,
        &mut stats,
    );

    append_transition_meshes(
        &sdf,
        &mut mesh,
        input.chunk,
        input.world,
        chunk_origin,
        chunk_center,
        subdivisions,
        step,
        transition_mask,
        &mut stats,
    );

    let (water_mesh, water_stats) = generate_water_mesh(
        input.chunk,
        input.world,
        chunk_center,
        chunk_origin,
        input.water_exposure_mode,
    );

    stats.mesh_generation_ms_total = started.elapsed().as_secs_f32() * 1000.0;

    McMeshOutput {
        result: ChunkMeshResult {
            solid: mesh,
            water: water_mesh,
            water_stats,
            lod_transition_snap_stats: Default::default(),
            mesh_section_stats: TerrainMeshSectionStats::default(),
            mc_transvoxel_stats: Some(stats),
        },
        stats,
    }
}

pub(crate) struct SdfGrid {
    values: Vec<f32>,
    padded: usize,
    step: i32,
    chunk_origin: IVec3,
}

impl SdfGrid {
    fn new(
        chunk: &Chunk,
        world: &VoxelWorld,
        my_lod: LodLevel,
        neighbor_lods: &NeighborLods,
        chunk_origin: IVec3,
    ) -> Self {
        let (padded, values, step) =
            mc_support::build_mc_sdf_values(chunk, world, my_lod, neighbor_lods);
        Self {
            values,
            padded,
            step,
            chunk_origin,
        }
    }

    fn index(padded: usize, x: usize, y: usize, z: usize) -> usize {
        x + y * padded + z * padded * padded
    }

    pub fn get(&self, x: usize, y: usize, z: usize) -> f32 {
        self.values[Self::index(self.padded, x, y, z)]
    }

    fn local_position(&self, x: usize, y: usize, z: usize) -> Vec3 {
        Vec3::new(
            ((x as i32 - 1) * self.step) as f32,
            ((y as i32 - 1) * self.step) as f32,
            ((z as i32 - 1) * self.step) as f32,
        )
    }

    pub fn interpolate_edge(&self, a: [usize; 3], b: [usize; 3]) -> Vec3 {
        let va = self.get(a[0], a[1], a[2]);
        let vb = self.get(b[0], b[1], b[2]);
        let pa = self.local_position(a[0], a[1], a[2]);
        let pb = self.local_position(b[0], b[1], b[2]);
        interpolate_iso(pa, pb, va, vb)
    }
}

fn interpolate_iso(a: Vec3, b: Vec3, va: f32, vb: f32) -> Vec3 {
    if (va - vb).abs() < f32::EPSILON {
        return (a + b) * 0.5;
    }
    let t = va / (va - vb);
    a.lerp(b, t.clamp(0.0, 1.0))
}

#[derive(Copy, Clone)]
struct RegularVertexData(u16);

impl RegularVertexData {
    fn corner_a(self) -> usize {
        ((self.0 & 0x0F) as usize).min(7)
    }
    fn corner_b(self) -> usize {
        (((self.0 & 0xF0) >> 4) as usize).min(7)
    }
}

fn extract_regular_mc(
    sdf: &SdfGrid,
    mesh: &mut MeshData,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    subdivisions: usize,
    _step: i32,
    transition_mask: TransvoxelFaceMask,
    stats: &mut McTransvoxelStats,
) {
    let skip_regular_on_face = |cx: usize, cy: usize, cz: usize| -> bool {
        if transition_mask.pos_x && cx >= subdivisions.saturating_sub(1) {
            return true;
        }
        if transition_mask.neg_x && cx == 0 {
            return true;
        }
        if transition_mask.pos_y && cy >= subdivisions.saturating_sub(1) {
            return true;
        }
        if transition_mask.neg_y && cy == 0 {
            return true;
        }
        if transition_mask.pos_z && cz >= subdivisions.saturating_sub(1) {
            return true;
        }
        if transition_mask.neg_z && cz == 0 {
            return true;
        }
        false
    };

    for cz in 0..subdivisions {
        for cy in 0..subdivisions {
            for cx in 0..subdivisions {
                if skip_regular_on_face(cx, cy, cz) {
                    continue;
                }
                let mut case = 0usize;
                for (i, corner) in CUBE_CORNERS.iter().enumerate() {
                    let gx = cx + corner[0] as usize;
                    let gy = cy + corner[1] as usize;
                    let gz = cz + corner[2] as usize;
                    if sdf.get(gx, gy, gz) < 0.0 {
                        case |= 1 << i;
                    }
                }
                // Only 0 and 255 emit no triangles. Earlier this code also
                // dropped cases with exactly 1 or 7 solid corners as a defence
                // against "shatter" from the unclamped smoothed SDF — but that
                // produced a regular pattern of triangular holes along any
                // sloping surface (every cell where the iso clips one corner
                // hits that count). The sign-guard clamp in `smoothed_sdf_*`
                // now keeps air corners strictly positive, so the underlying
                // shatter source is gone and the filter must not drop real
                // single-corner cases.
                if case == 0 || case == 255 {
                    continue;
                }
                let class = REGULAR_CELL_CLASS[case];
                let tri_data = REGULAR_CELL_DATA[class as usize];
                let tri_count = tri_data.get_triangle_count() as usize;
                let vert_data = REGULAR_VERTEX_DATA[case];
                let mut cell_vertices: [Option<Vec3>; 12] = [None; 12];
                for vi in 0..tri_data.get_vertex_count() as usize {
                    let vd = RegularVertexData(vert_data[vi]);
                    let corner_a = vd.corner_a();
                    let corner_b = vd.corner_b();
                    let ca = CUBE_CORNERS[corner_a];
                    let cb = CUBE_CORNERS[corner_b];
                    let a = [
                        cx + ca[0] as usize,
                        cy + ca[1] as usize,
                        cz + ca[2] as usize,
                    ];
                    let b = [
                        cx + cb[0] as usize,
                        cy + cb[1] as usize,
                        cz + cb[2] as usize,
                    ];
                    cell_vertices[vi] = Some(sdf.interpolate_edge(a, b));
                }
                for t in 0..tri_count {
                    let i0 = tri_data.vertex_index[t * 3] as usize;
                    let i1 = tri_data.vertex_index[t * 3 + 1] as usize;
                    let i2 = tri_data.vertex_index[t * 3 + 2] as usize;
                    let Some(p0) = cell_vertices[i0] else { continue };
                    let Some(p1) = cell_vertices[i1] else { continue };
                    let Some(p2) = cell_vertices[i2] else { continue };
                    push_mc_triangle(
                        mesh,
                        chunk,
                        world,
                        chunk_origin,
                        chunk_center,
                        p0,
                        p1,
                        p2,
                    );
                    stats.record_regular_triangles(1);
                }
            }
        }
    }
}

pub(crate) fn push_mc_triangle(
    mesh: &mut MeshData,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) {
    let base = mesh.positions.len() as u32;
    for local in [p0, p1, p2] {
        let normal = sdf_gradient_normal_at_world(world, chunk_origin, local);
        let weights = mc_support::vertex_material_weights(local, chunk, world, chunk_origin);
        mesh.positions
            .push(mc_support::scale_vertex(local, chunk_center));
        mesh.normals.push(normal);
        mesh.uvs.push([1.0, 0.0]);
        mesh.colors.push(weights);
    }
    mesh.indices.push(base);
    mesh.indices.push(base + 1);
    mesh.indices.push(base + 2);
    mesh.push_triangle_barycentrics();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CHUNK_SIZE_I32;
    use crate::voxel::types::VoxelType;
    use crate::voxel::meshing::WaterAirExposureMode;

    fn sphere_world() -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(4, 4, 4));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let center = Vec3::new(8.0, 8.0, 8.0);
        let radius = 6.0f32;
        for z in 0..CHUNK_SIZE_I32 {
            for y in 0..CHUNK_SIZE_I32 {
                for x in 0..CHUNK_SIZE_I32 {
                    let p = Vec3::new(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5);
                    if p.distance(center) <= radius {
                        world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                    }
                }
            }
        }
        world
    }

    #[test]
    fn sphere_fixture_has_triangles_and_valid_attributes() {
        let world = sphere_world();
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
        });
        let mesh = &out.result.solid;
        assert!(!mesh.is_empty());
        assert_eq!(mesh.positions.len(), mesh.normals.len());
        assert_eq!(mesh.positions.len(), mesh.uvs.len());
        assert_eq!(mesh.positions.len(), mesh.colors.len());
        assert_eq!(mesh.indices.len() % 3, 0);
    }

    /// A single solid voxel surrounded by air produces eight MC cells each
    /// with exactly one solid corner — the canonical "1-bit case". A previous
    /// guard skipped `solid_corners <= 1 || solid_corners >= 7` as a defence
    /// against unclamped-smoothed-SDF shatter; that guard left a regular
    /// pattern of triangular holes along every sloping surface. Now that
    /// `smoothed_sdf_*` clamp air corners ≥ SIGN_GUARD, the guard is gone
    /// and these cases must emit triangles. If this assertion ever fails,
    /// look for a re-introduced single-corner filter in `extract_regular_mc`.
    #[test]
    fn single_solid_voxel_emits_corner_triangles() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.set_voxel(IVec3::new(8, 8, 8), VoxelType::Rock);

        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
        });
        let mesh = &out.result.solid;
        assert!(
            !mesh.is_empty(),
            "single-solid-voxel fixture produced no triangles — the \
             single-corner MC filter has likely been re-introduced"
        );
        assert!(
            out.stats.triangle_count_regular >= 8,
            "expected ≥ 8 triangles from the 8 cells touching the lone solid \
             voxel, got {}",
            out.stats.triangle_count_regular
        );
    }

    /// LOD0↔LOD1 transition apron must emit triangles for cells with
    /// single-corner cases. A previous filter in `extract_transition_cell`
    /// (`solid_corners <= 1 || >= 8`) dropped those, leaving irregular dark
    /// holes along the LOD-transition boundary on any sloped terrain.
    /// Fixture: a sloped wedge inside the chunk with the PosY face flagged
    /// as having a coarser neighbour, so the transvoxel apron runs along it.
    #[test]
    fn sloped_chunk_with_coarser_pos_y_neighbor_emits_transition_triangles() {
        use crate::voxel::chunk::LodLevel;

        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        // For the PosY transition apron to fire, the iso must cross the +Y
        // boundary cell row (world voxels at y = 14..15 for a 16-voxel chunk).
        // A sawtooth surface alternating between heights 14 and 15 along X
        // creates a sweep of 9-corner transition cases that includes the
        // single-corner cases the previous filter dropped.
        for x in 0..CHUNK_SIZE_I32 {
            let height = 14 + (x % 2); // alternates 14, 15 along +X
            for z in 0..CHUNK_SIZE_I32 {
                for y in 0..=height {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }

        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let neighbor_lods = NeighborLods {
            pos_y: Some(LodLevel::Lod1),
            ..Default::default()
        };
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods,
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
        });
        assert!(
            out.stats.triangle_count_transition > 0,
            "expected transition triangles along the PosY 2:1 LOD boundary \
             but got 0 — the single-corner transition-cell filter has \
             likely been re-introduced in extract_transition_cell"
        );
    }

    /// MC mesh at Lod1 must tag its per-triangle barycentric UV1 with LOD
    /// index 1 so the wireframe-debug shader can colour the chunk light-blue.
    /// Without this tag every MC chunk renders as LOD0 (white) regardless of
    /// its real LOD, and Alt+F7 can't distinguish LOD0 from LOD1 chunks.
    #[test]
    fn mc_mesh_carries_lod_tagged_barycentric_uvs() {
        use crate::voxel::chunk::LodLevel;
        use crate::voxel::meshing::barycentric_lod_index;

        let world = sphere_world();
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod1,
            neighbor_lods: NeighborLods::default(),
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
        });
        let mesh = &out.result.solid;
        assert!(!mesh.is_empty(), "Lod1 sphere should still produce a mesh");
        // Every vertex must carry the Lod1 tag.
        for uv in &mesh.barycentric_uvs {
            assert_eq!(
                barycentric_lod_index(*uv),
                1,
                "MC Lod1 mesh has a vertex tagged as LOD {} instead of 1; \
                 mesh.wireframe_lod_index init missing in generate_mc_chunk_mesh",
                barycentric_lod_index(*uv)
            );
        }
    }
}
