//! Transvoxel transition-cell extraction for 2:1 LOD boundaries (all six faces).
//!
//! Transition cells replace the outermost regular-MC cell row on faces where the
//! neighbor LOD index is exactly `my_lod_index + 1` (coarser neighbor).

use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::meshing::{McTriangleSource, MeshData};
use crate::voxel::skirt::ChunkFace;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

use super::face_mask::TransvoxelFaceMask;
use super::mc::{SdfGrid, push_mc_triangle};
use super::stats::McTransvoxelStats;
use super::tables::{TRANSITION_CELL_CLASS, TRANSITION_CELL_DATA, TRANSITION_VERTEX_DATA};

#[derive(Copy, Clone)]
struct TransitionVertexData(u16);

impl TransitionVertexData {
    fn grid_a(self) -> usize {
        ((self.0 & 0x0F) as usize).min(12)
    }
    fn grid_b(self) -> usize {
        (((self.0 & 0xF0) >> 4) as usize).min(12)
    }
}

#[derive(Clone, Copy)]
struct HighResDelta {
    u: isize,
    v: isize,
}

const HIGH_RES_FACE_GRID: [HighResDelta; 9] = [
    HighResDelta { u: 0, v: 0 },
    HighResDelta { u: 1, v: 0 },
    HighResDelta { u: 2, v: 0 },
    HighResDelta { u: 0, v: 1 },
    HighResDelta { u: 1, v: 1 },
    HighResDelta { u: 2, v: 1 },
    HighResDelta { u: 0, v: 2 },
    HighResDelta { u: 1, v: 2 },
    HighResDelta { u: 2, v: 2 },
];

const HIGH_RES_CASE_BITS: [usize; 9] = [0x01, 0x02, 0x04, 0x80, 0x100, 0x08, 0x40, 0x20, 0x10];

/// Grid-point layout for one transition cell (Lengyel 13-point layout).
#[derive(Clone, Copy)]
enum GridPoint {
    HighRes(HighResDelta),
    LowRes(usize, usize),
}

const TRANSITION_GRID_POINTS: [GridPoint; 13] = [
    GridPoint::HighRes(HighResDelta { u: 0, v: 0 }),
    GridPoint::HighRes(HighResDelta { u: 1, v: 0 }),
    GridPoint::HighRes(HighResDelta { u: 2, v: 0 }),
    GridPoint::HighRes(HighResDelta { u: 0, v: 1 }),
    GridPoint::HighRes(HighResDelta { u: 1, v: 1 }),
    GridPoint::HighRes(HighResDelta { u: 2, v: 1 }),
    GridPoint::HighRes(HighResDelta { u: 0, v: 2 }),
    GridPoint::HighRes(HighResDelta { u: 1, v: 2 }),
    GridPoint::HighRes(HighResDelta { u: 2, v: 2 }),
    GridPoint::LowRes(0, 0),
    GridPoint::LowRes(1, 0),
    GridPoint::LowRes(0, 1),
    GridPoint::LowRes(1, 1),
];

struct FaceFrame {
    /// Regular-grid axis aligned with face normal (into chunk).
    w_axis: u8,
    w_sign: i32,
    /// Tangential axes.
    u_axis: u8,
    u_sign: i32,
    v_axis: u8,
    v_sign: i32,
}

impl FaceFrame {
    fn for_face(face: ChunkFace) -> Self {
        match face {
            ChunkFace::NegX => Self {
                w_axis: 0,
                w_sign: 1,
                u_axis: 2,
                u_sign: -1,
                v_axis: 1,
                v_sign: 1,
            },
            ChunkFace::PosX => Self {
                w_axis: 0,
                w_sign: -1,
                u_axis: 2,
                u_sign: 1,
                v_axis: 1,
                v_sign: 1,
            },
            ChunkFace::NegY => Self {
                w_axis: 1,
                w_sign: 1,
                u_axis: 0,
                u_sign: 1,
                v_axis: 2,
                v_sign: -1,
            },
            ChunkFace::PosY => Self {
                w_axis: 1,
                w_sign: -1,
                u_axis: 0,
                u_sign: 1,
                v_axis: 2,
                v_sign: 1,
            },
            ChunkFace::NegZ => Self {
                w_axis: 2,
                w_sign: 1,
                u_axis: 0,
                u_sign: 1,
                v_axis: 1,
                v_sign: 1,
            },
            ChunkFace::PosZ => Self {
                w_axis: 2,
                w_sign: -1,
                u_axis: 0,
                u_sign: -1,
                v_axis: 1,
                v_sign: 1,
            },
        }
    }

