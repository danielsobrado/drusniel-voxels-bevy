//! CSV export for the CLOD crossfade runtime/material bridge.
//!
//! This is the bench/debug companion for the PoC-style dither crossfade path:
//! it records the runtime transition counters and the concrete page fade
//! components so visual regressions can be diagnosed without relying only on
//! screenshots.

use std::fs::{File, OpenOptions, create_dir_all};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use bevy::prelude::*;

use super::crossfade::ClodDitherRole;
use super::crossfade_runtime::{ClodCrossfadeFrameClock, ClodCrossfadeRuntimeState, ClodPageFade};
use super::fade_material::ClodFadeMaterialSettings;
use super::render::ClodPageMeshTag;

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodCrossfadeStatsExportSettings {
    pub enabled: bool,
    pub path: PathBuf,
    pub sample_every_frames: u64,
}

impl Default for ClodCrossfadeStatsExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_CROSSFADE_STATS_CSV"),
            path: std::env::var("VOXEL_CLOD_CROSSFADE_STATS_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-crossfade-runtime.csv")),
            sample_every_frames: std::env::var("VOXEL_CLOD_CROSSFADE_STATS_SAMPLE_EVERY")
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(1)
                .max(1),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodCrossfadeStatsExportState {
    writer: Option<BufWriter<File>>,
    last_written_frame: Option<u64>,
    disabled_after_error: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ClodFadeEntityStats {
    pub page_entities: usize,
    pub faded_entities: usize,
    pub visible_faded_entities: usize,
    pub stable_entities: usize,
    pub fade_in_entities: usize,
    pub fade_out_entities: usize,
    pub min_alpha: f32,
    pub max_alpha: f32,
}

impl Default for ClodFadeEntityStats {
    fn default() -> Self {
        Self {
            page_entities: 0,
            faded_entities: 0,
            visible_faded_entities: 0,
            stable_entities: 0,
            fade_in_entities: 0,
            fade_out_entities: 0,
            min_alpha: 1.0,
            max_alpha: 1.0,
        }
    }
}

pub(crate) fn fade_entity_stats<I>(pages: I) -> ClodFadeEntityStats
where
    I: IntoIterator<Item = (Option<ClodPageFade>, bool)>,
{
    let mut stats = ClodFadeEntityStats::default();
    let mut saw_alpha = false;

    for (fade, visible) in pages {
        stats.page_entities += 1;

        let Some(fade) = fade else {
            continue;
        };

        stats.faded_entities += 1;
        if visible {
            stats.visible_faded_entities += 1;
        }

        match fade.role {
            ClodDitherRole::Stable => stats.stable_entities += 1,
            ClodDitherRole::FadeIn => stats.fade_in_entities += 1,
            ClodDitherRole::FadeOut => stats.fade_out_entities += 1,
        }

        if saw_alpha {
            stats.min_alpha = stats.min_alpha.min(fade.alpha);
            stats.max_alpha = stats.max_alpha.max(fade.alpha);
        } else {
            stats.min_alpha = fade.alpha;
            stats.max_alpha = fade.alpha;
            saw_alpha = true;
        }
    }

    stats
}

pub(crate) fn clod_crossfade_stats_export_system(
    settings: Res<ClodCrossfadeStatsExportSettings>,
    mut state: ResMut<ClodCrossfadeStatsExportState>,
    clock: Res<ClodCrossfadeFrameClock>,
    runtime_state: Res<ClodCrossfadeRuntimeState>,
    material_settings: Res<ClodFadeMaterialSettings>,
    pages: Query<(Option<&ClodPageFade>, &Visibility), With<ClodPageMeshTag>>,
) {
    if !settings.enabled || state.disabled_after_error {
        return;
    }

    let frame = clock.frame.saturating_sub(1);
    if frame % settings.sample_every_frames != 0 || state.last_written_frame == Some(frame) {
        return;
    }

    let stats = fade_entity_stats(
        pages
            .iter()
            .map(|(fade, visibility)| (fade.copied(), !matches!(*visibility, Visibility::Hidden))),
    );

    let transition_id = runtime_state.active_transition_id.as_deref().unwrap_or("");
    let line = format!(
        "{frame},{transition_id},{material_enabled},{stable_pages},{fade_in_pages},{fade_out_pages},{page_entities},{faded_entities},{visible_faded_entities},{stable_entities},{fade_in_entities},{fade_out_entities},{min_alpha:.6},{max_alpha:.6}\n",
        material_enabled = u8::from(material_settings.enabled),
        stable_pages = runtime_state.stable_pages,
        fade_in_pages = runtime_state.fade_in_pages,
        fade_out_pages = runtime_state.fade_out_pages,
        page_entities = stats.page_entities,
        faded_entities = stats.faded_entities,
        visible_faded_entities = stats.visible_faded_entities,
        stable_entities = stats.stable_entities,
        fade_in_entities = stats.fade_in_entities,
        fade_out_entities = stats.fade_out_entities,
        min_alpha = stats.min_alpha,
        max_alpha = stats.max_alpha,
    );

    match state.writer(&settings.path).and_then(|writer| {
        writer.write_all(line.as_bytes())?;
        writer.flush()
    }) {
        Ok(()) => state.last_written_frame = Some(frame),
        Err(error) => {
            state.disabled_after_error = true;
            warn!(
                "failed to write CLOD crossfade stats CSV {}: {error}",
                settings.path.display()
            );
        }
    }
}

impl ClodCrossfadeStatsExportState {
    fn writer(&mut self, path: &Path) -> std::io::Result<&mut BufWriter<File>> {
        if self.writer.is_none() {
            if let Some(parent) = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
            {
                create_dir_all(parent)?;
            }
            let file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(path)?;
            let mut writer = BufWriter::new(file);
            writer.write_all(
                b"frame,transition_id,material_enabled,stable_pages,fade_in_pages,fade_out_pages,page_entities,faded_entities,visible_faded_entities,stable_entities,fade_in_entities,fade_out_entities,min_alpha,max_alpha\n",
            )?;
            self.writer = Some(writer);
        }

        Ok(self.writer.as_mut().expect("writer initialized"))
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fade_entity_stats_counts_roles_and_alpha_extents() {
        let stats = fade_entity_stats([
            (
                Some(ClodPageFade {
                    alpha: 0.25,
                    role: ClodDitherRole::FadeIn,
                }),
                true,
            ),
            (
                Some(ClodPageFade {
                    alpha: 0.75,
                    role: ClodDitherRole::FadeOut,
                }),
                true,
            ),
            (
                Some(ClodPageFade {
                    alpha: 1.0,
                    role: ClodDitherRole::Stable,
                }),
                false,
            ),
            (None, false),
        ]);

        assert_eq!(stats.page_entities, 4);
        assert_eq!(stats.faded_entities, 3);
        assert_eq!(stats.visible_faded_entities, 2);
        assert_eq!(stats.fade_in_entities, 1);
        assert_eq!(stats.fade_out_entities, 1);
        assert_eq!(stats.stable_entities, 1);
        assert_eq!(stats.min_alpha, 0.25);
        assert_eq!(stats.max_alpha, 1.0);
    }

    #[test]
    fn fade_entity_stats_uses_visible_defaults_when_no_fades_exist() {
        let stats = fade_entity_stats([(None, true), (None, false)]);
        assert_eq!(stats.page_entities, 2);
        assert_eq!(stats.faded_entities, 0);
        assert_eq!(stats.min_alpha, 1.0);
        assert_eq!(stats.max_alpha, 1.0);
    }
}
