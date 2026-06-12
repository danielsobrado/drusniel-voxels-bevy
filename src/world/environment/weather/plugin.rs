use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::menu::{GraphicsQuality, PauseMenuState, SettingsState};
use crate::performance::AreaTimingRecorder;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::quality::RenderQualityPreset;

use super::config::{WeatherConfig, WeatherQuality};
use super::state::{WeatherKind, WeatherRuntime};

pub struct WeatherPlugin;

impl Plugin for WeatherPlugin {
    fn build(&self, app: &mut App) {
        let config = WeatherConfig::load_default_path().with_env_override();
        let runtime = WeatherRuntime::new(&config);

        app.insert_resource(config)
            .insert_resource(runtime)
            .add_systems(
                Update,
                cycle_weather_debug_presets.before(update_weather_runtime),
            )
            .add_systems(Update, update_weather_runtime)
            .add_systems(
                Update,
                record_weather_counters.after(update_weather_runtime),
            );
    }
}

fn cycle_weather_debug_presets(
    keys: Res<ButtonInput<KeyCode>>,
    pause_menu: Option<Res<PauseMenuState>>,
    mut config: ResMut<WeatherConfig>,
    mut runtime: ResMut<WeatherRuntime>,
    mut render_preset: Option<ResMut<RenderQualityPreset>>,
    mut settings: Option<ResMut<SettingsState>>,
) {
    if pause_menu.as_deref().is_some_and(|menu| menu.open) {
        return;
    }

    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let control_held = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight);
    if !keys.just_pressed(KeyCode::F2) {
        return;
    }

    if control_held {
        let current = render_preset.as_deref().copied().unwrap_or_default();
        let next = next_render_quality_preset(current);
        if let Some(mut preset) = render_preset.take() {
            *preset = next;
        }
        if let Some(mut settings) = settings.take() {
            settings.graphics_quality = graphics_quality_for_render_preset(next);
        }
        info!("Render preset test cycle: {:?} (Ctrl+F2)", next);
        return;
    }

    if shift_held {
        let next = next_weather_quality(config.quality);
        config.enabled = next != WeatherQuality::Off;
        config.quality = next;
        info!("Weather shader quality test cycle: {:?} (Shift+F2)", next);
        return;
    }

    config.enabled = true;
    if config.quality == WeatherQuality::Off {
        config.quality = WeatherQuality::High;
    }
    let next = next_weather_kind(runtime.target_kind);
    runtime.set_target_kind(next);
    info!("Weather shader test cycle: {:?} (F2)", next);
}

fn update_weather_runtime(
    config: Res<WeatherConfig>,
    time: Res<Time>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    quality: Option<Res<RenderQualityPreset>>,
    mut runtime: ResMut<WeatherRuntime>,
) {
    let integrated_gpu = capabilities
        .as_deref()
        .map(|capabilities| capabilities.conservative_weather_path())
        .unwrap_or(false);
    let effective_quality =
        effective_weather_quality(&config, quality.as_deref().copied(), integrated_gpu);
    // `advance` reports whether the shader uniforms actually changed. Write
    // through bypass_change_detection so an idle tick does not mark the
    // resource changed: `sync_weather_to_materials` mutates every terrain
    // material variant whenever WeatherRuntime reads as changed, forcing
    // per-frame material re-prepare even with weather fully idle.
    let changed = runtime.bypass_change_detection().advance(
        &config,
        time.delta_secs(),
        effective_quality,
        integrated_gpu,
    );
    if changed {
        runtime.set_changed();
    }
}

fn record_weather_counters(
    runtime: Res<WeatherRuntime>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Res<FrameCount>,
) {
    let Some(timing) = timing.as_deref_mut() else {
        return;
    };
    let uniforms = runtime.uniforms;
    timing.record_count(frame.0, "Weather Rain Factor", uniforms.rain_factor as f64);
    timing.record_count(frame.0, "Weather Snow Factor", uniforms.snow_factor as f64);
    timing.record_count(frame.0, "Weather Wetness", uniforms.wetness as f64);
    timing.record_count(
        frame.0,
        "Weather Overlay Density",
        uniforms.overlay_density as f64,
    );
    timing.record_count(
        frame.0,
        "Weather Kind Code",
        uniforms.weather_kind_code as f64,
    );
    timing.record_count(frame.0, "Weather Quality Code", runtime.quality.code());
    timing.record_count(
        frame.0,
        "Weather Overlay Pass Active",
        ((uniforms.flags & super::state::WEATHER_FLAG_PRECIP_OVERLAY) != 0) as u32 as f64,
    );
    timing.record_count(
        frame.0,
        "Weather Puddle Normal Active",
        ((uniforms.flags & super::state::WEATHER_FLAG_PUDDLE_DETAIL) != 0) as u32 as f64,
    );
    timing.record_count(
        frame.0,
        "Weather Shader Feature Mask",
        uniforms.flags as f64,
    );
}

