//! Settings dialog systems and UI.
//!
//! This module handles the settings dialog including:
//! - Graphics settings (quality, AA, ray tracing, resolution, etc.)
//! - Gameplay settings (walk/run speed, jump/float height)
//! - Atmosphere settings (day/night cycle, fog, lighting)

use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::prelude::*;
use bevy::ui::{FlexWrap, RelativeCursorPosition};
use bevy::window::{MonitorSelection, PrimaryWindow, VideoModeSelection, WindowMode, WindowResolution};

use crate::atmosphere::FogConfig;
use crate::environment::AtmosphereSettings;
use crate::player::PlayerConfig;
use crate::rendering::ray_tracing::RayTracingSettings;

use super::types::*;
use super::ui::{ACTIVE_BG, BUTTON_BG, INACTIVE_BG, INPUT_ACTIVE_BG, INPUT_INACTIVE_BG};

// ============================================================================
// Settings Dialog Spawning
// ============================================================================

/// Spawns the settings dialog as a child of the menu root.
pub fn spawn_settings_dialog(
    commands: &mut Commands,
    root_entity: Option<Entity>,
    font: &Handle<Font>,
    settings_state: SettingsState,
    ray_tracing_supported: bool,
) -> Entity {
    let mut dialog_entity = commands.spawn((
        Node {
            width: Val::Percent(80.0),
            height: Val::Percent(75.0),
            padding: UiRect::all(Val::Px(20.0)),
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(12.0),
            align_self: AlignSelf::Center,
            justify_content: JustifyContent::FlexStart,
            ..default()
        },
        BackgroundColor(Color::srgba(0.08, 0.08, 0.08, 0.95)),
        SettingsDialogRoot,
    ));

    dialog_entity.with_children(|dialog| {
        spawn_settings_header(dialog, font);
        spawn_settings_tabs(dialog, font);
        spawn_settings_content(dialog, font, &settings_state, ray_tracing_supported);
        spawn_settings_close_button(dialog, font);
    });

    let dialog_id = dialog_entity.id();
    if let Some(root) = root_entity {
        commands.entity(root).add_child(dialog_id);
    }

    dialog_id
}

fn spawn_settings_header(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog.spawn((
        Text::new("Settings"),
        TextFont {
            font: font.clone(),
            font_size: 28.0,
            ..default()
        },
        TextColor(Color::WHITE),
    ));
}

fn spawn_settings_tabs(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            column_gap: Val::Px(10.0),
            ..default()
        })
        .with_children(|tabs| {
            spawn_settings_tab_button(tabs, font, "Graphics", SettingsTabButton::Graphics);
            spawn_settings_tab_button(tabs, font, "Gameplay", SettingsTabButton::Gameplay);
            spawn_settings_tab_button(tabs, font, "Atmosphere", SettingsTabButton::Atmosphere);
            spawn_settings_tab_button(tabs, font, "Fog", SettingsTabButton::Fog);
            spawn_settings_tab_button(tabs, font, "Visual", SettingsTabButton::Visual);
        });
}

fn spawn_settings_tab_button(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    tab: SettingsTabButton,
) {
    parent
        .spawn((
            Button,
            Node {
                padding: UiRect::axes(Val::Px(14.0), Val::Px(10.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(Color::srgba(0.18, 0.18, 0.18, 0.9)),
            tab,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

fn spawn_settings_content(
    dialog: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    _settings_state: &SettingsState,
    ray_tracing_supported: bool,
) {
    spawn_graphics_tab(dialog, font, ray_tracing_supported);
    spawn_gameplay_tab(dialog, font);
    spawn_atmosphere_tab(dialog, font);
    spawn_fog_tab(dialog, font);
    spawn_visual_tab(dialog, font);
}

fn spawn_settings_close_button(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Button,
            Node {
                width: Val::Px(120.0),
                padding: UiRect::all(Val::Px(10.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(BUTTON_BG),
            CloseSettingsButton,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new("Close"),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

// ============================================================================
// Tab Content Spawning
// ============================================================================

fn spawn_graphics_tab(
    dialog: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    ray_tracing_supported: bool,
) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::Flex,
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            GraphicsTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Quality", |options, font| {
                spawn_graphics_option(options, font, "Low", GraphicsQualityOption(GraphicsQuality::Low));
                spawn_graphics_option(options, font, "Medium", GraphicsQualityOption(GraphicsQuality::Medium));
                spawn_graphics_option(options, font, "High", GraphicsQualityOption(GraphicsQuality::High));
            });

            spawn_option_row(content, font, "Anti-Aliasing", |options, font| {
                spawn_graphics_option(options, font, "None", AntiAliasingOption(AntiAliasing::None));
                spawn_graphics_option(options, font, "FXAA", AntiAliasingOption(AntiAliasing::Fxaa));
                spawn_graphics_option(options, font, "MSAA 4x", AntiAliasingOption(AntiAliasing::Msaa4x));
                spawn_graphics_option(options, font, "TAA", AntiAliasingOption(AntiAliasing::Taa));
            });

            if ray_tracing_supported {
                spawn_option_row(content, font, "Ray Tracing", |options, font| {
                    spawn_graphics_option(options, font, "Off", RayTracingOption(false));
                    spawn_graphics_option(options, font, "On", RayTracingOption(true));
                });
            }

            spawn_option_row(content, font, "Shadow Filter", |options, font| {
                spawn_graphics_option(options, font, "Gaussian", ShadowFilteringOption(ShadowFiltering::Gaussian));
                spawn_graphics_option(options, font, "Hardware", ShadowFilteringOption(ShadowFiltering::Hardware2x2));
                spawn_graphics_option(options, font, "Temporal", ShadowFilteringOption(ShadowFiltering::Temporal));
            });

            spawn_option_row(content, font, "Display Mode", |options, font| {
                spawn_graphics_option(options, font, "Bordered", DisplayModeOption::Bordered);
                spawn_graphics_option(options, font, "Borderless", DisplayModeOption::Borderless);
                spawn_graphics_option(options, font, "Fullscreen", DisplayModeOption::Fullscreen);
            });

            spawn_option_row(content, font, "Resolution", |options, font| {
                spawn_graphics_option(options, font, "1280x720", ResolutionOption(UVec2::new(1280, 720)));
                spawn_graphics_option(options, font, "1920x1080", ResolutionOption(UVec2::new(1920, 1080)));
                spawn_graphics_option(options, font, "2560x1440", ResolutionOption(UVec2::new(2560, 1440)));
            });
        });
}

fn spawn_gameplay_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            GameplayTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Walk Speed", |options, font| {
                spawn_graphics_option(options, font, "Slow", PlayerWalkSpeedOption(WalkSpeedPreset::Slow));
                spawn_graphics_option(options, font, "Standard", PlayerWalkSpeedOption(WalkSpeedPreset::Standard));
                spawn_graphics_option(options, font, "Fast", PlayerWalkSpeedOption(WalkSpeedPreset::Fast));
            });

            spawn_option_row(content, font, "Run Speed", |options, font| {
                spawn_graphics_option(options, font, "Slow", PlayerRunSpeedOption(RunSpeedPreset::Slow));
                spawn_graphics_option(options, font, "Standard", PlayerRunSpeedOption(RunSpeedPreset::Standard));
                spawn_graphics_option(options, font, "Fast", PlayerRunSpeedOption(RunSpeedPreset::Fast));
            });

            spawn_option_row(content, font, "Jump Height", |options, font| {
                spawn_graphics_option(options, font, "Low", PlayerJumpHeightOption(JumpHeightPreset::Low));
                spawn_graphics_option(options, font, "Standard", PlayerJumpHeightOption(JumpHeightPreset::Standard));
                spawn_graphics_option(options, font, "High", PlayerJumpHeightOption(JumpHeightPreset::High));
            });

            spawn_option_row(content, font, "Float Height", |options, font| {
                spawn_graphics_option(options, font, "Low", PlayerFloatHeightOption(FloatHeightPreset::Low));
                spawn_graphics_option(options, font, "Standard", PlayerFloatHeightOption(FloatHeightPreset::Standard));
                spawn_graphics_option(options, font, "High", PlayerFloatHeightOption(FloatHeightPreset::High));
            });
        });
}

