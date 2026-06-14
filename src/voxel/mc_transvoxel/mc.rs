use crate::constants::{CHUNK_SIZE, VOXEL_SIZE};
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::meshing::mc_support;
use crate::voxel::meshing::{
    ChunkMeshResult, McTransitionForensicsMode, McTriangleSource, McTriangleSources, MeshData,
    MeshForensicsOptions, MeshGenerationTimingStats, TerrainMeshSectionStats, WaterAirExposureMode,
    generate_water_mesh,
};
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use std::time::Instant;

use super::config::McTransvoxelSettings;
use super::face_mask::{TransvoxelFaceMask, compute_transvoxel_face_mask};
use super::normals::sdf_gradient_normal_at_world;
use super::stats::McTransvoxelStats;
use super::tables::{CUBE_CORNERS, REGULAR_CELL_CLASS, REGULAR_CELL_DATA, REGULAR_VERTEX_DATA};
#[cfg(test)]
use super::transvoxel::transition_case_for_regular_cell;
use super::transvoxel::{append_transition_meshes, transition_triangle_count_for_regular_cell};

pub struct McMeshInput<'a> {
    pub world: &'a VoxelWorld,
    pub chunk: &'a Chunk,
    pub chunk_pos: IVec3,
    pub lod: LodLevel,
    pub neighbor_lods: NeighborLods,
    pub settings: &'a McTransvoxelSettings,
    pub water_exposure_mode: WaterAirExposureMode,
    pub forensics: MeshForensicsOptions,
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
    let chunk_origin = VoxelWorld::chunk_to_world(input.chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let (transition_mask, skipped) = compute_transvoxel_face_mask(input.lod, &input.neighbor_lods);
    stats.skipped_lod_delta_gt_one = skipped;

    let sdf = SdfGrid::new(
        input.chunk,
        input.world,
        input.lod,
        &input.neighbor_lods,
        chunk_origin,
    );
    let mut mesh = MeshData::with_capacity(4096, 6144);
    let mut triangle_sources = input.forensics.enabled.then(Vec::new);
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
        if input.forensics.mc_transitions == McTransitionForensicsMode::DisabledKeepBoundaryRows {
            TransvoxelFaceMask::default()
        } else {
            transition_mask
        },
        input.lod,
        &mut triangle_sources,
        &mut stats,
    );

    if input.forensics.mc_transitions == McTransitionForensicsMode::Enabled {
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
            input.lod,
            &mut triangle_sources,
            &mut stats,
        );
    }

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
            mc_triangle_sources: triangle_sources.map(|sources| McTriangleSources { sources }),
            generation_timing: MeshGenerationTimingStats::default(),
        },
        stats,
    }
}

pub(crate) struct SdfGrid {
    values: Vec<f32>,
    padded: usize,
    step: i32,
}

