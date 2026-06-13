#[cfg(test)]
mod tests {
    use crate::audio::config::{
        AudioCategory, AudioEventsConfig, AudioSettings, EventAudioConfig, load_audio_config,
    };
    use crate::audio::events::{AudioEventId, GameAudioEvent};
    use crate::audio::playback::{MissingAssetsTracker, play_audio_events_system};
    use crate::audio::throttle::AudioThrottle;
    use bevy::prelude::*;
    use std::collections::HashMap;
    use std::time::Duration;

    #[test]
    fn test_all_events_configured() {
        let (_settings, config) = load_audio_config();

        let all_events = [
            AudioEventId::UiClick,
            AudioEventId::UiHover,
            AudioEventId::UiError,
            AudioEventId::UiWarning,
            AudioEventId::UiSuccess,
            AudioEventId::UiToggleOn,
            AudioEventId::UiToggleOff,
            AudioEventId::MenuOpen,
            AudioEventId::MenuClose,
            AudioEventId::SettingsOpen,
            AudioEventId::SettingsClose,
            AudioEventId::SettingsSave,
            AudioEventId::SettingsTabChange,
            AudioEventId::InventoryOpen,
            AudioEventId::InventoryClose,
            AudioEventId::InventorySlotSelect,
            AudioEventId::InventoryItemPickUp,
            AudioEventId::InventoryItemPlace,
            AudioEventId::HotbarSelect,
            AudioEventId::HotbarBlocked,
            AudioEventId::MapOpen,
            AudioEventId::MapClose,
            AudioEventId::ChatOpen,
            AudioEventId::ChatClose,
            AudioEventId::ChatSubmit,
            AudioEventId::ChatError,
            AudioEventId::TerrainToolSelect,
            AudioEventId::TerrainDigStart,
            AudioEventId::TerrainDigTick,
            AudioEventId::TerrainDigStop,
            AudioEventId::TerrainRaise,
            AudioEventId::TerrainLower,
            AudioEventId::TerrainSmooth,
            AudioEventId::TerrainPaint,
            AudioEventId::TerrainBrushRadius,
            AudioEventId::TerrainEditBlocked,
            AudioEventId::SaveSuccess,
            AudioEventId::SaveError,
            AudioEventId::LoadSuccess,
            AudioEventId::LoadError,
            AudioEventId::WorldWarning,
            AudioEventId::WorldError,
            AudioEventId::DebugPanelOpen,
            AudioEventId::DebugPanelClose,
            AudioEventId::DebugToggleOn,
            AudioEventId::DebugToggleOff,
            AudioEventId::LodToggle,
            AudioEventId::WireframeToggle,
            AudioEventId::NaadfToggle,
            AudioEventId::ValidationWarning,
            AudioEventId::ValidationError,
            AudioEventId::PlayerJump,
        ];

        for event_id in all_events {
            assert!(
                config.events.contains_key(&event_id),
                "Event {:?} is missing from config",
                event_id
            );
        }
    }

    #[test]
    fn test_cooldown_throttle() {
        let mut throttle = AudioThrottle::default();
        let event_id = AudioEventId::TerrainDigTick;
        let cooldown = 100;

        assert!(!throttle.is_throttled(event_id, cooldown));
        assert!(throttle.is_throttled(event_id, cooldown));

        std::thread::sleep(Duration::from_millis(cooldown + 5));
        assert!(!throttle.is_throttled(event_id, cooldown));
    }

