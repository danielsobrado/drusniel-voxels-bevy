//! Phase 4 Rust port of the CLOD pages builder (plan §6 / §11).
//!
//! Standalone (no Bevy) so it iterates fast and is unit-testable. Mirrors the validated
//! Three.js PoC (tools/clod-poc). Two PoC findings are baked in here:
//!   - the page outer border is detected TOPOLOGICALLY (open edges), not by footprint
//!     plane (Surface Nets vertices sit inside cells -> non-planar borders);
//!   - meshopt's attribute stride is in BYTES (the JS npm wrapper uses floats).
//!
//! When integrated into the engine, this maps onto src/terrain/pages/.

pub mod config;
pub mod lock;
pub mod quadtree;
pub mod simplify;
pub mod source_mesh;
pub mod terrain;
pub mod types;
pub mod validate;
pub mod weld;