    fn tangent_grid_coord(subdivisions: usize, cell: usize, delta: usize, sign: i32) -> usize {
        if sign >= 0 {
            1 + cell * 2 + delta
        } else {
            subdivisions + 1 - (cell * 2 + delta)
        }
    }

    fn transition_cell_for_regular_axis(
        subdivisions: usize,
        regular_axis_cell: usize,
        sign: i32,
    ) -> usize {
        let transition_cells = subdivisions / 2;
        if transition_cells == 0 {
            return 0;
        }
        if sign >= 0 {
            (regular_axis_cell / 2).min(transition_cells - 1)
        } else {
            (subdivisions
                .saturating_sub(1)
                .saturating_sub(regular_axis_cell)
                / 2)
            .min(transition_cells - 1)
        }
    }

    fn grid_coords(
        &self,
        subdivisions: usize,
        cell_u: usize,
        cell_v: usize,
        point: GridPoint,
    ) -> [usize; 3] {
        // The transition cell fills the chunk's outermost boundary cell row —
        // exactly the row that `skip_regular_on_face` skips in the regular MC
        // pass. Its high-res case plane lies one cell into the chunk; its
        // low-res plane lies on the outer boundary, so the cell spans the same
        // padded W interval as the skipped regular cell.
        //
        // Regular chunk cells use padded corners [1..=subdivisions+1].
        // The 9 high-res case samples sit on the inner side of the skipped
        // boundary row; the 4 low-res samples sit on the outer boundary side.
        let (high_w, low_w) = if self.w_sign > 0 {
            (2usize, 1usize)
        } else {
            (subdivisions, subdivisions + 1)
        };
        let mut coords = [0usize; 3];
        match point {
            GridPoint::HighRes(delta) => {
                // 3x3 high-res sub-grid within the cell.
                coords[self.w_axis as usize] = high_w;
                coords[self.u_axis as usize] =
                    Self::tangent_grid_coord(subdivisions, cell_u, delta.u as usize, self.u_sign);
                coords[self.v_axis as usize] =
                    Self::tangent_grid_coord(subdivisions, cell_v, delta.v as usize, self.v_sign);
            }
            GridPoint::LowRes(fu, fv) => {
                // 4 low-res corners coincide with the 4 corners of the same 3x3
                // sub-grid in world space, so they share U/V positions with the
                // high-res corners (0,0), (2,0), (0,2), (2,2). The * 2 multiplier
                // was missing in the prior version, putting low-res corners at
                // wrong world positions inside earlier cells.
                coords[self.w_axis as usize] = low_w;
                coords[self.u_axis as usize] =
                    Self::tangent_grid_coord(subdivisions, cell_u, fu * 2, self.u_sign);
                coords[self.v_axis as usize] =
                    Self::tangent_grid_coord(subdivisions, cell_v, fv * 2, self.v_sign);
            }
        }
        coords
    }

    fn transition_cell_for_regular_cell(
        &self,
        subdivisions: usize,
        regular_cell: [usize; 3],
    ) -> (usize, usize) {
        (
            Self::transition_cell_for_regular_axis(
                subdivisions,
                regular_cell[self.u_axis as usize],
                self.u_sign,
            ),
            Self::transition_cell_for_regular_axis(
                subdivisions,
                regular_cell[self.v_axis as usize],
                self.v_sign,
            ),
        )
    }
}

