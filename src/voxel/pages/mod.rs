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
//! Page builds never run on the frame path; the near-field bubble stays live LOD0 chunks.
//!
//! Step 1 (this commit): the §11.1 main-surface export from the chunk mesher. The builder
//! (weld → lock → simplify → quadtree) and runtime selection follow in later steps, ported
//! near-verbatim from `tools/clod-rs/src/*`.

pub mod build_queue;
pub mod config;
pub mod export;
pub mod lock;
pub mod plugin;
pub mod quadtree;
pub mod runtime;
pub mod simplify;
pub mod source_mesh;
pub mod types;
pub mod validate;
pub mod weld;

pub use build_queue::{ClodPageBuildStatus, ClodPageTree};
pub use export::{extract_main_surface_for_clod, ClodExportError, TerrainMainSurfaceExport};
pub use plugin::ClodPagesPlugin;
pub use types::{ClodBuildError, PageFootprint, PageMesh};

#[cfg(test)]
mod tests;