fn spawn_atmosphere_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                overflow: Overflow::scroll_y(),
                max_height: Val::Px(400.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            AtmosphereTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Day/Night", |options, font| {
                spawn_graphics_option(options, font, "Off", DayNightCycleOption(false));
                spawn_graphics_option(options, font, "On", DayNightCycleOption(true));
            });

            spawn_option_row(content, font, "Day Length", |options, font| {
                spawn_graphics_option(options, font, "Short", DayLengthOption::Short);
                spawn_graphics_option(options, font, "Standard", DayLengthOption::Standard);
                spawn_graphics_option(options, font, "Long", DayLengthOption::Long);
            });

            spawn_option_row(content, font, "Time Scale", |options, font| {
                spawn_graphics_option(options, font, "Slow", TimeScaleOption::Slow);
                spawn_graphics_option(options, font, "Real", TimeScaleOption::RealTime);
                spawn_graphics_option(options, font, "Fast", TimeScaleOption::Fast);
            });

            spawn_option_row(content, font, "Rayleigh", |options, font| {
                spawn_graphics_option(options, font, "Gentle", RayleighOption::Gentle);
                spawn_graphics_option(options, font, "Balanced", RayleighOption::Balanced);
                spawn_graphics_option(options, font, "Vivid", RayleighOption::Vivid);
            });

            spawn_option_row(content, font, "Mie", |options, font| {
                spawn_graphics_option(options, font, "Soft", MieOption::Soft);
                spawn_graphics_option(options, font, "Standard", MieOption::Standard);
                spawn_graphics_option(options, font, "Dense", MieOption::Dense);
            });

            spawn_option_row(content, font, "Mie Direction", |options, font| {
                spawn_graphics_option(options, font, "Broad", MieDirectionOption::Broad);
                spawn_graphics_option(options, font, "Standard", MieDirectionOption::Standard);
                spawn_graphics_option(options, font, "Forward", MieDirectionOption::Forward);
            });

            spawn_option_row(content, font, "Exposure", |options, font| {
                spawn_graphics_option(options, font, "Low", ExposureOption::Low);
                spawn_graphics_option(options, font, "Neutral", ExposureOption::Neutral);
                spawn_graphics_option(options, font, "High", ExposureOption::High);
            });

            spawn_option_row(content, font, "Twilight Band", |options, font| {
                spawn_graphics_option(options, font, "Narrow", TwilightBandOption::Narrow);
                spawn_graphics_option(options, font, "Medium", TwilightBandOption::Medium);
                spawn_graphics_option(options, font, "Wide", TwilightBandOption::Wide);
            });

            spawn_option_row(content, font, "Night", |options, font| {
                spawn_graphics_option(options, font, "Dim", NightBrightnessOption::Dim);
                spawn_graphics_option(options, font, "Balanced", NightBrightnessOption::Balanced);
                spawn_graphics_option(options, font, "Bright", NightBrightnessOption::Bright);
            });

            spawn_option_row(content, font, "Sky Quality", |options, font| {
                spawn_graphics_option(options, font, "Low", SkyQualityOption::Low);
                spawn_graphics_option(options, font, "Medium", SkyQualityOption::Medium);
                spawn_graphics_option(options, font, "High", SkyQualityOption::High);
                spawn_graphics_option(options, font, "Ultra", SkyQualityOption::Ultra);
            });

            spawn_option_row(content, font, "Ozone", |options, font| {
                spawn_graphics_option(options, font, "None", OzoneOption::None);
                spawn_graphics_option(options, font, "Subtle", OzoneOption::Subtle);
                spawn_graphics_option(options, font, "Earth", OzoneOption::Earth);
                spawn_graphics_option(options, font, "Heavy", OzoneOption::Heavy);
            });

            spawn_option_row(content, font, "Ground Albedo", |options, font| {
                spawn_graphics_option(options, font, "Dark", GroundAlbedoOption::Dark);
                spawn_graphics_option(options, font, "Earth", GroundAlbedoOption::Earth);
                spawn_graphics_option(options, font, "Bright", GroundAlbedoOption::Bright);
                spawn_graphics_option(options, font, "Snow", GroundAlbedoOption::Snow);
            });

            spawn_option_row(content, font, "Sun Size", |options, font| {
                spawn_graphics_option(options, font, "Small", SunSizeOption::Small);
                spawn_graphics_option(options, font, "Earth", SunSizeOption::Earth);
                spawn_graphics_option(options, font, "Large", SunSizeOption::Large);
            });
        });
}

