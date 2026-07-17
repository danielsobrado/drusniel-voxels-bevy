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

pub mod border_lock_export;
pub mod border_lock_stats;
pub mod build_queue;
pub mod config;
pub mod crossfade;
pub mod crossfade_runtime;
pub mod crossfade_stats_export;
pub mod cut_freeze_export;
pub mod debug_overlay;
pub mod diagonal_polish;
pub mod dither_material;
pub mod edit_dirtiness;
pub mod export;
pub mod fade_material;
pub mod lock;
pub mod material_tier;
pub mod material_weights;
mod ownership;
pub mod plugin;
pub mod quadtree;
pub mod rebuild_observer;
pub mod render;
pub mod runtime;
pub mod runtime_stats_export;
pub mod scripted_edit;
pub mod scripted_edit_adapter;
pub mod scripted_edit_authoritative_hook;
pub mod scripted_edit_driver;
pub mod scripted_edit_mutation_sink;
mod selection;
pub mod simplify;
pub mod simplify_export;
pub mod simplify_stats;
pub mod source_mesh;
pub(crate) mod source_meshing;
pub mod stats;
pub mod summary;
pub mod topology_export;
pub mod topology_stats;
pub mod triangle_quality;
pub mod types;
pub mod validate;
pub mod weld;
pub mod weld_export;
pub mod weld_stats;

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
