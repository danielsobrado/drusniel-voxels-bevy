use bevy::prelude::*;
use bevy::render::render_resource::ShaderType;
use serde::{Deserialize, Serialize};

use super::config::{WeatherConfig, WeatherQuality};

pub const WEATHER_FLAG_ENABLED: u32 = 1 << 0;
pub const WEATHER_FLAG_PRECIP_OVERLAY: u32 = 1 << 1;
pub const WEATHER_FLAG_PUDDLE_DETAIL: u32 = 1 << 2;
pub const WEATHER_FLAG_SNOW_TINT: u32 = 1 << 3;
pub const WEATHER_FLAG_INTEGRATED_FALLBACK: u32 = 1 << 4;
pub const WEATHER_FLAG_SHADER_WETNESS: u32 = 1 << 5;
pub const WEATHER_FLAG_SHADER_PUDDLES: u32 = 1 << 6;
pub const WEATHER_FLAG_SHADER_OVERLAY_LOW_COST: u32 = 1 << 7;

#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeatherKind {
    #[default]
    Clear = 0,
    Rain = 1,
    Snow = 2,
}

impl WeatherKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "clear" => Some(Self::Clear),
            "rain" => Some(Self::Rain),
            "snow" => Some(Self::Snow),
            _ => None,
        }
    }

    pub fn code(self) -> u32 {
        self as u32
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, ShaderType, bytemuck::Pod, bytemuck::Zeroable)]
pub struct WeatherShaderUniforms {
    pub weather_kind_code: u32,
    pub flags: u32,
    pub rain_factor: f32,
    pub rain_factor2: f32,
    pub inv_rain_factor: f32,
    pub inv_rain_factor_sqrt: f32,
    pub wetness: f32,
    pub snow_factor: f32,
    pub in_dry: f32,
    pub in_rainy: f32,
    pub in_snowy: f32,
    pub overlay_density: f32,
    pub puddle_strength: f32,
    pub snow_tint_strength: f32,
    pub time: f32,
    pub _padding: f32,
}

#[derive(Resource, Clone, Debug)]
pub struct WeatherRuntime {
    pub target_kind: WeatherKind,
    pub uniforms: WeatherShaderUniforms,
    pub quality: WeatherQuality,
}

impl Default for WeatherRuntime {
    fn default() -> Self {
        Self::new(&WeatherConfig::default())
    }
}

impl WeatherRuntime {
    pub fn new(config: &WeatherConfig) -> Self {
        let target_kind = if config.enabled {
            config.initial_kind
        } else {
            WeatherKind::Clear
        };
        let quality = if config.enabled {
            config.quality
        } else {
            WeatherQuality::Off
        };
        let mut runtime = Self {
            target_kind,
            uniforms: WeatherShaderUniforms::default(),
            quality,
        };
        runtime.rebuild_uniforms(config, quality, false, 0.0, 0.0, 0.0, 0.0);
        runtime
    }

    pub fn set_target_kind(&mut self, kind: WeatherKind) {
        self.target_kind = kind;
    }

    pub fn advance(
        &mut self,
        config: &WeatherConfig,
        dt: f32,
        quality: WeatherQuality,
        integrated_gpu: bool,
    ) -> bool {
        let previous = self.uniforms;
        let previous_quality = self.quality;
        self.quality = quality;
        let target_kind = if config.enabled {
            self.target_kind
        } else {
            WeatherKind::Clear
        };
        let target_rain = match target_kind {
            WeatherKind::Rain => config.rain.factor,
            _ => 0.0,
        };
        let target_snow = match target_kind {
            WeatherKind::Snow => config.snow.factor,
            _ => 0.0,
        };
        let rain = step_toward(
            self.uniforms.rain_factor,
            target_rain,
            dt / config.transition_seconds,
        );
        let snow = step_toward(
            self.uniforms.snow_factor,
            target_snow,
            dt / config.transition_seconds,
        );
        let target_wetness = if quality.allows_shader_wetness() {
            rain * config.rain.wetness
        } else {
            0.0
        };
        let wetness = step_toward(
            self.uniforms.wetness,
            target_wetness,
            dt / config.wetness_transition_seconds,
        );
        let active = config.enabled
            && quality != WeatherQuality::Off
            && (target_kind != WeatherKind::Clear || rain > 0.0 || snow > 0.0 || wetness > 0.0);
        let time = if active {
            self.uniforms.time + dt.max(0.0)
        } else {
            0.0
        };
        self.rebuild_uniforms(config, quality, integrated_gpu, time, rain, snow, wetness);
        self.uniforms != previous || self.quality != previous_quality
    }