fn spawn_fog_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(8.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                overflow: Overflow::scroll_y(),
                max_height: Val::Px(400.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            FogTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Fog Preset", |options, font| {
                spawn_graphics_option(options, font, "Clear", FogPresetOption::Clear);
                spawn_graphics_option(options, font, "Balanced", FogPresetOption::Balanced);
                spawn_graphics_option(options, font, "Misty", FogPresetOption::Misty);
            });

            content
                .spawn(Node {
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    column_gap: Val::Px(18.0),
                    row_gap: Val::Px(12.0),
                    align_items: AlignItems::FlexStart,
                    ..default()
                })
                .with_children(|columns| {
                    spawn_settings_column(columns, font, "Distance", |column, font| {
                        spawn_option_row(column, font, "Distance Fog", |options, font| {
                            spawn_graphics_option(options, font, "Off", DistanceFogOption(false));
                            spawn_graphics_option(options, font, "On", DistanceFogOption(true));
                        });

                        spawn_option_row(column, font, "Volumetric Fog", |options, font| {
                            spawn_graphics_option(options, font, "Off", VolumetricFogOption(false));
                            spawn_graphics_option(options, font, "On", VolumetricFogOption(true));
                        });

                        spawn_fog_slider_row(column, font, "Fog Start", FogSlider::DistanceStart);
                        spawn_fog_slider_row(column, font, "Fog End", FogSlider::DistanceEnd);
                    });

                    spawn_settings_column(columns, font, "Color", |column, font| {
                        spawn_fog_slider_row(column, font, "Blue Tint", FogSlider::FogBlueTint);
                        spawn_fog_slider_row(column, font, "Brightness", FogSlider::FogBrightness);
                        spawn_fog_slider_row(column, font, "Aerial Strength", FogSlider::AerialStrength);
                        spawn_fog_slider_row(column, font, "Ambient", FogSlider::AmbientIntensity);
                    });

                    spawn_settings_column(columns, font, "Volume", |column, font| {
                        spawn_fog_slider_row(column, font, "Volume Density", FogSlider::VolumeDensity);
                        spawn_fog_slider_row(column, font, "Scattering", FogSlider::VolumeScattering);
                        spawn_fog_slider_row(column, font, "Absorption", FogSlider::VolumeAbsorption);
                        spawn_fog_slider_row(column, font, "Asymmetry", FogSlider::ScatteringAsymmetry);
                        spawn_fog_slider_row(column, font, "Volume Size", FogSlider::VolumeSize);
                        spawn_fog_slider_row(column, font, "Step Count", FogSlider::StepCount);
                        spawn_fog_slider_row(column, font, "Jitter", FogSlider::Jitter);
                    });
                });
        });
}

fn spawn_visual_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(8.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                overflow: Overflow::scroll_y(),
                max_height: Val::Px(400.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            VisualTabContent,
        ))
        .with_children(|content| {
            content
                .spawn(Node {
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    column_gap: Val::Px(18.0),
                    row_gap: Val::Px(12.0),
                    align_items: AlignItems::FlexStart,
                    ..default()
                })
                .with_children(|columns| {
                    spawn_settings_column(columns, font, "Color", |column, font| {
                        spawn_slider_row(column, font, "Temperature", VisualSlider::Temperature, -0.3, 0.3);
                        spawn_slider_row(column, font, "Saturation", VisualSlider::Saturation, 0.5, 2.0);
                        spawn_slider_row(column, font, "Exposure", VisualSlider::Exposure, -1.0, 1.0);
                        spawn_slider_row(column, font, "Gamma", VisualSlider::Gamma, 0.5, 1.5);
                    });

                    spawn_settings_column(columns, font, "Light", |column, font| {
                        spawn_slider_row(column, font, "Highlights", VisualSlider::HighlightsGain, 0.5, 1.5);
                        spawn_slider_row(column, font, "Sun Warmth", VisualSlider::SunWarmth, 0.0, 0.3);
                        spawn_slider_row(column, font, "Illuminance", VisualSlider::Illuminance, 5000.0, 50000.0);
                        spawn_slider_row(column, font, "Sky Light", VisualSlider::SkyboxBrightness, 1000.0, 10000.0);
                    });
                });
        });
}

/// Spawns a slider row with label, track, and value display
fn spawn_slider_row(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    slider: VisualSlider,
    _min: f32,
    _max: f32,
) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: Val::Px(10.0),
            height: Val::Px(28.0),
            ..default()
        })
        .with_children(|row| {
            // Label
            row.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::WHITE),
                Node {
                    width: Val::Px(110.0),
                    ..default()
                },
            ));

            // Slider track (clickable background)
            row.spawn((
                Button,
                Node {
                    width: Val::Px(130.0),
                    height: Val::Px(18.0),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.2, 0.2, 0.2, 1.0)),
                SliderTrack(slider),
                RelativeCursorPosition::default(),
            ))
            .with_children(|track| {
                // Slider fill (colored portion)
                track.spawn((
                    Node {
                        width: Val::Percent(50.0), // Will be updated by system
                        height: Val::Percent(100.0),
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.3, 0.6, 0.9, 1.0)),
                    SliderFill(slider),
                ));
            });

            // Value input
            row.spawn((
                Button,
                Node {
                    width: Val::Px(60.0),
                    height: Val::Px(22.0),
                    padding: UiRect::axes(Val::Px(6.0), Val::Px(2.0)),
                    justify_content: JustifyContent::FlexEnd,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(INPUT_INACTIVE_BG),
                SettingsInputButton(SettingsInputField::Visual(slider)),
            ))
            .with_children(|input| {
                input.spawn((
                    Text::new("0.00"),
                    TextFont {
                        font: font.clone(),
                        font_size: 13.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                    SliderValueText(slider),
                ));
            });
        });
}

fn spawn_fog_slider_row(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    slider: FogSlider,
) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: Val::Px(10.0),
            height: Val::Px(28.0),
            ..default()
        })
        .with_children(|row| {
            row.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::WHITE),
                Node {
                    width: Val::Px(110.0),
                    ..default()
                },
            ));

            row.spawn((
                Button,
                Node {
                    width: Val::Px(130.0),
                    height: Val::Px(18.0),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.2, 0.2, 0.2, 1.0)),
                FogSliderTrack(slider),
                RelativeCursorPosition::default(),
            ))
            .with_children(|track| {
                track.spawn((
                    Node {
                        width: Val::Percent(50.0),
                        height: Val::Percent(100.0),
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.3, 0.6, 0.9, 1.0)),
                    FogSliderFill(slider),
                ));
            });

            row.spawn((
                Button,
                Node {
                    width: Val::Px(60.0),
                    height: Val::Px(22.0),
                    padding: UiRect::axes(Val::Px(6.0), Val::Px(2.0)),
                    justify_content: JustifyContent::FlexEnd,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(INPUT_INACTIVE_BG),
                SettingsInputButton(SettingsInputField::Fog(slider)),
            ))
            .with_children(|input| {
                input.spawn((
                    Text::new("0.00"),
                    TextFont {
                        font: font.clone(),
                        font_size: 13.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                    FogSliderValueText(slider),
                ));
            });
        });
}

fn spawn_settings_column<F>(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    title: &str,
    spawn_rows: F,
) where
    F: FnOnce(&mut ChildSpawnerCommands, &Handle<Font>),
{
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(8.0),
            width: Val::Px(320.0),
            ..default()
        })
        .with_children(|column| {
            column.spawn((
                Text::new(title),
                TextFont {
                    font: font.clone(),
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::srgba(0.78, 0.82, 0.86, 1.0)),
            ));

            spawn_rows(column, font);
        });
}

// ============================================================================
// Helper Functions
// ============================================================================

