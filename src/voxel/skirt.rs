use crate::constants::VOXEL_SIZE;
use crate::voxel::chunk::LodLevel;
use bevy::prelude::{Resource, Vec3};
use std::collections::HashMap;

/// Flags indicating which chunk faces a vertex touches.
#[derive(Clone, Copy, Default)]
pub struct BoundaryFlags {
    pub neg_x: bool,
    pub pos_x: bool,
    pub neg_y: bool,
    pub pos_y: bool,
    pub neg_z: bool,
    pub pos_z: bool,
}

impl BoundaryFlags {
    pub fn is_boundary(&self) -> bool {
        self.neg_x || self.pos_x || self.neg_y || self.pos_y || self.neg_z || self.pos_z
    }

    pub fn on_face(&self, face: ChunkFace) -> bool {
        match face {
            ChunkFace::NegX => self.neg_x,
            ChunkFace::PosX => self.pos_x,
            ChunkFace::NegZ => self.neg_z,
            ChunkFace::PosZ => self.pos_z,
            ChunkFace::NegY => self.neg_y,
            ChunkFace::PosY => self.pos_y,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum ChunkFace {
    NegX = 0,
    PosX = 1,
    NegY = 2,
    PosY = 3,
    NegZ = 4,
    PosZ = 5,
}

impl ChunkFace {
    /// All six faces in index order.
    pub const ALL: [ChunkFace; 6] = [
        ChunkFace::NegX,
        ChunkFace::PosX,
        ChunkFace::NegY,
        ChunkFace::PosY,
        ChunkFace::NegZ,
        ChunkFace::PosZ,
    ];

    /// Returns the opposite face.
    #[inline]
    pub fn opposite(self) -> ChunkFace {
        match self {
            ChunkFace::NegX => ChunkFace::PosX,
            ChunkFace::PosX => ChunkFace::NegX,
            ChunkFace::NegY => ChunkFace::PosY,
            ChunkFace::PosY => ChunkFace::NegY,
            ChunkFace::NegZ => ChunkFace::PosZ,
            ChunkFace::PosZ => ChunkFace::NegZ,
        }
    }

    /// Returns the direction vector for this face (pointing outward).
    #[inline]
    pub fn direction(self) -> bevy::prelude::IVec3 {
        match self {
            ChunkFace::NegX => bevy::prelude::IVec3::NEG_X,
            ChunkFace::PosX => bevy::prelude::IVec3::X,
            ChunkFace::NegY => bevy::prelude::IVec3::NEG_Y,
            ChunkFace::PosY => bevy::prelude::IVec3::Y,
            ChunkFace::NegZ => bevy::prelude::IVec3::NEG_Z,
            ChunkFace::PosZ => bevy::prelude::IVec3::Z,
        }
    }
}

/// Determine boundary flags for a vertex position in chunk-local voxel units.
pub fn compute_boundary_flags(local_pos: Vec3, chunk_size: f32) -> BoundaryFlags {
    const EPSILON: f32 = 0.01;

    BoundaryFlags {
        neg_x: local_pos.x <= EPSILON,
        pos_x: local_pos.x >= chunk_size - EPSILON,
        neg_y: local_pos.y <= EPSILON,
        pos_y: local_pos.y >= chunk_size - EPSILON,
        neg_z: local_pos.z <= EPSILON,
        pos_z: local_pos.z >= chunk_size - EPSILON,
    }
}

/// An edge on the chunk boundary that needs a skirt.
#[derive(Clone)]
pub struct BoundaryEdge {
    pub v0_pos: Vec3,
    pub v1_pos: Vec3,
    pub v0_normal: Vec3,
    pub v1_normal: Vec3,
    pub v0_weights: [f32; 4],
    pub v1_weights: [f32; 4],
    pub face: ChunkFace,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct QuantizedPos {
    x: i32,
    y: i32,
    z: i32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct EdgeKey {
    a: QuantizedPos,
    b: QuantizedPos,
    face: ChunkFace,
}

const EDGE_QUANTIZE_SCALE: f32 = 10000.0;

fn quantize_pos(pos: Vec3) -> QuantizedPos {
    QuantizedPos {
        x: (pos.x * EDGE_QUANTIZE_SCALE).round() as i32,
        y: (pos.y * EDGE_QUANTIZE_SCALE).round() as i32,
        z: (pos.z * EDGE_QUANTIZE_SCALE).round() as i32,
    }
}

fn ordered_edge(a: QuantizedPos, b: QuantizedPos) -> (QuantizedPos, QuantizedPos) {
    if (a.x, a.y, a.z) <= (b.x, b.y, b.z) {
        (a, b)
    } else {
        (b, a)
    }
}

/// Extract boundary edges from mesh triangles using local positions to detect faces.
pub fn extract_boundary_edges(
    local_positions: &[Vec3],
    positions: &[[f32; 3]],
    normals: &[[f32; 3]],
    indices: &[u32],
    material_weights: &[[f32; 4]],
    chunk_size: f32,
) -> Vec<BoundaryEdge> {
    let mut boundary_edges: Vec<BoundaryEdge> = Vec::new();
    let mut edge_indices: HashMap<EdgeKey, usize> = HashMap::new();
    let mut edge_counts: Vec<u8> = Vec::new();

    for tri in indices.chunks(3) {
        if tri.len() < 3 {
            continue;
        }

        let edges = [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])];

        for (i0, i1) in edges {
            let i0 = i0 as usize;
            let i1 = i1 as usize;

            if i0 >= local_positions.len() || i1 >= local_positions.len() {
                continue;
            }

            let local0 = local_positions[i0];
            let local1 = local_positions[i1];

            let flags0 = compute_boundary_flags(local0, chunk_size);
            let flags1 = compute_boundary_flags(local1, chunk_size);

            for face in ChunkFace::ALL {
                if !flags0.on_face(face) || !flags1.on_face(face) {
                    continue;
                }

                let q0 = quantize_pos(local0);
                let q1 = quantize_pos(local1);
                let (a, b) = ordered_edge(q0, q1);
                let key = EdgeKey { a, b, face };

                if let Some(edge_index) = edge_indices.get(&key).copied() {
                    edge_counts[edge_index] = edge_counts[edge_index].saturating_add(1);
                    continue;
                }

                let v0_pos = Vec3::from_array(positions.get(i0).copied().unwrap_or([0.0; 3]));
                let v1_pos = Vec3::from_array(positions.get(i1).copied().unwrap_or([0.0; 3]));
                let v0_normal =
                    Vec3::from_array(normals.get(i0).copied().unwrap_or([0.0, 1.0, 0.0]));
                let v1_normal =
                    Vec3::from_array(normals.get(i1).copied().unwrap_or([0.0, 1.0, 0.0]));
                let v0_weights = *material_weights.get(i0).unwrap_or(&[0.0, 0.0, 0.0, 1.0]);
                let v1_weights = *material_weights.get(i1).unwrap_or(&[0.0, 0.0, 0.0, 1.0]);

                let edge_index = boundary_edges.len();
                boundary_edges.push(BoundaryEdge {
                    v0_pos,
                    v1_pos,
                    v0_normal,
                    v1_normal,
                    v0_weights,
                    v1_weights,
                    face,
                });
                edge_indices.insert(key, edge_index);
                edge_counts.push(1);
            }
        }
    }

    boundary_edges
        .into_iter()
        .zip(edge_counts)
        .filter_map(|(edge, count)| (count == 1).then_some(edge))
        .collect()
}

/// Configuration for skirt generation.
#[derive(Resource, Clone)]
pub struct SkirtConfig {
    /// How far down skirts extend (in world units).
    pub depth: f32,
    /// Only generate skirts toward lower-LOD neighbors.
    pub adaptive: bool,
}

impl Default for SkirtConfig {
    fn default() -> Self {
        Self {
            // Increased from 0.5 to 1.5 to better hide LOD transitions.
            // LOD1 uses step size 2, so vertices can be up to 1 voxel off from LOD0.
            // A depth of 1.5 ensures the skirt extends far enough to cover the gap.
            depth: VOXEL_SIZE * 1.5,
            adaptive: true,
        }
    }
}

/// Neighbor LOD information for adaptive skirts.
#[derive(Clone, Copy, Debug, Default)]
pub struct NeighborLods {
    pub neg_x: Option<LodLevel>,
    pub pos_x: Option<LodLevel>,
    pub neg_y: Option<LodLevel>,
    pub pos_y: Option<LodLevel>,
    pub neg_z: Option<LodLevel>,
    pub pos_z: Option<LodLevel>,
}

impl NeighborLods {
    fn lod_for_face(&self, face: ChunkFace) -> Option<LodLevel> {
        match face {
            ChunkFace::NegX => self.neg_x,
            ChunkFace::PosX => self.pos_x,
            ChunkFace::NegY => self.neg_y,
            ChunkFace::PosY => self.pos_y,
            ChunkFace::NegZ => self.neg_z,
            ChunkFace::PosZ => self.pos_z,
        }
    }

    pub fn needs_vertical_skirt(&self, face: ChunkFace, my_lod: LodLevel) -> bool {
        if matches!(face, ChunkFace::NegY | ChunkFace::PosY) {
            return false;
        }

        self.lod_for_face(face)
            .is_some_and(|n_lod| n_lod.is_lower_detail_than(my_lod))
    }

    pub fn needs_transition_apron(&self, face: ChunkFace, my_lod: LodLevel) -> bool {
        if matches!(face, ChunkFace::NegY | ChunkFace::PosY) {
            return false;
        }

        self.lod_for_face(face)
            .is_some_and(|n_lod| n_lod.is_lower_detail_than(my_lod))
    }
}

fn edge_supports_transition_lip(edge: &BoundaryEdge) -> bool {
    let avg_up = (edge.v0_normal.y + edge.v1_normal.y) * 0.5;
    let min_up = edge.v0_normal.y.min(edge.v1_normal.y);
    avg_up > 0.35 || min_up > 0.15
}

fn upward_biased_normal(normal: Vec3) -> Vec3 {
    (normal * 0.2 + Vec3::Y * 0.8).normalize_or_zero()
}

fn push_boundary_quad_indices(indices: &mut Vec<u32>, face: ChunkFace, base_idx: u32) {
    match face {
        ChunkFace::NegX | ChunkFace::PosZ | ChunkFace::NegY => {
            indices.extend_from_slice(&[
                base_idx,
                base_idx + 2,
                base_idx + 1,
                base_idx + 1,
                base_idx + 2,
                base_idx + 3,
            ]);
        }
        ChunkFace::PosX | ChunkFace::NegZ | ChunkFace::PosY => {
            indices.extend_from_slice(&[
                base_idx,
                base_idx + 1,
                base_idx + 2,
                base_idx + 1,
                base_idx + 3,
                base_idx + 2,
            ]);
        }
    }
}

fn push_quad_barycentrics(barycentric_uvs: &mut Vec<[f32; 2]>) {
    barycentric_uvs.extend_from_slice(&[[1.0, 0.0], [0.0, 1.0], [0.0, 0.0], [0.0, 1.0]]);
}

/// Generate skirt geometry and append to existing mesh data.
pub fn generate_skirts(
    positions: &mut Vec<[f32; 3]>,
    normals: &mut Vec<[f32; 3]>,
    uvs: &mut Vec<[f32; 2]>,
    barycentric_uvs: &mut Vec<[f32; 2]>,
    material_weights: &mut Vec<[f32; 4]>,
    indices: &mut Vec<u32>,
    boundary_edges: &[BoundaryEdge],
    config: &SkirtConfig,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) {
    if config.depth <= 0.0 {
        return;
    }

    for edge in boundary_edges {
        // Keep Y-face neighbor LODs for dirtying/debugging, but do not patch
        // terrain altitude slices with world-down skirt geometry.
        if matches!(edge.face, ChunkFace::NegY | ChunkFace::PosY) {
            continue;
        }

        let has_lower_lod_neighbor = neighbor_lods
            .lod_for_face(edge.face)
            .is_some_and(|lod| lod.is_lower_detail_than(my_lod));
        let supports_transition_lip = has_lower_lod_neighbor && edge_supports_transition_lip(edge);
        let needs_lip = !config.adaptive || neighbor_lods.needs_transition_apron(edge.face, my_lod);
        let needs_vertical_candidate =
            !config.adaptive || neighbor_lods.needs_vertical_skirt(edge.face, my_lod);
        let needs_vertical = needs_vertical_candidate;
        let emit_lip = needs_lip && supports_transition_lip;
        if !emit_lip && !needs_vertical {
            continue;
        }

        let skirt_normal = match edge.face {
            ChunkFace::NegX => Vec3::NEG_X,
            ChunkFace::PosX => Vec3::X,
            ChunkFace::NegY => Vec3::NEG_Y,
            ChunkFace::PosY => Vec3::Y,
            ChunkFace::NegZ => Vec3::NEG_Z,
            ChunkFace::PosZ => Vec3::Z,
        };

        let base_idx = positions.len() as u32;
        // Scale skirt depth with the LOD difference so a Lod0/Lod1 transition gets a
        // deeper drop than the same-LOD baseline. step is the coarser side's step.
        let transition_depth = neighbor_lods
            .lod_for_face(edge.face)
            .map(|neighbor_lod| {
                let step = neighbor_lod.step_size().max(my_lod.step_size()).max(1) as f32;
                config.depth.max(step * VOXEL_SIZE * 2.0)
            })
            .unwrap_or(config.depth);
        let drop = Vec3::new(0.0, -transition_depth, 0.0);
        let lip_width = if emit_lip {
            neighbor_lods
                .lod_for_face(edge.face)
                .map(|lod| {
                    let step = lod.step_size().max(my_lod.step_size()).max(1) as f32;
                    (step * VOXEL_SIZE * 0.08).clamp(VOXEL_SIZE * 0.08, VOXEL_SIZE * 0.30)
                })
                .unwrap_or(VOXEL_SIZE * 0.08)
        } else {
            0.0
        };
        let lip_drop = Vec3::new(0.0, -VOXEL_SIZE * 0.015, 0.0);

        let top0 = edge.v0_pos;
        let top1 = edge.v1_pos;
        let lip0 = top0 + skirt_normal * lip_width + lip_drop;
        let lip1 = top1 + skirt_normal * lip_width + lip_drop;

        let blend_factor = 0.2;
        let blended_normal0 =
            (edge.v0_normal * (1.0 - blend_factor) + skirt_normal * blend_factor).normalize();
        let blended_normal1 =
            (edge.v1_normal * (1.0 - blend_factor) + skirt_normal * blend_factor).normalize();
        let vertical_normal0 = if emit_lip {
            upward_biased_normal(edge.v0_normal)
        } else {
            blended_normal0
        };
        let vertical_normal1 = if emit_lip {
            upward_biased_normal(edge.v1_normal)
        } else {
            blended_normal1
        };

        let (vertical_top0, vertical_top1) = if emit_lip {
            positions.push(top0.to_array());
            normals.push(upward_biased_normal(edge.v0_normal).to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v0_weights);

            positions.push(top1.to_array());
            normals.push(upward_biased_normal(edge.v1_normal).to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v1_weights);

            positions.push(lip0.to_array());
            normals.push(upward_biased_normal(edge.v0_normal).to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v0_weights);

            positions.push(lip1.to_array());
            normals.push(upward_biased_normal(edge.v1_normal).to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v1_weights);

            push_quad_barycentrics(barycentric_uvs);
            push_boundary_quad_indices(indices, edge.face, base_idx);
            (lip0, lip1)
        } else {
            (top0, top1)
        };

        if emit_lip && !needs_vertical {
            continue;
        }

        if !needs_vertical {
            continue;
        }

        let vertical_idx = positions.len() as u32;
        let bot0 = vertical_top0 + drop;
        let bot1 = vertical_top1 + drop;

        positions.push(vertical_top0.to_array());
        normals.push(vertical_normal0.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v0_weights);

        positions.push(vertical_top1.to_array());
        normals.push(vertical_normal1.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v1_weights);

        positions.push(bot0.to_array());
        normals.push(vertical_normal0.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v0_weights);

        positions.push(bot1.to_array());
        normals.push(vertical_normal1.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v1_weights);

        push_quad_barycentrics(barycentric_uvs);
        push_boundary_quad_indices(indices, edge.face, vertical_idx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge_on_pos_x() -> BoundaryEdge {
        BoundaryEdge {
            v0_pos: Vec3::new(16.0, 4.0, 2.0),
            v1_pos: Vec3::new(16.0, 4.5, 6.0),
            v0_normal: Vec3::Y,
            v1_normal: Vec3::Y,
            v0_weights: [1.0, 0.0, 0.0, 0.0],
            v1_weights: [1.0, 0.0, 0.0, 0.0],
            face: ChunkFace::PosX,
        }
    }

    fn side_edge_on_pos_x() -> BoundaryEdge {
        BoundaryEdge {
            v0_pos: Vec3::new(16.0, 4.0, 2.0),
            v1_pos: Vec3::new(16.0, 4.5, 6.0),
            v0_normal: Vec3::X,
            v1_normal: Vec3::X,
            v0_weights: [1.0, 0.0, 0.0, 0.0],
            v1_weights: [1.0, 0.0, 0.0, 0.0],
            face: ChunkFace::PosX,
        }
    }

    #[test]
    fn boundary_extraction_ignores_shared_edges_on_boundary_plane() {
        let local_positions = vec![
            Vec3::new(16.0, 2.0, 4.0),
            Vec3::new(16.0, 3.0, 4.0),
            Vec3::new(16.0, 2.0, 5.0),
            Vec3::new(16.0, 3.0, 4.0),
            Vec3::new(16.0, 3.0, 5.0),
            Vec3::new(16.0, 2.0, 5.0),
        ];
        let positions = local_positions
            .iter()
            .map(|position| position.to_array())
            .collect::<Vec<_>>();
        let normals = vec![[1.0, 0.0, 0.0]; positions.len()];
        let weights = vec![[1.0, 0.0, 0.0, 0.0]; positions.len()];
        let indices = vec![0, 1, 2, 3, 4, 5];

        let edges = extract_boundary_edges(
            &local_positions,
            &positions,
            &normals,
            &indices,
            &weights,
            16.0,
        );

        assert_eq!(
            edges.len(),
            4,
            "the shared diagonal should not receive a visible skirt or transition apron"
        );
    }

    #[test]
    fn lod_transition_adds_narrow_top_lip_without_outward_drop() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            neg_x: None,
            pos_x: Some(LodLevel::Lod1),
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[edge_on_pos_x()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert_eq!(positions.len(), 8);
        assert_eq!(barycentric_uvs.len(), 8);
        assert_eq!(indices.len(), 12);
        assert!(
            positions[2][0] > 16.0 && positions[2][0] <= 16.31,
            "transition lip should cover the boundary without painting a broad patch"
        );
        assert!(
            positions[2][1] < positions[0][1] && positions[3][1] < positions[1][1],
            "transition lip should have a small downward bias to avoid z-fighting"
        );
        assert!(
            normals[4][1] > 0.95 && normals[5][1] > 0.95,
            "transition drop should be lit like nearby top terrain instead of a dark wall"
        );
        assert!(
            (positions[6][0] - positions[4][0]).abs() < 0.001
                && (positions[7][0] - positions[5][0]).abs() < 0.001,
            "transition skirt should drop from the lip instead of stepping farther into the neighbor"
        );
    }

    #[test]
    fn lower_lod_side_edge_uses_only_vertical_skirt() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            neg_x: None,
            pos_x: Some(LodLevel::Lod1),
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[side_edge_on_pos_x()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert_eq!(positions.len(), 4);
        assert_eq!(barycentric_uvs.len(), 4);
        assert_eq!(indices.len(), 6);
        assert!(
            positions
                .iter()
                .all(|position| (position[0] - 16.0).abs() < 0.001),
            "side edges should not emit horizontal lips over the neighbor terrain"
        );
    }

    #[test]
    fn same_lod_neighbor_keeps_adaptive_skirt_disabled() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            neg_x: None,
            pos_x: Some(LodLevel::Lod0),
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[edge_on_pos_x()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert!(positions.is_empty());
        assert!(barycentric_uvs.is_empty());
        assert!(indices.is_empty());
    }

    #[test]
    fn unknown_neighbor_keeps_adaptive_skirt_disabled() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            neg_x: None,
            pos_x: None,
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[edge_on_pos_x()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert!(positions.is_empty());
        assert!(barycentric_uvs.is_empty());
        assert!(indices.is_empty());
    }

    #[test]
    fn lod_transition_skirt_drop_scales_with_neighbor_step() {
        // Lod0 chunk facing a Lod1 neighbour: drop must be at least
        // step(2) * VOXEL_SIZE(1) * 2 = 4.0 voxels, NOT the baseline 1.5.
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            neg_x: None,
            pos_x: Some(LodLevel::Lod1),
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[side_edge_on_pos_x()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        // Vertical-only skirt: 4 vertices = top0, top1, bot0, bot1.
        assert_eq!(positions.len(), 4);
        let drop_v0 = positions[0][1] - positions[2][1];
        let drop_v1 = positions[1][1] - positions[3][1];
        assert!(
            (drop_v0 - 4.0).abs() < 1e-4,
            "expected Lod0/Lod1 transition drop = 4.0, got {drop_v0}"
        );
        assert!(
            (drop_v1 - 4.0).abs() < 1e-4,
            "expected Lod0/Lod1 transition drop = 4.0, got {drop_v1}"
        );
    }

    #[test]
    fn lower_lod_vertical_neighbor_does_not_generate_skirt() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let edge = BoundaryEdge {
            v0_pos: Vec3::new(4.0, 16.0, 2.0),
            v1_pos: Vec3::new(8.0, 16.0, 2.0),
            v0_normal: Vec3::Y,
            v1_normal: Vec3::Y,
            v0_weights: [1.0, 0.0, 0.0, 0.0],
            v1_weights: [1.0, 0.0, 0.0, 0.0],
            face: ChunkFace::PosY,
        };
        let neighbor_lods = NeighborLods {
            neg_x: None,
            pos_x: None,
            neg_y: None,
            pos_y: Some(LodLevel::Lod2),
            neg_z: None,
            pos_z: None,
        };

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[edge],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert!(positions.is_empty());
        assert!(barycentric_uvs.is_empty());
        assert!(indices.is_empty());
    }
}
