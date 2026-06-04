use bevy::prelude::*;
use serde::Deserialize;

pub const MC_TRANSVOXEL_CONFIG_PATH: &str = "assets/config/mc_transvoxel.yaml";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum McTransvoxelSpikeMode {
    #[default]
    Sandbox,
    SelectedChunks,
    ReplaceSurfaceNets,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum McTransvoxelLodDeltaPolicy {
    #[default]
    MaxOne,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum McTransvoxelMaterialMode {
    #[default]
    SingleTriplanar,
}

#[derive(Deserialize)]
struct McTransvoxelConfigFile {
    mc_transvoxel: McTransvoxelSettingsRaw,
}

#[derive(Deserialize)]
struct McTransvoxelSettingsRaw {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    mode: McTransvoxelSpikeMode,
    #[serde(default = "default_max_chunks_per_frame")]
    max_chunks_per_frame: u32,
    #[serde(default)]
    lod_delta_policy: McTransvoxelLodDeltaPolicy,
    #[serde(default)]
    use_secondary_positions: bool,
    #[serde(default)]
    generate_colliders: bool,
    #[serde(default)]
    material_mode: McTransvoxelMaterialMode,
    #[serde(default)]
    debug_draw_transition_faces: bool,
    #[serde(default)]
    debug_log_transition_stats: bool,
    #[serde(default)]
    debug_triangle_sources: bool,
    #[serde(default = "default_sandbox_radius")]
    sandbox_radius_chunks: i32,
}

fn default_max_chunks_per_frame() -> u32 {
    2
}

fn default_sandbox_radius() -> i32 {
    2
}

#[derive(Resource, Clone, Debug)]
pub struct McTransvoxelSettings {
    pub enabled: bool,
    pub mode: McTransvoxelSpikeMode,
    /// Parsed from YAML; not yet enforced by the mesh queue (spike backlog).
    pub max_chunks_per_frame: u32,
    pub lod_delta_policy: McTransvoxelLodDeltaPolicy,
    /// Parsed from YAML; no mesher/shader wiring yet (MTX-024).
    pub use_secondary_positions: bool,
    /// Parsed from YAML; no collider routing yet (MTX-035 / MTX-043).
    pub generate_colliders: bool,
    /// Parsed from YAML; triplanar path unchanged (MTX-041).
    pub material_mode: McTransvoxelMaterialMode,
    pub debug_draw_transition_faces: bool,
    pub debug_log_transition_stats: bool,
    pub debug_triangle_sources: bool,
    pub sandbox_radius_chunks: i32,
}

impl Default for McTransvoxelSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: McTransvoxelSpikeMode::Sandbox,
            max_chunks_per_frame: 2,
            lod_delta_policy: McTransvoxelLodDeltaPolicy::MaxOne,
            use_secondary_positions: false,
            generate_colliders: false,
            material_mode: McTransvoxelMaterialMode::SingleTriplanar,
            debug_draw_transition_faces: false,
            debug_log_transition_stats: false,
            debug_triangle_sources: false,
            sandbox_radius_chunks: 2,
        }
    }
}

impl McTransvoxelSettings {
    pub fn load_or_default() -> Self {
        match crate::config::loader::load_config::<McTransvoxelConfigFile, _>(
            MC_TRANSVOXEL_CONFIG_PATH,
        ) {
            Ok(file) => Self::from_raw(file.mc_transvoxel),
            Err(err) => {
                log::warn!(
                    "Failed to load MC+Transvoxel config from {MC_TRANSVOXEL_CONFIG_PATH}: {err}; using defaults (disabled)"
                );
                Self::default()
            }
        }
    }

    fn from_raw(raw: McTransvoxelSettingsRaw) -> Self {
        Self {
            enabled: raw.enabled,
            mode: raw.mode,
            max_chunks_per_frame: raw.max_chunks_per_frame.max(1),
            lod_delta_policy: raw.lod_delta_policy,
            use_secondary_positions: raw.use_secondary_positions,
            generate_colliders: raw.generate_colliders,
            material_mode: raw.material_mode,
            debug_draw_transition_faces: raw.debug_draw_transition_faces,
            debug_log_transition_stats: raw.debug_log_transition_stats,
            debug_triangle_sources: raw.debug_triangle_sources,
            sandbox_radius_chunks: raw.sandbox_radius_chunks.max(0),
        }
    }

    pub fn should_mesh_chunk(
        &self,
        chunk_pos: IVec3,
        camera_chunk: Option<IVec3>,
        logical_lod: crate::voxel::chunk::LodLevel,
    ) -> bool {
        if !self.enabled {
            return false;
        }
        match self.mode {
            McTransvoxelSpikeMode::ReplaceSurfaceNets => true,
            McTransvoxelSpikeMode::SelectedChunks => {
                matches!(logical_lod, crate::voxel::chunk::LodLevel::Lod0)
            }
            McTransvoxelSpikeMode::Sandbox => {
                let Some(camera_chunk) = camera_chunk else {
                    return false;
                };
                let delta = chunk_pos - camera_chunk;
                delta.x.abs() <= self.sandbox_radius_chunks
                    && delta.y.abs() <= self.sandbox_radius_chunks
                    && delta.z.abs() <= self.sandbox_radius_chunks
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_deserializes_debug_triangle_sources() {
        let file: McTransvoxelConfigFile = serde_yaml::from_str(
            r#"
mc_transvoxel:
  enabled: true
  debug_triangle_sources: true
"#,
        )
        .expect("mc_transvoxel config should deserialize");
        let settings = McTransvoxelSettings::from_raw(file.mc_transvoxel);

        assert!(settings.enabled);
        assert!(settings.debug_triangle_sources);
    }
}
