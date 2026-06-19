//! Stone ground-detail props: a size-stratified ("no bare ground") layer of procedural rocks
//! scattered over terrain. Stones are props, not terrain — they never enter the voxel field or
//! CLOD page geometry. The runtime/render/persistence integration lives in `PropsPlugin`; this
//! module owns the deterministic mesh generation, terrain-aware scatter, and config.

mod config;
mod constants;
mod debug;
mod hash;
mod material;
mod persistence;
mod placement;
mod rock_mesh;
mod runtime;
mod scatter;
mod site_sample;
mod stats;
#[cfg(test)]
mod tests;
mod types;

pub use config::{StoneClassConfig, StoneClassId, StoneConfig};
pub use constants::{MAX_STONE_CHUNK_SPAWNS_PER_FRAME, STONE_CHUNK_SIZE, STONES_SCHEMA_VERSION};
pub use placement::generate_stones_for_chunk;
pub use rock_mesh::{ATTRIBUTE_VDATA, RockPreset, build_rock, build_rock_buffers};
pub use runtime::StonesPlugin;
pub use scatter::{
    StoneInstance, class_shares, generate_ranked_stones_in_area, generate_stones_in_area,
};
pub use site_sample::{StoneSiteSample, sample_site};
pub use stats::StoneRuntimeStats;
pub use types::StoneClass;

// Reused from the parent prop module so stone placement shares the project's deterministic,
// calculate-once / persist-forever hashing (props/mod.rs).
use super::{deterministic_hash, hash_to_seed};
