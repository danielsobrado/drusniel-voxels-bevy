//! F3/debug overlay integration adapter for CLOD shadow stats.
//!
//! PR 0008 added pure formatting helpers.  This module turns those helpers into
//! a small Bevy-facing resource that the existing F3 overlay can read without
//! knowing about the loader/spawn internals.

use bevy::prelude::*;

use super::{
    clod_shadow_assets::ClodShadowSnapshotLoadStats,
    clod_shadow_config::{ClodShadowRuntimeSettings, clod_shadow_config_debug_line},
    clod_shadow_spawn::ClodShadowRuntimeSpawnStats,
    clod_shadow_stats_export::{ClodShadowDebugLines, format_clod_shadow_debug_lines},
};

#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClodShadowF3OverlaySettings {
    pub enabled: bool,
    pub show_config_line: bool,
    pub show_loader_line: bool,
    pub show_runtime_line: bool,
    pub show_triangle_line: bool,
    pub show_warning_line: bool,
}

impl Default for ClodShadowF3OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            show_config_line: true,
            show_loader_line: true,
            show_runtime_line: true,
            show_triangle_line: true,
            show_warning_line: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClodShadowF3LineKind {
    Info,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClodShadowF3OverlayLine {
    pub kind: ClodShadowF3LineKind,
    pub text: String,
}

impl ClodShadowF3OverlayLine {
    pub fn info(text: impl Into<String>) -> Self {
        Self {
            kind: ClodShadowF3LineKind::Info,
            text: text.into(),
        }
    }

    pub fn warning(text: impl Into<String>) -> Self {
        Self {
            kind: ClodShadowF3LineKind::Warning,
            text: text.into(),
        }
    }
}

#[derive(Resource, Debug, Clone, PartialEq, Eq, Default)]
pub struct ClodShadowF3OverlaySnapshot {
    pub generation: u64,
    pub lines: Vec<ClodShadowF3OverlayLine>,
}

impl ClodShadowF3OverlaySnapshot {
    pub fn visible_lines(&self) -> &[ClodShadowF3OverlayLine] {
        &self.lines
    }

    pub fn as_plain_text_lines(&self) -> Vec<String> {
        self.lines.iter().map(|line| line.text.clone()).collect()
    }
}

pub struct ClodShadowF3OverlayPlugin;

impl Plugin for ClodShadowF3OverlayPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodShadowF3OverlaySettings>()
            .init_resource::<ClodShadowF3OverlaySnapshot>()
            .add_systems(Update, refresh_clod_shadow_f3_overlay_snapshot);
    }
}

pub fn build_clod_shadow_f3_overlay_lines(
    settings: &ClodShadowF3OverlaySettings,
    formatted: &ClodShadowDebugLines,
) -> Vec<ClodShadowF3OverlayLine> {
    build_configured_clod_shadow_f3_overlay_lines(settings, formatted, None)
}

pub fn build_configured_clod_shadow_f3_overlay_lines(
    settings: &ClodShadowF3OverlaySettings,
    formatted: &ClodShadowDebugLines,
    runtime_settings: Option<&ClodShadowRuntimeSettings>,
) -> Vec<ClodShadowF3OverlayLine> {
    if !settings.enabled {
        return Vec::new();
    }

    let mut lines = Vec::with_capacity(5);

    if settings.show_config_line {
        if let Some(runtime_settings) = runtime_settings {
            lines.push(ClodShadowF3OverlayLine::info(
                clod_shadow_config_debug_line(runtime_settings),
            ));
        }
    }

    if settings.show_loader_line {
        lines.push(ClodShadowF3OverlayLine::info(formatted.loader.clone()));
    }
    if settings.show_runtime_line {
        lines.push(ClodShadowF3OverlayLine::info(formatted.runtime.clone()));
    }
    if settings.show_triangle_line {
        lines.push(ClodShadowF3OverlayLine::info(formatted.triangles.clone()));
    }
    if settings.show_warning_line {
        if let Some(warning) = &formatted.warning {
            lines.push(ClodShadowF3OverlayLine::warning(warning.clone()));
        }
    }

    lines
}

/// Append plain CLOD shadow lines into an existing F3 text buffer.
pub fn append_clod_shadow_f3_lines(
    output: &mut Vec<String>,
    settings: &ClodShadowF3OverlaySettings,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) {
    append_configured_clod_shadow_f3_lines(output, settings, None, load, spawn);
}

