//! CLOD page rebuild observability.
//!
//! `tools/clod-poc` measures the edit/rebuild path as a pipeline: dirty inputs,
//! LOD0 page source rebuild, ancestor re-simplification, then runtime cut refresh.
//! The Bevy runtime performs those steps through `PageExportCache` and
//! `ClodPageTree`. This module observes those existing state transitions and
//! exports a small CSV for bench/debug parity without changing rebuild logic.

use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::runtime::PageExportCache;

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodRebuildObserverSettings {
    /// Enables CSV output. Kept opt-in so normal play never touches disk.
    pub enabled: bool,
    /// Destination file. Existing files are appended to so a multi-phase bench can share a run.
    pub csv_path: PathBuf,
}

impl Default for ClodRebuildObserverSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_REBUILD_CSV"),
            csv_path: env::var("VOXEL_CLOD_REBUILD_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-rebuild-observer.csv")),
        }
    }
}

#[derive(Resource, Debug)]
pub(crate) struct ClodRebuildObserverState {
    frame: u64,
    sequence: u64,
    last_cache_revision: u64,
    last_tree_revision: u64,
    current: Option<ObservedRebuild>,
    last_error: Option<String>,
}

impl Default for ClodRebuildObserverState {
    fn default() -> Self {
        Self {
            frame: 0,
            sequence: 0,
            last_cache_revision: 0,
            last_tree_revision: 0,
            current: None,
            last_error: None,
        }
    }
}

#[derive(Debug)]
struct ObservedRebuild {
    sequence: u64,
    input_revision: u64,
    tree_revision_start: u64,
    started_at: Instant,
    input_frame: u64,
    source_complete_at: Option<Instant>,
    source_complete_frame: Option<u64>,
    build_started_at: Option<Instant>,
    build_started_frame: Option<u64>,
    latest_exports: usize,
    latest_complete_pages: usize,
    latest_page_coords: usize,
}

fn env_flag(name: &str) -> bool {
    env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        )
    })
}

pub(crate) fn clod_rebuild_observer_system(
    settings: Res<ClodRebuildObserverSettings>,
    mut state: ResMut<ClodRebuildObserverState>,
    cache: Res<PageExportCache>,
    tree: Res<ClodPageTree>,
) {
    if !settings.enabled {
        return;
    }

    state.frame = state.frame.saturating_add(1);

    if cache.revision != state.last_cache_revision {
        state.sequence = state.sequence.saturating_add(1);
        state.current = Some(ObservedRebuild {
            sequence: state.sequence,
            input_revision: cache.revision,
            tree_revision_start: tree.revision,
            started_at: Instant::now(),
            input_frame: state.frame,
            source_complete_at: None,
            source_complete_frame: None,
            build_started_at: None,
            build_started_frame: None,
            latest_exports: cache.exports.len(),
            latest_complete_pages: cache.complete_pages.len(),
            latest_page_coords: tree.build_page_coords.len(),
        });
        state.last_cache_revision = cache.revision;
    }

    let frame = state.frame;
    let last_tree_revision = state.last_tree_revision;
    let Some(current) = state.current.as_mut() else {
        state.last_tree_revision = tree.revision;
        return;
    };

    current.latest_exports = cache.exports.len();
    current.latest_complete_pages = cache.complete_pages.len();
    current.latest_page_coords = tree.build_page_coords.len().max(tree.page_coords.len());

    if current.source_complete_at.is_none()
        && cache.complete_pages_revision == current.input_revision
        && cache.complete_pages_world_chunk_count > 0
    {
        current.source_complete_at = Some(Instant::now());
        current.source_complete_frame = Some(frame);
    }

    if current.build_started_at.is_none()
        && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Building))
    {
        current.build_started_at = Some(Instant::now());
        current.build_started_frame = Some(frame);
    }

    let published_new_tree = tree.revision != current.tree_revision_start
        && tree.revision != last_tree_revision
        && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready));

    if !published_new_tree {
        drop(current);
        state.last_tree_revision = tree.revision;
        return;
    }

    let sequence = current.sequence;
    let input_revision = current.input_revision;
    let tree_revision_start = current.tree_revision_start;
    let input_frame = current.input_frame;
    let source_complete_frame = current.source_complete_frame;
    let build_started_frame = current.build_started_frame;
    let latest_exports = current.latest_exports;
    let latest_complete_pages = current.latest_complete_pages;
    let latest_page_coords = current.latest_page_coords;
    let source_complete_at = current.source_complete_at;
    let build_started_at = current.build_started_at;
    let started_at = current.started_at;
    drop(current);

    let published_at = Instant::now();
    let snapshot = ClodRebuildSnapshot {
        sequence,
        input_revision,
        tree_revision_start,
        tree_revision_published: tree.revision,
        input_frame,
        source_complete_frame,
        build_started_frame,
        published_frame: frame,
        exports: latest_exports,
        complete_pages: latest_complete_pages,
        page_coords: latest_page_coords,
        nodes: total_nodes(&tree),
        triangles: total_triangles(&tree),
        nodes_by_level: nodes_by_level_field(&tree),
        source_complete_ms: elapsed_ms(source_complete_at, started_at),
        build_started_ms: elapsed_ms(build_started_at, started_at),
        publish_ms: Some(ms(published_at.duration_since(started_at))),
        total_ms: ms(published_at.duration_since(started_at)),
    };

    if let Err(err) = append_snapshot_csv(&settings.csv_path, &snapshot) {
        let msg = err.to_string();
        if state.last_error.as_deref() != Some(msg.as_str()) {
            warn!(
                "Failed to export CLOD rebuild observer stats to {:?}: {msg}",
                settings.csv_path
            );
            state.last_error = Some(msg);
        }
    } else {
        state.last_error = None;
    }

    state.last_tree_revision = tree.revision;
    state.current = None;
}

