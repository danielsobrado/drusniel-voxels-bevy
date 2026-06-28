//! Live CLOD diagnostics ported from the `tools/clod-poc` debug surface.
//!
//! The PoC exposes separate widgets for runtime stats, page boundaries,
//! error labels, locked-border overlays and wireframe. This module lands the
//! Bevy-side foundation: a lightweight egui panel plus page-footprint gizmos.
//! It intentionally stays inside `voxel::pages` so it can read selection/page
//! internals without pushing more CLOD-specific state into the global debug UI.

use std::collections::BTreeMap;
use std::env;

use bevy::prelude::*;
use bevy_egui::{egui, EguiContexts};

use super::render::ClodPageMeshTag;
use super::selection::{
    ClodPageNodeKey, ClodPageSelectionIndex, ClodSelectionDebugControls,
    ClodSelectionRuntimeStats,
};

#[derive(Resource, Debug, Clone)]
pub(crate) struct ClodDebugOverlaySettings {
    /// Show the compact CLOD stats/control window.
    pub show_overlay: bool,
    /// Draw visible page XZ footprints with Bevy gizmos.
    pub show_page_bounds: bool,
}

impl Default for ClodDebugOverlaySettings {
    fn default() -> Self {
        Self {
            show_overlay: env_flag("VOXEL_CLOD_DEBUG_OVERLAY"),
            show_page_bounds: env_flag("VOXEL_CLOD_DEBUG_BOUNDS"),
        }
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

pub(crate) fn toggle_clod_debug_overlay_system(
    keys: Res<ButtonInput<KeyCode>>,
    mut settings: ResMut<ClodDebugOverlaySettings>,
) {
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);

    if alt_held && !shift_held && keys.just_pressed(KeyCode::KeyO) {
        settings.show_overlay = !settings.show_overlay;
        info!(
            "CLOD debug overlay: {} (Alt+O to toggle)",
            if settings.show_overlay { "ON" } else { "OFF" }
        );
    }

    if alt_held && !shift_held && keys.just_pressed(KeyCode::KeyB) {
        settings.show_page_bounds = !settings.show_page_bounds;
        info!(
            "CLOD page bounds: {} (Alt+B to toggle)",
            if settings.show_page_bounds { "ON" } else { "OFF" }
        );
    }
}

pub(crate) fn clod_debug_overlay_ui_system(
    mut contexts: EguiContexts,
    settings: Res<ClodDebugOverlaySettings>,
    mut controls: ResMut<ClodSelectionDebugControls>,
    selection_stats: Res<ClodSelectionRuntimeStats>,
    index: Res<ClodPageSelectionIndex>,
    page_query: Query<(&ClodPageMeshTag, &Visibility)>,
) {
    if !settings.show_overlay {
        return;
    }

    let Ok(ctx) = contexts.ctx_mut() else {
        return;
    };

    let visible_counts = visible_page_counts_by_level(&page_query);
    let visible_total: usize = visible_counts.values().sum();
    let indexed_nodes = index.nodes().count();
    let root_count = index.root_count();
    let revision = index.revision;

    egui::Window::new("CLOD Debug")
        .default_width(320.0)
        .show(ctx, |ui| {
            ui.heading("Runtime cut");
            ui.label(format!("Tree revision: {:?}", revision));
            ui.label(format!("Indexed nodes: {indexed_nodes}"));
            ui.label(format!("Roots: {root_count}"));
            ui.label(format!("Visible page entities: {visible_total}"));
            ui.label(format!("Selected/rendered pages: {}", selection_stats.rendered_pages));
            ui.label(format!("Split nodes: {}", selection_stats.split_pages));

            if !visible_counts.is_empty() {
                ui.separator();
                ui.heading("Visible pages by LOD");
                for (level, count) in visible_counts {
                    ui.label(format!("L{level}: {count}"));
                }
            }

            ui.separator();
            ui.heading("Selection parity counters");
            ui.label(format!(
                "2:1 forced splits: {}",
                selection_stats.forced_splits
            ));
            ui.label(format!(
                "2:1 blocked splits: {}",
                selection_stats.blocked_splits
            ));
            ui.label(format!(
                "Near-field forced splits: {}",
                selection_stats.near_field_forced_splits
            ));
            ui.label(format!(
                "Frozen cut: {}",
                if selection_stats.frozen { "yes" } else { "no" }
            ));

            ui.separator();
            ui.heading("Debug controls");
            ui.checkbox(&mut controls.freeze_selection, "Freeze selection");

            let mut force_max_level_enabled = controls.forced_max_level.is_some();
            if ui
                .checkbox(&mut force_max_level_enabled, "Force max LOD level")
                .changed()
            {
                controls.forced_max_level = force_max_level_enabled.then_some(0);
            }

            if let Some(level) = controls.forced_max_level.as_mut() {
                ui.add(egui::Slider::new(level, 0..=12).text("max level"));
            }

            ui.label(format!(
                "Targeted force-split ids: {}",
                controls.force_split_ids.len()
            ));
            ui.label("Alt+O: overlay, Alt+B: page bounds");
            ui.label("Env: VOXEL_CLOD_DEBUG_OVERLAY=1, VOXEL_CLOD_DEBUG_BOUNDS=1");
        });
}

pub(crate) fn clod_page_bounds_gizmo_system(
    settings: Res<ClodDebugOverlaySettings>,
    index: Res<ClodPageSelectionIndex>,
    page_query: Query<(&ClodPageMeshTag, &Visibility)>,
    mut gizmos: Gizmos,
) {
    if !settings.show_page_bounds {
        return;
    }

    for (tag, visibility) in page_query.iter() {
        if is_hidden(visibility) {
            continue;
        }

        let key = ClodPageNodeKey::from(tag);
        let Some(node) = index.node(key) else {
            continue;
        };

        let y = node.mesh_bounds.max_y + 0.35;
        let fp = node.footprint;
        let a = Vec3::new(fp.min_x, y, fp.min_z);
        let b = Vec3::new(fp.max_x, y, fp.min_z);
        let c = Vec3::new(fp.max_x, y, fp.max_z);
        let d = Vec3::new(fp.min_x, y, fp.max_z);
        let color = level_color(tag.level);

        gizmos.line(a, b, color);
        gizmos.line(b, c, color);
        gizmos.line(c, d, color);
        gizmos.line(d, a, color);
    }
}

fn visible_page_counts_by_level(
    page_query: &Query<(&ClodPageMeshTag, &Visibility)>,
) -> BTreeMap<usize, usize> {
    let mut counts = BTreeMap::new();
    for (tag, visibility) in page_query.iter() {
        if !is_hidden(visibility) {
            *counts.entry(tag.level).or_insert(0) += 1;
        }
    }
    counts
}

fn is_hidden(visibility: &Visibility) -> bool {
    matches!(*visibility, Visibility::Hidden)
}

fn level_color(level: usize) -> Color {
    match level % 6 {
        0 => Color::srgb(0.40, 0.95, 0.55),
        1 => Color::srgb(0.45, 0.75, 1.00),
        2 => Color::srgb(1.00, 0.80, 0.35),
        3 => Color::srgb(1.00, 0.45, 0.45),
        4 => Color::srgb(0.75, 0.55, 1.00),
        _ => Color::srgb(0.35, 1.00, 0.95),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        unsafe { env::set_var("VOXEL_CLOD_DEBUG_OVERLAY_TEST", "yes") };
        assert!(env_flag("VOXEL_CLOD_DEBUG_OVERLAY_TEST"));
        unsafe { env::remove_var("VOXEL_CLOD_DEBUG_OVERLAY_TEST") };
    }

    #[test]
    fn level_color_cycles_without_panicking() {
        for level in 0..32 {
            let _ = level_color(level);
        }
    }
}
