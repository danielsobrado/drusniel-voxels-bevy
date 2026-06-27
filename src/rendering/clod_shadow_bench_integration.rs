//! Bench CSV/summary integration adapter for CLOD shadow stats.
//!
//! PR 0008 introduced stable metric names.  This module keeps a Bevy resource
//! with the latest metric rows so bench call sites can append them alongside the
//! existing render timing rows and summary values.

use bevy::prelude::*;

use super::{
    clod_shadow_assets::ClodShadowSnapshotLoadStats,
    clod_shadow_config::ClodShadowRuntimeSettings,
    clod_shadow_spawn::ClodShadowRuntimeSpawnStats,
    clod_shadow_stats_export::{clod_shadow_bench_metric_rows, clod_shadow_bench_metrics},
};

#[derive(Debug, Clone, PartialEq)]
pub struct ClodShadowBenchRow {
    pub name: String,
    pub value: String,
}

impl ClodShadowBenchRow {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

#[derive(Resource, Debug, Clone, PartialEq, Default)]
pub struct ClodShadowBenchSnapshot {
    pub generation: u64,
    pub rows: Vec<ClodShadowBenchRow>,
}

impl ClodShadowBenchSnapshot {
    pub fn as_pairs(&self) -> Vec<(String, String)> {
        self.rows
            .iter()
            .map(|row| (row.name.clone(), row.value.clone()))
            .collect()
    }

    pub fn push_into_pairs(&self, output: &mut Vec<(String, String)>) {
        output.extend(self.as_pairs());
    }
}

pub struct ClodShadowBenchIntegrationPlugin;

impl Plugin for ClodShadowBenchIntegrationPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodShadowBenchSnapshot>()
            .add_systems(Update, refresh_clod_shadow_bench_snapshot);
    }
}

pub fn build_clod_shadow_bench_rows(
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) -> Vec<ClodShadowBenchRow> {
    build_configured_clod_shadow_bench_rows(None, load, spawn)
}

pub fn build_configured_clod_shadow_bench_rows(
    settings: Option<&ClodShadowRuntimeSettings>,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) -> Vec<ClodShadowBenchRow> {
    if settings.is_some_and(|settings| !settings.should_emit_bench_metrics()) {
        return Vec::new();
    }

    let mut rows = Vec::new();
    if let Some(settings) = settings {
        rows.push(ClodShadowBenchRow::new(
            "Clod Shadow Runtime Mode",
            settings.mode_label(),
        ));
        rows.push(ClodShadowBenchRow::new(
            "Clod Shadow Runtime Mode Code",
            format!("{:.4}", settings.mode_code() as f64),
        ));
        rows.push(ClodShadowBenchRow::new(
            "Clod Shadow Snapshot Path",
            settings.snapshot_path.display().to_string(),
        ));
    }

    rows.extend(
        clod_shadow_bench_metric_rows(load, spawn)
            .into_iter()
            .map(|(name, value)| ClodShadowBenchRow::new(name, value)),
    );
    rows
}

/// Append CLOD shadow metrics into an existing bench row buffer.
pub fn append_clod_shadow_bench_rows(
    output: &mut Vec<(String, String)>,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) {
    append_configured_clod_shadow_bench_rows(output, None, load, spawn);
}

pub fn append_configured_clod_shadow_bench_rows(
    output: &mut Vec<(String, String)>,
    settings: Option<&ClodShadowRuntimeSettings>,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) {
    output.extend(
        build_configured_clod_shadow_bench_rows(settings, load, spawn)
            .into_iter()
            .map(|row| (row.name, row.value)),
    );
}

/// Numeric-key helper for summary writers that prefer raw f64 metrics.
pub fn append_clod_shadow_bench_summary_values(
    output: &mut Vec<(String, f64)>,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) {
    append_configured_clod_shadow_bench_summary_values(output, None, load, spawn);
}

