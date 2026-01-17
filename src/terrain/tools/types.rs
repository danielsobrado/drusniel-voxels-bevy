use bevy::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum TerrainTool {
    #[default]
    None,
    Raise,
    Lower,
    Level,
    Smooth,
}

impl TerrainTool {
    pub fn icon_index(&self) -> usize {
        match self {
            Self::None => 0,
            Self::Raise => 1,
            Self::Lower => 2,
            Self::Level => 3,
            Self::Smooth => 4,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::None => "None",
            Self::Raise => "Raise",
            Self::Lower => "Lower",
            Self::Level => "Level",
            Self::Smooth => "Smooth",
        }
    }

    /// Get all terrain tools in order (for hotbar display)
    pub fn all_tools() -> [TerrainTool; 4] {
        [Self::Raise, Self::Lower, Self::Level, Self::Smooth]
    }
}

#[derive(Resource)]
pub struct TerrainToolState {
    pub active_tool: TerrainTool,
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    /// Whether terraforming mode is active (T key toggle)
    pub terraforming_mode: bool,
}

impl Default for TerrainToolState {
    fn default() -> Self {
        Self {
            active_tool: TerrainTool::None,
            radius: 3.0,
            strength: 1.0,
            target_height: None,
            terraforming_mode: false,
        }
    }
}

#[derive(Resource)]
pub struct TerrainToolConfig {
    pub min_radius: f32,
    pub max_radius: f32,
    pub radius_step: f32,
    pub min_strength: f32,
    pub max_strength: f32,
    pub strength_step: f32,
}

impl Default for TerrainToolConfig {
    fn default() -> Self {
        Self {
            min_radius: 1.0,
            max_radius: 10.0,
            radius_step: 0.5,
            min_strength: 0.1,
            max_strength: 3.0,
            strength_step: 0.1,
        }
    }
}
