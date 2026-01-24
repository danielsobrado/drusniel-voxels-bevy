//! Settings dialog systems and UI.
//!
//! This module handles the settings dialog including:
//! - Graphics settings (quality, AA, ray tracing, resolution, etc.)
//! - Gameplay settings (walk/run speed, jump/float height)
//! - Atmosphere settings (day/night cycle, fog, lighting)

use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::prelude::*;
use bevy::ui::{FlexWrap, RelativeCursorPosition};
use bevy::window::{MonitorSelection, PrimaryWindow, VideoModeSelection, Window, WindowMode, WindowResolution};

use crate::atmosphere::{FogConfig, FogPreset};
use crate::environment::AtmosphereSettings;
use crate::player::PlayerConfig;
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::voxel::plugin::WorldConfig;
use crate::voxel::world::VoxelWorld;

use super::types::*;
use super::ui::{ACTIVE_BG, BUTTON_BG, INACTIVE_BG, INPUT_ACTIVE_BG, INPUT_INACTIVE_BG};

// ============================================================================
// Settings Dialog Spawning
// ============================================================================

/// Spawns the settings dialog as a child of the menu root.
use crate::menu::preview_3d::{BlockPreviewImage, TriplanarPreviewImage};

// ...

pub fn spawn_settings_dialog(
    commands: &mut Commands,
    root_entity: Option<Entity>,
    font: &Handle<Font>,
    settings_state: SettingsState,
    ray_tracing_supported: bool,
    dialog_position: Vec2,
    asset_server: &AssetServer,
    preview_image: &Res<BlockPreviewImage>,
    triplanar_preview_image: &Res<TriplanarPreviewImage>,
) -> Entity {
    let mut dialog_entity = commands.spawn((
        Node {
            width: Val::Auto,
            height: Val::Auto,
            max_width: Val::Percent(78.0), // Slightly wider to fit both previews
            max_height: Val::Percent(85.0),
            padding: UiRect::all(Val::Px(16.0)),
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(12.0),
            position_type: PositionType::Absolute,
            left: Val::Px(dialog_position.x),
            top: Val::Px(dialog_position.y),
            justify_content: JustifyContent::FlexStart,
            ..default()
        },
        BackgroundColor(Color::srgba(0.08, 0.08, 0.08, 0.95)),
        SettingsDialogRoot,
        // SettingsDialogDrag is a Resource, not a Component
    ));

    dialog_entity.with_children(|dialog| {
        spawn_settings_header(dialog, font);
        spawn_settings_tabs(dialog, font);
        spawn_settings_content(
            dialog,
            font,
            &settings_state,
            ray_tracing_supported,
            asset_server,
            preview_image,
            triplanar_preview_image,
        );
        spawn_settings_footer(dialog, font);
    });

    let dialog_id = dialog_entity.id();
    if let Some(root) = root_entity {
        commands.entity(root).add_child(dialog_id);
    }

    dialog_id
}

fn spawn_settings_header(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog.spawn((
        Button,
        Node {
            width: Val::Percent(100.0),
            padding: UiRect::axes(Val::Px(10.0), Val::Px(6.0)),
            justify_content: JustifyContent::FlexStart,
            align_items: AlignItems::Center,
            column_gap: Val::Px(10.0),
            align_self: AlignSelf::Stretch,
            ..default()
        },
        BackgroundColor(Color::srgba(0.18, 0.18, 0.18, 0.95)),
        SettingsDragHandle,
    ))
    .with_children(|header| {
        header.spawn((
            Node {
                width: Val::Px(4.0),
                height: Val::Percent(100.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.45, 0.6, 0.5, 0.9)),
            SettingsDragHighlight,
        ));
        header.spawn((
            Text::new("⋮⋮"),
            TextFont {
                font: font.clone(),
                font_size: 20.0,
                ..default()
            },
            TextColor(Color::srgba(0.8, 0.8, 0.8, 0.9)),
        ));
        header.spawn((
            Text::new("Settings"),
            TextFont {
                font: font.clone(),
                font_size: 28.0,
                ..default()
            },
            TextColor(Color::WHITE),
        ));
    });
}

