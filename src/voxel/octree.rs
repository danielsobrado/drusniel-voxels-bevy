//! Hierarchical octree for O(log N) frustum culling.
//!
//! Instead of testing every chunk against the camera frustum each frame,
//! chunks are organized into an octree. Large groups can be culled with
//! a single AABB-frustum test, dramatically reducing per-frame work.

use crate::constants::CHUNK_SIZE_F32;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

/// Maximum chunks per leaf node before subdivision.
const MAX_CHUNKS_PER_LEAF: usize = 8;

/// Minimum node size (world units) to prevent over-subdivision.
const MIN_NODE_SIZE: f32 = CHUNK_SIZE_F32 * 2.0;

/// Axis-aligned bounding box for octree nodes.
#[derive(Clone, Copy, Debug)]
pub struct OctreeAabb {
    pub min: Vec3,
    pub max: Vec3,
}

impl OctreeAabb {
    pub fn new(min: Vec3, max: Vec3) -> Self {
        Self { min, max }
    }

    #[inline]
    pub fn center(&self) -> Vec3 {
        (self.min + self.max) * 0.5
    }

    #[inline]
    pub fn half_extents(&self) -> Vec3 {
        (self.max - self.min) * 0.5
    }

    /// Test if this AABB is completely outside the frustum planes.
    /// Returns true if the AABB should be culled (not visible).
    pub fn outside_frustum(&self, frustum: &ViewFrustum) -> bool {
        // Test against each of the 6 frustum planes
        for plane in &frustum.planes {
            // Find the AABB vertex furthest in the direction of the plane normal
            let p = Vec3::new(
                if plane.x >= 0.0 { self.max.x } else { self.min.x },
                if plane.y >= 0.0 { self.max.y } else { self.min.y },
                if plane.z >= 0.0 { self.max.z } else { self.min.z },
            );

            // If the furthest point is behind the plane, AABB is outside frustum
            // Plane equation: ax + by + cz + d = 0, where (a,b,c) is normal, d is offset
            if plane.x * p.x + plane.y * p.y + plane.z * p.z + plane.w < 0.0 {
                return true;
            }
        }
        false
    }
}

/// Simple view frustum representation using 6 planes.
/// Each plane is stored as Vec4(normal.x, normal.y, normal.z, d) where
/// the plane equation is: normal · point + d = 0
#[derive(Clone, Debug)]
pub struct ViewFrustum {
    /// 6 frustum planes: left, right, bottom, top, near, far
    pub planes: [Vec4; 6],
}

impl ViewFrustum {
    /// Extract frustum planes from a view-projection matrix.
    /// Uses the Gribb/Hartmann method.
    pub fn from_view_projection(view_proj: &Mat4) -> Self {
        let m = view_proj.to_cols_array_2d();

        // Extract and normalize planes
        // Left plane: row3 + row0
        let left = Self::normalize_plane(Vec4::new(
            m[0][3] + m[0][0],
            m[1][3] + m[1][0],
            m[2][3] + m[2][0],
            m[3][3] + m[3][0],
        ));

        // Right plane: row3 - row0
        let right = Self::normalize_plane(Vec4::new(
            m[0][3] - m[0][0],
            m[1][3] - m[1][0],
            m[2][3] - m[2][0],
            m[3][3] - m[3][0],
        ));

        // Bottom plane: row3 + row1
        let bottom = Self::normalize_plane(Vec4::new(
            m[0][3] + m[0][1],
            m[1][3] + m[1][1],
            m[2][3] + m[2][1],
            m[3][3] + m[3][1],
        ));

        // Top plane: row3 - row1
        let top = Self::normalize_plane(Vec4::new(
            m[0][3] - m[0][1],
            m[1][3] - m[1][1],
            m[2][3] - m[2][1],
            m[3][3] - m[3][1],
        ));

        // Near plane: row3 + row2
        let near = Self::normalize_plane(Vec4::new(
            m[0][3] + m[0][2],
            m[1][3] + m[1][2],
            m[2][3] + m[2][2],
            m[3][3] + m[3][2],
        ));

        // Far plane: row3 - row2
        let far = Self::normalize_plane(Vec4::new(
            m[0][3] - m[0][2],
            m[1][3] - m[1][2],
            m[2][3] - m[2][2],
            m[3][3] - m[3][2],
        ));

        Self {
            planes: [left, right, bottom, top, near, far],
        }
    }

    /// Normalize a plane so the normal has unit length.
    fn normalize_plane(plane: Vec4) -> Vec4 {
        let normal_len = (plane.x * plane.x + plane.y * plane.y + plane.z * plane.z).sqrt();
        if normal_len > 0.0 {
            plane / normal_len
        } else {
            plane
        }
    }
}

/// Octree node - either a leaf with chunks or internal with 8 children.
#[derive(Clone)]
pub enum OctreeNode {
    Leaf {
        bounds: OctreeAabb,
        chunks: Vec<IVec3>,
    },
    Internal {
        bounds: OctreeAabb,
        children: Box<[Option<OctreeNode>; 8]>,
    },
}

impl OctreeNode {
    pub fn bounds(&self) -> &OctreeAabb {
        match self {
            OctreeNode::Leaf { bounds, .. } => bounds,
            OctreeNode::Internal { bounds, .. } => bounds,
        }
    }