pub fn append_configured_clod_shadow_bench_summary_values(
    output: &mut Vec<(String, f64)>,
    settings: Option<&ClodShadowRuntimeSettings>,
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) {
    if settings.is_some_and(|settings| !settings.should_emit_bench_metrics()) {
        return;
    }
    if let Some(settings) = settings {
        output.push((
            "Clod Shadow Runtime Mode Code".to_owned(),
            settings.mode_code() as f64,
        ));
    }
    output.extend(
        clod_shadow_bench_metrics(load, spawn)
            .into_iter()
            .map(|metric| (metric.name.to_owned(), metric.value)),
    );
}

pub fn refresh_clod_shadow_bench_snapshot(
    settings: Option<Res<ClodShadowRuntimeSettings>>,
    load: Res<ClodShadowSnapshotLoadStats>,
    spawn: Res<ClodShadowRuntimeSpawnStats>,
    mut snapshot: ResMut<ClodShadowBenchSnapshot>,
) {
    snapshot.generation = spawn.generation.max(load.active_generation);
    snapshot.rows = build_configured_clod_shadow_bench_rows(settings.as_deref(), &load, &spawn);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_stats() -> ClodShadowSnapshotLoadStats {
        ClodShadowSnapshotLoadStats {
            attempted_loads: 1,
            successful_loads: 1,
            failed_loads: 0,
            active_generation: 12,
            loaded_pages: 10,
            loaded_proxy_meshes: 4,
            loaded_visual_triangles: 2000,
            loaded_runtime_shadow_triangles: 500,
            loaded_saved_triangles: 1500,
            last_path: None,
            last_error: None,
        }
    }

    fn spawn_stats() -> ClodShadowRuntimeSpawnStats {
        ClodShadowRuntimeSpawnStats {
            generation: 12,
            visual_caster_pages: 2,
            proxy_caster_pages: 4,
            no_cast_pages: 4,
            missing_visual_entities: 1,
            missing_proxy_meshes: 0,
            spawned_proxy_entities: 4,
            visual_triangles: 2000,
            runtime_shadow_triangles: 500,
            saved_triangles: 1500,
        }
    }

    #[test]
    fn bench_adapter_exports_stable_rows() {
        let rows = build_clod_shadow_bench_rows(&load_stats(), &spawn_stats());
        assert_eq!(rows.len(), 14);
        assert!(rows.iter().any(|row| {
            row.name == "Clod Shadow Saved Percent" && row.value == "75.0000"
        }));
    }

    #[test]
    fn bench_adapter_exports_configured_mode_rows() {
        let rows = build_configured_clod_shadow_bench_rows(
            Some(&ClodShadowRuntimeSettings::default()),
            &load_stats(),
            &spawn_stats(),
        );

        assert_eq!(rows.len(), 17);
        assert!(rows.iter().any(|row| {
            row.name == "Clod Shadow Runtime Mode" && row.value == "proxy"
        }));
        assert!(rows.iter().any(|row| {
            row.name == "Clod Shadow Runtime Mode Code" && row.value == "1.0000"
        }));
    }

    #[test]
    fn bench_adapter_appends_pairs() {
        let mut rows = vec![("Existing Metric".to_owned(), "1.0000".to_owned())];
        append_clod_shadow_bench_rows(&mut rows, &load_stats(), &spawn_stats());
        assert_eq!(rows.first().unwrap().0, "Existing Metric");
        assert!(rows.iter().any(|row| row.0 == "Clod Shadow Missing Visual Entities"));
    }

    #[test]
    fn bench_adapter_exports_numeric_summary_values() {
        let mut values = Vec::new();
        append_clod_shadow_bench_summary_values(&mut values, &load_stats(), &spawn_stats());
        assert!(values.iter().any(|(name, value)| {
            name == "Clod Shadow Runtime Triangles" && (*value - 500.0).abs() < 0.001
        }));
    }

    #[test]
    fn configured_bench_summary_includes_mode_code() {
        let mut values = Vec::new();
        append_configured_clod_shadow_bench_summary_values(
            &mut values,
            Some(&ClodShadowRuntimeSettings::default()),
            &load_stats(),
            &spawn_stats(),
        );
        assert!(values.iter().any(|(name, value)| {
            name == "Clod Shadow Runtime Mode Code" && (*value - 1.0).abs() < 0.001
        }));
    }
}
