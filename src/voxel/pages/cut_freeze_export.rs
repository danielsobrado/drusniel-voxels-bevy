//! CSV export for CLOD cut-freeze state.
//!
//! Selection freeze is a debug/QA lock on the active rendered cut.  This module
//! records both the debug control and the resulting selection state so benches
//! can prove that a frozen cut stays stable.

use std::collections::hash_map::DefaultHasher;
use std::fs::{File, OpenOptions, create_dir_all};
use std::hash::{Hash, Hasher};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use bevy::prelude::*;

use super::selection::{
    ClodPageNodeKey, ClodPageSelectionState, ClodSelectionDebugControls,
    ClodSelectionRuntimeStats,
};

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodCutFreezeExportSettings {
    pub enabled: bool,
    pub path: PathBuf,
    pub sample_every_frames: u64,
}

impl Default for ClodCutFreezeExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_CUT_FREEZE_CSV"),
            path: std::env::var("VOXEL_CLOD_CUT_FREEZE_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-cut-freeze.csv")),
            sample_every_frames: std::env::var("VOXEL_CLOD_CUT_FREEZE_SAMPLE_EVERY")
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(1)
                .max(1),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodCutFreezeExportState {
    writer: Option<BufWriter<File>>,
    frame: u64,
    last_written_frame: Option<u64>,
    disabled_after_error: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClodCutFreezeSnapshot {
    pub frame: u64,
    pub freeze_requested: bool,
    pub frozen_active: bool,
    pub rendered_pages: usize,
    pub split_pages: usize,
    pub forced_splits: u32,
    pub blocked_splits: u32,
    pub near_field_forced_splits: u32,
    pub cut_digest: String,
    pub cut_keys: String,
}

pub(crate) fn clod_cut_freeze_export_system(
    settings: Res<ClodCutFreezeExportSettings>,
    mut state: ResMut<ClodCutFreezeExportState>,
    controls: Res<ClodSelectionDebugControls>,
    selection: Res<ClodPageSelectionState>,
    stats: Res<ClodSelectionRuntimeStats>,
) {
    let frame = state.frame;
    state.frame = state.frame.saturating_add(1);

    if !settings.enabled || state.disabled_after_error {
        return;
    }
    if frame % settings.sample_every_frames != 0 || state.last_written_frame == Some(frame) {
        return;
    }

    let snapshot = build_snapshot(
        frame,
        controls.freeze_selection,
        stats.frozen,
        selection.rendered_keys(),
        *stats,
    );

    let line = format!(
        "{frame},{freeze_requested},{frozen_active},{rendered_pages},{split_pages},{forced_splits},{blocked_splits},{near_field_forced_splits},{cut_digest},{cut_keys}\n",
        frame = snapshot.frame,
        freeze_requested = u8::from(snapshot.freeze_requested),
        frozen_active = u8::from(snapshot.frozen_active),
        rendered_pages = snapshot.rendered_pages,
        split_pages = snapshot.split_pages,
        forced_splits = snapshot.forced_splits,
        blocked_splits = snapshot.blocked_splits,
        near_field_forced_splits = snapshot.near_field_forced_splits,
        cut_digest = snapshot.cut_digest,
        cut_keys = snapshot.cut_keys,
    );

    if let Err(err) = append_line(&settings.path, &mut state, &line) {
        warn!("failed to write CLOD cut-freeze CSV {}: {err}", settings.path.display());
        state.disabled_after_error = true;
        return;
    }
    state.last_written_frame = Some(frame);
}

fn build_snapshot<I>(
    frame: u64,
    freeze_requested: bool,
    frozen_active: bool,
    rendered: I,
    stats: ClodSelectionRuntimeStats,
) -> ClodCutFreezeSnapshot
where
    I: IntoIterator<Item = ClodPageNodeKey>,
{
    let mut keys: Vec<ClodPageNodeKey> = rendered.into_iter().collect();
    keys.sort_by_key(|key| (key.level, key.coord.0, key.coord.1));

    let cut_digest = cut_digest(&keys);
    let cut_keys = keys
        .iter()
        .map(|key| format!("{}:{}:{}", key.level, key.coord.0, key.coord.1))
        .collect::<Vec<_>>()
        .join(";");

    ClodCutFreezeSnapshot {
        frame,
        freeze_requested,
        frozen_active,
        rendered_pages: keys.len(),
        split_pages: stats.split_pages,
        forced_splits: stats.forced_splits,
        blocked_splits: stats.blocked_splits,
        near_field_forced_splits: stats.near_field_forced_splits,
        cut_digest,
        cut_keys,
    }
}

fn cut_digest(keys: &[ClodPageNodeKey]) -> String {
    let mut hasher = DefaultHasher::new();
    for key in keys {
        key.level.hash(&mut hasher);
        key.coord.0.hash(&mut hasher);
        key.coord.1.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

fn append_line(
    path: &Path,
    state: &mut ClodCutFreezeExportState,
    line: &str,
) -> std::io::Result<()> {
    if state.writer.is_none() {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                create_dir_all(parent)?;
            }
        }
        let file_exists = path.exists();
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let mut writer = BufWriter::new(file);
        if !file_exists {
            writer.write_all(b"frame,freeze_requested,frozen_active,rendered_pages,split_pages,forced_splits,blocked_splits,near_field_forced_splits,cut_digest,cut_keys\n")?;
        }
        state.writer = Some(writer);
    }

    if let Some(writer) = &mut state.writer {
        writer.write_all(line.as_bytes())?;
        writer.flush()?;
    }
    Ok(())
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).ok().is_some_and(|value| {
        matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(level: usize, x: i32, z: i32) -> ClodPageNodeKey {
        ClodPageNodeKey::new(level, (x, z))
    }

    #[test]
    fn digest_is_order_independent_after_sorting() {
        let stats = ClodSelectionRuntimeStats { rendered_pages: 2, split_pages: 1, forced_splits: 0, blocked_splits: 0, near_field_forced_splits: 0, frozen: true };
        let a = build_snapshot(1, true, true, [key(0, 1, 0), key(0, 0, 0)], stats);
        let b = build_snapshot(1, true, true, [key(0, 0, 0), key(0, 1, 0)], stats);
        assert_eq!(a.cut_digest, b.cut_digest);
        assert_eq!(a.cut_keys, "0:0:0;0:1:0");
    }

    #[test]
    fn snapshot_carries_split_counters() {
        let stats = ClodSelectionRuntimeStats { rendered_pages: 1, split_pages: 7, forced_splits: 2, blocked_splits: 3, near_field_forced_splits: 4, frozen: true };
        let snapshot = build_snapshot(9, true, true, [key(0, 0, 0)], stats);
        assert_eq!(snapshot.split_pages, 7);
        assert_eq!(snapshot.forced_splits, 2);
        assert_eq!(snapshot.blocked_splits, 3);
        assert_eq!(snapshot.near_field_forced_splits, 4);
    }
}