fn spawn_graphics_option<T: Component + Copy + Send + Sync + 'static>(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    tag: T,
) {
    parent
        .spawn((
            Button,
            Node {
                padding: UiRect::axes(Val::Px(12.0), Val::Px(8.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(INACTIVE_BG),
            tag,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

fn spawn_option_row<F>(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    spawn_options: F,
) where
    F: FnOnce(&mut ChildSpawnerCommands, &Handle<Font>),
{
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: Val::Px(12.0),
            ..default()
        })
        .with_children(|row| {
            row.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
                Node {
                    width: Val::Px(140.0),
                    ..default()
                },
            ));
            row.spawn(Node {
                flex_direction: FlexDirection::Row,
                column_gap: Val::Px(8.0),
                ..default()
            })
            .with_children(|options| {
                spawn_options(options, font);
            });
        });
}

/// Closes the settings dialog if open.
pub fn close_settings_dialog(commands: &mut Commands, settings_state: &mut SettingsState) {
    if let Some(dialog) = settings_state.dialog_root.take() {
        commands.entity(dialog).despawn();
    }
}

// ============================================================================
// Settings Tab Handling
// ============================================================================

/// Handles switching between settings tabs.
pub fn handle_settings_tabs(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    mut input_state: ResMut<SettingsInputState>,
    mut tab_query: Query<(&Interaction, &SettingsTabButton), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, tab) in tab_query.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        settings_state.active_tab = match tab {
            SettingsTabButton::Graphics => SettingsTab::Graphics,
            SettingsTabButton::Gameplay => SettingsTab::Gameplay,
            SettingsTabButton::Atmosphere => SettingsTab::Atmosphere,
            SettingsTabButton::Fog => SettingsTab::Fog,
            SettingsTabButton::Visual => SettingsTab::Visual,
        };
        input_state.active = None;
        input_state.buffer.clear();
    }
}

/// Handles graphics settings changes.
pub fn handle_graphics_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    quality_query: Query<(&Interaction, &GraphicsQualityOption), (Changed<Interaction>, With<Button>)>,
    aa_query: Query<(&Interaction, &AntiAliasingOption), (Changed<Interaction>, With<Button>)>,
    rt_query: Query<(&Interaction, &RayTracingOption), (Changed<Interaction>, With<Button>)>,
    display_query: Query<(&Interaction, &DisplayModeOption), (Changed<Interaction>, With<Button>)>,
    resolution_query: Query<(&Interaction, &ResolutionOption), (Changed<Interaction>, With<Button>)>,
    shadow_query: Query<(&Interaction, &ShadowFilteringOption), (Changed<Interaction>, With<Button>)>,
    mut rt_settings: ResMut<RayTracingSettings>,
    mut window_query: Query<&mut Window, With<PrimaryWindow>>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in quality_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.graphics_quality = option.0;
        }
    }

    for (interaction, option) in aa_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.anti_aliasing = option.0;
        }
    }

    for (interaction, option) in rt_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.ray_tracing = option.0;
            rt_settings.enabled = option.0;
        }
    }

    for (interaction, option) in display_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.display_mode = match option {
                DisplayModeOption::Bordered => DisplayMode::Bordered,
                DisplayModeOption::Borderless => DisplayMode::Borderless,
                DisplayModeOption::Fullscreen => DisplayMode::Fullscreen,
            };
            apply_window_settings(&settings_state, &mut window_query);
        }
    }

    for (interaction, option) in resolution_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.resolution = option.0;
            apply_window_settings(&settings_state, &mut window_query);
        }
    }

    for (interaction, option) in shadow_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.shadow_filtering = option.0;
        }
    }
}

/// Handles gameplay settings changes.
pub fn handle_gameplay_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    walk_query: Query<(&Interaction, &PlayerWalkSpeedOption), (Changed<Interaction>, With<Button>)>,
    run_query: Query<(&Interaction, &PlayerRunSpeedOption), (Changed<Interaction>, With<Button>)>,
    jump_query: Query<(&Interaction, &PlayerJumpHeightOption), (Changed<Interaction>, With<Button>)>,
    float_query: Query<(&Interaction, &PlayerFloatHeightOption), (Changed<Interaction>, With<Button>)>,
    mut player_config: ResMut<PlayerConfig>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in walk_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.walk_speed = option.0;
            player_config.walk_speed = option.0.value();
        }
    }

    for (interaction, option) in run_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.run_speed = option.0;
            player_config.run_speed = option.0.value();
        }
    }

    for (interaction, option) in jump_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.jump_height = option.0;
            player_config.jump_height = option.0.value();
        }
    }

    for (interaction, option) in float_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.float_height = option.0;
            player_config.float_height = option.0.value();
        }
    }
}

/// Handles atmosphere settings changes.
pub fn handle_atmosphere_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    cycle_query: Query<(&Interaction, &DayNightCycleOption), (Changed<Interaction>, With<Button>)>,
    day_length_query: Query<(&Interaction, &DayLengthOption), (Changed<Interaction>, With<Button>)>,
    time_scale_query: Query<(&Interaction, &TimeScaleOption), (Changed<Interaction>, With<Button>)>,
    rayleigh_query: Query<(&Interaction, &RayleighOption), (Changed<Interaction>, With<Button>)>,
    mie_query: Query<(&Interaction, &MieOption), (Changed<Interaction>, With<Button>)>,
    mie_dir_query: Query<(&Interaction, &MieDirectionOption), (Changed<Interaction>, With<Button>)>,
    exposure_query: Query<(&Interaction, &ExposureOption), (Changed<Interaction>, With<Button>)>,
    twilight_query: Query<(&Interaction, &TwilightBandOption), (Changed<Interaction>, With<Button>)>,
    night_query: Query<(&Interaction, &NightBrightnessOption), (Changed<Interaction>, With<Button>)>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut bevy_atmosphere_query: Query<&mut bevy::pbr::Atmosphere>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in cycle_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.cycle_enabled = option.0;
            atmosphere.cycle_enabled = option.0;
            if !option.0 {
                atmosphere.time = atmosphere.day_length * 0.25;
            }
        }
    }

    for (interaction, option) in day_length_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.day_length = *option;
            atmosphere.day_length = match option {
                DayLengthOption::Short => 600.0,
                DayLengthOption::Standard => 1800.0,
                DayLengthOption::Long => 3600.0,
            };
        }
    }

    for (interaction, option) in time_scale_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.time_scale = *option;
            atmosphere.time_scale = match option {
                TimeScaleOption::Slow => 0.5,
                TimeScaleOption::RealTime => 1.0,
                TimeScaleOption::Fast => 2.0,
            };
        }
    }

    let base_rayleigh = Vec3::new(5.5, 13.0, 22.4) * 0.0012;
    let base_mie = Vec3::splat(0.005);

    for (interaction, option) in rayleigh_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.rayleigh = *option;
            atmosphere.rayleigh = match option {
                RayleighOption::Gentle => base_rayleigh * 0.7,
                RayleighOption::Balanced => base_rayleigh,
                RayleighOption::Vivid => base_rayleigh * 1.4,
            };
            // Also update Bevy's native atmosphere
            for mut atmo in bevy_atmosphere_query.iter_mut() {
                atmo.rayleigh_scattering = match option {
                    RayleighOption::Gentle => Vec3::new(5.5e-6, 13.0e-6, 22.4e-6) * 0.7,
                    RayleighOption::Balanced => Vec3::new(5.5e-6, 13.0e-6, 22.4e-6),
                    RayleighOption::Vivid => Vec3::new(5.5e-6, 13.0e-6, 22.4e-6) * 1.4,
                };
            }
        }
    }

    for (interaction, option) in mie_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.mie = *option;
            atmosphere.mie = match option {
                MieOption::Soft => Vec3::splat(0.0035),
                MieOption::Standard => base_mie,
                MieOption::Dense => Vec3::splat(0.0075),
            };
            // Also update Bevy's native atmosphere
            for mut atmo in bevy_atmosphere_query.iter_mut() {
                atmo.mie_scattering = match option {
                    MieOption::Soft => 1.0e-5,
                    MieOption::Standard => 2.0e-5,
                    MieOption::Dense => 4.0e-5,
                };
            }
        }
    }

    for (interaction, option) in mie_dir_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.mie_direction = *option;
            atmosphere.mie_direction = match option {
                MieDirectionOption::Broad => 0.5,
                MieDirectionOption::Standard => 0.7,
                MieDirectionOption::Forward => 0.85,
            };
            // Also update Bevy's native atmosphere
            for mut atmo in bevy_atmosphere_query.iter_mut() {
                atmo.mie_asymmetry = match option {
                    MieDirectionOption::Broad => 0.5,
                    MieDirectionOption::Standard => 0.758,
                    MieDirectionOption::Forward => 0.9,
                };
            }
        }
    }

    for (interaction, option) in exposure_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.exposure = *option;
            atmosphere.exposure = match option {
                ExposureOption::Low => 0.8,
                ExposureOption::Neutral => 1.0,
                ExposureOption::High => 1.3,
            };
        }
    }

    for (interaction, option) in twilight_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.twilight_band = *option;
            atmosphere.twilight_band = match option {
                TwilightBandOption::Narrow => 0.35,
                TwilightBandOption::Medium => 0.6,
                TwilightBandOption::Wide => 0.9,
            };
        }
    }

    for (interaction, option) in night_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.night_brightness = *option;
            atmosphere.night_floor = match option {
                NightBrightnessOption::Dim => 0.04,
                NightBrightnessOption::Balanced => 0.08,
                NightBrightnessOption::Bright => 0.12,
            };
        }
    }
}

