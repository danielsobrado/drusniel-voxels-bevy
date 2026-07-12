//! Config/toggle integration for the  CLOD shadow runtime path.
//!
//! This module centralizes the feature gate used by the PR 0006-0009 shadow
//! pipeline.  The goal is to make the path easy to A/B in normal runs, F3, and
//! bench scenes without scattering booleans through the loader, spawn wiring, and
//! debug adapters.

use bevy::prelude::*;
use std::{collections::BTreeMap, path::PathBuf};

use super::{
    clod_shadow_assets::{ClodShadowSnapshotPath, DEFAULT_CLOD_SHADOW_SNAPSHOT_PATH},
    clod_shadow_f3_overlay::ClodShadowF3OverlaySettings,
    clod_shadow_runtime::ClodShadowRuntimeAction,
};

pub const ENV_CLOD_SHADOWS: &str = "VOXEL_CLOD_SHADOWS";
pub const ENV_CLOD_SHADOW_SNAPSHOT: &str = "VOXEL_CLOD_SHADOW_SNAPSHOT";
pub const ENV_CLOD_SHADOW_AUTO_RELOAD: &str = "VOXEL_CLOD_SHADOW_AUTO_RELOAD";
pub const ENV_CLOD_SHADOW_LOAD_SNAPSHOT: &str = "VOXEL_CLOD_SHADOW_LOAD_SNAPSHOT";
pub const ENV_CLOD_SHADOW_LIGHT_LAYERS: &str = "VOXEL_CLOD_SHADOW_LIGHT_LAYERS";
pub const ENV_CLOD_SHADOW_F3: &str = "VOXEL_CLOD_SHADOW_F3";
pub const ENV_CLOD_SHADOW_BENCH: &str = "VOXEL_CLOD_SHADOW_BENCH";

/// Runtime mode for the CLOD shadow path.
///
/// `Proxy` is the parity target: visual meshes are used near the camera, proxy
/// meshes cast mid/far terrain shadows, and no-cast pages are removed from the
/// shadow workload.  The other modes are A/B tools for bench scenes and bug
/// isolation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClodShadowRuntimeMode {
    Disabled,
    Proxy,
    VisualOnly,
    NoCastOnly,
}

impl Default for ClodShadowRuntimeMode {
    fn default() -> Self {
        Self::Proxy
    }
}

impl ClodShadowRuntimeMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "0" | "off" | "false" | "disabled" | "disable" | "none" => Some(Self::Disabled),
            "1" | "on" | "true" | "auto" | "proxy" | "proxies" | "fable" => Some(Self::Proxy),
            "visual" | "visual_only" | "visual-only" | "visualonly" => Some(Self::VisualOnly),
            "nocast" | "no_cast" | "no-cast" | "no_cast_only" | "no-cast-only" => {
                Some(Self::NoCastOnly)
            }
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Proxy => "proxy",
            Self::VisualOnly => "visual-only",
            Self::NoCastOnly => "no-cast-only",
        }
    }
}

/// Single source of truth for the CLOD shadow feature gate.
#[derive(Resource, Debug, Clone, PartialEq, Eq, Hash)]
pub struct ClodShadowRuntimeSettings {
    pub mode: ClodShadowRuntimeMode,
    pub snapshot_path: PathBuf,
    pub auto_reload_snapshot: bool,
    pub load_snapshot: bool,
    pub configure_light_layers: bool,
    pub f3_overlay_enabled: bool,
    pub bench_metrics_enabled: bool,
}

impl Default for ClodShadowRuntimeSettings {
    fn default() -> Self {
        Self {
            mode: ClodShadowRuntimeMode::Proxy,
            snapshot_path: PathBuf::from(DEFAULT_CLOD_SHADOW_SNAPSHOT_PATH),
            auto_reload_snapshot: false,
            load_snapshot: true,
            configure_light_layers: true,
            f3_overlay_enabled: true,
            bench_metrics_enabled: true,
        }
    }
}

impl ClodShadowRuntimeSettings {
    pub fn enabled(&self) -> bool {
        self.mode != ClodShadowRuntimeMode::Disabled
    }

    pub fn should_load_snapshot(&self) -> bool {
        self.enabled() && self.load_snapshot && self.snapshot_path.is_file()
    }

