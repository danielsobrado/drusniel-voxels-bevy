use super::types::{TerrainTool, TerrainToolConfig, TerrainToolState};
use crate::audio::events::{AudioEventId, GameAudioEvent};
use bevy::input::mouse::MouseWheel;
use bevy::prelude::*;

pub fn handle_tool_input(
    keys: Res<ButtonInput<KeyCode>>,
    _mouse: Res<ButtonInput<MouseButton>>,
    mut scroll: MessageReader<MouseWheel>,
    mut state: ResMut<TerrainToolState>,
    config: Res<TerrainToolConfig>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    // Only process adjustments when in terraforming mode with an active tool
    if !state.terraforming_mode || state.active_tool == TerrainTool::None {
        return;
    }

    // Adjust radius with scroll + shift
    if keys.pressed(KeyCode::ShiftLeft) {
        let mut radius_changed = false;
        for event in scroll.read() {
            let delta = event.y.signum() * config.radius_step;
            let new_radius = (state.radius + delta).clamp(config.min_radius, config.max_radius);
            if new_radius != state.radius {
                state.radius = new_radius;
                radius_changed = true;
            }
        }
        if radius_changed {
            audio_events.write(GameAudioEvent::ui(AudioEventId::TerrainBrushRadius));
        }
    }
    // Adjust strength with scroll + ctrl
    else if keys.pressed(KeyCode::ControlLeft) {
        for event in scroll.read() {
            let delta = event.y.signum() * config.strength_step;
            state.strength =
                (state.strength + delta).clamp(config.min_strength, config.max_strength);
        }
    }
}

pub fn select_terrain_tool(
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<TerrainToolState>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let before = state.active_tool;

    // T key toggles terraforming mode
    if keys.just_pressed(KeyCode::KeyT) {
        state.terraforming_mode = !state.terraforming_mode;
        if state.terraforming_mode {
            // Default to Raise tool when entering terraforming mode
            state.active_tool = TerrainTool::Raise;
        } else {
            // Clear active tool when exiting
            state.active_tool = TerrainTool::None;
        }
    }
    // If not in terraforming mode, don't process tool selection
    else if !state.terraforming_mode {
        return;
    }
    // Escape exits terraforming mode
    else if keys.just_pressed(KeyCode::Escape) {
        state.terraforming_mode = false;
        state.active_tool = TerrainTool::None;
    }
    // Number keys 1-4 select tools when in terraforming mode
    else if keys.just_pressed(KeyCode::Digit1) {
        state.active_tool = TerrainTool::Raise;
    } else if keys.just_pressed(KeyCode::Digit2) {
        state.active_tool = TerrainTool::Lower;
    } else if keys.just_pressed(KeyCode::Digit3) {
        state.active_tool = TerrainTool::Level;
        state.target_height = None; // Reset target
    } else if keys.just_pressed(KeyCode::Digit4) {
        state.active_tool = TerrainTool::Smooth;
    }

    if state.active_tool != before {
        audio_events.write(GameAudioEvent::ui(AudioEventId::TerrainToolSelect));
    }
}
