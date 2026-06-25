//! CLOD pages — coarse far-field terrain LODs built by decimating merged chunk meshes.
//!
//! Plan: [`docs/plans/clod-execution-plan.md`] §7 and the Phase 5 integration plan
//! [`docs/plans/clod-phase5-plan.md`]. Validated end-to-end in the sandboxes
//! `tools/clod-poc` (Three.js) and `tools/clod-rs` (standalone Rust) before landing here.
//!
//! Invariants (do not violate): VoxelWorld stays authoritative; pages are derived caches.
//! Lower LODs are NEVER re-extracted from voxels — always decimated from merged child
//! meshes. Page borders are locked (by OPEN topological boundary, a sandbox finding — not
//! by footprint plane: Surface Nets vertices sit inside cells, so borders are non-planar).

pub mod build_queue;
pub mod config;
pub mod diagonal_polish;
pub mod export;
pub mod lock;
pub mod material_weights;
pub mod material_tier;
mod ownership;
pub mod plugin;
pub mod quadtree;
pub mod render;
pub mod runtime;
mod selection;
pub mod simplify;
pub mod source_mesh;
pub mod stats;
pub mod summary;
pub mod triangle_quality;
pub mod types;
pub mod validate;
pub mod weld;

#[cfg(test)]
pub mod debug_export;

pub use build_queue::{ClodPageBuildStatus, ClodPageTree};
pub use export::{ClodExportError, TerrainMainSurfaceExport, extract_main_surface_for_clod};
pub(crate) use ownership::ClodPageMeshGate;
pub use plugin::ClodPagesPlugin;
pub use render::{ClodPageMeshBounds, ClodPageMeshTag};
pub use summary::TerrainSummaryField;
pub use types::{ClodBuildError, PageFootprint, PageMesh};

#[cfg(test)]
mod synthetic;
#[cfg(test)]
mod tests;