    pub fn should_spawn_proxy_casters(&self) -> bool {
        self.mode == ClodShadowRuntimeMode::Proxy
    }

    pub fn should_configure_light_layers(&self) -> bool {
        self.enabled() && self.should_spawn_proxy_casters() && self.configure_light_layers
    }

    pub fn should_show_f3(&self) -> bool {
        self.enabled() && self.f3_overlay_enabled
    }

    pub fn should_emit_bench_metrics(&self) -> bool {
        self.bench_metrics_enabled
    }

    /// Resolve the exported runtime action to the action that should actually be
    /// applied under the current debug/bench mode.
    pub fn effective_action(
        &self,
        requested: ClodShadowRuntimeAction,
    ) -> Option<ClodShadowRuntimeAction> {
        match self.mode {
            ClodShadowRuntimeMode::Disabled => None,
            ClodShadowRuntimeMode::Proxy => Some(requested),
            ClodShadowRuntimeMode::VisualOnly => Some(ClodShadowRuntimeAction::UseVisualMeshCaster),
            ClodShadowRuntimeMode::NoCastOnly => {
                Some(ClodShadowRuntimeAction::ApplyNotShadowCaster)
            }
        }
    }

    pub fn mode_label(&self) -> &'static str {
        self.mode.as_str()
    }

    pub fn mode_code(&self) -> u32 {
        match self.mode {
            ClodShadowRuntimeMode::Disabled => 0,
            ClodShadowRuntimeMode::Proxy => 1,
            ClodShadowRuntimeMode::VisualOnly => 2,
            ClodShadowRuntimeMode::NoCastOnly => 3,
        }
    }
}

/// Bench/render-toggles adapter.  These fields intentionally mirror the names we
/// want in bench scene TOML files and debug UI toggles.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClodShadowRenderToggles {
    pub disable_clod_shadows: bool,
    pub force_visual_mesh_shadows: bool,
    pub force_no_cast_shadows: bool,
    pub disable_clod_shadow_proxies: bool,
    pub disable_clod_shadow_snapshot_loading: bool,
    pub disable_clod_shadow_light_layers: bool,
    pub disable_clod_shadow_f3: bool,
    pub disable_clod_shadow_bench_metrics: bool,
    pub clod_shadow_snapshot_path: Option<PathBuf>,
    pub clod_shadow_auto_reload: Option<bool>,
}

impl ClodShadowRenderToggles {
    pub fn any_mode_override(&self) -> bool {
        self.disable_clod_shadows
            || self.force_visual_mesh_shadows
            || self.force_no_cast_shadows
            || self.disable_clod_shadow_proxies
    }
}

pub fn apply_clod_shadow_render_toggles(
    settings: &mut ClodShadowRuntimeSettings,
    toggles: &ClodShadowRenderToggles,
) {
    if toggles.disable_clod_shadows {
        settings.mode = ClodShadowRuntimeMode::Disabled;
    } else if toggles.force_no_cast_shadows {
        settings.mode = ClodShadowRuntimeMode::NoCastOnly;
    } else if toggles.force_visual_mesh_shadows || toggles.disable_clod_shadow_proxies {
        settings.mode = ClodShadowRuntimeMode::VisualOnly;
    }

    if toggles.disable_clod_shadow_snapshot_loading {
        settings.load_snapshot = false;
    }
    if toggles.disable_clod_shadow_light_layers {
        settings.configure_light_layers = false;
    }
    if toggles.disable_clod_shadow_f3 {
        settings.f3_overlay_enabled = false;
    }
    if toggles.disable_clod_shadow_bench_metrics {
        settings.bench_metrics_enabled = false;
    }
    if let Some(path) = &toggles.clod_shadow_snapshot_path {
        settings.snapshot_path = path.clone();
    }
    if let Some(auto_reload) = toggles.clod_shadow_auto_reload {
        settings.auto_reload_snapshot = auto_reload;
    }
}

pub fn clod_shadow_settings_from_env() -> ClodShadowRuntimeSettings {
    clod_shadow_settings_from_env_pairs(std::env::vars())
}