impl SdfGrid {
    fn new(
        chunk: &Chunk,
        world: &VoxelWorld,
        my_lod: LodLevel,
        neighbor_lods: &NeighborLods,
        _chunk_origin: IVec3,
    ) -> Self {
        let (padded, values, step) =
            mc_support::build_mc_sdf_values(chunk, world, my_lod, neighbor_lods);
        Self {
            values,
            padded,
            step,
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

    fn sample_trilinear_grid_space(&self, p: Vec3) -> f32 {
        let max = self.padded.saturating_sub(1) as f32;
        let x = p.x.clamp(0.0, max);
        let y = p.y.clamp(0.0, max);
        let z = p.z.clamp(0.0, max);

        let x0 = x.floor() as usize;
        let y0 = y.floor() as usize;
        let z0 = z.floor() as usize;
        let x1 = (x0 + 1).min(self.padded - 1);
        let y1 = (y0 + 1).min(self.padded - 1);
        let z1 = (z0 + 1).min(self.padded - 1);

        let tx = x - x0 as f32;
        let ty = y - y0 as f32;
        let tz = z - z0 as f32;

        let c000 = self.get(x0, y0, z0);
        let c100 = self.get(x1, y0, z0);
        let c010 = self.get(x0, y1, z0);
        let c110 = self.get(x1, y1, z0);
        let c001 = self.get(x0, y0, z1);
        let c101 = self.get(x1, y0, z1);
        let c011 = self.get(x0, y1, z1);
        let c111 = self.get(x1, y1, z1);

        let c00 = lerp_f32(c000, c100, tx);
        let c10 = lerp_f32(c010, c110, tx);
        let c01 = lerp_f32(c001, c101, tx);
        let c11 = lerp_f32(c011, c111, tx);
        let c0 = lerp_f32(c00, c10, ty);
        let c1 = lerp_f32(c01, c11, ty);
        lerp_f32(c0, c1, tz)
    }

    fn normal_at_local(&self, local: Vec3) -> Option<Vec3> {
        if self.padded < 2 || self.step <= 0 {
            return None;
        }
        let step = self.step as f32;
        let grid_pos = Vec3::new(
            local.x / step + 1.0,
            local.y / step + 1.0,
            local.z / step + 1.0,
        );
        let gradient = Vec3::new(
            self.sample_trilinear_grid_space(grid_pos + Vec3::X)
                - self.sample_trilinear_grid_space(grid_pos - Vec3::X),
            self.sample_trilinear_grid_space(grid_pos + Vec3::Y)
                - self.sample_trilinear_grid_space(grid_pos - Vec3::Y),
            self.sample_trilinear_grid_space(grid_pos + Vec3::Z)
                - self.sample_trilinear_grid_space(grid_pos - Vec3::Z),
        );
        let normal = gradient.normalize_or_zero();
        (normal.length_squared() > 0.0).then_some(normal)
    }
}

fn interpolate_iso(a: Vec3, b: Vec3, va: f32, vb: f32) -> Vec3 {
    if (va - vb).abs() < f32::EPSILON {
        return (a + b) * 0.5;
    }
    let t = va / (va - vb);
    a.lerp(b, t.clamp(0.0, 1.0))
}

fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
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

fn transition_replaces_regular_cell(
    sdf: &SdfGrid,
    subdivisions: usize,
    transition_mask: TransvoxelFaceMask,
    regular_cell: [usize; 3],
) -> bool {
    let (faces, count) =
        transition_faces_for_regular_cell(transition_mask, subdivisions, regular_cell);
    faces[..count].iter().flatten().any(|face| {
        transition_triangle_count_for_regular_cell(sdf, subdivisions, *face, regular_cell) > 0
    })
}

fn transition_faces_for_regular_cell(
    transition_mask: TransvoxelFaceMask,
    subdivisions: usize,
    regular_cell: [usize; 3],
) -> ([Option<ChunkFace>; 6], usize) {
    let [cx, cy, cz] = regular_cell;
    let max_cell = subdivisions.saturating_sub(1);
    let mut faces = [None; 6];
    let mut count = 0usize;
    let mut add = |face: ChunkFace| {
        faces[count] = Some(face);
        count += 1;
    };

    if transition_mask.pos_x && cx >= max_cell {
        add(ChunkFace::PosX);
    }
    if transition_mask.neg_x && cx == 0 {
        add(ChunkFace::NegX);
    }
    if transition_mask.pos_y && cy >= max_cell {
        add(ChunkFace::PosY);
    }
    if transition_mask.neg_y && cy == 0 {
        add(ChunkFace::NegY);
    }
    if transition_mask.pos_z && cz >= max_cell {
        add(ChunkFace::PosZ);
    }
    if transition_mask.neg_z && cz == 0 {
        add(ChunkFace::NegZ);
    }

    (faces, count)
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
    lod: LodLevel,
    triangle_sources: &mut Option<Vec<McTriangleSource>>,
    stats: &mut McTransvoxelStats,
) {
    let grid_base = 1usize;
    // The current transition extraction is not yet watertight enough to
    // destructively replace regular boundary rows. Live probes on 2026-05-24
    // showed non-empty transition cells whose triangles missed the expected
    // near ray by ~0.3-0.5 voxel after the matching regular cell had been
    // skipped. Keep the regular surface and let transition triangles act as a
    // seam apron until the transition table/frame path is proven watertight.
    let replace_regular_boundary_rows = false;
    for cz in 0..subdivisions {
        for cy in 0..subdivisions {
            for cx in 0..subdivisions {
                let mut case = 0usize;
                for (i, corner) in CUBE_CORNERS.iter().enumerate() {
                    let gx = cx + grid_base + corner[0] as usize;
                    let gy = cy + grid_base + corner[1] as usize;
                    let gz = cz + grid_base + corner[2] as usize;
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
                if replace_regular_boundary_rows
                    && transition_replaces_regular_cell(
                        sdf,
                        subdivisions,
                        transition_mask,
                        [cx, cy, cz],
                    )
                {
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
                        cx + grid_base + ca[0] as usize,
                        cy + grid_base + ca[1] as usize,
                        cz + grid_base + ca[2] as usize,
                    ];
                    let b = [
                        cx + grid_base + cb[0] as usize,
                        cy + grid_base + cb[1] as usize,
                        cz + grid_base + cb[2] as usize,
                    ];
                    cell_vertices[vi] = Some(sdf.interpolate_edge(a, b));
                }
                for t in 0..tri_count {
                    let i0 = tri_data.vertex_index[t * 3] as usize;
                    let i1 = tri_data.vertex_index[t * 3 + 1] as usize;
                    let i2 = tri_data.vertex_index[t * 3 + 2] as usize;
                    let Some(p0) = cell_vertices[i0] else {
                        continue;
                    };
                    let Some(p1) = cell_vertices[i1] else {
                        continue;
                    };
                    let Some(p2) = cell_vertices[i2] else {
                        continue;
                    };
                    push_mc_triangle(
                        mesh,
                        chunk,
                        world,
                        chunk_origin,
                        chunk_center,
                        sdf,
                        p0,
                        p1,
                        p2,
                    );
                    if let Some(sources) = triangle_sources.as_mut() {
                        sources.push(McTriangleSource::Regular {
                            chunk_pos: chunk.position(),
                            lod,
                            cell: UVec3::new(cx as u32, cy as u32, cz as u32),
                            case_index: case as u16,
                            class_index: class,
                        });
                    }
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
    sdf: &SdfGrid,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) {
    let base = mesh.positions.len() as u32;
    let normal_at = |local: Vec3| {
        sdf.normal_at_local(local).unwrap_or_else(|| {
            Vec3::from_array(sdf_gradient_normal_at_world(world, chunk_origin, local))
        })
    };
    let mut vertices = [
        (p0, normal_at(p0)),
        (p1, normal_at(p1)),
        (p2, normal_at(p2)),
    ];
    let geometric = (p1 - p0).cross(p2 - p0).normalize_or_zero();
    let vertex_normal = (vertices[0].1 + vertices[1].1 + vertices[2].1).normalize_or_zero();
    if geometric.length_squared() > 0.0
        && vertex_normal.length_squared() > 0.0
        && geometric.dot(vertex_normal) < 0.0
    {
        vertices.swap(1, 2);
    }

    for (local, normal) in vertices {
        let weights = mc_support::vertex_material_weights(local, chunk, world, chunk_origin);
        mesh.positions
            .push(mc_support::scale_vertex(local, chunk_center));
        mesh.normals.push(normal.to_array());
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
    use crate::voxel::meshing::WaterAirExposureMode;
    use crate::voxel::types::VoxelType;

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

    fn first_mesh_ray_hit(mesh: &MeshData, origin: Vec3, dir: Vec3) -> Option<(f32, bool)> {
        let mut best: Option<(f32, bool)> = None;
        for tri in mesh.indices.chunks_exact(3) {
            let p0 = Vec3::from_array(mesh.positions[tri[0] as usize]);
            let p1 = Vec3::from_array(mesh.positions[tri[1] as usize]);
            let p2 = Vec3::from_array(mesh.positions[tri[2] as usize]);
            if let Some(hit) = ray_triangle_hit_for_test(origin, dir, p0, p1, p2) {
                if best.map_or(true, |best| hit.0 < best.0) {
                    best = Some(hit);
                }
            }
        }
        best
    }

    fn ray_triangle_hit_for_test(
        origin: Vec3,
        dir: Vec3,
        p0: Vec3,
        p1: Vec3,
        p2: Vec3,
    ) -> Option<(f32, bool)> {
        let edge1 = p1 - p0;
        let edge2 = p2 - p0;
        let pvec = dir.cross(edge2);
        let det = edge1.dot(pvec);
        if det.abs() < 1e-7 {
            return None;
        }
        let inv_det = 1.0 / det;
        let tvec = origin - p0;
        let u = tvec.dot(pvec) * inv_det;
        if !(-1e-4..=1.0 + 1e-4).contains(&u) {
            return None;
        }
        let qvec = tvec.cross(edge1);
        let v = dir.dot(qvec) * inv_det;
        if v < -1e-4 || u + v > 1.0 + 1e-4 {
            return None;
        }
        let distance = edge2.dot(qvec) * inv_det;
        (distance >= 0.0).then_some((distance, dir.dot(edge1.cross(edge2)) < 0.0))
    }

    fn world_with_heightfield(height: impl Fn(i32, i32) -> i32) -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        for z in 0..CHUNK_SIZE_I32 {
            for x in 0..CHUNK_SIZE_I32 {
                let column_height = height(x, z).clamp(0, CHUNK_SIZE_I32 - 2);
                for y in 0..=column_height {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
        world
    }

    fn world_with_heightfield_allow_top(height: impl Fn(i32, i32) -> i32) -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        for z in 0..CHUNK_SIZE_I32 {
            for x in 0..CHUNK_SIZE_I32 {
                let column_height = height(x, z).clamp(0, CHUNK_SIZE_I32 - 1);
                for y in 0..=column_height {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
        world
    }

    fn pos_y_transition_fixture_world() -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        for x in 0..CHUNK_SIZE_I32 {
            let height = 14 + (x % 2);
            for z in 0..CHUNK_SIZE_I32 {
                for y in 0..=height {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
        world
    }

    fn world_with_solid_pos_z_neighbor() -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 2));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_chunk(Chunk::new(IVec3::new(0, 0, 1)));
        for z in 0..CHUNK_SIZE_I32 {
            for y in 4..CHUNK_SIZE_I32 {
                for x in 0..CHUNK_SIZE_I32 {
                    world.set_voxel(IVec3::new(x, y, CHUNK_SIZE_I32 + z), VoxelType::Rock);
                }
            }
        }
        world
    }

    fn synthetic_pos_z_case_12_sdf() -> SdfGrid {
        let padded = 18usize;
        let mut values = vec![1.0f32; padded * padded * padded];
        let index = |x: usize, y: usize, z: usize| x + y * padded + z * padded * padded;
        values[index(11, 7, 16)] = -1.0;
        values[index(11, 8, 16)] = -1.0;
        SdfGrid {
            values,
            padded,
            step: 1,
        }
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
            forensics: MeshForensicsOptions::default(),
        });
        let mesh = &out.result.solid;
        assert!(!mesh.is_empty());
        assert_eq!(mesh.positions.len(), mesh.normals.len());
        assert_eq!(mesh.positions.len(), mesh.uvs.len());
        assert_eq!(mesh.positions.len(), mesh.colors.len());
        assert_eq!(mesh.indices.len() % 3, 0);
    }

    #[test]
    fn regular_mc_flat_plane_has_no_ray_gaps() {
        let world = world_with_heightfield(|_, _| 7);
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
            forensics: MeshForensicsOptions::default(),
        });
        let mesh = &out.result.solid;
        for z in (3..13).step_by(3) {
            for x in (3..13).step_by(3) {
                let hit = first_mesh_ray_hit(
                    mesh,
                    Vec3::new(x as f32 + 0.5, 20.0, z as f32 + 0.5),
                    Vec3::NEG_Y,
                );
                assert!(
                    hit.is_some(),
                    "flat-plane MC mesh had no ray hit at column ({x}, {z})"
                );
            }
        }
    }

    #[test]
    fn regular_mc_diagonal_plane_has_no_ray_gaps() {
        let world = world_with_heightfield(|x, _| 3 + x / 2);
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
            forensics: MeshForensicsOptions::default(),
        });
        let mesh = &out.result.solid;
        for z in (3..13).step_by(3) {
            for x in (3..13).step_by(3) {
                let hit = first_mesh_ray_hit(
                    mesh,
                    Vec3::new(x as f32 + 0.5, 20.0, z as f32 + 0.5),
                    Vec3::NEG_Y,
                );
                assert!(
                    hit.is_some(),
                    "diagonal-plane MC mesh had no ray hit at column ({x}, {z})"
                );
            }
        }
    }

    #[test]
    fn regular_lod1_mesh_covers_positive_boundary_cell() {
        let world = world_with_heightfield_allow_top(|_, _| CHUNK_SIZE_I32 - 1);
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
            forensics: MeshForensicsOptions::default(),
        });
        let mesh = &out.result.solid;
        let ray_origin = Vec3::new(8.0, 20.0, 8.0);
        let hit = first_mesh_ray_hit(mesh, ray_origin, Vec3::NEG_Y)
            .expect("Lod1 top surface should be meshed in the positive boundary cell");
        let hit_y = ray_origin.y - hit.0;

        assert!(
            hit_y > 14.0,
            "Lod1 top hit should come from the positive boundary cell [14,16], got y={hit_y}"
        );
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
            forensics: MeshForensicsOptions::default(),
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
    fn forensics_sources_track_regular_triangles() {
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
            forensics: MeshForensicsOptions {
                enabled: true,
                ..Default::default()
            },
        });
        let sources = out
            .result
            .mc_triangle_sources
            .as_ref()
            .expect("forensics-enabled MC mesh should carry triangle sources");
        assert_eq!(sources.sources.len(), out.result.solid.indices.len() / 3);
        assert!(sources.sources.iter().any(|source| {
            matches!(
                source,
                McTriangleSource::Regular {
                    chunk_pos: IVec3::ZERO,
                    lod: LodLevel::Lod0,
                    ..
                }
            )
        }));
    }

    #[test]
    fn sloped_chunk_with_coarser_pos_y_neighbor_emits_transition_triangles() {
        use crate::voxel::chunk::LodLevel;

        // For the PosY transition apron to fire, the iso must cross the +Y
        // boundary cell row (world voxels at y = 14..15 for a 16-voxel chunk).
        // A sawtooth surface alternating between heights 14 and 15 along X
        // creates a sweep of 9-corner transition cases that includes the
        // single-corner cases the previous filter dropped.
        let world = pos_y_transition_fixture_world();

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
            forensics: MeshForensicsOptions::default(),
        });
        assert!(
            out.stats.triangle_count_transition > 0,
            "expected transition triangles along the PosY 2:1 LOD boundary \
             but got 0 — the single-corner transition-cell filter has \
             likely been re-introduced in extract_transition_cell"
        );
    }

    #[test]
    fn transition_apron_keeps_regular_boundary_rows() {
        let world = pos_y_transition_fixture_world();
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods {
                pos_y: Some(LodLevel::Lod1),
                ..Default::default()
            },
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
            forensics: MeshForensicsOptions {
                enabled: true,
                ..Default::default()
            },
        });
        let sources = out
            .result
            .mc_triangle_sources
            .as_ref()
            .expect("forensics-enabled MC mesh should carry triangle sources");
        assert!(
            sources.sources.iter().any(|source| {
                matches!(
                    source,
                    McTriangleSource::Transition {
                        face: ChunkFace::PosY,
                        ..
                    }
                )
            }),
            "fixture should emit PosY transition apron triangles"
        );
        assert!(
            sources.sources.iter().any(|source| {
                matches!(
                    source,
                    McTriangleSource::Regular {
                        cell,
                        case_index,
                        ..
                    } if cell.y == 15 && *case_index != 0 && *case_index != 255
                )
            }),
            "regular boundary rows must remain under transition aprons until transition replacement is watertight"
        );
    }

    #[test]
    fn empty_transition_owner_keeps_regular_boundary_row() {
        let world = world_with_solid_pos_z_neighbor();
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let neighbor_lods = NeighborLods {
            pos_z: Some(LodLevel::Lod1),
            ..Default::default()
        };
        let sdf = SdfGrid::new(chunk, &world, LodLevel::Lod0, &neighbor_lods, IVec3::ZERO);
        assert_eq!(
            transition_triangle_count_for_regular_cell(&sdf, 16, ChunkFace::PosZ, [8, 8, 15]),
            0,
            "target PosZ transition cell should be empty while the regular boundary cell is non-empty"
        );
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods,
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
            forensics: MeshForensicsOptions {
                enabled: true,
                ..Default::default()
            },
        });

        let sources = out
            .result
            .mc_triangle_sources
            .as_ref()
            .expect("forensics-enabled MC mesh should carry triangle sources");
        assert!(
            !sources.sources.iter().any(|source| {
                matches!(
                    source,
                    McTriangleSource::Transition {
                        face: ChunkFace::PosZ,
                        cell_u: 4,
                        cell_v: 4,
                        ..
                    }
                )
            }),
            "target PosZ transition cell should not emit replacement triangles"
        );
        assert!(
            sources.sources.iter().any(|source| {
                matches!(
                    source,
                    McTriangleSource::Regular {
                        cell,
                        case_index,
                        ..
                    } if *cell == UVec3::new(8, 8, 15)
                        && *case_index != 0
                        && *case_index != 255
                )
            }),
            "non-empty PosZ regular boundary cells must remain when the owning transition cells are empty"
        );
        let hit = first_mesh_ray_hit(&out.result.solid, Vec3::new(8.5, 8.5, 14.0), Vec3::Z);
        assert!(
            hit.is_some(),
            "ray through the PosZ boundary row should hit the retained regular MC surface"
        );
    }

    #[test]
    fn pos_z_transition_case_uses_reversed_u_mapping() {
        let sdf = synthetic_pos_z_case_12_sdf();
        assert_eq!(
            transition_case_for_regular_cell(&sdf, 16, ChunkFace::PosZ, [10, 7, 15]),
            12,
            "PosZ regular cell x=10 must map through HighZ's reversed U axis"
        );
        assert_eq!(
            transition_triangle_count_for_regular_cell(&sdf, 16, ChunkFace::PosZ, [10, 7, 15]),
            3
        );

        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let mut mesh = MeshData::with_capacity(16, 16);
        let mut sources = Some(Vec::new());
        let mut stats = McTransvoxelStats::default();
        append_transition_meshes(
            &sdf,
            &mut mesh,
            chunk,
            &world,
            IVec3::ZERO,
            Vec3::splat(8.0),
            16,
            1,
            TransvoxelFaceMask {
                pos_z: true,
                ..Default::default()
            },
            LodLevel::Lod0,
            &mut sources,
            &mut stats,
        );
        let sources = sources.expect("forensics source collection should remain available");
        assert!(
            sources.iter().any(|source| {
                matches!(
                    source,
                    McTriangleSource::Transition {
                        face: ChunkFace::PosZ,
                        cell_u: 2,
                        cell_v: 3,
                        case_index: 12,
                        ..
                    }
                )
            }),
            "PosZ transition case 12 should be emitted at reversed-U cell (2, 3)"
        );
    }

    #[test]
    fn forensics_sources_track_transition_triangles() {
        use crate::voxel::chunk::LodLevel;

        let world = pos_y_transition_fixture_world();
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
            forensics: MeshForensicsOptions {
                enabled: true,
                ..Default::default()
            },
        });
        let sources = out
            .result
            .mc_triangle_sources
            .as_ref()
            .expect("forensics-enabled MC mesh should carry triangle sources");
        assert_eq!(sources.sources.len(), out.result.solid.indices.len() / 3);
        assert!(sources.sources.iter().any(|source| {
            matches!(
                source,
                McTriangleSource::Transition {
                    chunk_pos: IVec3::ZERO,
                    lod: LodLevel::Lod0,
                    face: crate::voxel::skirt::ChunkFace::PosY,
                    ..
                }
            )
        }));
    }

    #[test]
    fn transition_triangle_winding_matches_vertex_normals() {
        use crate::voxel::chunk::LodLevel;
        use crate::voxel::skirt::ChunkFace;

        let world = pos_y_transition_fixture_world();
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let settings = McTransvoxelSettings::default();
        let out = generate_mc_chunk_mesh(McMeshInput {
            world: &world,
            chunk,
            chunk_pos: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods {
                pos_y: Some(LodLevel::Lod1),
                ..Default::default()
            },
            settings: &settings,
            water_exposure_mode: WaterAirExposureMode::default(),
            forensics: MeshForensicsOptions {
                enabled: true,
                ..Default::default()
            },
        });
        let mesh = &out.result.solid;
        let sources = out
            .result
            .mc_triangle_sources
            .as_ref()
            .expect("forensics-enabled MC mesh should carry triangle sources");
        let mut checked = 0usize;
        let mut worst_dot = 1.0f32;

        for (triangle_index, source) in sources.sources.iter().enumerate() {
            if !matches!(
                source,
                McTriangleSource::Transition {
                    face: ChunkFace::PosY,
                    ..
                }
            ) {
                continue;
            }
            let indices = &mesh.indices[triangle_index * 3..triangle_index * 3 + 3];
            let p0 = Vec3::from_array(mesh.positions[indices[0] as usize]);
            let p1 = Vec3::from_array(mesh.positions[indices[1] as usize]);
            let p2 = Vec3::from_array(mesh.positions[indices[2] as usize]);
            let n0 = Vec3::from_array(mesh.normals[indices[0] as usize]);
            let n1 = Vec3::from_array(mesh.normals[indices[1] as usize]);
            let n2 = Vec3::from_array(mesh.normals[indices[2] as usize]);
            let geometric = (p1 - p0).cross(p2 - p0).normalize_or_zero();
            let vertex = (n0 + n1 + n2).normalize_or_zero();
            if geometric == Vec3::ZERO || vertex == Vec3::ZERO {
                continue;
            }
            let dot = geometric.dot(vertex);
            worst_dot = worst_dot.min(dot);
            checked += 1;
            assert!(
                dot > 0.0,
                "transition triangle {triangle_index} has geometric normal opposite vertex normal: dot={dot}, source={source:?}"
            );
        }

        assert!(
            checked > 0,
            "fixture did not emit PosY transition triangles"
        );
        assert!(
            worst_dot > 0.0,
            "all checked PosY transition triangles should align, worst dot={worst_dot}"
        );
    }

    #[test]
    fn regular_lod1_triangle_winding_matches_vertex_normals() {
        use crate::voxel::chunk::LodLevel;

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
            forensics: MeshForensicsOptions {
                enabled: true,
                ..Default::default()
            },
        });
        let mesh = &out.result.solid;
        let sources = out
            .result
            .mc_triangle_sources
            .as_ref()
            .expect("forensics-enabled MC mesh should carry triangle sources");
        let mut checked = 0usize;
        let mut worst_dot = 1.0f32;

        for (triangle_index, source) in sources.sources.iter().enumerate() {
            if !matches!(source, McTriangleSource::Regular { .. }) {
                continue;
            }
            let indices = &mesh.indices[triangle_index * 3..triangle_index * 3 + 3];
            let p0 = Vec3::from_array(mesh.positions[indices[0] as usize]);
            let p1 = Vec3::from_array(mesh.positions[indices[1] as usize]);
            let p2 = Vec3::from_array(mesh.positions[indices[2] as usize]);
            let n0 = Vec3::from_array(mesh.normals[indices[0] as usize]);
            let n1 = Vec3::from_array(mesh.normals[indices[1] as usize]);
            let n2 = Vec3::from_array(mesh.normals[indices[2] as usize]);
            let geometric = (p1 - p0).cross(p2 - p0).normalize_or_zero();
            let vertex = (n0 + n1 + n2).normalize_or_zero();
            if geometric == Vec3::ZERO || vertex == Vec3::ZERO {
                continue;
            }
            let dot = geometric.dot(vertex);
            worst_dot = worst_dot.min(dot);
            checked += 1;
            assert!(
                dot > 0.0,
                "regular triangle {triangle_index} has geometric normal opposite vertex normal: dot={dot}, source={source:?}"
            );
        }

        assert!(checked > 0, "fixture did not emit regular Lod1 triangles");
        assert!(
            worst_dot > 0.0,
            "all checked regular Lod1 triangles should align, worst dot={worst_dot}"
        );
    }

    #[test]
    fn regular_case3_table_uses_expected_lengyel_edges() {
        let class = REGULAR_CELL_CLASS[3];
        let tri_data = REGULAR_CELL_DATA[class as usize];
        let vert_data = REGULAR_VERTEX_DATA[3];
        let edges: Vec<[usize; 2]> = (0..tri_data.get_vertex_count() as usize)
            .map(|i| {
                let vd = RegularVertexData(vert_data[i]);
                let mut edge = [vd.corner_a(), vd.corner_b()];
                edge.sort_unstable();
                edge
            })
            .collect();

        assert_eq!(class, 3);
        assert_eq!(tri_data.get_triangle_count(), 2);
        assert_eq!(edges, vec![[0, 2], [0, 4], [1, 5], [1, 3]]);
        assert_eq!(&tri_data.vertex_index[..6], &[0, 1, 2, 0, 2, 3]);
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
            forensics: MeshForensicsOptions::default(),
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
