//! Machine-readable CLOD runtime stats.
//!
//! The CSV combines source-build progress with the active page cut so a bench cannot confuse
//! an empty CLOD runtime with a successful low-cost run.

use std::collections::BTreeMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use bevy::prelude::*;

use super::render::ClodPageMeshTag;
use super::runtime::PageExportCache;
use super::selection::{ClodPageSelectionIndex, ClodSelectionRuntimeStats};
use super::source_meshing::PageSourceMeshingStats;

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodRuntimeStatsExportSettings {
    /// Enables CSV sampling. Kept opt-in to avoid touching disk during normal play.
    pub enabled: bool,
    /// Destination file. Existing files are appended to so multiple bench phases can share a run.
    pub csv_path: PathBuf,
    /// Sample every N update frames. Use 1 for visual-regression benches.
    pub sample_every_frames: u64,
}

impl Default for ClodRuntimeStatsExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_STATS_CSV"),
            csv_path: env::var("VOXEL_CLOD_STATS_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-selection-runtime.csv")),
            sample_every_frames: env::var("VOXEL_CLOD_STATS_SAMPLE_EVERY")
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(1),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodRuntimeStatsExportState {
    frame: u64,
    last_error: Option<String>,
}

impl ClodRuntimeStatsExportState {
    #[cfg(test)]
    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

fn env_flag(name: &str) -> bool {
    env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        )
    })
}

pub(crate) fn clod_runtime_stats_export_system(
    settings: Res<ClodRuntimeStatsExportSettings>,
    mut state: ResMut<ClodRuntimeStatsExportState>,
    selection_stats: Res<ClodSelectionRuntimeStats>,
    source_stats: Res<PageSourceMeshingStats>,
    cache: Res<PageExportCache>,
    index: Res<ClodPageSelectionIndex>,
    page_query: Query<(&ClodPageMeshTag, &Visibility)>,
) {
    if !settings.enabled {
        return;
    }

    state.frame = state.frame.saturating_add(1);
    if state.frame % settings.sample_every_frames != 0 {
        return;
    }

    let visible_counts = visible_lod_counts(&page_query);
    let visible_pages: usize = visible_counts.values().sum();
    let snapshot = ClodRuntimeStatsSnapshot {
        frame: state.frame,
        revision: index.revision.unwrap_or_default(),
        source_exports: cache.exports.len(),
        complete_page_columns: cache.complete_pages.len(),
        source_pending_chunks: source_stats.pending_chunks,
        source_meshed_this_frame: source_stats.meshed_this_frame,
        source_failures_total: source_stats.failures_total,
        indexed_nodes: index.nodes().count(),
        root_nodes: index.root_count(),
        visible_pages,
        rendered_pages: selection_stats.rendered_pages,
        split_pages: selection_stats.split_pages,
        forced_splits: selection_stats.forced_splits,
        blocked_splits: selection_stats.blocked_splits,
        near_field_forced_splits: selection_stats.near_field_forced_splits,
        frozen: selection_stats.frozen,
        visible_lods: visible_lod_counts_field(&visible_counts),
    };

    if let Err(error) = append_snapshot_csv(&settings.csv_path, &snapshot) {
        let message = error.to_string();
        if state.last_error.as_deref() != Some(message.as_str()) {
            warn!(
                "Failed to export CLOD runtime stats to {:?}: {message}",
                settings.csv_path
            );
            state.last_error = Some(message);
        }
    } else {
        state.last_error = None;
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ClodRuntimeStatsSnapshot {
    frame: u64,
    revision: u64,
    source_exports: usize,
    complete_page_columns: usize,
    source_pending_chunks: usize,
    source_meshed_this_frame: usize,
    source_failures_total: u64,
    indexed_nodes: usize,
    root_nodes: usize,
    visible_pages: usize,
    rendered_pages: usize,
    split_pages: usize,
    forced_splits: u32,
    blocked_splits: u32,
    near_field_forced_splits: u32,
    frozen: bool,
    visible_lods: String,
}

fn visible_lod_counts(
    page_query: &Query<(&ClodPageMeshTag, &Visibility)>,
) -> BTreeMap<usize, usize> {
    let mut counts = BTreeMap::new();
    for (tag, visibility) in page_query.iter() {
        if is_hidden(visibility) {
            continue;
        }
        *counts.entry(tag.level).or_default() += 1;
    }
    counts
}

fn is_hidden(visibility: &Visibility) -> bool {
    matches!(visibility, Visibility::Hidden)
}

fn visible_lod_counts_field(counts: &BTreeMap<usize, usize>) -> String {
    counts
        .iter()
        .map(|(level, count)| format!("L{level}:{count}"))
        .collect::<Vec<_>>()
        .join(";")
}

fn append_snapshot_csv(path: &PathBuf, snapshot: &ClodRuntimeStatsSnapshot) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let needs_header = !path.exists() || path.metadata()?.len() == 0;
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    if needs_header {
        writeln!(
            file,
            "frame,revision,source_exports,complete_page_columns,source_pending_chunks,source_meshed_this_frame,source_failures_total,indexed_nodes,root_nodes,visible_pages,rendered_pages,split_pages,forced_splits,blocked_splits,near_field_forced_splits,frozen,visible_lods"
        )?;
    }
    writeln!(
        file,
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
        snapshot.frame,
        snapshot.revision,
        snapshot.source_exports,
        snapshot.complete_page_columns,
        snapshot.source_pending_chunks,
        snapshot.source_meshed_this_frame,
        snapshot.source_failures_total,
        snapshot.indexed_nodes,
        snapshot.root_nodes,
        snapshot.visible_pages,
        snapshot.rendered_pages,
        snapshot.split_pages,
        snapshot.forced_splits,
        snapshot.blocked_splits,
        snapshot.near_field_forced_splits,
        snapshot.frozen,
        snapshot.visible_lods,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_lod_counts_are_stable_and_compact() {
        let mut counts = BTreeMap::new();
        counts.insert(2, 1);
        counts.insert(0, 4);
        counts.insert(1, 3);

        assert_eq!(visible_lod_counts_field(&counts), "L0:4;L1:3;L2:1");
    }

    #[test]
    fn csv_export_writes_header_once() {
        let mut path = env::temp_dir();
        path.push(format!(
            "drusniel-clod-runtime-stats-{}-{}.csv",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = fs::remove_file(&path);

        let snapshot = ClodRuntimeStatsSnapshot {
            frame: 1,
            revision: 7,
            source_exports: 64,
            complete_page_columns: 4,
            source_pending_chunks: 8,
            source_meshed_this_frame: 4,
            source_failures_total: 0,
            indexed_nodes: 10,
            root_nodes: 1,
            visible_pages: 4,
            rendered_pages: 4,
            split_pages: 2,
            forced_splits: 1,
            blocked_splits: 0,
            near_field_forced_splits: 1,
            frozen: false,
            visible_lods: "L0:4".to_string(),
        };

        append_snapshot_csv(&path, &snapshot).expect("first append");
        append_snapshot_csv(&path, &snapshot).expect("second append");
        let text = fs::read_to_string(&path).expect("csv text");
        assert_eq!(text.lines().count(), 3);
        assert_eq!(text.matches("frame,revision").count(), 1);
        assert!(text.contains("source_exports"));
        assert!(text.contains(",64,4,8,4,0,10,"));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn export_state_clears_error_after_success() {
        let mut state = ClodRuntimeStatsExportState {
            frame: 0,
            last_error: Some("old".to_string()),
        };
        state.last_error = None;
        assert_eq!(state.last_error(), None);
    }
}
