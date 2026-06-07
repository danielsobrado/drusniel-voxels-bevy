use bevy::prelude::*;
use serde::Deserialize;

#[derive(Resource, Deserialize, Clone, Debug)]
pub struct WitchcraftWaterFinishConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_witchcraft_style")]
    pub style: u32,
    #[serde(default = "default_witchcraft_watercolor_mode")]
    pub watercolor_mode: u32,
    #[serde(default)]
    pub legacy: bool,
    #[serde(default)]
    pub color_multiplier_enabled: bool,
    #[serde(default = "default_witchcraft_color_multiplier")]
    pub color_multiplier: [f32; 3],
    #[serde(default = "default_witchcraft_reflect_b")]
    pub reflect_b: u32,
    #[serde(default)]
    pub debug: u32,
}

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct WitchcraftWaterFinishParams {
    pub enabled: bool,
    pub style: u32,
    pub watercolor_mode: u32,
    pub legacy: bool,
    pub color_multiplier_enabled: bool,
    pub color_multiplier: [f32; 3],
    pub reflect_b: u32,
    pub debug: u32,
}

impl Default for WitchcraftWaterFinishConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            style: default_witchcraft_style(),
            watercolor_mode: default_witchcraft_watercolor_mode(),
            legacy: false,
            color_multiplier_enabled: false,
            color_multiplier: default_witchcraft_color_multiplier(),
            reflect_b: default_witchcraft_reflect_b(),
            debug: 0,
        }
    }
}

impl Default for WitchcraftWaterFinishParams {
    fn default() -> Self {
        WitchcraftWaterFinishConfig::default().params()
    }
}

impl WitchcraftWaterFinishConfig {
    pub fn params(&self) -> WitchcraftWaterFinishParams {
        let mut params = WitchcraftWaterFinishParams {
            enabled: self.enabled || env_flag("VOXEL_WATER_WITCHCRAFT_FINISH"),
            style: self.style,
            watercolor_mode: self.watercolor_mode,
            legacy: self.legacy || env_flag("VOXEL_WATER_WITCHCRAFT_LEGACY"),
            color_multiplier_enabled: self.color_multiplier_enabled,
            color_multiplier: self.color_multiplier,
            reflect_b: self.reflect_b,
            debug: self.debug,
        };

        if let Ok(style) = std::env::var("VOXEL_WATER_WITCHCRAFT_STYLE")
            && let Ok(style) = style.trim().parse::<u32>()
        {
            params.style = style;
        }
        if let Ok(reflect_b) = std::env::var("VOXEL_WATER_WITCHCRAFT_REFLECT_B")
            && let Ok(reflect_b) = reflect_b.trim().parse::<u32>()
        {
            params.reflect_b = reflect_b;
        }
        if let Ok(debug) = std::env::var("VOXEL_WATER_WITCHCRAFT_DEBUG")
            && let Ok(debug) = debug.trim().parse::<u32>()
        {
            params.debug = debug;
        }

        params
    }
}

impl WitchcraftWaterFinishParams {
    pub fn multiply_rgba(self, rgba: [f32; 4]) -> [f32; 4] {
        if !(self.enabled && self.color_multiplier_enabled) {
            return rgba;
        }

        [
            rgba[0] * self.color_multiplier[0],
            rgba[1] * self.color_multiplier[1],
            rgba[2] * self.color_multiplier[2],
            rgba[3],
        ]
    }

    pub fn shader_control_alpha(self, alpha: f32) -> f32 {
        if !self.enabled {
            return alpha.clamp(0.0, 2.0);
        }

        let debug = self.debug.min(3);
        let mut code = if self.style >= 3 { 30.0 } else { 8.0 };
        if debug > 0 {
            code = if self.style >= 3 {
                30.0 + debug as f32
            } else {
                10.0 + debug as f32
            };
        }
        if self.legacy {
            code += 50.0;
        }
        if self.reflect_b == 200 {
            code += 100.0;
        }
        code
    }

    pub fn reflection_multiplier_base(self) -> f32 {
        if self.enabled && self.reflect_b != 200 {
            0.0
        } else {
            1.0
        }
    }
}

pub struct WitchcraftWaterFinishPlugin;

impl Plugin for WitchcraftWaterFinishPlugin {
    fn build(&self, _app: &mut App) {}
}

fn default_witchcraft_style() -> u32 {
    1
}

fn default_witchcraft_watercolor_mode() -> u32 {
    3
}

fn default_witchcraft_color_multiplier() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}

fn default_witchcraft_reflect_b() -> u32 {
    200
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}