#[derive(Clone, Debug, PartialEq)]
struct ClodRebuildSnapshot {
    sequence: u64,
    input_revision: u64,
    tree_revision_start: u64,
    tree_revision_published: u64,
    input_frame: u64,
    source_complete_frame: Option<u64>,
    build_started_frame: Option<u64>,
    published_frame: u64,
    exports: usize,
    complete_pages: usize,
    page_coords: usize,
    nodes: usize,
    triangles: usize,
    nodes_by_level: String,
    source_complete_ms: Option<f64>,
    build_started_ms: Option<f64>,
    publish_ms: Option<f64>,
    total_ms: f64,
}

fn total_nodes(tree: &ClodPageTree) -> usize {
    tree.nodes_by_level.iter().map(Vec::len).sum()
}

fn total_triangles(tree: &ClodPageTree) -> usize {
    tree.nodes_by_level
        .iter()
        .flatten()
        .map(|node| node.mesh.triangle_count())
        .sum()
}

fn nodes_by_level_field(tree: &ClodPageTree) -> String {
    tree.nodes_by_level
        .iter()
        .enumerate()
        .filter(|(_, nodes)| !nodes.is_empty())
        .map(|(level, nodes)| format!("L{level}:{}", nodes.len()))
        .collect::<Vec<_>>()
        .join(";")
}

fn elapsed_ms(mark: Option<Instant>, start: Instant) -> Option<f64> {
    mark.map(|instant| ms(instant.duration_since(start)))
}

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn append_snapshot_csv(path: &PathBuf, snapshot: &ClodRebuildSnapshot) -> std::io::Result<()> {
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }

    let write_header = fs::metadata(path).map(|meta| meta.len() == 0).unwrap_or(true);
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    if write_header {
        writeln!(
            file,
            "sequence,input_revision,tree_revision_start,tree_revision_published,input_frame,source_complete_frame,build_started_frame,published_frame,exports,complete_pages,page_coords,nodes,triangles,nodes_by_level,source_complete_ms,build_started_ms,publish_ms,total_ms"
        )?;
    }
    writeln!(
        file,
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
        snapshot.sequence,
        snapshot.input_revision,
        snapshot.tree_revision_start,
        snapshot.tree_revision_published,
        snapshot.input_frame,
        csv_opt_u64(snapshot.source_complete_frame),
        csv_opt_u64(snapshot.build_started_frame),
        snapshot.published_frame,
        snapshot.exports,
        snapshot.complete_pages,
        snapshot.page_coords,
        snapshot.nodes,
        snapshot.triangles,
        snapshot.nodes_by_level,
        csv_opt_f64(snapshot.source_complete_ms),
        csv_opt_f64(snapshot.build_started_ms),
        csv_opt_f64(snapshot.publish_ms),
        format_ms(snapshot.total_ms),
    )
}

fn csv_opt_u64(value: Option<u64>) -> String {
    value.map(|v| v.to_string()).unwrap_or_default()
}

fn csv_opt_f64(value: Option<f64>) -> String {
    value.map(format_ms).unwrap_or_default()
}

fn format_ms(value: f64) -> String {
    format!("{value:.3}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_option_fields_are_blank_when_missing() {
        assert_eq!(csv_opt_u64(None), "");
        assert_eq!(csv_opt_f64(None), "");
        assert_eq!(csv_opt_u64(Some(42)), "42");
        assert_eq!(csv_opt_f64(Some(12.34567)), "12.346");
    }

    #[test]
    fn milliseconds_are_formatted_stably() {
        assert_eq!(format_ms(0.0), "0.000");
        assert_eq!(format_ms(1.23456), "1.235");
    }
}

