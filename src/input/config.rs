use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GameAction {
    MoveForward,
    MoveBackward,
    MoveLeft,
    MoveRight,
    Jump,
    Sprint,
    Crouch,
    Interact,
    ToggleInventory,
    ToggleMenu,
    ToggleFog,
    ToggleDebug,
    ToggleFly,
    PrimaryAttack,
    SecondaryAttack,
    Hotbar1,
    Hotbar2,
    Hotbar3,
    Hotbar4,
    Hotbar5,
    Hotbar6,
    Hotbar7,
    Hotbar8,
    Hotbar9,
    Chat,
    Map,
    Screenshot,
    // Building
    ToggleBuildingMode,
    ToggleSnapMode,
    RotatePiece,
}

#[derive(Resource, Serialize, Deserialize, Debug, Clone)]
pub struct InputConfig {
    pub bindings: HashMap<GameAction, KeyCode>,
}

impl Default for InputConfig {
    fn default() -> Self {
        let mut bindings = HashMap::new();
        bindings.insert(GameAction::MoveForward, KeyCode::KeyW);
        bindings.insert(GameAction::MoveBackward, KeyCode::KeyS);
        bindings.insert(GameAction::MoveLeft, KeyCode::KeyA);
        bindings.insert(GameAction::MoveRight, KeyCode::KeyD);
        bindings.insert(GameAction::Jump, KeyCode::Space);
        bindings.insert(GameAction::Sprint, KeyCode::ShiftLeft);
        bindings.insert(GameAction::Crouch, KeyCode::ControlLeft);
        bindings.insert(GameAction::Interact, KeyCode::KeyE);
        bindings.insert(GameAction::ToggleInventory, KeyCode::KeyI); // Also Tab commonly
        bindings.insert(GameAction::ToggleMenu, KeyCode::Escape);
        bindings.insert(GameAction::ToggleFog, KeyCode::KeyP); // Alt+P logic handled in specific system? Or just bind P for now
        bindings.insert(GameAction::ToggleDebug, KeyCode::F3);
        bindings.insert(GameAction::ToggleFly, KeyCode::F1);
        bindings.insert(GameAction::Chat, KeyCode::Enter);
        bindings.insert(GameAction::Map, KeyCode::KeyM);
        bindings.insert(GameAction::Screenshot, KeyCode::F12);
        
        // Hotbar
        bindings.insert(GameAction::Hotbar1, KeyCode::Digit1);
        bindings.insert(GameAction::Hotbar2, KeyCode::Digit2);
        bindings.insert(GameAction::Hotbar3, KeyCode::Digit3);
        bindings.insert(GameAction::Hotbar4, KeyCode::Digit4);
        bindings.insert(GameAction::Hotbar5, KeyCode::Digit5);
        bindings.insert(GameAction::Hotbar6, KeyCode::Digit6);
        bindings.insert(GameAction::Hotbar7, KeyCode::Digit7);
        bindings.insert(GameAction::Hotbar8, KeyCode::Digit8);
        bindings.insert(GameAction::Hotbar9, KeyCode::Digit9);

        // Building
        bindings.insert(GameAction::ToggleBuildingMode, KeyCode::KeyB);
        bindings.insert(GameAction::ToggleSnapMode, KeyCode::KeyX);
        bindings.insert(GameAction::RotatePiece, KeyCode::KeyR);

        Self { bindings }
    }
}

pub fn load_inputs(mut config: ResMut<InputConfig>) {
    let path = Path::new("assets/config/inputs.yaml");
    if path.exists() {
        match fs::read_to_string(path) {
            Ok(content) => {
                match serde_yaml::from_str(&content) {
                    Ok(loaded) => *config = loaded,
                    Err(e) => warn!("Failed to parse input config: {}", e),
                }
            }
            Err(e) => warn!("Failed to read input config: {}", e),
        }
    } else {
        // Create default if missing
        save_inputs(&config);
    }
}

pub fn save_inputs_system(config: Res<InputConfig>) {
    if config.is_changed() {
        save_inputs(&config);
    }
}

pub fn save_inputs(config: &InputConfig) {
    let path = Path::new("assets/config/inputs.yaml");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    match serde_yaml::to_string(config) {
        Ok(yaml) => {
            if let Err(e) = fs::write(path, yaml) {
                error!("Failed to write input config: {}", e);
            } else {
                info!("Input config saved to {:?}", path);
            }
        },
        Err(e) => error!("Failed to serialize input config: {}", e),
    }
}