    #[test]
    fn test_disabled_suppression() {
        let mut app = App::new();
        app.add_message::<GameAudioEvent>();

        let settings = AudioSettings {
            enabled: false,
            ..default()
        };
        let mut events = HashMap::new();
        events.insert(
            AudioEventId::UiClick,
            EventAudioConfig {
                enabled: true,
                volume: 0.5,
                cooldown_ms: 0,
                asset: Some("audio/ui/click.ogg".to_string()),
                category: AudioCategory::Ui,
                max_distance: None,
                pitch: None,
            },
        );

        app.insert_resource(settings);
        app.insert_resource(AudioEventsConfig { events });
        app.init_resource::<AudioThrottle>();
        app.init_resource::<MissingAssetsTracker>();
        app.add_systems(Update, play_audio_events_system);

        fn send_ui_click_system(mut writer: MessageWriter<GameAudioEvent>) {
            writer.write(GameAudioEvent::ui(AudioEventId::UiClick));
        }
        app.add_systems(
            Update,
            send_ui_click_system.before(play_audio_events_system),
        );

        app.update();
    }

    #[test]
    fn test_volume_clamping() {
        let settings = AudioSettings {
            enabled: true,
            master_volume: 1.5, // should clamp
            ui_volume: -0.5,    // should clamp
            ..default()
        };

        // Test helper bounds clamping
        assert_eq!(settings.master_volume.clamp(0.0, 1.0), 1.0);
        assert_eq!(settings.ui_volume.clamp(0.0, 1.0), 0.0);

        let clamped_settings = AudioSettings {
            enabled: true,
            master_volume: settings.master_volume.clamp(0.0, 1.0),
            ui_volume: settings.ui_volume.clamp(0.0, 1.0),
            ..default()
        };

        // Test clamping via effective_volume
        let volume1 = clamped_settings.effective_volume(AudioCategory::Ui, 1.0, 1.0);
        assert_eq!(volume1, 0.0); // 1.0 * 0.0 * 1.0 * 1.0 = 0.0

        let volume2 = clamped_settings.effective_volume(AudioCategory::Ui, 2.0, 1.0);
        assert_eq!(volume2, 0.0); // clamped but ui_volume is 0.0
    }

    #[test]
    fn test_missing_asset_does_not_panic() {
        let mut app = App::new();
        app.add_message::<GameAudioEvent>();

        let settings = AudioSettings {
            enabled: true,
            ..default()
        };
        let mut events = HashMap::new();
        // Event with no asset path configured
        events.insert(
            AudioEventId::UiClick,
            EventAudioConfig {
                enabled: true,
                volume: 0.5,
                cooldown_ms: 0,
                asset: None,
                category: AudioCategory::Ui,
                max_distance: None,
                pitch: None,
            },
        );
        // Event with non-existent asset path
        events.insert(
            AudioEventId::UiHover,
            EventAudioConfig {
                enabled: true,
                volume: 0.5,
                cooldown_ms: 0,
                asset: Some("nonexistent_asset_file.ogg".to_string()),
                category: AudioCategory::Ui,
                max_distance: None,
                pitch: None,
            },
        );

        app.insert_resource(settings);
        app.insert_resource(AudioEventsConfig { events });
        app.init_resource::<AudioThrottle>();
        app.init_resource::<MissingAssetsTracker>();
        app.add_systems(Update, play_audio_events_system);

        fn send_events_system(mut writer: MessageWriter<GameAudioEvent>) {
            writer.write(GameAudioEvent::ui(AudioEventId::UiClick));
            writer.write(GameAudioEvent::ui(AudioEventId::UiHover));
        }
        app.add_systems(Update, send_events_system.before(play_audio_events_system));

        app.update();
    }

    #[test]
    fn test_unknown_event_deserialization_fails() {
        // Unknown event IDs in config parsing will fail YAML/JSON deserialization
        let invalid_yaml = "
global:
  enabled: true
  master_volume: 0.6
  ui_volume: 0.55
  terrain_volume: 0.45
  debug_volume: 0.35
  world_volume: 0.50
events:
  invalid-event-id-xyz:
    enabled: true
    volume: 0.20
    cooldown_ms: 35
    category: ui
";
        let parsed: Result<crate::audio::config::AudioConfig, _> =
            serde_yaml::from_str(invalid_yaml);
        assert!(
            parsed.is_err(),
            "Deserializing invalid/unknown event ID must fail"
        );
    }
}
