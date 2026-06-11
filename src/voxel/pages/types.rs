//! Builder data contracts. Ported from tools/clod-rs/src/types.rs (the validated sandbox).

use super::export::ClodExportError;
use std::fmt;

/// SOA mesh. Positions are world-space.
#[derive(Clone, Default)]
pub struct PageMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub materials: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
}

impl PageMesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

/// Horizontal page footprint in WORLD units (terrain is chunked in X/Z only).
#[derive(Clone, Copy, Debug)]
pub struct PageFootprint {
    pub min_x: f32,
    pub min_z: f32,
    pub max_x: f32,
    pub max_z: f32,
}

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

/// Hard-fail builder error — never simplify dirty input (plan §3, §11.7).
#[derive(Debug)]
pub enum ClodBuildError {
    Export(ClodExportError),
    DirtyInput(String),
    InternalBorderNotWelded(String),
    BorderPositionMismatch(String),
    BorderNormalMismatch(String),
    BorderMaterialMismatch(String),
    PageIncomplete(String),
    MeshoptFailed(String),
}

impl fmt::Display for ClodBuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use ClodBuildError::*;
        match self {
            Export(e) => write!(f, "{e}"),
            DirtyInput(m) => write!(f, "DirtyInput: {m}"),
            InternalBorderNotWelded(m) => write!(f, "InternalBorderNotWelded: {m}"),
            BorderPositionMismatch(m) => write!(f, "BorderPositionMismatch: {m}"),
            BorderNormalMismatch(m) => write!(f, "BorderNormalMismatch: {m}"),
            BorderMaterialMismatch(m) => write!(f, "BorderMaterialMismatch: {m}"),
            PageIncomplete(m) => write!(f, "PageIncomplete: {m}"),
            MeshoptFailed(m) => write!(f, "MeshoptFailed: {m}"),
        }
    }
}

impl std::error::Error for ClodBuildError {}

impl From<ClodExportError> for ClodBuildError {
    fn from(e: ClodExportError) -> Self {
        ClodBuildError::Export(e)
    }
}
