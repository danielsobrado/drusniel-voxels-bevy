use super::events::AudioEventId;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Resource, Debug, Clone)]
pub struct AudioSettings {
    pub enabled: bool,
    pub master_volume: f32,
    pub ui_volume: f32,
    pub inventory_volume: f32,
    pub map_volume: f32,
    pub chat_volume: f32,
    pub terrain_volume: f32,
    pub debug_volume: f32,
    pub world_volume: f32,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            master_volume: 0.6,
            ui_volume: 0.55,
            inventory_volume: 0.5,
            map_volume: 0.5,
            chat_volume: 0.5,
            terrain_volume: 0.45,
            debug_volume: 0.35,
            world_volume: 0.50,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioCategory {
    Ui,
    Inventory,
    Map,
    Chat,
    Terrain,
    Debug,
    World,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventAudioConfig {
    pub enabled: bool,
    pub volume: f32,
    pub cooldown_ms: u64,
    pub asset: Option<String>,
    pub category: AudioCategory,
    pub max_distance: Option<f32>,
    pub pitch: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GlobalAudioConfig {
    pub enabled: bool,
    pub master_volume: f32,
    pub ui_volume: f32,
    #[serde(default = "default_volume")]
    pub inventory_volume: f32,
    #[serde(default = "default_volume")]
    pub map_volume: f32,
    #[serde(default = "default_volume")]
    pub chat_volume: f32,
    pub terrain_volume: f32,
    pub debug_volume: f32,
    pub world_volume: f32,
}

fn default_volume() -> f32 {
    0.5
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioConfig {
    pub global: GlobalAudioConfig,
    pub events: HashMap<AudioEventId, EventAudioConfig>,
}

#[derive(Resource, Debug, Clone)]
pub struct AudioEventsConfig {
    pub events: HashMap<AudioEventId, EventAudioConfig>,
}

impl AudioSettings {
    pub fn get_category_volume(&self, category: AudioCategory) -> f32 {
        match category {
            AudioCategory::Ui => self.ui_volume,
            AudioCategory::Inventory => self.inventory_volume,
            AudioCategory::Map => self.map_volume,
            AudioCategory::Chat => self.chat_volume,
            AudioCategory::Terrain => self.terrain_volume,
            AudioCategory::Debug => self.debug_volume,
            AudioCategory::World => self.world_volume,
        }
    }

    pub fn effective_volume(&self, category: AudioCategory, event_vol: f32, strength: f32) -> f32 {
        if !self.enabled {
            return 0.0;
        }
        let category_vol = self.get_category_volume(category);
        (self.master_volume * category_vol * event_vol * strength).clamp(0.0, 1.0)
    }
}

pub fn load_audio_config() -> (AudioSettings, AudioEventsConfig) {
    let path = std::path::Path::new("assets/config/audio_events.yaml");
    match crate::config::loader::load_config::<AudioConfig, _>(path) {
        Ok(config) => {
            let settings = AudioSettings {
                enabled: config.global.enabled,
                master_volume: config.global.master_volume.clamp(0.0, 1.0),
                ui_volume: config.global.ui_volume.clamp(0.0, 1.0),
                inventory_volume: config.global.inventory_volume.clamp(0.0, 1.0),
                map_volume: config.global.map_volume.clamp(0.0, 1.0),
                chat_volume: config.global.chat_volume.clamp(0.0, 1.0),
                terrain_volume: config.global.terrain_volume.clamp(0.0, 1.0),
                debug_volume: config.global.debug_volume.clamp(0.0, 1.0),
                world_volume: config.global.world_volume.clamp(0.0, 1.0),
            };

            let mut events = config.events;
            for event_cfg in events.values_mut() {
                event_cfg.volume = event_cfg.volume.clamp(0.0, 1.0);
            }

            (settings, AudioEventsConfig { events })
        }
        Err(err) => {
            warn!(
                "Failed to load audio config from assets/config/audio_events.yaml: {}. Using defaults.",
                err
            );
            get_fallback_defaults()
        }
    }
}

fn get_fallback_defaults() -> (AudioSettings, AudioEventsConfig) {
    let settings = AudioSettings::default();
    let mut events = HashMap::new();

    // Insert minimal fallback config for the essential events to avoid crashes
    // if config is missing.
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

    for id in all_events {
        let category = match id {
            AudioEventId::UiClick
            | AudioEventId::UiHover
            | AudioEventId::UiError
            | AudioEventId::UiWarning
            | AudioEventId::UiSuccess
            | AudioEventId::UiToggleOn
            | AudioEventId::UiToggleOff => AudioCategory::Ui,
            AudioEventId::MenuOpen
            | AudioEventId::MenuClose
            | AudioEventId::SettingsOpen
            | AudioEventId::SettingsClose
            | AudioEventId::SettingsSave
            | AudioEventId::SettingsTabChange => AudioCategory::Ui,
            AudioEventId::InventoryOpen
            | AudioEventId::InventoryClose
            | AudioEventId::InventorySlotSelect
            | AudioEventId::InventoryItemPickUp
            | AudioEventId::InventoryItemPlace
            | AudioEventId::HotbarSelect
            | AudioEventId::HotbarBlocked => AudioCategory::Inventory,
            AudioEventId::MapOpen | AudioEventId::MapClose => AudioCategory::Map,
            AudioEventId::ChatOpen
            | AudioEventId::ChatClose
            | AudioEventId::ChatSubmit
            | AudioEventId::ChatError => AudioCategory::Chat,
            AudioEventId::TerrainToolSelect
            | AudioEventId::TerrainDigStart
            | AudioEventId::TerrainDigTick
            | AudioEventId::TerrainDigStop
            | AudioEventId::TerrainRaise
            | AudioEventId::TerrainLower
            | AudioEventId::TerrainSmooth
            | AudioEventId::TerrainPaint
            | AudioEventId::TerrainBrushRadius
            | AudioEventId::TerrainEditBlocked => AudioCategory::Terrain,
            AudioEventId::SaveSuccess
            | AudioEventId::SaveError
            | AudioEventId::LoadSuccess
            | AudioEventId::LoadError
            | AudioEventId::WorldWarning
            | AudioEventId::WorldError
            | AudioEventId::PlayerJump => AudioCategory::World,
            _ => AudioCategory::Debug,
        };

        events.insert(
            id,
            EventAudioConfig {
                enabled: true,
                volume: 0.5,
                cooldown_ms: 50,
                asset: None,
                category,
                max_distance: None,
                pitch: None,
            },
        );
    }

    (settings, AudioEventsConfig { events })
}
