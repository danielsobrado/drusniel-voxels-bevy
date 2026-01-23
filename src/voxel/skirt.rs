use crate::constants::VOXEL_SIZE;
use crate::voxel::chunk::LodLevel;
use bevy::prelude::{Resource, Vec3};
use std::collections::HashSet;

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
        self.neg_x || self.pos_x || self.neg_z || self.pos_z
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
    let mut edge_set: HashSet<EdgeKey> = HashSet::new();

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

            for face in [
                ChunkFace::NegX,
                ChunkFace::PosX,
                ChunkFace::NegZ,
                ChunkFace::PosZ,
            ] {
                if !flags0.on_face(face) || !flags1.on_face(face) {
                    continue;
                }

                let q0 = quantize_pos(local0);
                let q1 = quantize_pos(local1);
                let (a, b) = ordered_edge(q0, q1);
                let key = EdgeKey { a, b, face };

                if !edge_set.insert(key) {
                    continue;
                }

                let v0_pos = Vec3::from_array(positions.get(i0).copied().unwrap_or([0.0; 3]));
                let v1_pos = Vec3::from_array(positions.get(i1).copied().unwrap_or([0.0; 3]));
                let v0_normal = Vec3::from_array(normals.get(i0).copied().unwrap_or([0.0, 1.0, 0.0]));
                let v1_normal = Vec3::from_array(normals.get(i1).copied().unwrap_or([0.0, 1.0, 0.0]));
                let v0_weights = *material_weights.get(i0).unwrap_or(&[0.0, 0.0, 0.0, 1.0]);
                let v1_weights = *material_weights.get(i1).unwrap_or(&[0.0, 0.0, 0.0, 1.0]);

                boundary_edges.push(BoundaryEdge {
                    v0_pos,
                    v1_pos,
                    v0_normal,
                    v1_normal,
                    v0_weights,
                    v1_weights,
                    face,
                });
            }
        }
    }

    boundary_edges
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
pub struct NeighborLods {
    pub neg_x: Option<LodLevel>,
    pub pos_x: Option<LodLevel>,
    pub neg_z: Option<LodLevel>,
    pub pos_z: Option<LodLevel>,
}

impl NeighborLods {
    pub fn needs_skirt(&self, face: ChunkFace, my_lod: LodLevel) -> bool {
        let neighbor_lod = match face {
            ChunkFace::NegX => self.neg_x,
            ChunkFace::PosX => self.pos_x,
            ChunkFace::NegZ => self.neg_z,
            ChunkFace::PosZ => self.pos_z,
            ChunkFace::NegY | ChunkFace::PosY => None,
        };

        match neighbor_lod {
            Some(n_lod) => n_lod.is_lower_detail_than(my_lod),
            None => true,
        }
    }
}

/// Generate skirt geometry and append to existing mesh data.
pub fn generate_skirts(
    positions: &mut Vec<[f32; 3]>,
    normals: &mut Vec<[f32; 3]>,
    uvs: &mut Vec<[f32; 2]>,
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
        if config.adaptive && !neighbor_lods.needs_skirt(edge.face, my_lod) {
            continue;
        }

        let skirt_normal = match edge.face {
            ChunkFace::NegX => Vec3::NEG_X,
            ChunkFace::PosX => Vec3::X,
            ChunkFace::NegZ => Vec3::NEG_Z,
            ChunkFace::PosZ => Vec3::Z,
            ChunkFace::NegY | ChunkFace::PosY => continue,
        };

        let base_idx = positions.len() as u32;
        let drop = Vec3::new(0.0, -config.depth, 0.0);

        let top0 = edge.v0_pos;
        let top1 = edge.v1_pos;
        let bot0 = top0 + drop;
        let bot1 = top1 + drop;

        let blend_factor = 0.3;
        let blended_normal0 = (edge.v0_normal * (1.0 - blend_factor) + skirt_normal * blend_factor).normalize();
        let blended_normal1 = (edge.v1_normal * (1.0 - blend_factor) + skirt_normal * blend_factor).normalize();

        positions.push(top0.to_array());
        normals.push(blended_normal0.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v0_weights);

        positions.push(top1.to_array());
        normals.push(blended_normal1.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v1_weights);

        positions.push(bot0.to_array());
        normals.push(blended_normal0.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v0_weights);

        positions.push(bot1.to_array());
        normals.push(blended_normal1.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v1_weights);

        match edge.face {
            ChunkFace::NegX | ChunkFace::PosZ => {
                indices.extend_from_slice(&[
                    base_idx,
                    base_idx + 2,
                    base_idx + 1,
                    base_idx + 1,
                    base_idx + 2,
                    base_idx + 3,
                ]);
            }
            ChunkFace::PosX | ChunkFace::NegZ => {
                indices.extend_from_slice(&[
                    base_idx,
                    base_idx + 1,
                    base_idx + 2,
                    base_idx + 1,
                    base_idx + 3,
                    base_idx + 2,
                ]);
            }
            ChunkFace::NegY | ChunkFace::PosY => {}
        }
    }
}