    /// Collect all chunks that pass the frustum test.
    pub fn query_frustum(&self, frustum: &ViewFrustum, results: &mut Vec<IVec3>) {
        // Early out if entire node is outside frustum
        if self.bounds().outside_frustum(frustum) {
            return;
        }

        match self {
            OctreeNode::Leaf { chunks, .. } => {
                // Add all chunks in this leaf (they passed the node-level test)
                results.extend(chunks.iter().copied());
            }
            OctreeNode::Internal { children, .. } => {
                // Recurse into children
                for child in children.iter().flatten() {
                    child.query_frustum(frustum, results);
                }
            }
        }
    }

    /// Count total chunks in this subtree.
    pub fn chunk_count(&self) -> usize {
        match self {
            OctreeNode::Leaf { chunks, .. } => chunks.len(),
            OctreeNode::Internal { children, .. } => {
                children.iter().flatten().map(|c| c.chunk_count()).sum()
            }
        }
    }
}

/// Resource containing the chunk octree for fast frustum culling.
#[derive(Resource, Default)]
pub struct ChunkOctree {
    root: Option<OctreeNode>,
    dirty: bool,
    /// Cached chunk count for stats.
    chunk_count: usize,
}

impl ChunkOctree {
    /// Build the octree from all chunks in the world.
    pub fn build(&mut self, world: &VoxelWorld) {
        let chunk_positions: Vec<IVec3> = world.chunk_positions().collect();

        if chunk_positions.is_empty() {
            self.root = None;
            self.dirty = false;
            self.chunk_count = 0;
            return;
        }

        // Compute world bounds from all chunks
        let (min, max) = compute_world_bounds(&chunk_positions);
        let bounds = OctreeAabb::new(min, max);

        self.root = Some(build_node(bounds, chunk_positions));
        self.dirty = false;
        self.chunk_count = self.root.as_ref().map(|r| r.chunk_count()).unwrap_or(0);
    }

    /// Query chunks visible in the given frustum.
    pub fn query_frustum(&self, frustum: &ViewFrustum) -> Vec<IVec3> {
        let mut results = Vec::with_capacity(self.chunk_count / 4);
        if let Some(root) = &self.root {
            root.query_frustum(frustum, &mut results);
        }
        results
    }

    /// Mark the octree as needing rebuild (e.g., chunks added/removed).
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// Check if the octree needs rebuilding.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Check if the octree has been built.
    pub fn is_built(&self) -> bool {
        self.root.is_some()
    }

    /// Get the total number of chunks in the octree.
    pub fn chunk_count(&self) -> usize {
        self.chunk_count
    }
}

/// Compute world-space bounds from chunk positions.
fn compute_world_bounds(chunks: &[IVec3]) -> (Vec3, Vec3) {
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);

    for &chunk_pos in chunks {
        let world_min = (chunk_pos.as_vec3()) * CHUNK_SIZE_F32;
        let world_max = world_min + Vec3::splat(CHUNK_SIZE_F32);

        min = min.min(world_min);
        max = max.max(world_max);
    }

    (min, max)
}

/// Recursively build an octree node.
fn build_node(bounds: OctreeAabb, chunks: Vec<IVec3>) -> OctreeNode {
    let size = bounds.max - bounds.min;

    // Make a leaf if few chunks or node is too small to subdivide
    if chunks.len() <= MAX_CHUNKS_PER_LEAF
        || size.x <= MIN_NODE_SIZE
        || size.y <= MIN_NODE_SIZE
        || size.z <= MIN_NODE_SIZE
    {
        return OctreeNode::Leaf { bounds, chunks };
    }

    // Subdivide into 8 octants
    let center = bounds.center();
    let mut child_chunks: [Vec<IVec3>; 8] = Default::default();

    // Sort chunks into octants based on their center position
    for chunk_pos in chunks {
        let chunk_center =
            chunk_pos.as_vec3() * CHUNK_SIZE_F32 + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let octant = get_octant(chunk_center, center);
        child_chunks[octant].push(chunk_pos);
    }

    // Build children
    let mut children: [Option<OctreeNode>; 8] = Default::default();
    for (i, child_chunk_vec) in child_chunks.into_iter().enumerate() {
        if !child_chunk_vec.is_empty() {
            let child_bounds = get_octant_bounds(&bounds, i);
            children[i] = Some(build_node(child_bounds, child_chunk_vec));
        }
    }

    OctreeNode::Internal {
        bounds,
        children: Box::new(children),
    }
}

/// Determine which octant a point falls into relative to center.
/// Octant index: bit 0 = X >= center, bit 1 = Y >= center, bit 2 = Z >= center
fn get_octant(point: Vec3, center: Vec3) -> usize {
    let mut octant = 0;
    if point.x >= center.x {
        octant |= 1;
    }
    if point.y >= center.y {
        octant |= 2;
    }
    if point.z >= center.z {
        octant |= 4;
    }
    octant
}

/// Compute the bounds for a child octant.
fn get_octant_bounds(parent: &OctreeAabb, octant: usize) -> OctreeAabb {
    let center = parent.center();
    let min = Vec3::new(
        if octant & 1 != 0 { center.x } else { parent.min.x },
        if octant & 2 != 0 { center.y } else { parent.min.y },
        if octant & 4 != 0 { center.z } else { parent.min.z },
    );
    let max = Vec3::new(
        if octant & 1 != 0 { parent.max.x } else { center.x },
        if octant & 2 != 0 { parent.max.y } else { center.y },
        if octant & 4 != 0 { parent.max.z } else { center.z },
    );
    OctreeAabb::new(min, max)
}