    fn rebuild_uniforms(
        &mut self,
        config: &WeatherConfig,
        quality: WeatherQuality,
        integrated_gpu: bool,
        time: f32,
        rain: f32,
        snow: f32,
        wetness: f32,
    ) {
        let mut flags = 0;
        let visual_enabled = config.enabled && quality != WeatherQuality::Off;
        let visual_rain = if visual_enabled { rain } else { 0.0 };
        let visual_snow = if visual_enabled { snow } else { 0.0 };
        let visual_wetness = if visual_enabled { wetness } else { 0.0 };

        if visual_enabled {
            flags |= WEATHER_FLAG_ENABLED;
        }
        if integrated_gpu {
            flags |= WEATHER_FLAG_INTEGRATED_FALLBACK;
        }
        let overlay_density =
            weather_overlay_density(config, quality, integrated_gpu, visual_rain, visual_snow);
        if overlay_density > 0.0 {
            flags |= WEATHER_FLAG_PRECIP_OVERLAY;
        }
        if overlay_density > 0.0 && quality <= WeatherQuality::Low {
            flags |= WEATHER_FLAG_SHADER_OVERLAY_LOW_COST;
        }
        if visual_wetness > 0.0 {
            flags |= WEATHER_FLAG_SHADER_WETNESS;
        }
        let puddle_strength = if !quality.allows_puddles()
            || (integrated_gpu && config.low_gpu.disable_puddle_detail)
        {
            0.0
        } else {
            visual_rain * config.rain.puddle_strength
        };
        if puddle_strength > 0.0 {
            flags |= WEATHER_FLAG_SHADER_PUDDLES;
        }
        if puddle_strength > 0.0
            && quality.allows_animated_puddle_normals()
            && !(integrated_gpu && config.low_gpu.disable_puddle_detail)
        {
            flags |= WEATHER_FLAG_PUDDLE_DETAIL;
        }
        let snow_tint_strength = visual_snow * config.snow.snow_tint_strength;
        if snow_tint_strength > 0.0 {
            flags |= WEATHER_FLAG_SNOW_TINT;
        }
        let rain_factor2 = visual_rain * visual_rain;
        let dominant_kind = if visual_rain <= f32::EPSILON && visual_snow <= f32::EPSILON {
            WeatherKind::Clear
        } else if visual_rain >= visual_snow {
            WeatherKind::Rain
        } else {
            WeatherKind::Snow
        };

        self.uniforms = WeatherShaderUniforms {
            weather_kind_code: dominant_kind.code(),
            flags,
            rain_factor: visual_rain,
            rain_factor2,
            inv_rain_factor: 1.0 - visual_rain,
            inv_rain_factor_sqrt: 1.0 - rain_factor2,
            wetness: visual_wetness,
            snow_factor: visual_snow,
            in_dry: 1.0 - visual_rain.max(visual_snow),
            in_rainy: visual_rain,
            in_snowy: visual_snow,
            overlay_density,
            puddle_strength,
            snow_tint_strength,
            time,
            _padding: 0.0,
        };
    }
}

fn weather_overlay_density(
    config: &WeatherConfig,
    quality: WeatherQuality,
    integrated_gpu: bool,
    rain: f32,
    snow: f32,
) -> f32 {
    if quality == WeatherQuality::Off || (integrated_gpu && config.low_gpu.disable_precip_overlay) {
        return 0.0;
    }
    ((rain * config.rain.overlay_density + snow * config.snow.overlay_density)
        * quality.overlay_density_scale())
    .clamp(0.0, 1.0)
}

fn step_toward(current: f32, target: f32, max_delta: f32) -> f32 {
    if max_delta <= 0.0 {
        return current;
    }
    if current < target {
        (current + max_delta).min(target)
    } else {
        (current - max_delta).max(target)
    }
}

#[cfg(test)]
fn weather_opacity_remap_mirror(weather_tex_opacity: f32) -> f32 {
    (weather_tex_opacity * 1.25 - 0.1).clamp(0.0, 1.0)
}

#[cfg(test)]
fn compute_rain_opacity_mirror(weather_tex_opacity: f32) -> f32 {
    let remapped = weather_opacity_remap_mirror(weather_tex_opacity);
    remapped * remapped
}

#[cfg(test)]
fn compute_snow_opacity_mirror(weather_tex_opacity: f32) -> f32 {
    let remapped = weather_opacity_remap_mirror(weather_tex_opacity);
    1.0 - (1.0 - remapped) * (1.0 - remapped)
}

