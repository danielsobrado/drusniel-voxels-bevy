//! Shared fantasy UI theme values for Bevy UI and egui.

use bevy::prelude::*;
use bevy_egui::egui;

// Visual style adapted from the MIT-licensed reference copied under docs/reference/world-of-claudecraft-ui.

pub const DR_PANEL_BG: Color = Color::srgba(0.08, 0.075, 0.065, 0.94);
pub const DR_PANEL_BG_STRONG: Color = Color::srgba(0.12, 0.11, 0.095, 0.98);
pub const DR_PANEL_BORDER: Color = Color::srgba(0.42, 0.34, 0.18, 0.92);
pub const DR_PANEL_BORDER_STRONG: Color = Color::srgba(0.72, 0.58, 0.25, 1.0);
pub const DR_GOLD: Color = Color::srgb(0.91, 0.79, 0.42);
pub const DR_GOLD_DIM: Color = Color::srgb(0.62, 0.51, 0.24);
pub const DR_TEXT: Color = Color::srgb(0.91, 0.87, 0.74);
pub const DR_TEXT_MUTED: Color = Color::srgb(0.61, 0.57, 0.47);
pub const DR_TEXT_DISABLED: Color = Color::srgba(0.45, 0.42, 0.35, 0.75);
pub const DR_BUTTON_BG: Color = Color::srgba(0.2, 0.18, 0.15, 0.94);
pub const DR_BUTTON_HOVER_BG: Color = Color::srgba(0.29, 0.25, 0.16, 0.96);
pub const DR_BUTTON_ACTIVE_BG: Color = Color::srgba(0.39, 0.32, 0.17, 0.98);
pub const DR_BUTTON_BORDER: Color = Color::srgba(0.47, 0.39, 0.23, 0.95);
pub const DR_DANGER: Color = Color::srgb(0.85, 0.42, 0.35);
pub const DR_OK: Color = Color::srgb(0.47, 0.72, 0.42);
pub const DR_BLUE: Color = Color::srgb(0.47, 0.68, 0.87);
pub const DR_SLOT_BG: Color = Color::srgba(0.05, 0.045, 0.04, 0.94);
pub const DR_SLOT_ACTIVE_BG: Color = Color::srgba(0.28, 0.22, 0.11, 0.98);
pub const DR_OVERLAY_BG: Color = Color::srgba(0.03, 0.03, 0.04, 0.72);

pub const PANEL_PADDING: f32 = 16.0;
pub const PANEL_GAP: f32 = 12.0;
pub const BUTTON_PADDING_X: f32 = 14.0;
pub const BUTTON_PADDING_Y: f32 = 10.0;
pub const SLOT_SIZE: f32 = 64.0;
pub const SLOT_GAP: f32 = 6.0;
pub const HOTBAR_PANEL_PADDING: f32 = 8.0;
pub const WINDOW_TITLE_SIZE: f32 = 28.0;
pub const BODY_TEXT_SIZE: f32 = 18.0;
pub const SMALL_TEXT_SIZE: f32 = 13.0;

pub const DR_EGUI_PANEL_BG: egui::Color32 = egui::Color32::from_rgba_premultiplied(20, 19, 17, 240);
pub const DR_EGUI_PANEL_BG_STRONG: egui::Color32 =
    egui::Color32::from_rgba_premultiplied(31, 28, 24, 250);
pub const DR_EGUI_PANEL_BORDER: egui::Color32 = egui::Color32::from_rgb(107, 87, 45);
pub const DR_EGUI_GOLD: egui::Color32 = egui::Color32::from_rgb(233, 201, 106);
pub const DR_EGUI_TEXT: egui::Color32 = egui::Color32::from_rgb(232, 221, 189);
pub const DR_EGUI_TEXT_MUTED: egui::Color32 = egui::Color32::from_rgb(155, 146, 121);
pub const DR_EGUI_DEBUG_WINDOW_FILL: egui::Color32 =
    egui::Color32::from_rgba_premultiplied(26, 24, 21, 238);
pub const DR_EGUI_DEBUG_PANEL_FILL: egui::Color32 =
    egui::Color32::from_rgba_premultiplied(20, 19, 17, 224);
pub const DR_EGUI_DEBUG_EXTREME_BG: egui::Color32 = egui::Color32::from_rgb(12, 11, 10);
pub const DR_EGUI_DEBUG_FAINT_BG: egui::Color32 =
    egui::Color32::from_rgba_premultiplied(48, 42, 31, 140);
pub const DR_EGUI_DEBUG_INACTIVE_STROKE: egui::Color32 = egui::Color32::from_rgb(92, 76, 42);
pub const DR_EGUI_DEBUG_SELECTION_BG: egui::Color32 = egui::Color32::from_rgb(112, 91, 45);

pub fn fantasy_egui_visuals() -> egui::Visuals {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = DR_EGUI_PANEL_BG;
    visuals.window_fill = DR_EGUI_PANEL_BG_STRONG;
    visuals.window_stroke = egui::Stroke::new(1.0, DR_EGUI_PANEL_BORDER);
    visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, DR_EGUI_TEXT_MUTED);
    visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(34, 30, 25);
    visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0, DR_EGUI_TEXT);
    visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(75, 64, 40);
    visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0, egui::Color32::WHITE);
    visuals.widgets.active.bg_fill = egui::Color32::from_rgb(99, 82, 43);
    visuals.widgets.active.fg_stroke = egui::Stroke::new(1.0, DR_EGUI_GOLD);
    visuals.selection.bg_fill = egui::Color32::from_rgb(99, 82, 43);
    visuals
}

pub fn apply_fantasy_egui_style(ctx: &egui::Context) {
    ctx.set_visuals(fantasy_egui_visuals());
}
