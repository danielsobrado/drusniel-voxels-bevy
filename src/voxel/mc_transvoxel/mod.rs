//! MC + Transvoxel spike — experimental LOD seam closure (not production-ready).
//!
//! See `docs/legacy/mc-transvoxel-plan.md` for scope, gates, and go/no-go criteria.
//! Default builds compile the real mesher (`mc_transvoxel` is a default Cargo feature).
//! Terrain stays Surface Nets until `McTransvoxelSettings::enabled` is true (YAML
//! startup default or **Alt+F5** at runtime). `--no-default-features` uses [`stub`](stub.rs).

#[cfg(feature = "mc_transvoxel")]
mod config;
#[cfg(feature = "mc_transvoxel")]
mod debug;
#[cfg(feature = "mc_transvoxel")]
mod face_mask;
#[cfg(feature = "mc_transvoxel")]
mod mc;
#[cfg(feature = "mc_transvoxel")]
mod normals;
#[cfg(feature = "mc_transvoxel")]
mod stats;
#[cfg(feature = "mc_transvoxel")]
pub(crate) mod tables;
#[cfg(feature = "mc_transvoxel")]
mod transvoxel;

#[cfg(feature = "mc_transvoxel")]
pub use config::{
    MC_TRANSVOXEL_CONFIG_PATH, McTransvoxelLodDeltaPolicy, McTransvoxelMaterialMode,
    McTransvoxelSettings, McTransvoxelSpikeMode,
};
#[cfg(feature = "mc_transvoxel")]
pub use debug::log_transition_stats_if_due;
#[cfg(feature = "mc_transvoxel")]
pub use face_mask::{TransvoxelFaceMask, compute_transvoxel_face_mask};
#[cfg(feature = "mc_transvoxel")]
pub use mc::{McMeshInput, McMeshOutput, generate_mc_chunk_mesh};
#[cfg(feature = "mc_transvoxel")]
pub use stats::{McTransvoxelRuntimeStats, McTransvoxelStats};

#[cfg(not(feature = "mc_transvoxel"))]
mod stub;

#[cfg(not(feature = "mc_transvoxel"))]
pub use stub::*;