pub fn append_transition_meshes(
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
    for (face_index, face) in ChunkFace::ALL.iter().enumerate() {
        if !transition_mask.get(*face) {
            continue;
        }
        let frame = FaceFrame::for_face(*face);
        let mut face_tris = 0u32;
        let transition_cells = subdivisions / 2;
        for cell_v in 0..transition_cells {
            for cell_u in 0..transition_cells {
                face_tris += extract_transition_cell(
                    sdf,
                    mesh,
                    chunk,
                    world,
                    chunk_origin,
                    chunk_center,
                    subdivisions,
                    &frame,
                    cell_u,
                    cell_v,
                    *face,
                    lod,
                    triangle_sources,
                );
            }
        }
        stats.record_transition_face(face_index, face_tris);
    }
}

fn extract_transition_cell(
    sdf: &SdfGrid,
    mesh: &mut MeshData,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    subdivisions: usize,
    frame: &FaceFrame,
    cell_u: usize,
    cell_v: usize,
    face: ChunkFace,
    lod: LodLevel,
    triangle_sources: &mut Option<Vec<McTriangleSource>>,
) -> u32 {
    let case = transition_case_index(sdf, subdivisions, frame, cell_u, cell_v);
    // Only 0 and 0x1FF (all 9 corners) emit no transition triangles. A prior
    // `solid_corners <= 1 || >= 8` filter was added as a defence against
    // unclamped-smoothed-SDF shatter, mirroring the same bug in
    // `extract_regular_mc`. It dropped every transition cell where the iso
    // clipped one corner — precisely the topology that occurs along the
    // LOD0↔LOD1 apron on any sloped surface — producing irregular dark holes
    // at the LOD transition. The SDF sign-guard now keeps air corners > 0,
    // so the defensive filter has no purpose and must be removed.
    if case == 0 || case == 0x1FF {
        return 0;
    }

    let raw_class = TRANSITION_CELL_CLASS[case];
    let class = raw_class & 0x7F;
    let invert = (raw_class & 0x80) != 0;
    let tri_data = TRANSITION_CELL_DATA[class as usize];
    let tri_count = tri_data.get_triangle_count() as usize;
    let vert_data = TRANSITION_VERTEX_DATA[case];
    let mut cell_vertices: [Option<Vec3>; 12] = [None; 12];

    for vi in 0..tri_data.get_vertex_count() as usize {
        let vd = TransitionVertexData(vert_data[vi]);
        let ga = TRANSITION_GRID_POINTS[vd.grid_a()];
        let gb = TRANSITION_GRID_POINTS[vd.grid_b()];
        let a = frame.grid_coords(subdivisions, cell_u, cell_v, ga);
        let b = frame.grid_coords(subdivisions, cell_u, cell_v, gb);
        cell_vertices[vi] = Some(sdf.interpolate_edge(a, b));
    }

    let mut emitted = 0u32;
    for t in 0..tri_count {
        let i0 = tri_data.vertex_index[t * 3] as usize;
        let i1 = tri_data.vertex_index[t * 3 + 1] as usize;
        let i2 = tri_data.vertex_index[t * 3 + 2] as usize;
        let Some(p0) = cell_vertices[i0] else {
            continue;
        };
        let Some(mut p1) = cell_vertices[i1] else {
            continue;
        };
        let Some(mut p2) = cell_vertices[i2] else {
            continue;
        };
        if !invert {
            std::mem::swap(&mut p1, &mut p2);
        }
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
            sources.push(McTriangleSource::Transition {
                chunk_pos: chunk.position(),
                lod,
                face,
                cell_u: cell_u as u16,
                cell_v: cell_v as u16,
                case_index: case as u16,
                class_index: class,
                invert,
            });
        }
        emitted += 1;
    }
    emitted
}

pub(super) fn transition_triangle_count_for_regular_cell(
    sdf: &SdfGrid,
    subdivisions: usize,
    face: ChunkFace,
    regular_cell: [usize; 3],
) -> usize {
    transition_case_triangle_count(transition_case_for_regular_cell(
        sdf,
        subdivisions,
        face,
        regular_cell,
    ))
}

pub(super) fn transition_case_for_regular_cell(
    sdf: &SdfGrid,
    subdivisions: usize,
    face: ChunkFace,
    regular_cell: [usize; 3],
) -> usize {
    if subdivisions / 2 == 0 {
        return 0;
    }
    let frame = FaceFrame::for_face(face);
    let (cell_u, cell_v) = frame.transition_cell_for_regular_cell(subdivisions, regular_cell);
    transition_case_index(sdf, subdivisions, &frame, cell_u, cell_v)
}

