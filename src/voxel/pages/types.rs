//! Builder data contracts. Ported from tools/clod-poc/src/types.ts.

use super::export::ClodExportError;
use std::fmt;

/// SOA mesh. Positions are world-space.
#[derive(Clone, Default)]
pub struct PageMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    /// Per-vertex 4-channel material blend weights (grass/rock/sand/snow).
    pub materials: Vec<[f32; 4]>,
    /// Per-vertex paint override (0 = natural terrain, slot+1 = painted material).
    pub paint_slots: Vec<f32>,
    /// Number of weight channels per vertex (always 4 when present).
    pub material_weight_stride: usize,
    pub indices: Vec<u32>,
}

impl PageMesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
    /// Flat view of material weights (4 channels per vertex).
    pub fn material_weights(&self) -> &[f32] {
        bytemuck::cast_slice(&self.materials)
    }
    /// Mutable flat view of material weights.
    pub fn material_weights_mut(&mut self) -> &mut [f32] {
        bytemuck::cast_slice_mut(&mut self.materials)
    }
    /// Number of material weight channels per vertex. Always 4 for this builder.
    pub fn material_weight_stride(&self) -> usize {
        if self.material_weight_stride > 0 {
            self.material_weight_stride
        } else if !self.materials.is_empty() {
            4
        } else {
            0
        }
    }
    /// Ensure paint_slots length matches vertex count, filling with 0 for natural terrain.
    pub fn ensure_paint_slots(&mut self) {
        let vc = self.vertex_count();
        if self.paint_slots.len() != vc {
            self.paint_slots.resize(vc, 0.0);
        }
    }
}

/// Uniquely identifies a page in the quadtree hierarchy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PageId {
    pub level: u8,
    pub x: i32,
    pub z: i32,
}

impl fmt::Display for PageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "L{}:({},{})", self.level, self.x, self.z)
    }
}

/// Horizontal page footprint in world units (terrain is chunked in X/Z only).
#[derive(Clone, Copy, Debug)]
pub struct PageFootprint {
    pub min_x: f32,
    pub min_z: f32,
    pub max_x: f32,
    pub max_z: f32,
}

impl PageFootprint {
    pub fn contains_point(self, world_x: f32, world_z: f32) -> bool {
        world_x >= self.min_x
            && world_x < self.max_x
            && world_z >= self.min_z
            && world_z < self.max_z
    }

    pub fn contains_footprint(self, inner: PageFootprint) -> bool {
        self.min_x <= inner.min_x
            && self.min_z <= inner.min_z
            && self.max_x >= inner.max_x
            && self.max_z >= inner.max_z
    }

    /// Squared horizontal distance from a world XZ point to the footprint rectangle.
    pub fn distance_xz_squared(self, world_x: f32, world_z: f32) -> f32 {
        let dx = if world_x < self.min_x {
            self.min_x - world_x
        } else if world_x > self.max_x {
            world_x - self.max_x
        } else {
            0.0
        };
        let dz = if world_z < self.min_z {
            self.min_z - world_z
        } else if world_z > self.max_z {
            world_z - self.max_z
        } else {
            0.0
        };
        dx * dx + dz * dz
    }

    /// Horizontal distance from a world XZ point to the footprint rectangle.
    pub fn distance_xz(self, world_x: f32, world_z: f32) -> f32 {
        self.distance_xz_squared(world_x, world_z).sqrt()
    }
}

/// Bounding sphere for culling / selection.
#[derive(Debug, Clone, Copy)]
pub struct BoundingSphere {
    pub center: [f32; 3],
    pub radius: f32,
    pub min_y: f32,
    pub max_y: f32,
}

/// Tolerances for weld conflict and border validation.
#[derive(Debug, Clone, Copy)]
pub struct BorderTolerances {
    pub position: f32,
    pub normal_dot: f32,
    pub material: f32,
}

pub const DEFAULT_TOLERANCES: BorderTolerances = BorderTolerances {
    position: 1e-6,
    normal_dot: 0.9999,
    material: 1e-4,
};

/// Hard-fail builder error.
#[derive(Debug, thiserror::Error)]
pub enum ClodBuildError {
    #[error("{0}")]
    Export(#[from] ClodExportError),
    #[error("ConfigInvalid: {message}")]
    ConfigInvalid { message: String },
    #[error("DirtyInput: {message}")]
    DirtyInput { message: String },
    #[error("InternalBorderNotWelded: {message}")]
    InternalBorderNotWelded { message: String },
    #[error("BorderPositionMismatch: {message}")]
    BorderPositionMismatch { message: String },
    #[error("BorderNormalMismatch: {message}")]
    BorderNormalMismatch { message: String },
    #[error("BorderMaterialMismatch: {message}")]
    BorderMaterialMismatch { message: String },
    #[error("PageIncomplete: {message}")]
    PageIncomplete { message: String },
    #[error("SimplifierUnavailable: {message}")]
    SimplifierUnavailable { message: String },
    #[error("MeshoptFailed: {message}")]
    MeshoptFailed { message: String },
    #[error("DegenerateGeometry: {message}")]
    DegenerateGeometry { message: String },
    #[error("MissingMaterialWeights: {message}")]
    MissingMaterialWeights { message: String },
}