pub fn clod_shadow_settings_from_env_pairs<I, K, V>(pairs: I) -> ClodShadowRuntimeSettings
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let mut settings = ClodShadowRuntimeSettings::default();
    let env: BTreeMap<String, String> = pairs
        .into_iter()
        .map(|(key, value)| (key.into(), value.into()))
        .collect();

    if let Some(value) = env.get(ENV_CLOD_SHADOWS) {
        if let Some(mode) = ClodShadowRuntimeMode::parse(value) {
            settings.mode = mode;
        }
    }
    if let Some(value) = env.get(ENV_CLOD_SHADOW_SNAPSHOT) {
        if !value.trim().is_empty() {
            settings.snapshot_path = PathBuf::from(value.trim());
        }
    }
    if let Some(value) = env.get(ENV_CLOD_SHADOW_AUTO_RELOAD) {
        if let Some(parsed) = parse_bool_env(value) {
            settings.auto_reload_snapshot = parsed;
        }
    }
    if let Some(value) = env.get(ENV_CLOD_SHADOW_LOAD_SNAPSHOT) {
        if let Some(parsed) = parse_bool_env(value) {
            settings.load_snapshot = parsed;
        }
    }
    if let Some(value) = env.get(ENV_CLOD_SHADOW_LIGHT_LAYERS) {
        if let Some(parsed) = parse_bool_env(value) {
            settings.configure_light_layers = parsed;
        }
    }
    if let Some(value) = env.get(ENV_CLOD_SHADOW_F3) {
        if let Some(parsed) = parse_bool_env(value) {
            settings.f3_overlay_enabled = parsed;
        }
    }
    if let Some(value) = env.get(ENV_CLOD_SHADOW_BENCH) {
        if let Some(parsed) = parse_bool_env(value) {
            settings.bench_metrics_enabled = parsed;
        }
    }

    settings
}

pub fn parse_bool_env(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "on" | "true" | "yes" | "y" | "enable" | "enabled" => Some(true),
        "0" | "off" | "false" | "no" | "n" | "disable" | "disabled" => Some(false),
        _ => None,
    }
}

pub struct ClodShadowConfigPlugin;

impl Plugin for ClodShadowConfigPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodShadowRuntimeSettings>()
            .add_systems(Startup, apply_clod_shadow_env_overrides)
            .add_systems(Update, sync_clod_shadow_settings_to_runtime_resources);
    }
}

pub fn apply_clod_shadow_env_overrides(mut settings: ResMut<ClodShadowRuntimeSettings>) {
    *settings = clod_shadow_settings_from_env();
}

/// Keep existing loader/F3 resources in sync with the central feature gate.
///
/// Call sites that have not yet added PR 0008/0009 can still add this plugin:
/// the optional resources simply no-op until those modules are present.
pub fn sync_clod_shadow_settings_to_runtime_resources(
    settings: Res<ClodShadowRuntimeSettings>,
    snapshot_path: Option<ResMut<ClodShadowSnapshotPath>>,
    f3_settings: Option<ResMut<ClodShadowF3OverlaySettings>>,
) {
    if let Some(mut snapshot_path) = snapshot_path {
        if snapshot_path.path != settings.snapshot_path {
            snapshot_path.path = settings.snapshot_path.clone();
            snapshot_path.request_reload();
        }
        snapshot_path.auto_reload_when_modified = settings.auto_reload_snapshot;
        if settings.should_load_snapshot() && snapshot_path.generation == 0 {
            snapshot_path.request_reload();
        }
    }

    if let Some(mut f3_settings) = f3_settings {
        f3_settings.enabled = settings.should_show_f3();
    }
}