fn spawn_settings_tabs(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            column_gap: Val::Px(10.0),
            row_gap: Val::Px(6.0),
            flex_wrap: FlexWrap::Wrap,
            ..default()
        })
        .with_children(|tabs| {
            spawn_settings_tab_button(tabs, font, "Graphics", SettingsTabButton::Graphics);
            spawn_settings_tab_button(tabs, font, "Meshing", SettingsTabButton::Meshing);
            spawn_settings_tab_button(tabs, font, "Gameplay", SettingsTabButton::Gameplay);
            spawn_settings_tab_button(tabs, font, "Atmosphere", SettingsTabButton::Atmosphere);
            spawn_settings_tab_button(tabs, font, "Fog", SettingsTabButton::Fog);
            spawn_settings_tab_button(tabs, font, "Visual", SettingsTabButton::Visual);
            spawn_settings_tab_button(tabs, font, "Controls", SettingsTabButton::Controls);
            spawn_settings_tab_button(tabs, font, "Debug", SettingsTabButton::Debug);
            spawn_settings_tab_button(tabs, font, "Textures", SettingsTabButton::Textures);
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
    asset_server: &AssetServer,
    preview_image: &Res<BlockPreviewImage>,
    triplanar_preview_image: &Res<TriplanarPreviewImage>,
) {
    spawn_graphics_tab(dialog, font, ray_tracing_supported);
    spawn_meshing_tab(dialog, font);
    spawn_gameplay_tab(dialog, font);
    spawn_atmosphere_tab(dialog, font);
    spawn_fog_tab(dialog, font);
    spawn_visual_tab(dialog, font);
    spawn_controls_tab(dialog, font);
    spawn_debug_tab(dialog, font);
    spawn_textures_tab(dialog, font, asset_server, preview_image, triplanar_preview_image);
}

fn spawn_settings_footer(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn(Node {
            width: Val::Percent(100.0),
            justify_content: JustifyContent::SpaceBetween,
            align_items: AlignItems::Center,
            ..default()
        })
        .with_children(|footer| {
            spawn_save_settings_button(footer, font);
            spawn_settings_close_button(footer, font);
        });
}

fn spawn_save_settings_button(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn((
            Button,
            Node {
                width: Val::Px(140.0),
                padding: UiRect::all(Val::Px(10.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(Color::srgba(0.2, 0.6, 0.3, 0.9)),
            SaveSettingsButton,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new("Save Settings"),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

fn spawn_settings_close_button(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
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

fn spawn_meshing_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
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
            MeshingTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Greedy Meshing", |options, font| {
                spawn_graphics_option(options, font, "Off", GreedyMeshingOption(false));
                spawn_graphics_option(options, font, "On", GreedyMeshingOption(true));
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
            spawn_day_night_row(content, font);

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
                spawn_graphics_option(options, font, "Clear", FogPresetOption(FogPreset::Clear));
                spawn_graphics_option(options, font, "Balanced", FogPresetOption(FogPreset::Balanced));
                spawn_graphics_option(options, font, "Misty", FogPresetOption(FogPreset::Misty));
            });

            content
                .spawn(Node {
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    column_gap: Val::Px(18.0),
                    row_gap: Val::Px(12.0),
                    align_items: AlignItems::FlexStart,
                    max_width: Val::Px(720.0),
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

fn spawn_controls_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    use crate::input::config::GameAction;
    
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(4.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                overflow: Overflow::scroll_y(),
                max_height: Val::Px(400.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            ControlsTabContent,
        ))
        .with_children(|content| {
            let left_actions = vec![
                ("Move Forward", GameAction::MoveForward),
                ("Move Backward", GameAction::MoveBackward),
                ("Move Left", GameAction::MoveLeft),
                ("Move Right", GameAction::MoveRight),
                ("Jump", GameAction::Jump),
                ("Sprint", GameAction::Sprint),
                ("Crouch", GameAction::Crouch),
                ("Interact", GameAction::Interact),
                ("Hotbar 1", GameAction::Hotbar1),
                ("Hotbar 2", GameAction::Hotbar2),
                ("Hotbar 3", GameAction::Hotbar3),
                ("Hotbar 4", GameAction::Hotbar4),
                ("Hotbar 5", GameAction::Hotbar5),
            ];

            let right_actions = vec![
                ("Inventory", GameAction::ToggleInventory),
                ("Menu", GameAction::ToggleMenu),
                ("Fly Mode", GameAction::ToggleFly),
                ("Chat", GameAction::Chat),
                ("Map", GameAction::Map),
                ("Screenshot", GameAction::Screenshot),
                ("Hotbar 6", GameAction::Hotbar6),
                ("Hotbar 7", GameAction::Hotbar7),
                ("Hotbar 8", GameAction::Hotbar8),
                ("Hotbar 9", GameAction::Hotbar9),
            ];

            content
                .spawn(Node {
                    flex_direction: FlexDirection::Row,
                    column_gap: Val::Px(24.0),
                    row_gap: Val::Px(8.0),
                    justify_content: JustifyContent::SpaceBetween,
                    align_items: AlignItems::FlexStart,
                    ..default()
                })
                .with_children(|columns| {
                    spawn_controls_column(columns, font, &left_actions);
                    spawn_controls_column(columns, font, &right_actions);
                });
            
            spawn_save_controls_button(content, font);
        });
}

fn spawn_controls_column(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    actions: &[(&str, crate::input::config::GameAction)],
) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(4.0),
            width: Val::Percent(50.0),
            min_width: Val::Px(300.0),
            flex_grow: 1.0,
            ..default()
        })
        .with_children(|column| {
            for (label, action) in actions {
                spawn_rebind_row(column, font, label, *action);
            }
        });
}

fn spawn_debug_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
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
            DebugTabContent,
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
                    let debug_core = [
                        ("Toggle Debug Overlay", "F3"),
                        ("Inspector + Settings Window", "F4"),
                        ("Mesh Mode (Blocky/Surface)", "F5"),
                        ("Water Visibility (debug)", "F6"),
                        ("Grass Visibility (debug)", "F7"),
                        ("AO Style (V0.3/Full)", "F8"),
                        ("SSAO/GTAO Toggle", "F9"),
                        ("Sun Shadows Toggle", "F10"),
                        ("Photo Mode", "F12"),
                        ("Block Debug (Console)", "G"),
                    ];

                    let overlay_toggles = [
                        ("Vertex Corners", "Alt+V"),
                        ("Texture Debug", "Alt+T"),
                        ("Multiplayer Debug", "Alt+N"),
                        ("Chunk Stats", "Alt+C"),
                        ("Prop Debug", "Alt+P"),
                        ("Performance Panel", "Alt+F"),
                        ("Volumetric Fog", "Alt+L"),
                        ("Area Timings", "Alt+Shift+T"),
                        ("Timing Trace", "Alt+Shift+R"),
                    ];

                    let adaptive_gi = [
                        ("GI Quality Low", "Alt+1"),
                        ("GI Quality Medium", "Alt+2"),
                        ("GI Quality High", "Alt+3"),
                        ("GI Quality Ultra", "Alt+4"),
                        ("Probe Debug Log", "Alt+P"),
                        ("Contact Shadows Log", "Alt+C"),
                    ];

                    let misc_toggles = [
                        ("Cycle Fog Preset", "Alt+P"),
                    ];

                    spawn_debug_column(columns, font, "Debug & Development", &debug_core);
                    spawn_debug_column(columns, font, "F3 Overlay (Alt+)", &overlay_toggles);
                    spawn_debug_column(columns, font, "Adaptive GI (Alt+)", &adaptive_gi);
                    spawn_debug_column(columns, font, "Misc Toggles", &misc_toggles);
                });
        });
}

fn spawn_debug_column(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    title: &str,
    rows: &[(&str, &str)],
) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(6.0),
            width: Val::Px(360.0),
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

            for (label, key) in rows {
                spawn_debug_row(column, font, label, key);
            }
        });
}

