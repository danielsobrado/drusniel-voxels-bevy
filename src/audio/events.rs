use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// The audio event vocabulary and lightweight feedback approach were inspired by
/// the MIT-licensed World of Claudecraft audio reference (© 2026 Levy Street).

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioEventId {
    // UI
    UiClick,
    UiHover,
    UiError,
    UiWarning,
    UiSuccess,
    UiToggleOn,
    UiToggleOff,

    // Menu/settings
    MenuOpen,
    MenuClose,
    SettingsOpen,
    SettingsClose,
    SettingsSave,
    SettingsTabChange,

    // Inventory/hotbar
    InventoryOpen,
    InventoryClose,
    InventorySlotSelect,
    InventoryItemPickUp,
    InventoryItemPlace,
    HotbarSelect,
    HotbarBlocked,

    // Map/chat
    MapOpen,
    MapClose,
    ChatOpen,
    ChatClose,
    ChatSubmit,
    ChatError,

    // Terrain tools
    TerrainToolSelect,
    TerrainDigStart,
    TerrainDigTick,
    TerrainDigStop,
    TerrainRaise,
    TerrainLower,
    TerrainSmooth,
    TerrainPaint,
    TerrainBrushRadius,
    TerrainEditBlocked,

    // Build/project/world
    SaveSuccess,
    SaveError,
    LoadSuccess,
    LoadError,
    WorldWarning,
    WorldError,

    // Debug/render
    DebugPanelOpen,
    DebugPanelClose,
    DebugToggleOn,
    DebugToggleOff,
    LodToggle,
    WireframeToggle,
    NaadfToggle,
    ValidationWarning,
    ValidationError,

    // Player gameplay
    PlayerJump,
}

#[derive(Message, Debug, Clone)]
pub struct GameAudioEvent {
    pub id: AudioEventId,
    pub strength: f32,
    pub position: Option<Vec3>,
}

impl GameAudioEvent {
    pub fn ui(id: AudioEventId) -> Self {
        Self {
            id,
            strength: 1.0,
            position: None,
        }
    }

    pub fn world(id: AudioEventId, position: Vec3) -> Self {
        Self {
            id,
            strength: 1.0,
            position: Some(position),
        }
    }

    /// Set the event strength (volume multiplier). Clamped to `0.0..=1.0`.
    pub fn with_strength(mut self, strength: f32) -> Self {
        self.strength = strength.clamp(0.0, 1.0);
        self
    }
}
