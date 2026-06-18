//! Stone ground-detail props: a size-stratified ("no bare ground") layer of procedural rocks
//! scattered over terrain. Stones are props, not terrain — they never enter the voxel field or
//! CLOD page geometry. The runtime/render/persistence integration lives in `PropsPlugin`; this
//! module owns the deterministic mesh generation, terrain-aware scatter, and config.

mod config;
mod hash;
mod rock_mesh;
mod runtime;
mod scatter;
mod site_sample;

pub use config::{StoneClassConfig, StoneClassId, StoneConfig};
pub use rock_mesh::{ATTRIBUTE_VDATA, RockPreset, build_rock, build_rock_buffers};
pub use runtime::StonesPlugin;
pub use scatter::{StoneInstance, class_shares, generate_stones_in_area};
pub use site_sample::{StoneSiteSample, sample_site};

// Reused from the parent prop module so stone placement shares the project's deterministic,
// calculate-once / persist-forever hashing (props/mod.rs).
use super::{deterministic_hash, hash_to_seed};