#[cfg(test)]
fn smoothstep_mirror(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
fn weather_upness_mask_mirror(normal_y: f32, threshold: f32) -> f32 {
    smoothstep_mirror(threshold, 1.0, normal_y)
}

#[cfg(test)]
fn weather_puddle_mask_mirror(
    weather: WeatherShaderUniforms,
    normal_y: f32,
    threshold: f32,
) -> f32 {
    if weather.weather_kind_code != WeatherKind::Rain.code() && weather.in_rainy <= 0.001 {
        return 0.0;
    }
    (weather.wetness * weather.puddle_strength * weather_upness_mask_mirror(normal_y, threshold))
        .clamp(0.0, 1.0)
}

#[cfg(test)]
fn weather_snow_mask_mirror(weather: WeatherShaderUniforms, normal_y: f32, threshold: f32) -> f32 {
    if weather.weather_kind_code != WeatherKind::Snow.code() && weather.in_snowy <= 0.001 {
        return 0.0;
    }
    (weather.snow_factor
        * weather.snow_tint_strength
        * weather_upness_mask_mirror(normal_y, threshold))
    .clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(kind: WeatherKind) -> WeatherConfig {
        WeatherConfig {
            initial_kind: kind,
            transition_seconds: 1.0,
            wetness_transition_seconds: 1.0,
            ..WeatherConfig::default()
        }
        .sanitize()
    }

    #[test]
    fn weather_rain_ramps_up_and_down() {
        let mut config = test_config(WeatherKind::Clear);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.set_target_kind(WeatherKind::Rain);
        runtime.advance(&config, 0.25, WeatherQuality::High, false);
        assert!((runtime.uniforms.rain_factor - 0.25).abs() < 0.0001);

        runtime.advance(&config, 1.0, WeatherQuality::High, false);
        assert!((runtime.uniforms.rain_factor - 1.0).abs() < 0.0001);

        runtime.set_target_kind(WeatherKind::Clear);
        runtime.advance(&config, 0.25, WeatherQuality::High, false);
        assert!((runtime.uniforms.rain_factor - 0.75).abs() < 0.0001);

        config.enabled = false;
        runtime.advance(&config, 1.0, WeatherQuality::High, false);
        assert!((runtime.uniforms.rain_factor - 0.0).abs() < 0.0001);
    }

    #[test]
    fn weather_snow_ramps_up_and_down() {
        let config = test_config(WeatherKind::Clear);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.set_target_kind(WeatherKind::Snow);
        runtime.advance(&config, 0.4, WeatherQuality::High, false);
        assert!((runtime.uniforms.snow_factor - 0.4).abs() < 0.0001);

        runtime.advance(&config, 1.0, WeatherQuality::High, false);
        assert!((runtime.uniforms.snow_factor - 1.0).abs() < 0.0001);

        runtime.set_target_kind(WeatherKind::Clear);
        runtime.advance(&config, 0.5, WeatherQuality::High, false);
        assert!((runtime.uniforms.snow_factor - 0.5).abs() < 0.0001);
    }

    #[test]
    fn weather_inv_rain_factor_sqrt_matches_shaderpack_formula() {
        let config = test_config(WeatherKind::Clear);
        let mut runtime = WeatherRuntime::new(&config);
        runtime.set_target_kind(WeatherKind::Rain);
        runtime.advance(&config, 0.6, WeatherQuality::High, false);

        let rain = runtime.uniforms.rain_factor;
        assert!((runtime.uniforms.inv_rain_factor_sqrt - (1.0 - rain * rain)).abs() < 0.0001);
    }

    #[test]
    fn weather_clear_fades_everything_toward_zero() {
        let config = test_config(WeatherKind::Rain);
        let mut runtime = WeatherRuntime::new(&config);
        runtime.advance(&config, 1.0, WeatherQuality::High, false);
        assert!(runtime.uniforms.rain_factor > 0.0);
        assert!(runtime.uniforms.wetness > 0.0);

        runtime.set_target_kind(WeatherKind::Clear);
        runtime.advance(&config, 0.5, WeatherQuality::High, false);
        assert!(runtime.uniforms.rain_factor < 1.0);
        assert!(runtime.uniforms.wetness < config.rain.wetness);

        runtime.advance(&config, 1.0, WeatherQuality::High, false);
        assert_eq!(
            runtime.uniforms.weather_kind_code,
            WeatherKind::Clear.code()
        );
        assert!((runtime.uniforms.rain_factor - 0.0).abs() < 0.0001);
        assert!((runtime.uniforms.snow_factor - 0.0).abs() < 0.0001);
        assert!((runtime.uniforms.wetness - 0.0).abs() < 0.0001);
    }

    #[test]
    fn weather_quality_off_zeroes_shader_uniforms() {
        let config = test_config(WeatherKind::Rain);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.advance(&config, 1.0, WeatherQuality::Off, false);

        assert_eq!(runtime.quality, WeatherQuality::Off);
        assert_eq!(runtime.uniforms.rain_factor, 0.0);
        assert_eq!(runtime.uniforms.wetness, 0.0);
        assert_eq!(runtime.uniforms.overlay_density, 0.0);
        assert_eq!(runtime.uniforms.puddle_strength, 0.0);
        assert_eq!(runtime.uniforms.flags & WEATHER_FLAG_ENABLED, 0);
    }

    #[test]
    fn weather_quality_low_keeps_wetness_without_puddles_or_normals() {
        let config = test_config(WeatherKind::Rain);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.advance(&config, 1.0, WeatherQuality::Low, false);

        assert!(runtime.uniforms.wetness > 0.0);
        assert_eq!(runtime.uniforms.puddle_strength, 0.0);
        assert_eq!(runtime.uniforms.flags & WEATHER_FLAG_SHADER_PUDDLES, 0);
        assert_eq!(runtime.uniforms.flags & WEATHER_FLAG_PUDDLE_DETAIL, 0);
        assert!(runtime.uniforms.overlay_density > 0.0);
        assert!(runtime.uniforms.overlay_density < config.rain.overlay_density);
    }

    #[test]
    fn weather_quality_medium_enables_cheap_puddles_without_animated_normals() {
        let config = test_config(WeatherKind::Rain);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.advance(&config, 1.0, WeatherQuality::Medium, false);

        assert!(runtime.uniforms.puddle_strength > 0.0);
        assert_ne!(runtime.uniforms.flags & WEATHER_FLAG_SHADER_PUDDLES, 0);
        assert_eq!(runtime.uniforms.flags & WEATHER_FLAG_PUDDLE_DETAIL, 0);
    }

    #[test]
    fn weather_quality_high_enables_animated_puddle_normals() {
        let config = test_config(WeatherKind::Rain);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.advance(&config, 1.0, WeatherQuality::High, false);

        assert_ne!(runtime.uniforms.flags & WEATHER_FLAG_PUDDLE_DETAIL, 0);
    }

    #[test]
    fn integrated_gpu_disables_overlay_and_animated_normals_by_default() {
        let config = test_config(WeatherKind::Rain);
        let mut runtime = WeatherRuntime::new(&config);

        runtime.advance(&config, 1.0, WeatherQuality::High, true);

        assert_eq!(runtime.uniforms.overlay_density, 0.0);
        assert_eq!(runtime.uniforms.flags & WEATHER_FLAG_PUDDLE_DETAIL, 0);
        assert_ne!(runtime.uniforms.flags & WEATHER_FLAG_INTEGRATED_FALLBACK, 0);
    }

    #[test]
    fn weather_opacity_remap_matches_shader_helper() {
        assert_eq!(weather_opacity_remap_mirror(-1.0), 0.0);
        assert!((weather_opacity_remap_mirror(0.72) - 0.8).abs() < 0.0001);
        assert_eq!(weather_opacity_remap_mirror(2.0), 1.0);
        assert!((compute_rain_opacity_mirror(0.72) - 0.64).abs() < 0.0001);
        assert!((compute_snow_opacity_mirror(0.72) - 0.96).abs() < 0.0001);
    }

    #[test]
    fn weather_masks_match_shader_helper_shape() {
        let mut rain = WeatherShaderUniforms {
            weather_kind_code: WeatherKind::Rain.code(),
            wetness: 0.8,
            puddle_strength: 0.5,
            in_rainy: 0.8,
            ..Default::default()
        };

        assert_eq!(weather_puddle_mask_mirror(rain, 0.0, 0.25), 0.0);
        assert!((weather_puddle_mask_mirror(rain, 1.0, 0.25) - 0.4).abs() < 0.0001);

        rain.weather_kind_code = WeatherKind::Clear.code();
        rain.in_rainy = 0.0;
        assert_eq!(weather_puddle_mask_mirror(rain, 1.0, 0.25), 0.0);

        let snow = WeatherShaderUniforms {
            weather_kind_code: WeatherKind::Snow.code(),
            snow_factor: 0.6,
            snow_tint_strength: 0.5,
            in_snowy: 0.6,
            ..Default::default()
        };
        assert_eq!(weather_snow_mask_mirror(snow, 0.0, 0.25), 0.0);
        assert!((weather_snow_mask_mirror(snow, 1.0, 0.25) - 0.3).abs() < 0.0001);
    }
}
