use bevy::prelude::*;
use std::collections::HashMap;
use super::config::{InputConfig, GameAction};

#[derive(Resource, Default)]
pub struct ActionState {
    pressed: HashMap<GameAction, bool>,
    just_pressed: HashMap<GameAction, bool>,
    just_released: HashMap<GameAction, bool>,
}

impl ActionState {
    pub fn pressed(&self, action: GameAction) -> bool {
        *self.pressed.get(&action).unwrap_or(&false)
    }

    pub fn just_pressed(&self, action: GameAction) -> bool {
        *self.just_pressed.get(&action).unwrap_or(&false)
    }

    pub fn just_released(&self, action: GameAction) -> bool {
        *self.just_released.get(&action).unwrap_or(&false)
    }
}

pub fn update_action_state(
    config: Res<InputConfig>,
    keys: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<ActionState>,
) {
    // Clear transient states
    state.just_pressed.clear();
    state.just_released.clear();

    for (action, key) in &config.bindings {
        let currently_pressed = keys.pressed(*key);
        let previously_pressed = *state.pressed.get(action).unwrap_or(&false);

        if currently_pressed && !previously_pressed {
            state.just_pressed.insert(*action, true);
        }
        
        if !currently_pressed && previously_pressed {
            state.just_released.insert(*action, true);
        }

        state.pressed.insert(*action, currently_pressed);
    }
}