fn transition_case_index(
    sdf: &SdfGrid,
    subdivisions: usize,
    frame: &FaceFrame,
    cell_u: usize,
    cell_v: usize,
) -> usize {
    let mut case = 0usize;
    for (i, delta) in HIGH_RES_FACE_GRID.iter().enumerate() {
        let coords = frame.grid_coords(subdivisions, cell_u, cell_v, GridPoint::HighRes(*delta));
        if sdf.get(coords[0], coords[1], coords[2]) < 0.0 {
            case |= HIGH_RES_CASE_BITS[i];
        }
    }
    case
}

fn transition_case_triangle_count(case: usize) -> usize {
    if case == 0 || case == 0x1FF {
        return 0;
    }
    let raw_class = TRANSITION_CELL_CLASS[case];
    let class = raw_class & 0x7F;
    TRANSITION_CELL_DATA[class as usize].get_triangle_count() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUBDIVISIONS: usize = 16; // LOD0 chunk subdivisions; padded grid is 18.

    /// PosY HighRes plane sits one cell into the chunk at padded index
    /// `subdivisions`, LowRes sits at the outer boundary `subdivisions + 1`.
    /// Together they span the boundary
    /// cell row that `skip_regular_on_face` skips in regular MC, with no gap.
    #[test]
    fn pos_y_transition_fills_skipped_boundary_row() {
        let frame = FaceFrame::for_face(ChunkFace::PosY);

        let hi = frame.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 0, v: 0 }),
        );
        let lo = frame.grid_coords(SUBDIVISIONS, 0, 0, GridPoint::LowRes(0, 0));

        // W = y axis, one cell in (16) for HighRes and boundary (17) for
        // LowRes. Together they span padded y [16, 17].
        assert_eq!(
            hi[1], SUBDIVISIONS,
            "PosY HighRes plane is one cell into the chunk"
        );
        assert_eq!(lo[1], SUBDIVISIONS + 1, "PosY LowRes is the outer boundary");
        assert_eq!(
            lo[1] - hi[1],
            1,
            "transition cell is exactly one W cell thick"
        );
    }

    /// NegY mirrors PosY: HighRes at padded index 2, LowRes at boundary 1.
    /// Before the fix this branch put HighRes at `subdivisions - 1 = 15`,
    /// which placed NegY transitions on the *opposite* end of the chunk.
    #[test]
    fn neg_y_transition_fills_skipped_boundary_row() {
        let frame = FaceFrame::for_face(ChunkFace::NegY);

        let hi = frame.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 0, v: 0 }),
        );
        let lo = frame.grid_coords(SUBDIVISIONS, 0, 0, GridPoint::LowRes(0, 0));

        assert_eq!(
            hi[1], 2,
            "NegY HighRes plane is one cell into the chunk at padded y=2"
        );
        assert_eq!(lo[1], 1, "NegY LowRes is the outer boundary at padded y=1");
        assert_eq!(
            hi[1] - lo[1],
            1,
            "transition cell is exactly one W cell thick"
        );
    }

    /// Each transition cell covers a 2x2 high-res sub-cell area. The four
    /// LowRes corners must coincide in world position with HighRes corners
    /// (0,0), (2,0), (0,2), (2,2) of the same cell. The pre-fix code wrote
    /// `cell_u + fu` (no * 2), which mapped LowRes corners to wrong positions
    /// inside earlier cells.
    #[test]
    fn low_res_corners_coincide_with_high_res_corners() {
        let frame = FaceFrame::for_face(ChunkFace::PosY);
        let cell_u = 3;
        let cell_v = 5;

        let pairs = [
            ((0u8, 0u8), (HighResDelta { u: 0, v: 0 })),
            ((1, 0), (HighResDelta { u: 2, v: 0 })),
            ((0, 1), (HighResDelta { u: 0, v: 2 })),
            ((1, 1), (HighResDelta { u: 2, v: 2 })),
        ];
        for ((fu, fv), hr_delta) in pairs {
            let lo = frame.grid_coords(
                SUBDIVISIONS,
                cell_u,
                cell_v,
                GridPoint::LowRes(fu as usize, fv as usize),
            );
            let hi = frame.grid_coords(SUBDIVISIONS, cell_u, cell_v, GridPoint::HighRes(hr_delta));
            // u_axis = 0, v_axis = 2 for PosY: LowRes and HighRes corner must
            // share U and V (only W differs).
            assert_eq!(lo[0], hi[0], "U mismatch for LowRes({fu},{fv})");
            assert_eq!(lo[2], hi[2], "V mismatch for LowRes({fu},{fv})");
        }
    }

    #[test]
    fn face_frames_match_transvoxel_tangent_orientation() {
        let pos_z = FaceFrame::for_face(ChunkFace::PosZ);
        let pos_z_u0 = pos_z.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 0, v: 0 }),
        );
        let pos_z_u2 = pos_z.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 2, v: 0 }),
        );
        assert!(pos_z_u0[0] > pos_z_u2[0], "HighZ/PosZ U must run toward -X");

        let neg_x = FaceFrame::for_face(ChunkFace::NegX);
        let neg_x_u0 = neg_x.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 0, v: 0 }),
        );
        let neg_x_u2 = neg_x.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 2, v: 0 }),
        );
        assert!(neg_x_u0[2] > neg_x_u2[2], "LowX/NegX U must run toward -Z");

        let neg_y = FaceFrame::for_face(ChunkFace::NegY);
        let neg_y_v0 = neg_y.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 0, v: 0 }),
        );
        let neg_y_v2 = neg_y.grid_coords(
            SUBDIVISIONS,
            0,
            0,
            GridPoint::HighRes(HighResDelta { u: 0, v: 2 }),
        );
        assert!(neg_y_v0[2] > neg_y_v2[2], "LowY/NegY V must run toward -Z");
    }

    #[test]
    fn transition_cell_mapping_respects_reversed_tangent_axes() {
        let pos_z = FaceFrame::for_face(ChunkFace::PosZ);
        assert_eq!(
            pos_z.transition_cell_for_regular_cell(SUBDIVISIONS, [10, 7, 15]),
            (2, 3),
            "PosZ regular cell x=10 should map to reversed-U transition cell 2"
        );

        let neg_x = FaceFrame::for_face(ChunkFace::NegX);
        assert_eq!(
            neg_x.transition_cell_for_regular_cell(SUBDIVISIONS, [0, 7, 10]),
            (2, 3),
            "NegX regular cell z=10 should map to reversed-U transition cell 2"
        );

        let neg_y = FaceFrame::for_face(ChunkFace::NegY);
        assert_eq!(
            neg_y.transition_cell_for_regular_cell(SUBDIVISIONS, [10, 0, 7]),
            (5, 4),
            "NegY regular cell z=7 should map to reversed-V transition cell 4"
        );
    }

    /// All face frames must keep grid coordinates within the padded grid
    /// [0..=subdivisions+1] for every transition cell index they'll be called
    /// with (cell_u, cell_v in [0..subdivisions/2)). Catches off-by-one bugs
    /// that would re-introduce the original OOB panic.
    #[test]
    fn grid_coords_stay_within_padded_bounds_for_all_faces() {
        let transition_cells = SUBDIVISIONS / 2;
        let padded = SUBDIVISIONS + 2; // 18 for LOD0

        for face in ChunkFace::ALL.iter().copied() {
            let frame = FaceFrame::for_face(face);
            for cell_v in 0..transition_cells {
                for cell_u in 0..transition_cells {
                    for grid_point in TRANSITION_GRID_POINTS.iter().copied() {
                        let c = frame.grid_coords(SUBDIVISIONS, cell_u, cell_v, grid_point);
                        for (axis, value) in c.iter().enumerate() {
                            assert!(
                                *value < padded,
                                "face {face:?} cell ({cell_u},{cell_v}) axis {axis} \
                                 produced grid index {value} >= padded {padded}"
                            );
                        }
                    }
                }
            }
        }
    }
}
