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

/// Determine boundary flags for a vertex in chunk-local voxel units.
///
/// `boundary_band` is the outermost cell row width on each face (typically
/// `LodLevel::step_size()`), matching `in_boundary_cell` in `meshing.rs` snap
/// logic. Fractional Surface Nets vertices sit inside that band, not on the
/// exact face plane.
pub fn compute_boundary_flags(
    local_pos: Vec3,
    chunk_size: f32,
    boundary_band: f32,
) -> BoundaryFlags {
    let band = boundary_band.max(0.0);

    BoundaryFlags {
        neg_x: local_pos.x <= band,
        pos_x: local_pos.x >= chunk_size - band,
        neg_y: local_pos.y <= band,
        pos_y: local_pos.y >= chunk_size - band,
        neg_z: local_pos.z <= band,
        pos_z: local_pos.z >= chunk_size - band,
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
///
/// Pass `boundary_band` = `my_lod.step_size() as f32` so edges are found in the
/// same outer-cell band used for LOD snap and transition skirts.
pub fn extract_boundary_edges(
    local_positions: &[Vec3],
    positions: &[[f32; 3]],
    normals: &[[f32; 3]],
    indices: &[u32],
    material_weights: &[[f32; 4]],
    chunk_size: f32,
    boundary_band: f32,
) -> Vec<BoundaryEdge> {
    if local_positions.len() != positions.len()
        || local_positions.len() != normals.len()
        || local_positions.len() != material_weights.len()
    {
        return Vec::new();
    }

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

            let flags0 = compute_boundary_flags(local0, chunk_size, boundary_band);
            let flags1 = compute_boundary_flags(local1, chunk_size, boundary_band);

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

                let v0_pos = Vec3::from_array(positions[i0]);
                let v1_pos = Vec3::from_array(positions[i1]);
                let v0_normal = Vec3::from_array(normals[i0]);
                let v1_normal = Vec3::from_array(normals[i1]);
                let v0_weights = material_weights[i0];
                let v1_weights = material_weights[i1];

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SkirtGenerationStats {
    pub transition_apron_index_count: u32,
    pub vertical_skirt_index_count: u32,
    /// Triangle count per X/Z face (NegX, PosX, NegZ, PosZ).
    pub per_face_triangle_counts: [u16; 4],
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

fn edge_prefers_upward_transition_normals(edge: &BoundaryEdge) -> bool {
    let avg_up = (edge.v0_normal.y + edge.v1_normal.y) * 0.5;
    let min_up = edge.v0_normal.y.min(edge.v1_normal.y);
    avg_up > 0.35 || min_up > 0.15
}

fn upward_biased_normal(normal: Vec3) -> Vec3 {
    (normal * 0.2 + Vec3::Y * 0.8).normalize_or_zero()
}

fn transition_apron_offset(face_normal: Vec3, surface_normal: Vec3, width: f32) -> Vec3 {
    if width <= 0.0 {
        return Vec3::ZERO;
    }

    let surface_normal = surface_normal.normalize_or_zero();
    if surface_normal == Vec3::ZERO {
        return face_normal * width;
    }

    let tangent = face_normal - surface_normal * face_normal.dot(surface_normal);
    let outward = tangent.dot(face_normal);
    if outward.abs() < 1e-4 {
        return face_normal * width;
    }

    // Full drape reaches `width` horizontally along the surface. On steep
    // terrain that plunges deep; cap the drop — but cap it by shortening the
    // along-surface reach, so the apron stays glued to the slope. Clamping
    // `offset.y` on its own lifts the apron off the surface and leaves a proud
    // horizontal flap floating above the terrain (the ~+1.9-voxel artifact).
    let mut scale = width / outward;
    let max_drop = width * 2.0;
    if tangent.y.abs() > 1e-4 {
        scale = scale.min(max_drop / tangent.y.abs());
    }
    tangent * scale
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

fn push_quad_barycentrics(barycentric_uvs: &mut Vec<[f32; 2]>, section: u8, lod_index: u8) {
    use crate::voxel::meshing::encode_barycentric_uv;
    barycentric_uvs.extend_from_slice(&[
        encode_barycentric_uv([1.0, 0.0], section, lod_index),
        encode_barycentric_uv([0.0, 1.0], section, lod_index),
        encode_barycentric_uv([0.0, 0.0], section, lod_index),
        encode_barycentric_uv([0.0, 1.0], section, lod_index),
    ]);
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
) -> SkirtGenerationStats {
    generate_skirts_with_apron_only_faces(
        positions,
        normals,
        uvs,
        barycentric_uvs,
        material_weights,
        indices,
        boundary_edges,
        config,
        my_lod,
        neighbor_lods,
        0,
    )
}

/// Generate skirt geometry, treating faces in `apron_only_face_mask` as
/// transition-apron-only seals. This is used after a snap weld: the snapped
/// fine boundary still needs a short draped surface over the coarse-side gap,
/// but must not emit the old vertical curtain.
pub fn generate_skirts_with_apron_only_faces(
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
    apron_only_face_mask: u8,
) -> SkirtGenerationStats {
    generate_skirts_with_masks(
        positions,
        normals,
        uvs,
        barycentric_uvs,
        material_weights,
        indices,
        boundary_edges,
        config,
        my_lod,
        neighbor_lods,
        apron_only_face_mask,
        0,
    )
}

/// Generate skirt geometry, skipping faces in `sealed_face_mask` entirely.
/// CPU snap has already welded those boundaries to the lower-detail surface, so
/// emitting a visible apron there creates a shelf instead of hiding a gap.
pub fn generate_skirts_with_sealed_faces(
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
    sealed_face_mask: u8,
) -> SkirtGenerationStats {
    generate_skirts_with_masks(
        positions,
        normals,
        uvs,
        barycentric_uvs,
        material_weights,
        indices,
        boundary_edges,
        config,
        my_lod,
        neighbor_lods,
        0,
        sealed_face_mask,
    )
}

fn generate_skirts_with_masks(
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
    apron_only_face_mask: u8,
    sealed_face_mask: u8,
) -> SkirtGenerationStats {
    let mut stats = SkirtGenerationStats::default();
    let wireframe_lod_index = my_lod.wireframe_lod_index();
    if config.depth <= 0.0 {
        return stats;
    }

    for edge in boundary_edges {
        if sealed_face_mask & chunk_face_mask(edge.face) != 0 {
            continue;
        }

        let has_lower_lod_neighbor = neighbor_lods
            .lod_for_face(edge.face)
            .is_some_and(|lod| lod.is_lower_detail_than(my_lod));
        let needs_transition_apron =
            !config.adaptive || neighbor_lods.needs_transition_apron(edge.face, my_lod);
        let needs_vertical_candidate =
            !config.adaptive || neighbor_lods.needs_vertical_skirt(edge.face, my_lod);
        let apron_only = apron_only_face_mask & chunk_face_mask(edge.face) != 0;
        let needs_vertical = needs_vertical_candidate && !apron_only;
        let emit_transition_apron = needs_transition_apron;
        if !emit_transition_apron && !needs_vertical {
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
        let transition_step = neighbor_lods
            .lod_for_face(edge.face)
            .map(|neighbor_lod| neighbor_lod.step_size().max(my_lod.step_size()).max(1) as f32)
            .unwrap_or_else(|| my_lod.step_size().max(1) as f32);
        let transition_depth = config.depth.max(transition_step * VOXEL_SIZE * 2.0);
        // Vertical (NegY/PosY) LOD boundaries cannot be hidden by a straight-down
        // curtain — the crack there sits in a roughly horizontal surface. Instead
        // extrude a short apron along the face normal toward the lower-detail
        // neighbour so the T-junction is backed by terrain-coloured geometry
        // rather than showing sky through the gap.
        let drop = if matches!(edge.face, ChunkFace::NegY | ChunkFace::PosY) {
            let apron = (transition_depth * 0.5).clamp(VOXEL_SIZE, VOXEL_SIZE * 3.0);
            skirt_normal * apron
        } else {
            Vec3::new(0.0, -transition_depth, 0.0)
        };
        let apron_width = if emit_transition_apron {
            // The probe caught real holes one voxel inside the coarse side of a
            // Lod0/Lod1 Z seam. A decorative sub-voxel lip cannot cover that;
            // the apron must span at least the coarser sampling step.
            (transition_step * VOXEL_SIZE).clamp(VOXEL_SIZE, VOXEL_SIZE * 3.0)
        } else {
            0.0
        };
        let apron_drop = Vec3::new(0.0, -VOXEL_SIZE * 0.03, 0.0);

        let top0 = edge.v0_pos;
        let top1 = edge.v1_pos;
        let apron0 =
            top0 + transition_apron_offset(skirt_normal, edge.v0_normal, apron_width) + apron_drop;
        let apron1 =
            top1 + transition_apron_offset(skirt_normal, edge.v1_normal, apron_width) + apron_drop;

        // Skirt/apron verts are a hidden band-aid: shade them like the adjacent
        // surface so they disappear. The previous `blended_normal` tilted 20% toward
        // the horizontal `skirt_normal`, which on steep slopes pushed the strip's
        // normal sideways/down — under an overhead sun it shaded black, the LOD
        // "dark band" (magenta strip in Alt+F8). Inheriting the surface normal removes
        // it without touching geometry. `upward_biased_normal` is kept for the gentle
        // edges it already handles.
        let surface_normal0 = edge.v0_normal.try_normalize().unwrap_or(Vec3::Y);
        let surface_normal1 = edge.v1_normal.try_normalize().unwrap_or(Vec3::Y);
        let use_upward_transition_normals =
            has_lower_lod_neighbor && edge_prefers_upward_transition_normals(edge);
        let transition_normal0 = if use_upward_transition_normals {
            upward_biased_normal(edge.v0_normal)
        } else {
            surface_normal0
        };
        let transition_normal1 = if use_upward_transition_normals {
            upward_biased_normal(edge.v1_normal)
        } else {
            surface_normal1
        };

        let (vertical_top0, vertical_top1) = if emit_transition_apron {
            positions.push(top0.to_array());
            normals.push(transition_normal0.to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v0_weights);

            positions.push(top1.to_array());
            normals.push(transition_normal1.to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v1_weights);

            positions.push(apron0.to_array());
            normals.push(transition_normal0.to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v0_weights);

            positions.push(apron1.to_array());
            normals.push(transition_normal1.to_array());
            uvs.push([1.0, 0.0]);
            material_weights.push(edge.v1_weights);

            push_quad_barycentrics(
                barycentric_uvs,
                crate::voxel::meshing::TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT,
                wireframe_lod_index,
            );
            push_boundary_quad_indices(indices, edge.face, base_idx);
            stats.transition_apron_index_count += 6;
            record_face_triangles(&mut stats, edge.face, 2);
            (apron0, apron1)
        } else {
            (top0, top1)
        };

        if emit_transition_apron && !needs_vertical {
            continue;
        }

        if !needs_vertical {
            continue;
        }

        let vertical_idx = positions.len() as u32;
        let bot0 = vertical_top0 + drop;
        let bot1 = vertical_top1 + drop;

        positions.push(vertical_top0.to_array());
        normals.push(transition_normal0.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v0_weights);

        positions.push(vertical_top1.to_array());
        normals.push(transition_normal1.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v1_weights);

        positions.push(bot0.to_array());
        normals.push(transition_normal0.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v0_weights);

        positions.push(bot1.to_array());
        normals.push(transition_normal1.to_array());
        uvs.push([1.0, 0.0]);
        material_weights.push(edge.v1_weights);

        push_quad_barycentrics(
            barycentric_uvs,
            crate::voxel::meshing::TERRAIN_MESH_SECTION_VERTICAL_SKIRT,
            wireframe_lod_index,
        );
        push_boundary_quad_indices(indices, edge.face, vertical_idx);
        stats.vertical_skirt_index_count += 6;
        record_face_triangles(&mut stats, edge.face, 2);
    }

    stats
}

#[inline]
fn record_face_triangles(stats: &mut SkirtGenerationStats, face: ChunkFace, triangles: u16) {
    let idx = match face {
        ChunkFace::NegX => Some(0),
        ChunkFace::PosX => Some(1),
        ChunkFace::NegZ => Some(2),
        ChunkFace::PosZ => Some(3),
        _ => None,
    };
    if let Some(idx) = idx {
        stats.per_face_triangle_counts[idx] =
            stats.per_face_triangle_counts[idx].saturating_add(triangles);
    }
}

#[inline]
fn chunk_face_mask(face: ChunkFace) -> u8 {
    1 << face as u8
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

    fn downhill_edge_on_pos_x() -> BoundaryEdge {
        let normal = Vec3::new(1.0, 1.0, 0.0).normalize();
        BoundaryEdge {
            v0_pos: Vec3::new(16.0, 4.0, 2.0),
            v1_pos: Vec3::new(16.0, 4.5, 6.0),
            v0_normal: normal,
            v1_normal: normal,
            v0_weights: [1.0, 0.0, 0.0, 0.0],
            v1_weights: [1.0, 0.0, 0.0, 0.0],
            face: ChunkFace::PosX,
        }
    }

    fn steep_downhill_edge_on_pos_x() -> BoundaryEdge {
        // ~70-degree slope descending toward +X — the surface normal tilts hard
        // toward +X, the regime where the old apron clamp left a proud flap.
        let normal = Vec3::new(0.94, 0.34, 0.0).normalize();
        BoundaryEdge {
            v0_pos: Vec3::new(16.0, 12.0, 2.0),
            v1_pos: Vec3::new(16.0, 12.5, 6.0),
            v0_normal: normal,
            v1_normal: normal,
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
            1.0,
        );

        assert_eq!(
            edges.len(),
            4,
            "the shared diagonal should not receive a visible skirt or transition apron"
        );
    }

    #[test]
    fn boundary_extraction_finds_neg_x_band_vertices_inside_outer_cell() {
        // Fractional Surface Nets places boundary verts near x=0.5, not x=0.0.
        let local_positions = vec![
            Vec3::new(0.5, 2.0, 4.0),
            Vec3::new(0.5, 3.0, 4.0),
            Vec3::new(0.5, 2.0, 5.0),
        ];
        let positions = local_positions
            .iter()
            .map(|position| position.to_array())
            .collect::<Vec<_>>();
        let normals = vec![[-1.0, 0.0, 0.0]; positions.len()];
        let weights = vec![[1.0, 0.0, 0.0, 0.0]; positions.len()];
        let indices = vec![0, 1, 2];

        let edges_tight_plane = extract_boundary_edges(
            &local_positions,
            &positions,
            &normals,
            &indices,
            &weights,
            16.0,
            0.01,
        );
        assert!(
            edges_tight_plane.is_empty(),
            "plane epsilon must not treat x=0.5 as on NegX"
        );

        let edges_lod0_band = extract_boundary_edges(
            &local_positions,
            &positions,
            &normals,
            &indices,
            &weights,
            16.0,
            1.0,
        );
        assert!(
            edges_lod0_band
                .iter()
                .any(|edge| edge.face == ChunkFace::NegX),
            "Lod0 step_size band should find NegX silhouette edges at x=0.5"
        );
    }

    #[test]
    fn lod_transition_adds_step_sized_top_apron() {
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
            (positions[2][0] - 18.0).abs() < 1e-4,
            "Lod0/Lod1 transition apron should span the Lod1 sample step"
        );
        assert!(
            positions[2][1] < positions[0][1] && positions[3][1] < positions[1][1],
            "transition apron should have a small downward bias to avoid z-fighting"
        );
        assert!(
            normals[4][1] > 0.95 && normals[5][1] > 0.95,
            "transition drop should be lit like nearby top terrain instead of a dark wall"
        );
        assert!(
            (positions[6][0] - positions[4][0]).abs() < 0.001
                && (positions[7][0] - positions[5][0]).abs() < 0.001,
            "transition skirt should drop from the apron instead of stepping farther into the neighbor"
        );
    }

    #[test]
    fn snapped_lod_transition_face_emits_apron_without_vertical_wall() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        };

        generate_skirts_with_apron_only_faces(
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
            chunk_face_mask(ChunkFace::PosX),
        );

        assert_eq!(positions.len(), 4);
        assert_eq!(barycentric_uvs.len(), 4);
        assert_eq!(indices.len(), 6);
        assert!(
            (positions[2][0] - 18.0).abs() < 1e-4,
            "snap seal apron should still cover the Lod1 sample step"
        );
    }

    #[test]
    fn sealed_lod_transition_face_emits_no_apron_or_vertical_wall() {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        };

        let stats = generate_skirts_with_sealed_faces(
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
            chunk_face_mask(ChunkFace::PosX),
        );

        assert!(positions.is_empty());
        assert!(barycentric_uvs.is_empty());
        assert!(indices.is_empty());
        assert_eq!(stats.transition_apron_index_count, 0);
        assert_eq!(stats.vertical_skirt_index_count, 0);
    }

    #[test]
    fn lod_transition_apron_drapes_downhill_instead_of_forming_horizontal_flap() {
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
            &[downhill_edge_on_pos_x()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert_eq!(positions.len(), 8);
        assert!((positions[2][0] - 18.0).abs() < 1e-4);
        assert!((positions[3][0] - 18.0).abs() < 1e-4);
        assert!(
            positions[2][1] < positions[0][1] - 1.5 && positions[3][1] < positions[1][1] - 1.5,
            "transition apron should follow the downhill tangent instead of floating horizontally"
        );
    }

    #[test]
    fn lod_transition_apron_stays_on_steep_slope_without_floating() {
        // Regression for the ~+1.9-voxel proud apron. On a steep slope the
        // apron must drape *along* the surface; the earlier independent
        // `offset.y` clamp truncated the drop and left the apron floating
        // above the terrain.
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut barycentric_uvs = Vec::new();
        let mut weights = Vec::new();
        let mut indices = Vec::new();
        let neighbor_lods = NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        };
        let edge = steep_downhill_edge_on_pos_x();

        generate_skirts(
            &mut positions,
            &mut normals,
            &mut uvs,
            &mut barycentric_uvs,
            &mut weights,
            &mut indices,
            &[edge.clone()],
            &SkirtConfig {
                depth: 1.5,
                adaptive: true,
            },
            LodLevel::Lod0,
            &neighbor_lods,
        );

        assert_eq!(positions.len(), 8);
        // tan(slope) = n.x / n.y for the surface normal.
        let slope = edge.v0_normal.x / edge.v0_normal.y;
        for (apron_idx, top) in [(2usize, edge.v0_pos), (3usize, edge.v1_pos)] {
            let apron = Vec3::from_array(positions[apron_idx]);
            let dx = apron.x - top.x;
            assert!(dx > 0.0, "apron must extend toward the lower-LOD neighbour");
            // The apron edge must sit on the draped surface (top.y - dx*slope),
            // never float above it — and never above the boundary edge itself.
            let draped_y = top.y - dx * slope;
            assert!(
                apron.y <= top.y,
                "apron floated above the boundary edge: apron.y={}, top.y={}",
                apron.y,
                top.y,
            );
            assert!(
                (apron.y - draped_y).abs() < 0.2,
                "apron must track the steep slope, not float: apron.y={}, draped_y={}",
                apron.y,
                draped_y,
            );
        }
    }

    #[test]
    fn lower_lod_side_edge_gets_step_sized_apron_and_vertical_skirt() {
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

        assert_eq!(positions.len(), 8);
        assert_eq!(barycentric_uvs.len(), 8);
        assert_eq!(indices.len(), 12);
        assert!(
            (positions[2][0] - 18.0).abs() < 1e-4,
            "side-edge apron should span the Lod1 sample step"
        );
        assert!(
            normals[4][0] > 0.95 && normals[5][0] > 0.95,
            "side-edge vertical skirt should keep side-like normals"
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

        // Apron + vertical skirt: bottom vertices are 6 and 7.
        assert_eq!(positions.len(), 8);
        let drop_v0 = positions[4][1] - positions[6][1];
        let drop_v1 = positions[5][1] - positions[7][1];
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
    fn lower_lod_vertical_neighbor_generates_apron_skirt() {
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

        // A vertical LOD boundary toward a lower-detail neighbour now emits a
        // short apron that backs the T-junction crack instead of leaving it open.
        assert!(!positions.is_empty(), "expected vertical apron geometry");
        assert!(!indices.is_empty());
        // The apron extrudes along +Y (toward the PosY neighbour) past the
        // boundary plane, bounded to a few voxels so it never becomes a wall.
        let max_y = positions.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        assert!(max_y > 16.0, "apron should extrude past the boundary plane");
        assert!(
            max_y <= 16.0 + VOXEL_SIZE * 3.0 + 1e-4,
            "apron must stay bounded, got {max_y}"
        );
    }

    #[test]
    fn skirt_barycentrics_tag_apron_and_vertical_sections() {
        use crate::voxel::meshing::{
            TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT, TERRAIN_MESH_SECTION_VERTICAL_SKIRT,
            barycentric_section,
        };

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

        let stats = generate_skirts(
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

        assert!(stats.transition_apron_index_count > 0);
        assert!(stats.vertical_skirt_index_count > 0);
        assert!(
            barycentric_uvs
                .iter()
                .any(|uv| { barycentric_section(*uv) == TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT })
        );
        assert!(
            barycentric_uvs
                .iter()
                .any(|uv| { barycentric_section(*uv) == TERRAIN_MESH_SECTION_VERTICAL_SKIRT })
        );
    }
}
