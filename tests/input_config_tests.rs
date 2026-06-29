use bevy::prelude::KeyCode;
use voxel_builder::input::config::{GameAction, InputConfig};

fn assert_spell_hotkeys_do_not_overlap_hotbar(config: &InputConfig) {
    assert_eq!(
        config.bindings.get(&GameAction::Hotbar1),
        Some(&KeyCode::Digit1)
    );
    assert_eq!(
        config.bindings.get(&GameAction::Hotbar2),
        Some(&KeyCode::Digit2)
    );
    assert_eq!(
        config.bindings.get(&GameAction::Hotbar3),
        Some(&KeyCode::Digit3)
    );
    assert_eq!(
        config.bindings.get(&GameAction::CastFire),
        Some(&KeyCode::KeyF)
    );
    assert_eq!(
        config.bindings.get(&GameAction::CastWater),
        Some(&KeyCode::KeyG)
    );
    assert_eq!(
        config.bindings.get(&GameAction::CastAir),
        Some(&KeyCode::KeyH)
    );
}

#[test]
fn shipped_input_config_keeps_spells_off_hotbar_slots() {
    let contents = include_str!("../assets/config/inputs.yaml");
    let config: InputConfig = serde_yaml::from_str(contents).expect("shipped input config parses");

    assert_spell_hotkeys_do_not_overlap_hotbar(&config);
}

#[test]
fn fallback_input_config_keeps_spells_off_hotbar_slots() {
    let config = InputConfig::default();

    assert_spell_hotkeys_do_not_overlap_hotbar(&config);
}