fn effective_weather_quality(
    config: &WeatherConfig,
    preset: Option<RenderQualityPreset>,
    integrated_gpu: bool,
) -> WeatherQuality {
    if !config.enabled {
        return WeatherQuality::Off;
    }

    let preset_cap = preset.unwrap_or_default().weather_quality_cap();
    let mut quality = config.quality.min(preset_cap);
    if integrated_gpu {
        quality = quality.min(WeatherQuality::Low);
    }
    quality
}

fn next_weather_kind(kind: WeatherKind) -> WeatherKind {
    match kind {
        WeatherKind::Clear => WeatherKind::Rain,
        WeatherKind::Rain => WeatherKind::Snow,
        WeatherKind::Snow => WeatherKind::Clear,
    }
}

fn next_weather_quality(quality: WeatherQuality) -> WeatherQuality {
    match quality {
        WeatherQuality::Off => WeatherQuality::Low,
        WeatherQuality::Low => WeatherQuality::Medium,
        WeatherQuality::Medium => WeatherQuality::High,
        WeatherQuality::High => WeatherQuality::Ultra,
        WeatherQuality::Ultra => WeatherQuality::Off,
    }
}

fn next_render_quality_preset(preset: RenderQualityPreset) -> RenderQualityPreset {
    match preset {
        RenderQualityPreset::Low => RenderQualityPreset::Medium,
        RenderQualityPreset::Medium => RenderQualityPreset::High,
        RenderQualityPreset::High => RenderQualityPreset::Performance100,
        RenderQualityPreset::Performance100 => RenderQualityPreset::Low,
    }
}

fn graphics_quality_for_render_preset(preset: RenderQualityPreset) -> GraphicsQuality {
    match preset {
        RenderQualityPreset::Low => GraphicsQuality::Low,
        RenderQualityPreset::Medium => GraphicsQuality::Medium,
        RenderQualityPreset::High => GraphicsQuality::High,
        RenderQualityPreset::Performance100 => GraphicsQuality::Performance100,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_quality(quality: WeatherQuality) -> WeatherConfig {
        WeatherConfig {
            quality,
            ..WeatherConfig::default()
        }
    }

    #[test]
    fn render_preset_caps_weather_quality() {
        let config = config_with_quality(WeatherQuality::Ultra);
        assert_eq!(
            effective_weather_quality(&config, Some(RenderQualityPreset::High), false),
            WeatherQuality::Ultra
        );
        assert_eq!(
            effective_weather_quality(&config, Some(RenderQualityPreset::Medium), false),
            WeatherQuality::Medium
        );
        assert_eq!(
            effective_weather_quality(&config, Some(RenderQualityPreset::Performance100), false),
            WeatherQuality::Low
        );
    }

    #[test]
    fn integrated_gpu_uses_conservative_weather_quality() {
        let config = config_with_quality(WeatherQuality::Ultra);
        assert_eq!(
            effective_weather_quality(&config, Some(RenderQualityPreset::High), true),
            WeatherQuality::Low
        );
    }

    #[test]
    fn disabled_weather_forces_quality_off() {
        let mut config = config_with_quality(WeatherQuality::Ultra);
        config.enabled = false;
        assert_eq!(
            effective_weather_quality(&config, Some(RenderQualityPreset::High), false),
            WeatherQuality::Off
        );
    }

    #[test]
    fn weather_debug_cycles_cover_expected_test_modes() {
        assert_eq!(next_weather_kind(WeatherKind::Clear), WeatherKind::Rain);
        assert_eq!(next_weather_kind(WeatherKind::Rain), WeatherKind::Snow);
        assert_eq!(next_weather_kind(WeatherKind::Snow), WeatherKind::Clear);

        assert_eq!(
            next_weather_quality(WeatherQuality::Off),
            WeatherQuality::Low
        );
        assert_eq!(
            next_weather_quality(WeatherQuality::Low),
            WeatherQuality::Medium
        );
        assert_eq!(
            next_weather_quality(WeatherQuality::Medium),
            WeatherQuality::High
        );
        assert_eq!(
            next_weather_quality(WeatherQuality::High),
            WeatherQuality::Ultra
        );
        assert_eq!(
            next_weather_quality(WeatherQuality::Ultra),
            WeatherQuality::Off
        );
    }

    #[test]
    fn render_preset_debug_cycle_matches_quality_menu_order() {
        assert_eq!(
            next_render_quality_preset(RenderQualityPreset::Low),
            RenderQualityPreset::Medium
        );
        assert_eq!(
            next_render_quality_preset(RenderQualityPreset::Medium),
            RenderQualityPreset::High
        );
        assert_eq!(
            next_render_quality_preset(RenderQualityPreset::High),
            RenderQualityPreset::Performance100
        );
        assert_eq!(
            next_render_quality_preset(RenderQualityPreset::Performance100),
            RenderQualityPreset::Low
        );
        assert!(matches!(
            graphics_quality_for_render_preset(RenderQualityPreset::Performance100),
            GraphicsQuality::Performance100
        ));
    }
}
