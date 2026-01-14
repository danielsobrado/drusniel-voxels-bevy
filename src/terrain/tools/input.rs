use bevy::prelude::*;
use bevy::input::mouse::MouseWheel;
use super::types::{TerrainTool, TerrainToolState, TerrainToolConfig};

pub fn handle_tool_input(
    keys: Res<ButtonInput<KeyCode>>,
    _mouse: Res<ButtonInput<MouseButton>>,
    mut scroll: MessageReader<MouseWheel>,
    mut state: ResMut<TerrainToolState>,
    config: Res<TerrainToolConfig>,
) {
    // Tool selection (when terrain mode active)
    if state.active_tool != TerrainTool::None {
        // Adjust radius with scroll + shift
        if keys.pressed(KeyCode::ShiftLeft) {
            for event in scroll.read() {
                let delta = event.y.signum() * config.radius_step;
                state.radius = (state.radius + delta)
                    .clamp(config.min_radius, config.max_radius);
            }
        }
        // Adjust strength with scroll + ctrl
        else if keys.pressed(KeyCode::ControlLeft) {
            for event in scroll.read() {
                let delta = event.y.signum() * config.strength_step;
                state.strength = (state.strength + delta)
                    .clamp(config.min_strength, config.max_strength);
            }
        }
    }

    // Set level target height on right-click
    // Target height set from raycast hit in apply_terrain_tool system
}

pub fn select_terrain_tool(
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<TerrainToolState>,
) {
    // Only when holding Alt (terrain tool mode)
    if !keys.pressed(KeyCode::AltLeft) {
        return;
    }

    if keys.just_pressed(KeyCode::Digit1) {
        state.active_tool = TerrainTool::Raise;
    } else if keys.just_pressed(KeyCode::Digit2) {
        state.active_tool = TerrainTool::Lower;
    } else if keys.just_pressed(KeyCode::Digit3) {
        state.active_tool = TerrainTool::Level;
        state.target_height = None; // Reset target
    } else if keys.just_pressed(KeyCode::Digit4) {
        state.active_tool = TerrainTool::Smooth;
    } else if keys.just_pressed(KeyCode::Escape) {
        state.active_tool = TerrainTool::None;
    }
}