/// Handles Bevy native atmosphere settings (sky quality, ozone, ground albedo, sun size).
pub fn handle_bevy_atmosphere_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    sky_quality_query: Query<(&Interaction, &SkyQualityOption), (Changed<Interaction>, With<Button>)>,
    ozone_query: Query<(&Interaction, &OzoneOption), (Changed<Interaction>, With<Button>)>,
    ground_albedo_query: Query<(&Interaction, &GroundAlbedoOption), (Changed<Interaction>, With<Button>)>,
    sun_size_query: Query<(&Interaction, &SunSizeOption), (Changed<Interaction>, With<Button>)>,
    mut bevy_atmosphere_query: Query<&mut bevy::pbr::Atmosphere>,
    mut atmo_settings_query: Query<&mut bevy::pbr::AtmosphereSettings>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    // Bevy native atmosphere settings
    for (interaction, option) in sky_quality_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.sky_quality = *option;
            for mut settings in atmo_settings_query.iter_mut() {
                settings.sky_max_samples = match option {
                    SkyQualityOption::Low => 16,
                    SkyQualityOption::Medium => 32,
                    SkyQualityOption::High => 48,
                    SkyQualityOption::Ultra => 64,
                };
            }
        }
    }

    for (interaction, option) in ozone_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.ozone = *option;
            for mut atmo in bevy_atmosphere_query.iter_mut() {
                atmo.ozone_absorption = match option {
                    OzoneOption::None => Vec3::ZERO,
                    OzoneOption::Subtle => Vec3::new(0.32e-6, 0.94e-6, 0.04e-6),
                    OzoneOption::Earth => Vec3::new(0.65e-6, 1.881e-6, 0.085e-6),
                    OzoneOption::Heavy => Vec3::new(1.3e-6, 3.76e-6, 0.17e-6),
                };
            }
        }
    }

    for (interaction, option) in ground_albedo_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.ground_albedo = *option;
            for mut atmo in bevy_atmosphere_query.iter_mut() {
                atmo.ground_albedo = match option {
                    GroundAlbedoOption::Dark => Vec3::splat(0.1),
                    GroundAlbedoOption::Earth => Vec3::new(0.3, 0.3, 0.3),
                    GroundAlbedoOption::Bright => Vec3::splat(0.5),
                    GroundAlbedoOption::Snow => Vec3::splat(0.8),
                };
            }
        }
    }

    for (interaction, option) in sun_size_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.sun_size = *option;
            // Sun angular radius in radians (Earth sun is ~0.00465 rad = 0.27°)
            // Note: This would need DirectionalLight modification in a full impl
            // For now this is a placeholder for future sun disk rendering
        }
    }
}

/// Handles fog settings changes.
pub fn handle_fog_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    distance_query: Query<(&Interaction, &DistanceFogOption), (Changed<Interaction>, With<Button>)>,
    volumetric_query: Query<(&Interaction, &VolumetricFogOption), (Changed<Interaction>, With<Button>)>,
    fog_query: Query<(&Interaction, &FogPresetOption), (Changed<Interaction>, With<Button>)>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut fog_config: ResMut<FogConfig>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in distance_query.iter() {
        if *interaction == Interaction::Pressed {
            fog_config.distance.enabled = option.0;
        }
    }

    for (interaction, option) in volumetric_query.iter() {
        if *interaction == Interaction::Pressed {
            fog_config.volumetric.enabled = option.0;
        }
    }

    for (interaction, option) in fog_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.fog_preset = *option;
            atmosphere.fog_density = match option {
                FogPresetOption::Clear => Vec2::new(0.0006, 0.0014),
                FogPresetOption::Balanced => Vec2::new(0.0009, 0.0022),
                FogPresetOption::Misty => Vec2::new(0.0012, 0.003),
            };
            fog_config.volume.density = match option {
                FogPresetOption::Clear => 0.015,
                FogPresetOption::Balanced => 0.04,
                FogPresetOption::Misty => 0.08,
            };
        }
    }
}

/// Handles the close settings button.
pub fn handle_close_settings(
    mut commands: Commands,
    mut settings_state: ResMut<SettingsState>,
    query: Query<&Interaction, (Changed<Interaction>, With<CloseSettingsButton>)>,
) {
    for interaction in query.iter() {
        if *interaction == Interaction::Pressed {
            close_settings_dialog(&mut commands, &mut settings_state);
        }
    }
}

