//! Settings dialog systems and UI.
//!
//! This module handles the settings dialog including:
//! - Graphics settings (quality, AA, ray tracing, resolution, etc.)
//! - Gameplay settings (walk/run speed, jump/float height)
//! - Atmosphere settings (day/night cycle, fog, lighting)

use bevy::prelude::*;
use bevy::window::{MonitorSelection, PrimaryWindow, VideoModeSelection, WindowMode, WindowResolution};

use crate::atmosphere::FogConfig;
use crate::environment::AtmosphereSettings;
use crate::player::PlayerConfig;
use crate::rendering::ray_tracing::RayTracingSettings;

use super::types::*;
use super::ui::{ACTIVE_BG, BUTTON_BG, INACTIVE_BG};

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
            width: Val::Percent(70.0),
            height: Val::Percent(70.0),
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

            spawn_option_row(content, font, "Fog", |options, font| {
                spawn_graphics_option(options, font, "Clear", FogPresetOption::Clear);
                spawn_graphics_option(options, font, "Balanced", FogPresetOption::Balanced);
                spawn_graphics_option(options, font, "Misty", FogPresetOption::Misty);
            });
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
        };
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
    fog_query: Query<(&Interaction, &FogPresetOption), (Changed<Interaction>, With<Button>)>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut fog_config: ResMut<FogConfig>,
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
        };
        *background = if active { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

/// Updates settings content visibility based on active tab.
pub fn update_settings_content_visibility(
    settings_state: Res<SettingsState>,
    mut graphics_query: Query<&mut Node, (With<GraphicsTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>)>,
    mut gameplay_query: Query<&mut Node, (With<GameplayTabContent>, Without<GraphicsTabContent>, Without<AtmosphereTabContent>)>,
    mut atmosphere_query: Query<&mut Node, (With<AtmosphereTabContent>, Without<GraphicsTabContent>, Without<GameplayTabContent>)>,
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
