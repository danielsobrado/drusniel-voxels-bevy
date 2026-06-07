use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::state::WeatherKind;

#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct WeatherConfig {
    pub enabled: bool,
    pub quality: WeatherQuality,
    pub initial_kind: WeatherKind,
    pub transition_seconds: f32,
    pub wetness_transition_seconds: f32,
    pub rain: WeatherEffectConfig,
    pub snow: WeatherEffectConfig,
    pub low_gpu: WeatherLowGpuConfig,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct WeatherEffectConfig {
    pub factor: f32,
    pub overlay_density: f32,
    pub wetness: f32,
    pub puddle_strength: f32,
    pub snow_tint_strength: f32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct WeatherLowGpuConfig {
    pub disable_precip_overlay: bool,
    pub disable_puddle_detail: bool,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeatherQuality {
    Off = 0,
    Low = 1,
    Medium = 2,
    #[default]
    High = 3,
    Ultra = 4,
}

impl WeatherQuality {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "off" | "0" | "disabled" => Some(Self::Off),
            "low" | "1" => Some(Self::Low),
            "medium" | "med" | "2" => Some(Self::Medium),
            "high" | "3" => Some(Self::High),
            "ultra" | "4" => Some(Self::Ultra),
            _ => None,
        }
    }

    pub fn code(self) -> f64 {
        self as u32 as f64
    }

    pub fn overlay_density_scale(self) -> f32 {
        match self {
            Self::Off => 0.0,
            Self::Low => 0.35,
            Self::Medium => 0.75,
            Self::High => 1.0,
            Self::Ultra => 1.25,
        }
    }

    pub fn allows_shader_wetness(self) -> bool {
        self != Self::Off
    }

    pub fn allows_puddles(self) -> bool {
        matches!(self, Self::Medium | Self::High | Self::Ultra)
    }

    pub fn allows_animated_puddle_normals(self) -> bool {
        matches!(self, Self::High | Self::Ultra)
    }
}

impl Default for WeatherConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            quality: WeatherQuality::High,
            initial_kind: WeatherKind::Clear,
            transition_seconds: 4.0,
            wetness_transition_seconds: 8.0,
            rain: WeatherEffectConfig {
                factor: 1.0,
                overlay_density: 0.55,
                wetness: 0.85,
                puddle_strength: 0.35,
                snow_tint_strength: 0.0,
            },
            snow: WeatherEffectConfig {
                factor: 1.0,
                overlay_density: 0.35,
                wetness: 0.0,
                puddle_strength: 0.0,
                snow_tint_strength: 0.65,
            },
            low_gpu: WeatherLowGpuConfig::default(),
        }
    }
}

impl Default for WeatherEffectConfig {
    fn default() -> Self {
        Self {
            factor: 1.0,
            overlay_density: 0.0,
            wetness: 0.0,
            puddle_strength: 0.0,
            snow_tint_strength: 0.0,
        }
    }
}

impl Default for WeatherLowGpuConfig {
    fn default() -> Self {
        Self {
            disable_precip_overlay: true,
            disable_puddle_detail: true,
        }
    }
}

impl WeatherConfig {
    pub const DEFAULT_PATH: &'static str = "assets/config/weather.yaml";

    pub fn load_default_path() -> Self {
        Self::load_from_path(Self::DEFAULT_PATH)
    }

    pub fn load_from_path(path: impl AsRef<Path>) -> Self {
        match std::fs::read_to_string(path.as_ref()) {
            Ok(contents) => match serde_yaml::from_str(&contents) {
                Ok(config) => config,
                Err(err) => {
                    warn!(
                        "Failed to parse weather config {}: {}; using defaults",
                        path.as_ref().display(),
                        err
                    );
                    Self::default()
                }
            },
            Err(err) => {
                warn!(
                    "Failed to read weather config {}: {}; using defaults",
                    path.as_ref().display(),
                    err
                );
                Self::default()
            }
        }
    }

    pub fn with_env_override(mut self) -> Self {
        if let Ok(value) = std::env::var("VOXEL_WEATHER") {
            match WeatherKind::parse(&value) {
                Some(kind) => {
                    self.enabled = true;
                    self.initial_kind = kind;
                }
                None => warn!(
                    "Ignoring invalid VOXEL_WEATHER='{}'; expected clear, rain, or snow",
                    value
                ),
            }
        }
        if let Ok(value) = std::env::var("VOXEL_WEATHER_QUALITY") {
            match WeatherQuality::parse(&value) {
                Some(quality) => self.quality = quality,
                None => warn!(
                    "Ignoring invalid VOXEL_WEATHER_QUALITY='{}'; expected off, low, medium, high, or ultra",
                    value
                ),
            }
        }
        self.sanitize()
    }

    pub fn sanitize(mut self) -> Self {
        self.transition_seconds = self.transition_seconds.max(0.001);
        self.wetness_transition_seconds = self.wetness_transition_seconds.max(0.001);
        self.rain = self.rain.sanitize();
        self.snow = self.snow.sanitize();
        if !self.enabled {
            self.initial_kind = WeatherKind::Clear;
            self.quality = WeatherQuality::Off;
        }
        self
    }
}

impl WeatherEffectConfig {
    fn sanitize(mut self) -> Self {
        self.factor = self.factor.clamp(0.0, 1.0);
        self.overlay_density = self.overlay_density.clamp(0.0, 1.0);
        self.wetness = self.wetness.clamp(0.0, 1.0);
        self.puddle_strength = self.puddle_strength.clamp(0.0, 1.0);
        self.snow_tint_strength = self.snow_tint_strength.clamp(0.0, 1.0);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weather_quality_parse_and_codes_are_stable() {
        assert_eq!(WeatherQuality::parse("off"), Some(WeatherQuality::Off));
        assert_eq!(WeatherQuality::parse("LOW"), Some(WeatherQuality::Low));
        assert_eq!(WeatherQuality::parse("2"), Some(WeatherQuality::Medium));
        assert_eq!(WeatherQuality::parse("ultra"), Some(WeatherQuality::Ultra));
        assert_eq!(WeatherQuality::High.code(), 3.0);
    }

    #[test]
    fn weather_quality_feature_gates_match_cost_tiers() {
        assert!(!WeatherQuality::Off.allows_shader_wetness());
        assert!(WeatherQuality::Low.allows_shader_wetness());
        assert!(!WeatherQuality::Low.allows_puddles());
        assert!(WeatherQuality::Medium.allows_puddles());
        assert!(!WeatherQuality::Medium.allows_animated_puddle_normals());
        assert!(WeatherQuality::High.allows_animated_puddle_normals());
        assert!(
            WeatherQuality::Ultra.overlay_density_scale()
                > WeatherQuality::High.overlay_density_scale()
        );
    }
}