fn spawn_debug_row(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, label: &str, key: &str) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            justify_content: JustifyContent::SpaceBetween,
            width: Val::Px(340.0),
            ..default()
        })
        .with_children(|row| {
            row.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));

            row.spawn((
                Node {
                    padding: UiRect::axes(Val::Px(8.0), Val::Px(2.0)),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(INACTIVE_BG),
            ))
            .with_children(|pill| {
                pill.spawn((
                    Text::new(key),
                    TextFont {
                        font: font.clone(),
                        font_size: 12.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
            });
        });
}

fn spawn_rebind_row(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    action: crate::input::config::GameAction,
) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            justify_content: JustifyContent::SpaceBetween,
            width: Val::Percent(100.0),
            padding: UiRect::horizontal(Val::Px(10.0)),
            height: Val::Px(32.0),
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
            ));

            row.spawn((
                Button,
                Node {
                    width: Val::Px(120.0),
                    height: Val::Px(28.0),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(INACTIVE_BG),
                RebindButton(action),
            ))
            .with_children(|button| {
                button.spawn((
                    Text::new("..."), 
                    TextFont {
                        font: font.clone(),
                        font_size: 14.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
            });
        });
}

fn spawn_save_controls_button(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn(Node {
            margin: UiRect::top(Val::Px(16.0)),
            justify_content: JustifyContent::Center,
            width: Val::Percent(100.0),
            ..default()
        })
        .with_children(|container| {
            container.spawn((
                Button,
                Node {
                    width: Val::Px(140.0),
                    height: Val::Px(36.0),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    ..default()
                },
                BackgroundColor(Color::srgba(0.2, 0.6, 0.3, 0.9)),
                SaveControlsButton,
            ))
            .with_children(|button| {
                button.spawn((
                    Text::new("Save Controls"),
                    TextFont {
                        font: font.clone(),
                        font_size: 16.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
            });
        });
}

#[derive(Component)]
pub struct SaveControlsButton;

fn spawn_textures_tab(
    dialog: &mut ChildSpawnerCommands, 
    font: &Handle<Font>, 
    asset_server: &AssetServer,
    preview_image: &Res<BlockPreviewImage>,
    triplanar_preview_image: &Res<TriplanarPreviewImage>,
) {
    use crate::menu::types::TexturesTabContent;

    let atlas_texture = asset_server.load("textures/atlas.png");

    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(12.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                overflow: Overflow::scroll_y(),
                max_height: Val::Px(500.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            TexturesTabContent,
        ))
        .with_children(|content| {
            // Section title
            content.spawn((
                Text::new("Atlas Texture Mapping (Blocky/F5 Mode)"),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::srgb(0.9, 0.9, 0.6)),
            ));

            // Main container: Atlas on left, settings on right
            content.spawn(Node {
                flex_direction: FlexDirection::Row,
                column_gap: Val::Px(20.0),
                ..default()
            }).with_children(|main_row| {
                // Left side: Atlas grid with tile numbers
                main_row.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: Val::Px(8.0),
                    ..default()
                }).with_children(|left| {
                    left.spawn((
                        Text::new("Atlas (click tile to assign)"),
                        TextFont {
                            font: font.clone(),
                            font_size: 14.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    // Atlas grid container (4x4 grid of tiles)
                    left.spawn(Node {
                        width: Val::Px(260.0),
                        height: Val::Px(260.0),
                        flex_direction: FlexDirection::Column,
                        ..default()
                    }).with_children(|grid_container| {
                        // Create 4x4 grid of clickable tiles
                        for row in 0..4 {
                            grid_container.spawn(Node {
                                flex_direction: FlexDirection::Row,
                                ..default()
                            }).with_children(|grid_row| {
                                for col in 0..4 {
                                    let tile_index = row * 4 + col;
                                    spawn_atlas_tile_button(grid_row, &atlas_texture, tile_index, font);
                                }
                            });
                        }
                    });
                });

                // Right side: Layer selection and cube preview
                main_row.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: Val::Px(12.0),
                    min_width: Val::Px(200.0),
                    ..default()
                }).with_children(|right| {
                    // Layer selection header
                    right.spawn((
                        Text::new("Select Layer to Edit:"),
                        TextFont {
                            font: font.clone(),
                            font_size: 14.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    // Layer buttons (Block Faces)
                    right.spawn(Node {
                        flex_direction: FlexDirection::Column,
                        row_gap: Val::Px(4.0),
                        ..default()
                    }).with_children(|layers| {
                        // We simplify the interface to edit the "Grass Block" structure primarily
                        spawn_layer_button(layers, font, "Top Face", ActiveTextureLayer::GrassTop, &atlas_texture);
                        spawn_layer_button(layers, font, "Side Faces", ActiveTextureLayer::GrassSide, &atlas_texture);
                        spawn_layer_button(layers, font, "Bottom Face", ActiveTextureLayer::Dirt, &atlas_texture);
                    });

                    // 3D Preview Image (Blocky)
                    right.spawn((
                        Node {
                            width: Val::Px(180.0),
                            height: Val::Px(180.0),
                            // Border
                            border: UiRect::all(Val::Px(2.0)),
                            ..default()
                        },
                        BorderColor::all(Color::srgba(0.3, 0.3, 0.3, 1.0)),
                        BackgroundColor(Color::BLACK),
                    )).with_children(|frame| {
                        frame.spawn((
                            Node {
                                width: Val::Percent(100.0),
                                height: Val::Percent(100.0),
                                ..default()
                            },
                            ImageNode {
                                image: preview_image.0.clone(),
                                ..default()
                            },
                            BackgroundColor(Color::WHITE),
                        ));
                    });

                    right.spawn((
                        Button,
                        Node {
                            width: Val::Px(160.0),
                            padding: UiRect::all(Val::Px(8.0)),
                            margin: UiRect::top(Val::Px(12.0)),
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.2, 0.5, 0.3, 0.9)),
                        SaveAtlasMappingButton,
                    ))
                    .with_children(|button| {
                        button.spawn((
                            Text::new("Save & Apply"),
                            TextFont {
                                font: font.clone(),
                                font_size: 16.0,
                                ..default()
                            },
                            TextColor(Color::WHITE),
                        ));
                    });
                });

                // Right Panel: Splatter / Smooth Preview
                main_row.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: Val::Px(16.0),
                    margin: UiRect::left(Val::Px(20.0)),
                    min_width: Val::Px(220.0),
                    ..default()
                }).with_children(|right| {
                    right.spawn((
                        Text::new("Splatter Mode (F6)"),
                        TextFont {
                            font: font.clone(),
                            font_size: 16.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.8, 0.8, 0.9, 1.0)),
                    ));

                    // Triplanar Preview Frame (Plane)
                    right.spawn((
                        Node {
                            width: Val::Px(200.0),
                            height: Val::Px(200.0),
                            border: UiRect::all(Val::Px(2.0)),
                            ..default()
                        },
                        BorderColor::all(Color::srgba(0.3, 0.3, 0.3, 1.0)),
                        BackgroundColor(Color::BLACK),
                    )).with_children(|frame| {
                        frame.spawn((
                            Node {
                                width: Val::Percent(100.0),
                                height: Val::Percent(100.0),
                                ..default()
                            },
                            ImageNode {
                                image: triplanar_preview_image.0.clone(),
                                ..default()
                            },
                            BackgroundColor(Color::WHITE),
                        ));
                    });

                    // Available Splatter Textures List
                    right.spawn((
                        Text::new("Available Terrain Types:"),
                        TextFont {
                            font: font.clone(),
                            font_size: 14.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                        Node { margin: UiRect::top(Val::Px(12.0)), ..default() },
                    ));

                    right.spawn(Node {
                        flex_direction: FlexDirection::Column,
                        row_gap: Val::Px(6.0),
                        ..default()
                    }).with_children(|list| {
                        // Re-use spawn_layer_button but maybe with simpler styling or logic?
                        // Actually, these trigger the preview too.
                        // "Rock" maps to Layer 2
                        // "Sand" maps to Layer 4 (wait, Types.rs says Sand is 4? Let's check ENUM)
                        // Types: GrassTop, GrassSide, Dirt, Rock, Sand.
                        // Order: 0, 1, 2, 3, 4.
                        spawn_layer_button(list, font, "Grass Terrain", ActiveTextureLayer::GrassTop, &atlas_texture);
                        spawn_layer_button(list, font, "Rock Terrain", ActiveTextureLayer::Rock, &atlas_texture);
                        spawn_layer_button(list, font, "Sand Terrain", ActiveTextureLayer::Sand, &atlas_texture);
                        spawn_layer_button(list, font, "Dirt Terrain", ActiveTextureLayer::Dirt, &atlas_texture);
                    });
                });

                    // Save button
// Save button moved to center column
            });
        });
}

#[derive(Component)]
pub struct SaveAtlasMappingButton;

fn spawn_atlas_tile_button(
    parent: &mut ChildSpawnerCommands,
    atlas_texture: &Handle<Image>,
    tile_index: u32,
    font: &Handle<Font>,
) {
    use crate::menu::types::AtlasTileButton;

    let tile_size = 64.0; // Display size
    let row = tile_index / 4;
    let col = tile_index % 4;

    parent.spawn((
        Button,
        Node {
            width: Val::Px(tile_size),
            height: Val::Px(tile_size),
            margin: UiRect::all(Val::Px(1.0)),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::End,
            padding: UiRect::ZERO,
            ..default()
        },
        BackgroundColor(Color::NONE),
        AtlasTileButton(tile_index),
    )).with_children(|tile| {
        // Image background
        tile.spawn((
            Node {
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                position_type: PositionType::Absolute,
                ..default()
            },
            ImageNode {
                image: atlas_texture.clone(),
                rect: Some(bevy::math::Rect {
                    min: bevy::math::Vec2::new(col as f32 * 256.0, row as f32 * 256.0),
                    max: bevy::math::Vec2::new((col + 1) as f32 * 256.0, (row + 1) as f32 * 256.0),
                }),
                ..default()
            },
        ));

        // Tile number overlay
        tile.spawn((
            Text::new(format!("{}", tile_index)),
            TextFont {
                font: font.clone(),
                font_size: 12.0,
                ..default()
            },
            TextColor(Color::srgba(1.0, 1.0, 1.0, 0.9)),
            Node {
                position_type: PositionType::Absolute,
                bottom: Val::Px(2.0),
                right: Val::Px(4.0),
                padding: UiRect::all(Val::Px(2.0)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.6)),
        ));
    });
}

fn spawn_layer_button(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    layer: ActiveTextureLayer,
    atlas_texture: &Handle<Image>,
) {
    use crate::menu::types::{TextureLayerButton, LayerTilePreview};

    parent.spawn(Node {
        flex_direction: FlexDirection::Row,
        align_items: AlignItems::Center,
        column_gap: Val::Px(8.0),
        ..default()
    }).with_children(|row| {
        // Layer selection button
        row.spawn((
            Button,
            Node {
                width: Val::Px(100.0),
                height: Val::Px(28.0),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(INACTIVE_BG),
            TextureLayerButton(layer),
        )).with_children(|btn| {
            btn.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });

        // Current tile preview for this layer
        row.spawn((
            Node {
                width: Val::Px(28.0),
                height: Val::Px(28.0),
                ..default()
            },
            BackgroundColor(Color::srgb(0.2, 0.2, 0.2)),
            LayerTilePreview(layer),
        )).with_children(|preview| {
            preview.spawn((
                Node {
                    width: Val::Percent(100.0),
                    height: Val::Percent(100.0),
                    ..default()
                },
                ImageNode {
                    image: atlas_texture.clone(),
                    rect: Some(bevy::math::Rect {
                        min: bevy::math::Vec2::ZERO,
                        max: bevy::math::Vec2::new(256.0, 256.0),
                    }),
                    ..default()
                },
            ));
        });

        // Tile index text
        row.spawn((
            Text::new("= 0"),
            TextFont {
                font: font.clone(),
                font_size: 12.0,
                ..default()
            },
            TextColor(Color::srgb(0.7, 0.7, 0.7)),
            LayerTileIndexText(layer),
        ));
    });
}

#[derive(Component, Copy, Clone)]
pub struct LayerTileIndexText(pub ActiveTextureLayer);

fn spawn_cube_face_preview(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    face: CubePreviewFace,
    atlas_texture: &Handle<Image>,
) {
    parent.spawn(Node {
        flex_direction: FlexDirection::Column,
        align_items: AlignItems::Center,
        row_gap: Val::Px(4.0),
        ..default()
    }).with_children(|col| {
        col.spawn((
            Text::new(label),
            TextFont {
                font: font.clone(),
                font_size: 11.0,
                ..default()
            },
            TextColor(Color::srgb(0.8, 0.8, 0.8)),
        ));

        col.spawn((
            Node {
                width: Val::Px(48.0),
                height: Val::Px(48.0),
                ..default()
            },
            BackgroundColor(Color::srgb(0.2, 0.2, 0.2)),
            face,
        )).with_children(|preview| {
            preview.spawn((
                Node {
                    width: Val::Percent(100.0),
                    height: Val::Percent(100.0),
                    ..default()
                },
                ImageNode {
                    image: atlas_texture.clone(),
                    rect: Some(bevy::math::Rect {
                        min: bevy::math::Vec2::ZERO,
                        max: bevy::math::Vec2::new(256.0, 256.0),
                    }),
                    ..default()
                },
            ));
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

fn spawn_day_night_row(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: Val::Px(12.0),
            ..default()
        })
        .with_children(|row| {
            row.spawn((
                Text::new("Day/Night"),
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
                spawn_graphics_option(options, font, "Off", DayNightCycleOption(false));
                spawn_graphics_option(options, font, "On", DayNightCycleOption(true));
            });

            row.spawn(Node {
                flex_direction: FlexDirection::Row,
                column_gap: Val::Px(6.0),
                align_items: AlignItems::Center,
                ..default()
            })
            .with_children(|time| {
                time.spawn((
                    Text::new("Time (h)"),
                    TextFont {
                        font: font.clone(),
                        font_size: 14.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.82, 0.86, 0.9, 1.0)),
                ));
                spawn_time_input_field(time, font);
            });
        });
}

fn spawn_time_input_field(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn((
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
            SettingsInputButton(SettingsInputField::AtmosphereTime),
        ))
        .with_children(|input| {
            input.spawn((
                Text::new("0.0"),
                TextFont {
                    font: font.clone(),
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                AtmosphereTimeValueText,
            ));
        });
}

/// Closes the settings dialog if open.
pub fn close_settings_dialog(
    commands: &mut Commands,
    settings_state: &mut SettingsState,
    drag_state: &mut SettingsDialogDrag,
) {
    if let Some(dialog) = settings_state.dialog_root.take() {
        commands.entity(dialog).despawn();
    }
    drag_state.active = false;
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
        info!("Switching settings tab");

        settings_state.active_tab = match *tab {
            SettingsTabButton::Graphics => SettingsTab::Graphics,
            SettingsTabButton::Meshing => SettingsTab::Meshing,
            SettingsTabButton::Gameplay => SettingsTab::Gameplay,
            SettingsTabButton::Atmosphere => SettingsTab::Atmosphere,
            SettingsTabButton::Fog => SettingsTab::Fog,
            SettingsTabButton::Visual => SettingsTab::Visual,
            SettingsTabButton::Controls => SettingsTab::Controls,
            SettingsTabButton::Debug => SettingsTab::Debug,
            SettingsTabButton::Textures => SettingsTab::Textures,
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

/// Handles meshing settings changes.
pub fn handle_meshing_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    greedy_query: Query<(&Interaction, &GreedyMeshingOption), (Changed<Interaction>, With<Button>)>,
    mut world_config: ResMut<WorldConfig>,
    mut world: ResMut<VoxelWorld>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in greedy_query.iter() {
        if *interaction == Interaction::Pressed {
            if settings_state.greedy_meshing == option.0 {
                continue;
            }
            settings_state.greedy_meshing = option.0;
            world_config.greedy_meshing = option.0;
            for (_, chunk) in world.chunk_entries_mut() {
                chunk.mark_dirty();
            }
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
            fog_config.current_preset = option.0;
            atmosphere.fog_density = match option.0 {
                FogPreset::Clear => Vec2::new(0.0006, 0.0014),
                FogPreset::Balanced => Vec2::new(0.0009, 0.0022),
                FogPreset::Misty => Vec2::new(0.0012, 0.003),
            };
            fog_config.volume.density = match option.0 {
                FogPreset::Clear => 0.005,
                FogPreset::Balanced => 0.015,
                FogPreset::Misty => 0.04,
            };
            info!("Switched to Fog Preset: {:?}", option.0);
        }
    }
}

/// Handles the close settings button.
pub fn handle_close_settings(
    mut commands: Commands,
    mut settings_state: ResMut<SettingsState>,
    mut drag_state: ResMut<SettingsDialogDrag>,
    query: Query<&Interaction, (Changed<Interaction>, With<CloseSettingsButton>)>,
) {
    for interaction in query.iter() {
        if *interaction == Interaction::Pressed {
            close_settings_dialog(&mut commands, &mut settings_state, &mut drag_state);
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
        let active = match *tab {
            SettingsTabButton::Graphics => settings_state.active_tab == SettingsTab::Graphics,
            SettingsTabButton::Meshing => settings_state.active_tab == SettingsTab::Meshing,
            SettingsTabButton::Gameplay => settings_state.active_tab == SettingsTab::Gameplay,
            SettingsTabButton::Atmosphere => settings_state.active_tab == SettingsTab::Atmosphere,
            SettingsTabButton::Fog => settings_state.active_tab == SettingsTab::Fog,
            SettingsTabButton::Visual => settings_state.active_tab == SettingsTab::Visual,
            SettingsTabButton::Controls => settings_state.active_tab == SettingsTab::Controls,
            SettingsTabButton::Debug => settings_state.active_tab == SettingsTab::Debug,
            SettingsTabButton::Textures => settings_state.active_tab == SettingsTab::Textures,
        };
        *background = if active { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates settings content visibility based on active tab.
pub fn update_settings_content_visibility(
    settings_state: Res<SettingsState>,
    mut graphics_query: Query<&mut Node, (With<GraphicsTabContent>, Without<GameplayTabContent>, Without<MeshingTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut meshing_query: Query<&mut Node, (With<MeshingTabContent>, Without<GraphicsTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut gameplay_query: Query<&mut Node, (With<GameplayTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut atmosphere_query: Query<&mut Node, (With<AtmosphereTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<GameplayTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut fog_query: Query<&mut Node, (With<FogTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut visual_query: Query<&mut Node, (With<VisualTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut controls_query: Query<&mut Node, (With<ControlsTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<TexturesTabContent>)>,
    mut debug_query: Query<&mut Node, (With<DebugTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>, Without<TexturesTabContent>)>,
    mut textures_query: Query<&mut Node, (With<TexturesTabContent>, Without<GraphicsTabContent>, Without<MeshingTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>, Without<FogTabContent>, Without<VisualTabContent>, Without<ControlsTabContent>)>,
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

    for mut node in meshing_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Meshing {
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

    for mut node in controls_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Controls {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in debug_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Debug {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in textures_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Textures {
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

/// Updates greedy meshing option backgrounds.
pub fn update_settings_greedy_meshing_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&GreedyMeshingOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.greedy_meshing == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
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
    atmosphere: Res<AtmosphereSettings>,
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
        input_state.buffer = format_settings_input_value(&visual_settings, &fog_config, &atmosphere, input.0);
    }
}

pub fn handle_settings_drag(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut drag_state: ResMut<SettingsDialogDrag>,
    mouse: Res<ButtonInput<MouseButton>>,
    window_query: Query<&Window, With<PrimaryWindow>>,
    mut dialog_query: Query<&mut Node, With<SettingsDialogRoot>>,
    handle_query: Query<&Interaction, (Changed<Interaction>, With<SettingsDragHandle>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        drag_state.active = false;
        return;
    }

    let Ok(window) = window_query.single() else { return };

    for interaction in handle_query.iter() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        if let Some(cursor) = window.cursor_position() {
            drag_state.active = true;
            drag_state.grab_offset = cursor - drag_state.position;
        }
    }

    if drag_state.active && mouse.just_released(MouseButton::Left) {
        drag_state.active = false;
    }

    if drag_state.active {
        if let Some(cursor) = window.cursor_position() {
            let mut new_pos = cursor - drag_state.grab_offset;
            let margin = 12.0;
            let max_x = (window.width() - margin).max(margin);
            let max_y = (window.height() - margin).max(margin);
            new_pos.x = new_pos.x.clamp(margin, max_x);
            new_pos.y = new_pos.y.clamp(margin, max_y);
            drag_state.position = new_pos;
        }
    }

    if drag_state.is_changed() {
        if let Ok(mut node) = dialog_query.single_mut() {
            node.left = Val::Px(drag_state.position.x);
            node.top = Val::Px(drag_state.position.y);
        }
    }
}

pub fn update_settings_drag_hover(
    settings_state: Res<SettingsState>,
    handle_query: Query<&Interaction, (With<SettingsDragHandle>, Changed<Interaction>)>,
    mut highlight_query: Query<&mut BackgroundColor, With<SettingsDragHighlight>>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    let Ok(mut highlight) = highlight_query.single_mut() else { return };

    for interaction in handle_query.iter() {
        *highlight = match *interaction {
            Interaction::Pressed => BackgroundColor(Color::srgba(0.55, 0.75, 0.6, 1.0)),
            Interaction::Hovered => BackgroundColor(Color::srgba(0.5, 0.7, 0.56, 0.95)),
            Interaction::None => BackgroundColor(Color::srgba(0.45, 0.6, 0.5, 0.9)),
        };
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
    mut atmosphere: ResMut<AtmosphereSettings>,
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
            apply_settings_input_value(
                active,
                value,
                &mut visual_settings,
                &mut fog_config,
                &mut atmosphere,
            );
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

pub fn update_atmosphere_time_display(
    atmosphere: Res<AtmosphereSettings>,
    settings_state: Res<SettingsState>,
    input_state: Res<SettingsInputState>,
    mut text_query: Query<&mut Text, With<AtmosphereTimeValueText>>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for mut text in text_query.iter_mut() {
        let value = if input_state.active == Some(SettingsInputField::AtmosphereTime) {
            input_state.buffer.clone()
        } else {
            format_atmosphere_time_value(&atmosphere)
        };
        **text = value;
    }
}

fn fog_slider_value(config: &FogConfig, slider: FogSlider) -> f32 {
    // Read from the ACTIVE preset for volume params to show true state
    let preset_config = match config.current_preset {
        FogPreset::Clear => &config.presets.clear,
        FogPreset::Balanced => &config.presets.balanced,
        FogPreset::Misty => &config.presets.misty,
    };

    match slider {
        FogSlider::DistanceStart => config.distance.start,
        FogSlider::DistanceEnd => config.distance.end,
        FogSlider::FogBlueTint => config.color_modifiers.blue_tint,
        FogSlider::FogBrightness => config.color_modifiers.brightness,
        FogSlider::AerialStrength => config.color_modifiers.aerial_strength,
        FogSlider::VolumeDensity => preset_config.density,
        FogSlider::VolumeScattering => preset_config.scattering,
        FogSlider::VolumeAbsorption => preset_config.absorption,
        FogSlider::ScatteringAsymmetry => preset_config.scattering_asymmetry,
        FogSlider::VolumeSize => preset_config.size,
        FogSlider::StepCount => config.volumetric.step_count as f32,
        FogSlider::Jitter => config.volumetric.jitter,
        FogSlider::AmbientIntensity => config.volumetric.ambient_intensity,
    }
}



fn inv_lerp(min: f32, max: f32, value: f32) -> f32 {
    if (max - min).abs() < f32::EPSILON {
        return 0.0;
    }
    ((value - min) / (max - min)).clamp(0.0, 1.0)
}

fn fog_slider_bounds(slider: FogSlider) -> (f32, f32) {
    match slider {
        FogSlider::DistanceStart => (0.0, 200.0),
        FogSlider::DistanceEnd => (50.0, 1000.0),
        FogSlider::FogBlueTint => (0.0, 1.0),
        FogSlider::FogBrightness => (0.5, 2.0),
        FogSlider::AerialStrength => (0.0, 1.0),
        FogSlider::VolumeDensity => (0.001, 0.1),
        FogSlider::VolumeScattering => (0.01, 0.5),
        FogSlider::VolumeAbsorption => (0.01, 0.3),
        FogSlider::ScatteringAsymmetry => (-0.9, 0.9),
        FogSlider::VolumeSize => (64.0, 1024.0),
        FogSlider::StepCount => (8.0, 64.0),
        FogSlider::Jitter => (0.0, 1.0),
        FogSlider::AmbientIntensity => (0.0, 1.0),
    }
}

fn apply_fog_slider(config: &mut FogConfig, slider: FogSlider, normalized: f32) {
    let (min, max) = fog_slider_bounds(slider);
    let value = lerp(min, max, normalized);
    apply_fog_value(config, slider, value);
}

fn apply_fog_value(config: &mut FogConfig, slider: FogSlider, value: f32) {
    let (min, max) = fog_slider_bounds(slider);
    let value = value.clamp(min, max);

    match slider {
        FogSlider::DistanceStart => config.distance.start = value,
        FogSlider::DistanceEnd => config.distance.end = value,
        FogSlider::FogBlueTint => config.color_modifiers.blue_tint = value,
        FogSlider::FogBrightness => config.color_modifiers.brightness = value,
        FogSlider::AerialStrength => config.color_modifiers.aerial_strength = value,
        FogSlider::VolumeDensity => config.volume.density = value,
        FogSlider::VolumeScattering => config.volume.scattering = value,
        FogSlider::VolumeAbsorption => config.volume.absorption = value,
        FogSlider::ScatteringAsymmetry => config.volume.scattering_asymmetry = value,
        FogSlider::VolumeSize => config.volume.size = value,
        FogSlider::StepCount => config.volumetric.step_count = value as u32,
        FogSlider::Jitter => config.volumetric.jitter = value,
        FogSlider::AmbientIntensity => config.volumetric.ambient_intensity = value,
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
        VisualSlider::Illuminance => (5000.0, 100_000.0),
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

fn format_atmosphere_time_value(atmosphere: &AtmosphereSettings) -> String {
    let hours = atmosphere_time_hours(atmosphere);
    format!("{:.1}", hours)
}

fn atmosphere_time_hours(atmosphere: &AtmosphereSettings) -> f32 {
    if atmosphere.day_length <= f32::EPSILON {
        return 0.0;
    }
    let normalized = (atmosphere.time / atmosphere.day_length).rem_euclid(1.0);
    (normalized * 24.0).clamp(0.0, 24.0)
}

fn format_settings_input_value(
    visual_settings: &VisualSettings,
    fog_config: &FogConfig,
    atmosphere: &AtmosphereSettings,
    field: SettingsInputField,
) -> String {
    match field {
        SettingsInputField::Visual(slider) => format_visual_slider_value(visual_settings, slider),
        SettingsInputField::Fog(slider) => format_fog_slider_value(fog_config, slider),
        SettingsInputField::AtmosphereTime => format_atmosphere_time_value(atmosphere),
    }
}

fn apply_settings_input_value(
    field: SettingsInputField,
    value: f32,
    visual_settings: &mut VisualSettings,
    fog_config: &mut FogConfig,
    atmosphere: &mut AtmosphereSettings,
) {
    match field {
        SettingsInputField::Visual(slider) => apply_visual_value(visual_settings, slider, value),
        SettingsInputField::Fog(slider) => apply_fog_value(fog_config, slider, value),
        SettingsInputField::AtmosphereTime => {
            let hours = value.clamp(0.0, 24.0);
            if atmosphere.day_length > 0.0 {
                atmosphere.time = (hours / 24.0) * atmosphere.day_length;
            }
        }
    }
}

/// Helper function to linearly interpolate between two values
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Helper function to get the normalized position between two values
// ============================================================================
// Controls Tab Systems
// ============================================================================

pub fn handle_settings_rebind_interaction(
    mut interaction_query: Query<
        (&Interaction, &RebindButton, &mut BackgroundColor),
        (Changed<Interaction>, With<Button>),
    >,
    mut rebind_state: ResMut<RebindState>,
) {
    for (interaction, rebind, mut bg) in interaction_query.iter_mut() {
        match *interaction {
            Interaction::Pressed => {
                rebind_state.active_action = Some(rebind.0);
                *bg = BackgroundColor(ACTIVE_BG);
            }
            Interaction::Hovered => {
                if rebind_state.active_action != Some(rebind.0) {
                    *bg = BackgroundColor(ACTIVE_BG); // Hover effect
                }
            }
            Interaction::None => {
                if rebind_state.active_action != Some(rebind.0) {
                    *bg = BackgroundColor(INACTIVE_BG);
                }
            }
        }
    }
}

pub fn handle_save_controls_interaction(
    mut interaction_query: Query<
        (&Interaction, &mut BackgroundColor),
        (Changed<Interaction>, With<SaveControlsButton>),
    >,
    input_config: Res<crate::input::config::InputConfig>,
) {
    for (interaction, mut bg) in interaction_query.iter_mut() {
        match *interaction {
            Interaction::Pressed => {
                *bg = BackgroundColor(Color::srgba(0.3, 0.7, 0.4, 1.0));
                crate::input::config::save_inputs(&input_config);
            }
            Interaction::Hovered => {
                *bg = BackgroundColor(Color::srgba(0.25, 0.65, 0.35, 1.0));
            }
            Interaction::None => {
                *bg = BackgroundColor(Color::srgba(0.2, 0.6, 0.3, 0.9));
            }
        }
    }
}

pub fn handle_save_settings_interaction(
    mut interaction_query: Query<
        (&Interaction, &mut BackgroundColor),
        (Changed<Interaction>, With<SaveSettingsButton>),
    >,
    settings_state: Res<SettingsState>,
    visual_settings: Res<VisualSettings>,
    fog_config: Res<FogConfig>,
    atmosphere: Res<AtmosphereSettings>,
) {
    for (interaction, mut bg) in interaction_query.iter_mut() {
        match *interaction {
            Interaction::Pressed => {
                *bg = BackgroundColor(Color::srgba(0.3, 0.7, 0.4, 1.0));
                match super::settings_persistence::save_settings_to_disk(
                    &settings_state,
                    &visual_settings,
                    &fog_config,
                    &atmosphere,
                ) {
                    Ok(()) => info!("Settings saved to {} / {}", super::settings_persistence::SETTINGS_YAML_PATH, super::settings_persistence::SETTINGS_JSON_PATH),
                    Err(err) => warn!("Failed to save settings: {}", err),
                }
            }
            Interaction::Hovered => {
                *bg = BackgroundColor(Color::srgba(0.25, 0.65, 0.35, 1.0));
            }
            Interaction::None => {
                *bg = BackgroundColor(Color::srgba(0.2, 0.6, 0.3, 0.9));
            }
        }
    }
}

pub fn process_rebind_input(
    mut events: EventReader<KeyboardInput>,
    mut rebind_state: ResMut<RebindState>,
    mut input_config: ResMut<crate::input::config::InputConfig>,
) {
    if let Some(action) = rebind_state.active_action {
        for event in events.read() {
            if event.state.is_pressed() {
                // Ignore Escape to cancel? or bind it? Let's bind it for now, user can rebind menu elsewhere if stuck
                // Actually, let's make Escape cancel rebind if that's standard, but for flexibility we might want to bind it.
                // Assuming raw key code mapping.
                
                input_config.bindings.insert(action, event.key_code);
                rebind_state.active_action = None;
                break; 
            }
        }
    }
}

pub fn update_controls_tab_display(
    rebind_state: Res<RebindState>,
    input_config: Res<crate::input::config::InputConfig>,
    mut button_query: Query<(&RebindButton, &mut BackgroundColor, &Children)>,
    mut text_query: Query<&mut Text>,
) {
    for (button, mut bg, children) in button_query.iter_mut() {
        if rebind_state.active_action == Some(button.0) {
            *bg = BackgroundColor(INPUT_ACTIVE_BG);
            if let Some(child) = children.first() {
                if let Ok(mut text) = text_query.get_mut(*child) {
                    **text = "Press Key...".to_string();
                }
            }
        } else {
            *bg = BackgroundColor(INACTIVE_BG);
            if let Some(child) = children.first() {
                if let Ok(mut text) = text_query.get_mut(*child) {
                    let key_name = input_config.bindings.get(&button.0)
                        .map(|k| format!("{:?}", k).replace("Key", ""))
                        .unwrap_or("None".to_string());
                    **text = key_name;
                }
            }
        }
    }
}

// ============================================================================
// Atlas Texture Mapping Systems
// ============================================================================

/// Handles layer button clicks to select which texture layer is being edited
pub fn handle_texture_layer_buttons(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut active_layer: ResMut<ActiveTextureLayer>,
    query: Query<(&Interaction, &TextureLayerButton), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, layer_button) in query.iter() {
        if *interaction == Interaction::Pressed {
            *active_layer = layer_button.0;
            info!("Selected texture layer: {:?}", layer_button.0);
        }
    }
}

/// Handles atlas tile button clicks to assign tile to the active layer
pub fn handle_atlas_tile_clicks(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    active_layer: Res<ActiveTextureLayer>,
    mut atlas_mapping: ResMut<crate::rendering::array_loader::AtlasMapping>,
    query: Query<(&Interaction, &AtlasTileButton), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, tile_button) in query.iter() {
        if *interaction == Interaction::Pressed {
            let tile_index = tile_button.0;
            match *active_layer {
                ActiveTextureLayer::GrassTop => atlas_mapping.grass = tile_index,
                ActiveTextureLayer::GrassSide => atlas_mapping.grass_side = tile_index,
                ActiveTextureLayer::Dirt => atlas_mapping.dirt = tile_index,
                ActiveTextureLayer::Rock => atlas_mapping.rock = tile_index,
                ActiveTextureLayer::Sand => atlas_mapping.sand = tile_index,
            }
            info!("Assigned atlas tile {} to layer {:?}", tile_index, *active_layer);
        }
    }
}

/// Updates layer button backgrounds based on active selection
pub fn update_texture_layer_backgrounds(
    settings_state: Res<SettingsState>,
    active_layer: Res<ActiveTextureLayer>,
    mut query: Query<(&TextureLayerButton, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (layer_button, mut bg) in query.iter_mut() {
        *bg = if layer_button.0 == *active_layer {
            ACTIVE_BG.into()
        } else {
            INACTIVE_BG.into()
        };
    }
}

/// Updates layer tile previews to show currently assigned atlas tiles
pub fn update_layer_tile_previews(
    settings_state: Res<SettingsState>,
    atlas_mapping: Res<crate::rendering::array_loader::AtlasMapping>,
    preview_query: Query<(&LayerTilePreview, &Children)>,
    mut image_query: Query<&mut ImageNode>,
    mut text_query: Query<(&LayerTileIndexText, &mut Text)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (preview, children) in preview_query.iter() {
        let tile_index = match preview.0 {
            ActiveTextureLayer::GrassTop => atlas_mapping.grass,
            ActiveTextureLayer::GrassSide => atlas_mapping.grass_side,
            ActiveTextureLayer::Dirt => atlas_mapping.dirt,
            ActiveTextureLayer::Rock => atlas_mapping.rock,
            ActiveTextureLayer::Sand => atlas_mapping.sand,
        };

        let row = tile_index / 4;
        let col = tile_index % 4;

        // Update the child ImageNode
        for child in children.iter() {
            if let Ok(mut image_node) = image_query.get_mut(child) {
                image_node.rect = Some(bevy::math::Rect {
                    min: bevy::math::Vec2::new(col as f32 * 256.0, row as f32 * 256.0),
                    max: bevy::math::Vec2::new((col + 1) as f32 * 256.0, (row + 1) as f32 * 256.0),
                });
            }
        }
    }

    for (text_marker, mut text) in text_query.iter_mut() {
        let tile_index = match text_marker.0 {
            ActiveTextureLayer::GrassTop => atlas_mapping.grass,
            ActiveTextureLayer::GrassSide => atlas_mapping.grass_side,
            ActiveTextureLayer::Dirt => atlas_mapping.dirt,
            ActiveTextureLayer::Rock => atlas_mapping.rock,
            ActiveTextureLayer::Sand => atlas_mapping.sand,
        };
        **text = format!("= {}", tile_index);
    }
}

/// Updates cube preview faces to show current texture assignments
pub fn update_cube_preview_faces(
    settings_state: Res<SettingsState>,
    atlas_mapping: Res<crate::rendering::array_loader::AtlasMapping>,
    face_query: Query<(&CubePreviewFace, &Children)>,
    mut image_query: Query<&mut ImageNode>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (face, children) in face_query.iter() {
        let tile_index = match face {
            CubePreviewFace::Top => atlas_mapping.grass,      // Top = grass
            CubePreviewFace::Side => atlas_mapping.grass_side, // Side = grass_side
            CubePreviewFace::Bottom => atlas_mapping.dirt,     // Bottom = dirt
        };

        let row = tile_index / 4;
        let col = tile_index % 4;

        // Update the child ImageNode
        for child in children.iter() {
            if let Ok(mut image_node) = image_query.get_mut(child) {
                image_node.rect = Some(bevy::math::Rect {
                    min: bevy::math::Vec2::new(col as f32 * 256.0, row as f32 * 256.0),
                    max: bevy::math::Vec2::new((col + 1) as f32 * 256.0, (row + 1) as f32 * 256.0),
                });
            }
        }
    }
}

/// Handles save atlas mapping button clicks
pub fn handle_save_atlas_mapping(
    state: Res<PauseMenuState>,
    settings_state: Res<SettingsState>,
    mut atlas_mapping: ResMut<crate::rendering::array_loader::AtlasMapping>,
    query: Query<&Interaction, (Changed<Interaction>, With<SaveAtlasMappingButton>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for interaction in query.iter() {
        if *interaction == Interaction::Pressed {
            // Mark for rebuild so textures get updated
            atlas_mapping.needs_rebuild = true;

            // Save to YAML
            match atlas_mapping.save_to_yaml() {
                Ok(()) => info!("Atlas mapping saved to atlas_mapping.yaml"),
                Err(e) => error!("Failed to save atlas mapping: {}", e),
            }
        }
    }
}
