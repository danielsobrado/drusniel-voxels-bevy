//! MC + Transvoxel spike — off-by-default LOD seam closure experiment.
//!
//! See `docs/lod/mc-transvoxel-plan.md` for scope, gates, and go/no-go criteria.
//! Production terrain continues to use Surface Nets unless
//! `assets/config/mc_transvoxel.yaml` has `enabled: true` **and** the `mc_transvoxel`
//! Cargo feature is enabled at compile time.

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
mod tables;
#[cfg(feature = "mc_transvoxel")]
mod transvoxel;

#[cfg(feature = "mc_transvoxel")]
pub use config::{
    McTransvoxelLodDeltaPolicy, McTransvoxelMaterialMode, McTransvoxelSettings,
    McTransvoxelSpikeMode, MC_TRANSVOXEL_CONFIG_PATH,
};
#[cfg(feature = "mc_transvoxel")]
pub use debug::log_transition_stats_if_due;
#[cfg(feature = "mc_transvoxel")]
pub use face_mask::TransvoxelFaceMask;
#[cfg(feature = "mc_transvoxel")]
pub use mc::{generate_mc_chunk_mesh, McMeshInput, McMeshOutput};
#[cfg(feature = "mc_transvoxel")]
pub use stats::{McTransvoxelRuntimeStats, McTransvoxelStats};

#[cfg(not(feature = "mc_transvoxel"))]
mod stub;

#[cfg(not(feature = "mc_transvoxel"))]
pub use stub::*;