pub fn append_configured_clod_shadow_f3_lines(
    output: &mut Vec<String>,
    settings: &ClodShadowF3OverlaySettings,
    runtime_settings: Option<&ClodShadowRuntimeSettings>,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) {
    let formatted = format_clod_shadow_debug_lines(load, spawn);
    output.extend(
        build_configured_clod_shadow_f3_overlay_lines(settings, &formatted, runtime_settings)
            .into_iter()
            .map(|line| line.text),
    );
}

pub fn refresh_clod_shadow_f3_overlay_snapshot(
    settings: Res<ClodShadowF3OverlaySettings>,
    runtime_settings: Option<Res<ClodShadowRuntimeSettings>>,
    load: Res<ClodShadowSnapshotLoadStats>,
    spawn: Res<ClodShadowRuntimeSpawnStats>,
    mut snapshot: ResMut<ClodShadowF3OverlaySnapshot>,
) {
    let formatted = format_clod_shadow_debug_lines(&load, &spawn);
    snapshot.generation = spawn.generation.max(load.active_generation);
    snapshot.lines = build_configured_clod_shadow_f3_overlay_lines(
        &settings,
        &formatted,
        runtime_settings.as_deref(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_stats() -> ClodShadowSnapshotLoadStats {
        ClodShadowSnapshotLoadStats {
            attempted_loads: 1,
            successful_loads: 1,
            failed_loads: 0,
            active_generation: 9,
            loaded_pages: 12,
            loaded_proxy_meshes: 5,
            loaded_visual_triangles: 1000,
            loaded_runtime_shadow_triangles: 300,
            loaded_saved_triangles: 700,
            last_path: None,
            last_error: None,
        }
    }

    fn spawn_stats() -> ClodShadowRuntimeSpawnStats {
        ClodShadowRuntimeSpawnStats {
            generation: 9,
            visual_caster_pages: 3,
            proxy_caster_pages: 5,
            no_cast_pages: 4,
            missing_visual_entities: 0,
            missing_proxy_meshes: 0,
            spawned_proxy_entities: 5,
            visual_triangles: 1000,
            runtime_shadow_triangles: 300,
            saved_triangles: 700,
        }
    }

    #[test]
    fn f3_adapter_builds_expected_plain_lines() {
        let mut output = Vec::new();
        append_clod_shadow_f3_lines(
            &mut output,
            &ClodShadowF3OverlaySettings::default(),
            &load_stats(),
            &spawn_stats(),
        );

        assert_eq!(output.len(), 3);
        assert!(output[0].contains("clod shadow asset"));
        assert!(output[1].contains("visual 3 proxy 5 no-cast 4"));
        assert!(output[2].contains("saved 700"));
    }

    #[test]
    fn f3_adapter_can_prepend_runtime_config_line() {
        let mut output = Vec::new();
        append_configured_clod_shadow_f3_lines(
            &mut output,
            &ClodShadowF3OverlaySettings::default(),
            Some(&ClodShadowRuntimeSettings::default()),
            &load_stats(),
            &spawn_stats(),
        );

        assert_eq!(output.len(), 4);
        assert!(output[0].contains("clod shadow config: mode proxy"));
    }

    #[test]
    fn f3_adapter_can_show_warning() {
        let mut load = load_stats();
        load.last_error = Some("missing snapshot".to_owned());

        let formatted = format_clod_shadow_debug_lines(&load, &spawn_stats());
        let lines =
            build_clod_shadow_f3_overlay_lines(&ClodShadowF3OverlaySettings::default(), &formatted);

        assert_eq!(lines.last().unwrap().kind, ClodShadowF3LineKind::Warning);
        assert!(lines.last().unwrap().text.contains("missing snapshot"));
    }

    #[test]
    fn f3_adapter_obeys_settings() {
        let settings = ClodShadowF3OverlaySettings {
            show_loader_line: false,
            show_runtime_line: true,
            show_triangle_line: false,
            show_warning_line: false,
            ..Default::default()
        };

        let formatted = format_clod_shadow_debug_lines(&load_stats(), &spawn_stats());
        let lines = build_clod_shadow_f3_overlay_lines(&settings, &formatted);

        assert_eq!(lines.len(), 1);
        assert!(lines[0].text.contains("clod shadow runtime"));
    }
}