fn apply_window_settings(
    settings_state: &SettingsState,
    window_query: &mut Query<&mut Window, With<PrimaryWindow>>,
) {
    let Ok(mut window) = window_query.single_mut() else {
        return;
    };

    window.mode = match settings_state.display_mode {
        DisplayMode::Bordered | DisplayMode::Borderless => WindowMode::Windowed,
        DisplayMode::Fullscreen => WindowMode::Fullscreen(MonitorSelection::Primary, VideoModeSelection::Current),
    };
    window.decorations = matches!(settings_state.display_mode, DisplayMode::Bordered);
    window.resolution = WindowResolution::new(
        settings_state.resolution.x,
        settings_state.resolution.y,
    );
}

// ============================================================================
// Background Update Systems
// ============================================================================

/// Updates settings tab button backgrounds based on active tab.
pub fn update_settings_tab_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&SettingsTabButton, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (tab, mut background) in query.iter_mut() {
        let active = match tab {
            SettingsTabButton::Graphics => settings_state.active_tab == SettingsTab::Graphics,
            SettingsTabButton::Gameplay => settings_state.active_tab == SettingsTab::Gameplay,
            SettingsTabButton::Atmosphere => settings_state.active_tab == SettingsTab::Atmosphere,
            SettingsTabButton::Fog => settings_state.active_tab == SettingsTab::Fog,
            SettingsTabButton::Visual => settings_state.active_tab == SettingsTab::Visual,
        };
        *background = if active { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates settings content visibility based on active tab.
pub fn update_settings_content_visibility(
    settings_state: Res<SettingsState>,
    mut graphics_query: Query<&mut Node, (With<GraphicsTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>)>,
    mut gameplay_query: Query<&mut Node, (With<GameplayTabContent>, Without<GraphicsTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>)>,
    mut atmosphere_query: Query<&mut Node, (With<AtmosphereTabContent>, Without<GraphicsTabContent>, Without<GameplayTabContent>, Without<FogTabContent>, Without<VisualTabContent>)>,
    mut fog_query: Query<&mut Node, (With<FogTabContent>, Without<GraphicsTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<VisualTabContent>)>,
    mut visual_query: Query<&mut Node, (With<VisualTabContent>, Without<GraphicsTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for mut node in graphics_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Graphics {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in gameplay_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Gameplay {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in atmosphere_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Atmosphere {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in fog_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Fog {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in visual_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Visual {
            Display::Flex
        } else {
            Display::None
        };
    }
}

/// Updates graphics quality option backgrounds.
pub fn update_settings_graphics_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&GraphicsQualityOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.graphics_quality == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates anti-aliasing option backgrounds.
pub fn update_settings_aa_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&AntiAliasingOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.anti_aliasing == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates walk speed option backgrounds.
pub fn update_settings_walk_speed_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerWalkSpeedOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.walk_speed == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates run speed option backgrounds.
pub fn update_settings_run_speed_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerRunSpeedOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.run_speed == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates jump height option backgrounds.
pub fn update_settings_jump_height_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerJumpHeightOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.jump_height == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates float height option backgrounds.
pub fn update_settings_float_height_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerFloatHeightOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.float_height == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates ray tracing option backgrounds.
pub fn update_settings_ray_tracing_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&RayTracingOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.ray_tracing == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates display mode option backgrounds.
pub fn update_settings_display_mode_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&DisplayModeOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        let active = match option {
            DisplayModeOption::Bordered => settings_state.display_mode == DisplayMode::Bordered,
            DisplayModeOption::Borderless => settings_state.display_mode == DisplayMode::Borderless,
            DisplayModeOption::Fullscreen => settings_state.display_mode == DisplayMode::Fullscreen,
        };
        *background = if active { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates shadow filtering option backgrounds.
pub fn update_settings_shadow_filtering_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&ShadowFilteringOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.shadow_filtering == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates resolution option backgrounds.
pub fn update_settings_resolution_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&ResolutionOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.resolution == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates day/night cycle option backgrounds.
pub fn update_cycle_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&DayNightCycleOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.cycle_enabled == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates day length option backgrounds.
pub fn update_day_length_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&DayLengthOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.day_length == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates time scale option backgrounds.
pub fn update_time_scale_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&TimeScaleOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.time_scale == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates rayleigh option backgrounds.
pub fn update_rayleigh_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&RayleighOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.rayleigh == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates mie option backgrounds.
pub fn update_mie_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&MieOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.mie == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates mie direction option backgrounds.
pub fn update_mie_direction_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&MieDirectionOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.mie_direction == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates exposure option backgrounds.
pub fn update_exposure_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&ExposureOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.exposure == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates twilight band option backgrounds.
pub fn update_twilight_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&TwilightBandOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.twilight_band == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates night brightness option backgrounds.
pub fn update_night_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&NightBrightnessOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.night_brightness == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates fog preset option backgrounds.
pub fn update_fog_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&FogPresetOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.fog_preset == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates fog toggle option backgrounds.
pub fn update_fog_toggle_backgrounds(
    settings_state: Res<SettingsState>,
    fog_config: Res<FogConfig>,
    mut queries: ParamSet<(
        Query<(&DistanceFogOption, &mut BackgroundColor), Without<VolumetricFogOption>>,
        Query<(&VolumetricFogOption, &mut BackgroundColor), Without<DistanceFogOption>>,
    )>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (option, mut background) in queries.p0().iter_mut() {
        *background = if fog_config.distance.enabled == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }

    for (option, mut background) in queries.p1().iter_mut() {
        *background = if fog_config.volumetric.enabled == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

// ============================================================================
// Settings Input Field Systems
// ============================================================================

/// Handles clicking on settings input fields.
pub fn handle_settings_input_interaction(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut input_state: ResMut<SettingsInputState>,
    visual_settings: Res<VisualSettings>,
    fog_config: Res<FogConfig>,
    query: Query<(&Interaction, &SettingsInputButton), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, input) in query.iter() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        input_state.active = Some(input.0);
        input_state.buffer = format_settings_input_value(&visual_settings, &fog_config, input.0);
    }
}

/// Processes keyboard input for the active settings input field.
pub fn process_settings_input_characters(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut input_state: ResMut<SettingsInputState>,
    mut keyboard_events: MessageReader<KeyboardInput>,
    mut fog_config: ResMut<FogConfig>,
    mut visual_settings: ResMut<VisualSettings>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    if input_state.active.is_none() {
        return;
    }

    for event in keyboard_events.read() {
        if !event.state.is_pressed() {
            continue;
        }

        match &event.logical_key {
            Key::Backspace => {
                input_state.buffer.pop();
            }
            Key::Enter => {
                input_state.active = None;
                input_state.buffer.clear();
                continue;
            }
            Key::Escape => {
                input_state.active = None;
                input_state.buffer.clear();
                continue;
            }
            Key::Character(value) => {
                if let Some(ch) = value.chars().next() {
                    if ch.is_ascii_digit() {
                        input_state.buffer.push(ch);
                    } else if ch == '.' && !input_state.buffer.contains('.') {
                        input_state.buffer.push(ch);
                    } else if ch == '-' && input_state.buffer.is_empty() {
                        input_state.buffer.push(ch);
                    }
                }
            }
            _ => {}
        }

        let Some(active) = input_state.active else { continue };
        if let Ok(value) = input_state.buffer.parse::<f32>() {
            apply_settings_input_value(active, value, &mut visual_settings, &mut fog_config);
        }
    }
}

/// Updates settings input field backgrounds based on active state.
pub fn update_settings_input_backgrounds(
    settings_state: Res<SettingsState>,
    input_state: Res<SettingsInputState>,
    mut query: Query<(&SettingsInputButton, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (field, mut background) in query.iter_mut() {
        let is_active = input_state.active == Some(field.0);
        *background = if is_active { INPUT_ACTIVE_BG } else { INPUT_INACTIVE_BG }.into();
    }
}

pub fn clear_settings_input_on_close(
    settings_state: Res<SettingsState>,
    mut input_state: ResMut<SettingsInputState>,
) {
    if settings_state.dialog_root.is_some() {
        return;
    }

    if input_state.active.is_some() || !input_state.buffer.is_empty() {
        input_state.active = None;
        input_state.buffer.clear();
    }
}

// ============================================================================
// Fog Settings Slider Systems
// ============================================================================

/// Handles slider interactions for fog settings.
pub fn handle_fog_sliders(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut fog_config: ResMut<FogConfig>,
    mut input_state: ResMut<SettingsInputState>,
    slider_query: Query<(&Interaction, &FogSliderTrack, &RelativeCursorPosition), With<Button>>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, slider_track, relative_cursor) in slider_query.iter() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        let Some(relative_pos) = relative_cursor.normalized else { continue };
        let normalized = relative_pos.x.clamp(0.0, 1.0);
        apply_fog_slider(&mut fog_config, slider_track.0, normalized);
        if input_state.active == Some(SettingsInputField::Fog(slider_track.0)) {
            input_state.buffer = format_fog_slider_value(&fog_config, slider_track.0);
        }
    }
}

/// Updates fog slider fill widths and value text based on current fog settings.
pub fn update_fog_slider_display(
    fog_config: Res<FogConfig>,
    settings_state: Res<SettingsState>,
    input_state: Res<SettingsInputState>,
    mut fill_query: Query<(&FogSliderFill, &mut Node)>,
    mut text_query: Query<(&FogSliderValueText, &mut Text)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (fill, mut node) in fill_query.iter_mut() {
        let (min, max) = fog_slider_bounds(fill.0);
        let value = fog_slider_value(&fog_config, fill.0);
        let normalized = inv_lerp(min, max, value);
        node.width = Val::Percent(normalized * 100.0);
    }

    for (text_marker, mut text) in text_query.iter_mut() {
        let value = if input_state.active == Some(SettingsInputField::Fog(text_marker.0)) {
            input_state.buffer.clone()
        } else {
            format_fog_slider_value(&fog_config, text_marker.0)
        };
        **text = value;
    }
}

// ============================================================================
// Visual Settings Slider Systems
// ============================================================================

/// Handles slider interactions for visual settings
pub fn handle_visual_sliders(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut visual_settings: ResMut<VisualSettings>,
    mut input_state: ResMut<SettingsInputState>,
    slider_query: Query<(&Interaction, &SliderTrack, &RelativeCursorPosition), With<Button>>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, slider_track, relative_cursor) in slider_query.iter() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        // Get normalized position from RelativeCursorPosition (0.0 to 1.0)
        let Some(relative_pos) = relative_cursor.normalized else { continue };
        let normalized = relative_pos.x.clamp(0.0, 1.0);

        apply_visual_slider(&mut visual_settings, slider_track.0, normalized);
        if input_state.active == Some(SettingsInputField::Visual(slider_track.0)) {
            input_state.buffer = format_visual_slider_value(&visual_settings, slider_track.0);
        }
    }
}

/// Updates slider fill widths and value text based on current visual settings
pub fn update_visual_slider_display(
    visual_settings: Res<VisualSettings>,
    settings_state: Res<SettingsState>,
    input_state: Res<SettingsInputState>,
    mut fill_query: Query<(&SliderFill, &mut Node)>,
    mut text_query: Query<(&SliderValueText, &mut Text)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (fill, mut node) in fill_query.iter_mut() {
        let (min, max) = visual_slider_bounds(fill.0);
        let value = visual_slider_value(&visual_settings, fill.0);
        let normalized = inv_lerp(min, max, value);
        node.width = Val::Percent(normalized * 100.0);
    }

    for (text_marker, mut text) in text_query.iter_mut() {
        let value_str = if input_state.active == Some(SettingsInputField::Visual(text_marker.0)) {
            input_state.buffer.clone()
        } else {
            format_visual_slider_value(&visual_settings, text_marker.0)
        };
        **text = value_str;
    }
}

fn visual_slider_bounds(slider: VisualSlider) -> (f32, f32) {
    match slider {
        VisualSlider::Temperature => (-0.3, 0.3),
        VisualSlider::Saturation => (0.5, 2.0),
        VisualSlider::Exposure => (-1.0, 1.0),
        VisualSlider::Gamma => (0.5, 1.5),
        VisualSlider::HighlightsGain => (0.5, 1.5),
        VisualSlider::SunWarmth => (0.0, 0.3),
        VisualSlider::Illuminance => (5000.0, 50000.0),
        VisualSlider::SkyboxBrightness => (1000.0, 10000.0),
    }
}

fn visual_slider_value(settings: &VisualSettings, slider: VisualSlider) -> f32 {
    match slider {
        VisualSlider::Temperature => settings.temperature,
        VisualSlider::Saturation => settings.saturation,
        VisualSlider::Exposure => settings.exposure,
        VisualSlider::Gamma => settings.gamma,
        VisualSlider::HighlightsGain => settings.highlights_gain,
        VisualSlider::SunWarmth => settings.sun_warmth,
        VisualSlider::Illuminance => settings.illuminance,
        VisualSlider::SkyboxBrightness => settings.skybox_brightness,
    }
}

fn apply_visual_slider(settings: &mut VisualSettings, slider: VisualSlider, normalized: f32) {
    let (min, max) = visual_slider_bounds(slider);
    let value = lerp(min, max, normalized);
    apply_visual_value(settings, slider, value);
}

fn apply_visual_value(settings: &mut VisualSettings, slider: VisualSlider, value: f32) {
    let (min, max) = visual_slider_bounds(slider);
    let value = value.clamp(min, max);

    match slider {
        VisualSlider::Temperature => settings.temperature = value,
        VisualSlider::Saturation => settings.saturation = value,
        VisualSlider::Exposure => settings.exposure = value,
        VisualSlider::Gamma => settings.gamma = value,
        VisualSlider::HighlightsGain => settings.highlights_gain = value,
        VisualSlider::SunWarmth => settings.sun_warmth = value,
        VisualSlider::Illuminance => settings.illuminance = value,
        VisualSlider::SkyboxBrightness => settings.skybox_brightness = value,
    }
}

fn format_visual_slider_value(settings: &VisualSettings, slider: VisualSlider) -> String {
    match slider {
        VisualSlider::Temperature => format!("{:.2}", settings.temperature),
        VisualSlider::Saturation => format!("{:.2}", settings.saturation),
        VisualSlider::Exposure => format!("{:.2}", settings.exposure),
        VisualSlider::Gamma => format!("{:.2}", settings.gamma),
        VisualSlider::HighlightsGain => format!("{:.2}", settings.highlights_gain),
        VisualSlider::SunWarmth => format!("{:.2}", settings.sun_warmth),
        VisualSlider::Illuminance => format!("{:.0}", settings.illuminance),
        VisualSlider::SkyboxBrightness => format!("{:.0}", settings.skybox_brightness),
    }
}

fn fog_slider_bounds(slider: FogSlider) -> (f32, f32) {
    match slider {
        FogSlider::DistanceStart => (20.0, 300.0),
        FogSlider::DistanceEnd => (60.0, 600.0),
        FogSlider::FogBlueTint => (0.0, 1.0),
        FogSlider::FogBrightness => (0.3, 1.5),
        FogSlider::AerialStrength => (0.0, 2.0),
        FogSlider::VolumeDensity => (0.0, 0.12),
        FogSlider::VolumeScattering => (0.1, 1.0),
        FogSlider::VolumeAbsorption => (0.0, 0.08),
        FogSlider::ScatteringAsymmetry => (0.0, 0.9),
        FogSlider::VolumeSize => (128.0, 1024.0),
        FogSlider::StepCount => (16.0, 128.0),
        FogSlider::Jitter => (0.0, 1.0),
        FogSlider::AmbientIntensity => (0.0, 0.25),
    }
}

fn fog_slider_value(config: &FogConfig, slider: FogSlider) -> f32 {
    match slider {
        FogSlider::DistanceStart => config.distance.start,
        FogSlider::DistanceEnd => config.distance.end,
        FogSlider::FogBlueTint => config.color_modifiers.blue_tint,
        FogSlider::FogBrightness => config.color_modifiers.brightness,
        FogSlider::AerialStrength => config.color_modifiers.aerial_strength,
        FogSlider::VolumeDensity => config.volume.density,
        FogSlider::VolumeScattering => config.volume.scattering,
        FogSlider::VolumeAbsorption => config.volume.absorption,
        FogSlider::ScatteringAsymmetry => config.volume.scattering_asymmetry,
        FogSlider::VolumeSize => config.volume.size,
        FogSlider::StepCount => config.volumetric.step_count as f32,
        FogSlider::Jitter => config.volumetric.jitter,
        FogSlider::AmbientIntensity => config.volumetric.ambient_intensity,
    }
}

fn apply_fog_slider(config: &mut FogConfig, slider: FogSlider, normalized: f32) {
    let (min, max) = fog_slider_bounds(slider);
    let value = lerp(min, max, normalized).clamp(min, max);
    apply_fog_value(config, slider, value);
}

fn apply_fog_value(config: &mut FogConfig, slider: FogSlider, value: f32) {
    let (min, max) = fog_slider_bounds(slider);
    let value = value.clamp(min, max);

    match slider {
        FogSlider::DistanceStart => {
            let max_start = (config.distance.end - 1.0).max(min);
            config.distance.start = value.min(max_start);
        }
        FogSlider::DistanceEnd => {
            let min_end = (config.distance.start + 1.0).min(max);
            config.distance.end = value.max(min_end);
        }
        FogSlider::FogBlueTint => {
            config.color_modifiers.blue_tint = value;
        }
        FogSlider::FogBrightness => {
            config.color_modifiers.brightness = value;
        }
        FogSlider::AerialStrength => {
            config.color_modifiers.aerial_strength = value;
        }
        FogSlider::VolumeDensity => {
            config.volume.density = value;
        }
        FogSlider::VolumeScattering => {
            config.volume.scattering = value;
        }
        FogSlider::VolumeAbsorption => {
            config.volume.absorption = value;
        }
        FogSlider::ScatteringAsymmetry => {
            config.volume.scattering_asymmetry = value;
        }
        FogSlider::VolumeSize => {
            let snapped = (value / 16.0).round() * 16.0;
            config.volume.size = snapped.clamp(min, max);
        }
        FogSlider::StepCount => {
            let snapped = (value / 16.0).round() * 16.0;
            config.volumetric.step_count = snapped.clamp(min, max) as u32;
        }
        FogSlider::Jitter => {
            config.volumetric.jitter = value;
        }
        FogSlider::AmbientIntensity => {
            config.volumetric.ambient_intensity = value;
        }
    }
}

fn format_fog_slider_value(config: &FogConfig, slider: FogSlider) -> String {
    match slider {
        FogSlider::DistanceStart => format!("{:.0}", config.distance.start),
        FogSlider::DistanceEnd => format!("{:.0}", config.distance.end),
        FogSlider::FogBlueTint => format!("{:.2}", config.color_modifiers.blue_tint),
        FogSlider::FogBrightness => format!("{:.2}", config.color_modifiers.brightness),
        FogSlider::AerialStrength => format!("{:.2}", config.color_modifiers.aerial_strength),
        FogSlider::VolumeDensity => format!("{:.3}", config.volume.density),
        FogSlider::VolumeScattering => format!("{:.2}", config.volume.scattering),
        FogSlider::VolumeAbsorption => format!("{:.3}", config.volume.absorption),
        FogSlider::ScatteringAsymmetry => format!("{:.2}", config.volume.scattering_asymmetry),
        FogSlider::VolumeSize => format!("{:.0}", config.volume.size),
        FogSlider::StepCount => format!("{}", config.volumetric.step_count),
        FogSlider::Jitter => format!("{:.2}", config.volumetric.jitter),
        FogSlider::AmbientIntensity => format!("{:.2}", config.volumetric.ambient_intensity),
    }
}

fn format_settings_input_value(
    visual_settings: &VisualSettings,
    fog_config: &FogConfig,
    field: SettingsInputField,
) -> String {
    match field {
        SettingsInputField::Visual(slider) => format_visual_slider_value(visual_settings, slider),
        SettingsInputField::Fog(slider) => format_fog_slider_value(fog_config, slider),
    }
}

fn apply_settings_input_value(
    field: SettingsInputField,
    value: f32,
    visual_settings: &mut VisualSettings,
    fog_config: &mut FogConfig,
) {
    match field {
        SettingsInputField::Visual(slider) => apply_visual_value(visual_settings, slider, value),
        SettingsInputField::Fog(slider) => apply_fog_value(fog_config, slider, value),
    }
}

/// Helper function to linearly interpolate between two values
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Helper function to get the normalized position between two values
fn inv_lerp(a: f32, b: f32, value: f32) -> f32 {
    ((value - a) / (b - a)).clamp(0.0, 1.0)
}