pub fn clod_shadow_config_debug_line(settings: &ClodShadowRuntimeSettings) -> String {
    format!(
        "clod shadow config: mode {} load {} proxies {} f3 {} bench {} path {}",
        settings.mode_label(),
        settings.should_load_snapshot(),
        settings.should_spawn_proxy_casters(),
        settings.should_show_f3(),
        settings.should_emit_bench_metrics(),
        settings.snapshot_path.display(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_mode_preserves_runtime_actions() {
        let settings = ClodShadowRuntimeSettings::default();
        assert_eq!(settings.mode, ClodShadowRuntimeMode::Proxy);
        assert_eq!(
            settings.effective_action(ClodShadowRuntimeAction::SpawnProxyShadowCaster),
            Some(ClodShadowRuntimeAction::SpawnProxyShadowCaster)
        );
        assert!(!settings.should_load_snapshot());
        assert!(settings.should_configure_light_layers());
    }

    #[test]
    fn disabled_mode_blocks_all_runtime_actions() {
        let settings = ClodShadowRuntimeSettings {
            mode: ClodShadowRuntimeMode::Disabled,
            ..Default::default()
        };
        assert_eq!(
            settings.effective_action(ClodShadowRuntimeAction::UseVisualMeshCaster),
            None
        );
        assert!(!settings.should_load_snapshot());
        assert!(!settings.should_show_f3());
    }

    #[test]
    fn visual_mode_replaces_proxy_and_no_cast_actions() {
        let settings = ClodShadowRuntimeSettings {
            mode: ClodShadowRuntimeMode::VisualOnly,
            ..Default::default()
        };
        assert_eq!(
            settings.effective_action(ClodShadowRuntimeAction::SpawnProxyShadowCaster),
            Some(ClodShadowRuntimeAction::UseVisualMeshCaster)
        );
        assert_eq!(
            settings.effective_action(ClodShadowRuntimeAction::ApplyNotShadowCaster),
            Some(ClodShadowRuntimeAction::UseVisualMeshCaster)
        );
    }

    #[test]
    fn no_cast_mode_forces_not_shadow_caster() {
        let settings = ClodShadowRuntimeSettings {
            mode: ClodShadowRuntimeMode::NoCastOnly,
            ..Default::default()
        };
        assert_eq!(
            settings.effective_action(ClodShadowRuntimeAction::UseVisualMeshCaster),
            Some(ClodShadowRuntimeAction::ApplyNotShadowCaster)
        );
    }

    #[test]
    fn env_parser_sets_mode_and_path() {
        let settings = clod_shadow_settings_from_env_pairs([
            (ENV_CLOD_SHADOWS, "visual"),
            (ENV_CLOD_SHADOW_SNAPSHOT, "assets/generated/clod/test.json"),
            (ENV_CLOD_SHADOW_AUTO_RELOAD, "1"),
            (ENV_CLOD_SHADOW_F3, "false"),
        ]);

        assert_eq!(settings.mode, ClodShadowRuntimeMode::VisualOnly);
        assert_eq!(
            settings.snapshot_path,
            PathBuf::from("assets/generated/clod/test.json")
        );
        assert!(settings.auto_reload_snapshot);
        assert!(!settings.f3_overlay_enabled);
    }

    #[test]
    fn render_toggles_apply_in_priority_order() {
        let mut settings = ClodShadowRuntimeSettings::default();
        apply_clod_shadow_render_toggles(
            &mut settings,
            &ClodShadowRenderToggles {
                force_visual_mesh_shadows: true,
                force_no_cast_shadows: true,
                disable_clod_shadow_snapshot_loading: true,
                disable_clod_shadow_bench_metrics: true,
                ..Default::default()
            },
        );

        assert_eq!(settings.mode, ClodShadowRuntimeMode::NoCastOnly);
        assert!(!settings.load_snapshot);
        assert!(!settings.bench_metrics_enabled);
    }

    #[test]
    fn debug_line_is_stable_and_human_readable() {
        let line = clod_shadow_config_debug_line(&ClodShadowRuntimeSettings::default());
        assert!(line.contains("clod shadow config"));
        assert!(line.contains("mode proxy"));
        assert!(line.contains(DEFAULT_CLOD_SHADOW_SNAPSHOT_PATH));
    }

    #[test]
    fn mode_code_is_stable_for_bench_rows() {
        assert_eq!(
            ClodShadowRuntimeSettings {
                mode: ClodShadowRuntimeMode::Disabled,
                ..Default::default()
            }
            .mode_code(),
            0
        );
        assert_eq!(ClodShadowRuntimeSettings::default().mode_code(), 1);
        assert_eq!(
            ClodShadowRuntimeSettings {
                mode: ClodShadowRuntimeMode::VisualOnly,
                ..Default::default()
            }
            .mode_code(),
            2
        );
        assert_eq!(
            ClodShadowRuntimeSettings {
                mode: ClodShadowRuntimeMode::NoCastOnly,
                ..Default::default()
            }
            .mode_code(),
            3
        );
    }
}
