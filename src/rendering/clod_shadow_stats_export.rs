//! F3/debug-overlay and bench-facing stat formatting for CLOD shadows.
//!
//! This module deliberately does not depend on the existing F3 overlay or bench
//! CSV implementation.  The integration point can call these helpers and append
//! their lines/metrics to the current debug UI and benchmark output.

use super::{
    clod_shadow_assets::ClodShadowSnapshotLoadStats, clod_shadow_spawn::ClodShadowRuntimeSpawnStats,
};

#[derive(Debug, Clone, PartialEq)]
pub struct ClodShadowBenchMetric {
    pub name: &'static str,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClodShadowDebugLines {
    pub loader: String,
    pub runtime: String,
    pub triangles: String,
    pub warning: Option<String>,
}

pub fn percent(saved: u32, total: u32) -> f32 {
    if total == 0 {
        0.0
    } else {
        (saved as f32 / total as f32) * 100.0
    }
}

/// Build compact F3/debug overlay lines.
pub fn format_clod_shadow_debug_lines(
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) -> ClodShadowDebugLines {
    let loaded_savings = percent(load.loaded_saved_triangles, load.loaded_visual_triangles);
    let runtime_savings = percent(spawn.saved_triangles, spawn.visual_triangles);

    let loader = format!(
        "clod shadow asset: gen {} loads {}/{} pages {} proxies {} saved {:.1}%",
        load.active_generation,
        load.successful_loads,
        load.attempted_loads,
        load.loaded_pages,
        load.loaded_proxy_meshes,
        loaded_savings,
    );

    let runtime = format!(
        "clod shadow runtime: visual {} proxy {} no-cast {} spawned {} missing visual {} proxy {}",
        spawn.visual_caster_pages,
        spawn.proxy_caster_pages,
        spawn.no_cast_pages,
        spawn.spawned_proxy_entities,
        spawn.missing_visual_entities,
        spawn.missing_proxy_meshes,
    );

    let triangles = format!(
        "clod shadow tris: visual {} shadow {} saved {} ({:.1}%)",
        spawn.visual_triangles,
        spawn.runtime_shadow_triangles,
        spawn.saved_triangles,
        runtime_savings,
    );

    let warning = if let Some(error) = &load.last_error {
        Some(format!("clod shadow load error: {error}"))
    } else if spawn.missing_visual_entities > 0 || spawn.missing_proxy_meshes > 0 {
        Some(format!(
            "clod shadow incomplete: missing visual {} proxy {}",
            spawn.missing_visual_entities, spawn.missing_proxy_meshes
        ))
    } else {
        None
    };

    ClodShadowDebugLines {
        loader,
        runtime,
        triangles,
        warning,
    }
}

/// Convert loader/spawn stats to stable bench metric rows.
pub fn clod_shadow_bench_metrics(
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) -> Vec<ClodShadowBenchMetric> {
    vec![
        ClodShadowBenchMetric {
            name: "Clod Shadow Snapshot Loads",
            value: load.successful_loads as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Snapshot Failed Loads",
            value: load.failed_loads as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Loaded Pages",
            value: load.loaded_pages as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Loaded Proxy Meshes",
            value: load.loaded_proxy_meshes as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Visual Caster Pages",
            value: spawn.visual_caster_pages as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Proxy Caster Pages",
            value: spawn.proxy_caster_pages as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow No Cast Pages",
            value: spawn.no_cast_pages as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Spawned Proxy Entities",
            value: spawn.spawned_proxy_entities as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Missing Visual Entities",
            value: spawn.missing_visual_entities as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Missing Proxy Meshes",
            value: spawn.missing_proxy_meshes as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Visual Triangles",
            value: spawn.visual_triangles as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Runtime Triangles",
            value: spawn.runtime_shadow_triangles as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Saved Triangles",
            value: spawn.saved_triangles as f64,
        },
        ClodShadowBenchMetric {
            name: "Clod Shadow Saved Percent",
            value: percent(spawn.saved_triangles, spawn.visual_triangles) as f64,
        },
    ]
}

/// Convenience CSV serialization for bench code paths that collect rows as
/// `(name,value)` strings instead of typed metrics.
pub fn clod_shadow_bench_metric_rows(
    load: &ClodShadowSnapshotLoadStats,
    spawn: &ClodShadowRuntimeSpawnStats,
) -> Vec<(String, String)> {
    clod_shadow_bench_metrics(load, spawn)
        .into_iter()
        .map(|metric| (metric.name.to_owned(), format!("{:.4}", metric.value)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_stats() -> ClodShadowSnapshotLoadStats {
        ClodShadowSnapshotLoadStats {
            attempted_loads: 2,
            successful_loads: 1,
            failed_loads: 1,
            active_generation: 7,
            loaded_pages: 10,
            loaded_proxy_meshes: 4,
            loaded_visual_triangles: 1000,
            loaded_runtime_shadow_triangles: 250,
            loaded_saved_triangles: 750,
            last_path: None,
            last_error: None,
        }
    }

    fn spawn_stats() -> ClodShadowRuntimeSpawnStats {
        ClodShadowRuntimeSpawnStats {
            generation: 7,
            visual_caster_pages: 2,
            proxy_caster_pages: 4,
            no_cast_pages: 4,
            missing_visual_entities: 0,
            missing_proxy_meshes: 0,
            spawned_proxy_entities: 4,
            visual_triangles: 1000,
            runtime_shadow_triangles: 250,
            saved_triangles: 750,
        }
    }

    #[test]
    fn percent_handles_zero() {
        assert_eq!(percent(1, 0), 0.0);
        assert_eq!(percent(25, 100), 25.0);
    }

    #[test]
    fn debug_lines_include_runtime_counts_and_savings() {
        let lines = format_clod_shadow_debug_lines(&load_stats(), &spawn_stats());
        assert!(lines.loader.contains("pages 10"));
        assert!(lines.runtime.contains("visual 2 proxy 4 no-cast 4"));
        assert!(lines.triangles.contains("saved 750 (75.0%)"));
        assert!(lines.warning.is_none());
    }

    #[test]
    fn debug_lines_warn_on_loader_error() {
        let mut load = load_stats();
        load.last_error = Some("bad json".to_owned());
        let lines = format_clod_shadow_debug_lines(&load, &spawn_stats());
        assert_eq!(
            lines.warning,
            Some("clod shadow load error: bad json".to_owned())
        );
    }

    #[test]
    fn bench_metrics_are_stable_and_named() {
        let metrics = clod_shadow_bench_metrics(&load_stats(), &spawn_stats());
        assert_eq!(metrics.len(), 14);
        assert!(metrics.iter().any(|metric| {
            metric.name == "Clod Shadow Saved Percent" && (metric.value - 75.0).abs() < 0.001
        }));
    }

    #[test]
    fn bench_rows_format_values() {
        let rows = clod_shadow_bench_metric_rows(&load_stats(), &spawn_stats());
        assert!(rows.contains(&(
            "Clod Shadow Runtime Triangles".to_owned(),
            "250.0000".to_owned()
        )));
    }
}
