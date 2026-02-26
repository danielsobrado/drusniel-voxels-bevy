use bevy::prelude::*;
use bevy::light::{CascadeShadowConfig, FogVolume, GlobalAmbientLight, VolumetricFog, VolumetricLight};
use bevy::pbr::{DistanceFog, FogFalloff};
use bevy::render::render_resource::ShaderType;
use crate::atmosphere::config::{DustAnimationConfig, FogColorModifiers, FogConfig, FogFalloffMode, FogPreset};
use crate::environment::{AtmosphereSettings, Sun};
use crate::voxel::plugin::LodSettings;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

pub struct FogPlugin;

#[derive(Resource)]
pub struct FogNoiseTexture(pub Handle<Image>);

use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::asset::RenderAssetUsages;

const BASE_PRESET_DENSITY: f32 = 0.0009; // "Balanced" preset baseline for scaling.
const VOLUME_DENSITY_SCALE: f32 = 1.0; // Volumetric density scale for visible god rays
const MIN_VOLUME_DENSITY: f32 = 0.0005; // Visible haze, avoids "invisible god rays" issue while keeping outdoors relatively clear
const MAX_VOLUME_DENSITY: f32 = 2.0; // High cap for testing god rays
const MIN_DISTANCE_SCALE: f32 = 0.25; // Prevents overly aggressive linear fog compression
const MAX_DISTANCE_SCALE: f32 = 2.5; // Prevents excessively thin fog
const MIN_DISTANCE_SPAN: f32 = 1.0; // Keep end > start
const SHADOW_FOG_FRACTION: f32 = 0.65; // End shadows before fog gets thick

impl Plugin for FogPlugin {
    fn build(&self, app: &mut App) {
        // Load fog config from file or use default
        let fog_config = load_fog_config().unwrap_or_else(|e| {
            warn!("Failed to load fog config: {}, using defaults", e);
            FogConfig::default()
        });

        app.insert_resource(fog_config)
            .init_resource::<DustAnimationState>()
            .add_systems(Startup, setup_fog)
            .add_systems(
                Update,
                (
                    sync_fog_toggles,
                    handle_fog_input,
                    update_fog_from_atmosphere,
                    update_shadow_cascades_from_fog,
                    follow_camera_fog_volume,
                    animate_dust_in_fog,
                ).chain(),
            );
    }
}

/// State for dust animation in volumetric fog
#[derive(Resource, Default)]
pub struct DustAnimationState {
    /// Current texture offset for dust movement
    pub offset: Vec3,
    /// Current dust animation config (from active preset)
    pub config: DustAnimationConfig,
}

fn handle_fog_input(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut config: ResMut<FogConfig>,
) {
    if keyboard.pressed(KeyCode::AltLeft) && keyboard.just_pressed(KeyCode::KeyP) {
        config.current_preset = match config.current_preset {
            FogPreset::Clear => FogPreset::Balanced,
            FogPreset::Balanced => FogPreset::Misty,
            FogPreset::Misty => FogPreset::GodRays,
            FogPreset::GodRays => FogPreset::Clear,
        };
        info!("Fog Preset Toggled: {:?}", config.current_preset);
    }
}

fn create_soft_noise_texture(images: &mut Assets<Image>) -> Handle<Image> {
    let size = 32; // Low res for soft, cloud-like noise when filtered
    let mut data = Vec::with_capacity(size * size * size * 4);

    // Create coherent noise with visible dust/cloud patterns
    // Using simple layered noise for more organic shapes
    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                // Base random value with wider range for more contrast
                let base = rand::random::<f32>();

                // Add low-frequency variation (big dust clouds)
                let fx = x as f32 / size as f32 * 2.0 * std::f32::consts::PI;
                let fy = y as f32 / size as f32 * 2.0 * std::f32::consts::PI;
                let fz = z as f32 / size as f32 * 2.0 * std::f32::consts::PI;
                let wave = (fx.sin() * fy.cos() * fz.sin() + 1.0) * 0.5; // 0 to 1

                // Blend random with coherent pattern for dust-like appearance
                let val = base * 0.4 + wave * 0.6;

                // Full range 10-255 for high contrast dust patterns visible in god rays
                let byte = (10.0 + val * 245.0) as u8;
                data.extend_from_slice(&[byte, byte, byte, 255]);
            }
        }
    }

    let image = Image::new(
        Extent3d {
            width: size as u32,
            height: size as u32,
            depth_or_array_layers: size as u32,
        },
        TextureDimension::D3,
        data,
        TextureFormat::Rgba8Unorm,
        RenderAssetUsages::RENDER_WORLD,
    );
    // Linear sampler is default for Image, which gives us smooth interpolation (clouds)
    images.add(image)
}

/// Debug system to verify all god rays components exist
/// Marker for the global fog volume entity
#[derive(Component)]
pub struct GlobalFogVolume;

/// Marker for the main camera with fog
#[derive(Component)]
pub struct FogCamera;

/// Stores the current atmosphere state for fog calculations
#[derive(Resource, Default)]
pub struct AtmosphereSample {
    pub sun_dir: Vec3,
    pub sun_altitude: f32,
}

/// Effective fog distance range after time-of-day and LOD alignment.
#[derive(Resource, Default, Clone, Copy)]
pub struct FogDistanceState {
    pub start: f32,
    pub end: f32,
}

/// GPU-compatible fog parameters for custom shaders that don't use Bevy's built-in fog.
/// This is synced to material uniforms for aerial perspective in building/props/grass shaders.
#[derive(Resource, Clone, Copy, ShaderType, Debug)]
pub struct FogUniforms {
    pub fog_color: LinearRgba,
    pub fog_start: f32,
    pub fog_end: f32,
    pub sun_dir: Vec3,
    pub directional_exponent: f32,
    /// Aerial perspective strength multiplier (0 = no fog blend, 1 = normal, 2 = exaggerated)
    pub aerial_strength: f32,
}

impl Default for FogUniforms {
    fn default() -> Self {
        Self {
            fog_color: LinearRgba::new(0.7, 0.78, 0.88, 1.0), // Day fog color
            fog_start: 80.0,
            fog_end: 220.0,
            sun_dir: Vec3::new(0.4, 0.8, 0.3).normalize(),
            directional_exponent: 30.0,
            aerial_strength: 1.0,
        }
    }
}

fn spawn_global_fog_volume(commands: &mut Commands, config: &FogConfig, texture: Option<Handle<Image>>) {
    // Use config values for proper god rays - low absorption for brightness
    let density = config.volume.density.max(MIN_VOLUME_DENSITY);
    let size = config.volume.size;
    let scattering = config.volume.scattering;
    let absorption = config.volume.absorption;
    let asymmetry = config.volume.scattering_asymmetry;
    let dust_config = &config.volume.dust_animation;

    info!(
        "Spawning FogVolume: density={:.6}, scattering={:.2}, absorption={:.4}, size={:.0}, dust={}",
        density, scattering, absorption, size, dust_config.enabled
    );

    let mut fog_volume = FogVolume {
        density_factor: density,
        scattering,
        absorption,
        scattering_asymmetry: asymmetry,
        ..default()
    };

    // Apply density texture for animated dust movement in god rays
    if dust_config.enabled {
        if let Some(tex) = texture {
            fog_volume.density_texture = Some(tex);
        }
    }

    commands.spawn((
        Name::new("GlobalFogVolume"),
        GlobalFogVolume,
        fog_volume,
        Transform::from_scale(Vec3::splat(size)),
    ));
}

fn setup_fog(
    mut commands: Commands,
    config: Res<FogConfig>,
    mut debug_toggles: ResMut<crate::interaction::DebugDetailToggles>,
    mut images: ResMut<Assets<Image>>,
) {
    // Generate noise texture for dust effects
    let noise_handle = create_soft_noise_texture(&mut images);
    commands.insert_resource(FogNoiseTexture(noise_handle.clone()));

    // Sync debug toggle to match loaded config
    debug_toggles.volumetric_fog_enabled = config.volumetric.enabled;

    info!(
        "Fog setup: volumetric.enabled={}, volume.density={}, volume.size={}",
        config.volumetric.enabled,
        config.volume.density,
        config.volume.size
    );

    if config.volumetric.enabled {
        // Spawn global fog volume centered at origin
        // Will be repositioned to follow camera
        info!("Spawning GlobalFogVolume for god rays");
        spawn_global_fog_volume(&mut commands, &config, Some(noise_handle));
    } else {
        warn!("Volumetric fog disabled - no god rays will be visible");
    }
    
    // Initialize atmosphere sample and fog range resources
    commands.insert_resource(AtmosphereSample::default());
    commands.insert_resource(FogDistanceState {
        start: config.distance.start,
        end: config.distance.end,
    });
    commands.insert_resource(FogUniforms {
        fog_start: config.distance.start,
        fog_end: config.distance.end,
        ..default()
    });
}

/// Call this when spawning the main camera to add fog components
pub fn fog_camera_components(config: &FogConfig) -> impl Bundle {
    (
        FogCamera,
        distance_fog_component(config),
        volumetric_fog_component(config),
    )
}

fn distance_fog_component(config: &FogConfig) -> DistanceFog {
    let colors = &config.colors.day;
    let (start, end) = linear_fog_range(config, 1.0, None);
    let mods = &config.color_modifiers;
    let fog_color = apply_color_modifiers4(colors.fog, mods);
    let directional_color = apply_color_modifiers3(colors.directional, mods);
    let extinction_color = apply_color_modifiers3(colors.extinction, mods);
    let inscattering_color = apply_color_modifiers3(colors.inscattering, mods);
    let use_linear = matches!(config.distance.falloff, FogFalloffMode::Linear)
        || config.distance.near_fade > 0.0;
    let falloff = match config.distance.falloff {
        FogFalloffMode::Linear => FogFalloff::Linear { start, end },
        FogFalloffMode::Atmospheric => FogFalloff::from_visibility_colors(
            end.max(1.0),
            Color::srgb(extinction_color[0], extinction_color[1], extinction_color[2]),
            Color::srgb(
                inscattering_color[0],
                inscattering_color[1],
                inscattering_color[2],
            ),
        ),
    };

    // Screen-space distance fog
    DistanceFog {
        color: Color::srgba(fog_color[0], fog_color[1], fog_color[2], fog_color[3]),
        directional_light_color: Color::srgba(
            directional_color[0],
            directional_color[1],
            directional_color[2],
            0.5,
        ),
        directional_light_exponent: 30.0,
        falloff: if use_linear { FogFalloff::Linear { start, end } } else { falloff },
    }
}

/// Call this when spawning the sun to enable volumetric light
pub fn sun_volumetric_components() -> VolumetricLight {
    VolumetricLight
}

fn volumetric_fog_component(config: &FogConfig) -> VolumetricFog {
    // Use defaults like Bevy example, but allow config overrides
    let mut vfog = VolumetricFog::default();
    vfog.step_count = config.volumetric.step_count;
    vfog.jitter = config.volumetric.jitter;
    vfog.ambient_intensity = config.volumetric.ambient_intensity;
    vfog
}

fn sync_fog_toggles(
    mut commands: Commands,
    mut config: ResMut<FogConfig>,
    debug_toggles: Res<crate::interaction::DebugDetailToggles>,
    camera_query: Query<(Entity, Option<&DistanceFog>, Option<&VolumetricFog>), With<FogCamera>>,
    volume_query: Query<Entity, With<GlobalFogVolume>>,
    noise_texture: Option<Res<FogNoiseTexture>>,
) {
    // Sync debug toggle to config if changed
    if debug_toggles.is_changed() {
        if config.volumetric.enabled != debug_toggles.volumetric_fog_enabled {
            info!("Syncing fog toggle: Volumetric Fog -> {}", debug_toggles.volumetric_fog_enabled);
            config.volumetric.enabled = debug_toggles.volumetric_fog_enabled;
        }
    }

    if !config.is_changed() {
        // Force check if debug toggle was just enabled but config thinks it didn't change (rare/unlikely)
        if !debug_toggles.is_changed() {
            return;
        }
    }
    
    if camera_query.iter().len() == 0 {
        warn!("sync_fog_toggles: No FogCamera found! Cannot apply fog components.");
    }

    for (entity, distance_fog, volumetric_fog) in camera_query.iter() {
        let mut camera = commands.entity(entity);

        if config.distance.enabled {
            if distance_fog.is_none() {
                // info!("Adding DistanceFog to camera");
                camera.insert(distance_fog_component(&config));
            }
        } else if distance_fog.is_some() {
            camera.remove::<DistanceFog>();
        }

        if config.volumetric.enabled {
            if volumetric_fog.is_none() {
                info!("Adding VolumetricFog to camera");
                camera.insert(volumetric_fog_component(&config));
            }
        } else if volumetric_fog.is_some() {
            info!("Removing VolumetricFog from camera");
            camera.remove::<VolumetricFog>();
        }
    }

    if config.volumetric.enabled {
        if volume_query.iter().next().is_none() {
            info!("Spawning GlobalFogVolume for god rays (sync)");
            spawn_global_fog_volume(&mut commands, &config, noise_texture.map(|n| n.0.clone()));
        }
    } else {
        for entity in volume_query.iter() {
            info!("Despawning GlobalFogVolume");
            commands.entity(entity).despawn();
        }
    }
}

/// Update fog colors based on time-of-day from AtmosphereSettings
fn update_fog_from_atmosphere(
    atmosphere_settings: Option<Res<AtmosphereSettings>>,
    config: Res<FogConfig>,
    lod_settings: Option<Res<LodSettings>>,
    mut atmosphere_sample: ResMut<AtmosphereSample>,
    mut fog_range: ResMut<FogDistanceState>,
    mut fog_uniforms: ResMut<FogUniforms>,
    ambient: Res<GlobalAmbientLight>,
    world: Res<VoxelWorld>,
    time: Res<Time>,
    // Smoothing for preset transitions and boost
    mut smoothing: Local<FogSmoothingState>,
    camera_query: Query<&Transform, With<FogCamera>>,
    mut fog_query: Query<&mut DistanceFog, With<FogCamera>>,
    mut volumetric_query: Query<&mut VolumetricFog, With<FogCamera>>,
    mut volume_query: Query<&mut FogVolume, With<GlobalFogVolume>>,
) {
    if smoothing.current_boost == 0.0 { smoothing.current_boost = 1.0; }
    if smoothing.target_boost == 0.0 { smoothing.target_boost = 1.0; }
    let Some(atmo_settings) = atmosphere_settings else { return };

    // Get Mie settings from atmosphere (connected to menu settings)
    let mie_direction = atmo_settings.mie_direction;
    // let mie_strength = atmo_settings.mie.x; // Use X component as overall strength
    
    // Calculate sun position from atmosphere settings
    let phase = atmo_settings.time / atmo_settings.day_length;
    let theta = phase * std::f32::consts::TAU;
    let altitude = theta.sin(); // 1 at noon, -1 at midnight
    let azimuth = theta.cos();
    let sun_dir = Vec3::new(azimuth * 0.45, altitude, 0.35).normalize_or_zero();
    
    // Update atmosphere sample
    atmosphere_sample.sun_dir = sun_dir;
    atmosphere_sample.sun_altitude = altitude;
    
    // Compute blend factors from sun altitude
    let (daylight, twilight, night) = if atmo_settings.cycle_enabled {
        let daylight = smoothstep(-0.1, 0.25, altitude);
        let twilight = twilight_factor(altitude, 0.15);
        let night = (1.0 - daylight).max(0.05);
        (daylight, twilight, night)
    } else {
        (1.0, 0.0, 0.0)
    };

    let preset_density = lerp(atmo_settings.fog_density.y, atmo_settings.fog_density.x, daylight)
        .max(0.0001);

    // Blend between presets
    let day = &config.colors.day;
    let twi = &config.colors.twilight;
    let ngt = &config.colors.night;
    
    // Interpolate fog color
    let fog_color = lerp_color4(
        lerp_color4(ngt.fog, day.fog, daylight),
        twi.fog,
        twilight,
    );
    
    let directional_color = lerp_color3(
        lerp_color3(ngt.directional, day.directional, daylight),
        twi.directional,
        twilight,
    );

    let extinction_color = lerp_color3(
        lerp_color3(ngt.extinction, day.extinction, daylight),
        twi.extinction,
        twilight,
    );

    let inscattering_color = lerp_color3(
        lerp_color3(ngt.inscattering, day.inscattering, daylight),
        twi.inscattering,
        twilight,
    );
    
    // Density increases at night/twilight
    let density_mult = 1.0 + twilight * 0.5 + night * 0.3;
    let preset_scale = (preset_density / BASE_PRESET_DENSITY).clamp(0.5, 2.5);
    let distance_scale = (1.0 / (preset_scale * density_mult))
        .clamp(MIN_DISTANCE_SCALE, MAX_DISTANCE_SCALE);
    let min_end = lod_settings.as_ref().map(|lod| lod.cull_distance);
    let (start, end) = linear_fog_range(&config, distance_scale, min_end);

    if (fog_range.start - start).abs() > 0.01 || (fog_range.end - end).abs() > 0.01 {
        fog_range.start = start;
        fog_range.end = end;
    }

    // Get preset config early to check for volumetric overrides
    let preset_config = match config.current_preset {
        FogPreset::Clear => &config.presets.clear,
        FogPreset::Balanced => &config.presets.balanced,
        FogPreset::Misty => &config.presets.misty,
        FogPreset::GodRays => &config.presets.god_rays,
    };

    // Use preset's ambient_intensity_override if set (allows 0 for max god ray contrast)
    // Otherwise calculate from sky brightness with a floor
    let ambient_intensity = preset_config.ambient_intensity_override.unwrap_or_else(|| {
        (ambient.brightness / 16000.0).clamp(0.01, 0.12)
            .max(config.volumetric.ambient_intensity)
    });

    let mods = &config.color_modifiers;
    let fog_color = apply_color_modifiers4(fog_color, mods);
    let directional_color = apply_color_modifiers3(directional_color, mods);
    let extinction_color = apply_color_modifiers3(extinction_color, mods);
    let inscattering_color = apply_color_modifiers3(inscattering_color, mods);
    let use_linear = matches!(config.distance.falloff, FogFalloffMode::Linear)
        || config.distance.near_fade > 0.0;
    let fog_falloff = match config.distance.falloff {
        FogFalloffMode::Linear => FogFalloff::Linear { start, end },
        FogFalloffMode::Atmospheric => FogFalloff::from_visibility_colors(
            end.max(1.0),
            Color::srgb(
                extinction_color[0],
                extinction_color[1],
                extinction_color[2],
            ),
            Color::srgb(
                inscattering_color[0],
                inscattering_color[1],
                inscattering_color[2],
            ),
        ),
    };

    // Update distance fog
    for mut fog in fog_query.iter_mut() {
        fog.color = Color::srgba(fog_color[0], fog_color[1], fog_color[2], fog_color[3]);
        fog.directional_light_color = Color::srgba(
            directional_color[0],
            directional_color[1],
            directional_color[2],
            0.5 * daylight + 0.2 * night, // Less directional glow at night
        );
        fog.directional_light_exponent = 30.0 + twilight * 20.0; // Tighter during sunset
        fog.falloff = if use_linear {
            FogFalloff::Linear { start, end }
        } else {
            fog_falloff.clone()
        };
    }

    // Update volumetric fog camera settings so night/dim changes take effect.
    // Use preset overrides when available for step_count (sharper rays)
    let step_count = preset_config.step_count_override.unwrap_or(config.volumetric.step_count);
    for mut volumetric in volumetric_query.iter_mut() {
        volumetric.ambient_color = ambient.color;
        volumetric.ambient_intensity = ambient_intensity;
        volumetric.step_count = step_count;
        volumetric.jitter = config.volumetric.jitter;
    }
    
    // Throttled check for indoor boost (10Hz is plenty)
    smoothing.boost_timer += time.delta_secs();
    if smoothing.boost_timer > 0.1 {
        smoothing.boost_timer = 0.0;
        smoothing.target_boost = camera_query
            .single()
            .map(|camera| indoor_density_boost(&world, camera.translation))
            .unwrap_or(1.0);
    }
    
    let target = smoothing.target_boost;

    // Smoothly interpolate boost to avoid jarring pops when walking under trees
    let interpolation_speed = 2.0;
    let dt = time.delta_secs();
    smoothing.current_boost = lerp(smoothing.current_boost, target, (dt * interpolation_speed).clamp(0.0, 1.0));

    // Smoothly transition fog parameters when switching presets (preset_config already defined above)
    let preset_speed = 1.0;
    smoothing.current_density = lerp(smoothing.current_density, preset_config.density, (dt * preset_speed).clamp(0.0, 1.0));
    smoothing.current_scattering = lerp(smoothing.current_scattering, preset_config.scattering, (dt * preset_speed).clamp(0.0, 1.0));
    smoothing.current_absorption = lerp(smoothing.current_absorption, preset_config.absorption, (dt * preset_speed).clamp(0.0, 1.0));
    smoothing.current_asymmetry = lerp(smoothing.current_asymmetry, preset_config.scattering_asymmetry, (dt * preset_speed).clamp(0.0, 1.0));

    // "Breathing" Turbulence Animation for Misty/Balanced presets
    // Modulates density slightly to feel like moving air
    let turbulence = if config.current_preset != FogPreset::Clear {
        let wave = (time.elapsed_secs() * 0.5).sin() * 0.5 + 0.5; // 0.0 to 1.0 sine wave
        1.0 + wave * 0.15 // +0% to +15% density
    } else {
        1.0
    };

    // Update volumetric fog volume
    for mut volume in volume_query.iter_mut() {
        // Use config density directly - lower values = more transparent fog
        let density = (smoothing.current_density * smoothing.current_boost * turbulence).clamp(MIN_VOLUME_DENSITY, MAX_VOLUME_DENSITY);
        volume.density_factor = density;
        volume.absorption = smoothing.current_absorption;
        volume.fog_color = Color::srgba(fog_color[0], fog_color[1], fog_color[2], 1.0);
        volume.light_tint = Color::srgba(
            directional_color[0],
            directional_color[1],
            directional_color[2],
            1.0,
        );
        // High light intensity for visible god rays
        // Base intensity from time of day, then multiplied by preset's light_intensity
        // God rays preset uses 50x multiplier for visible shafts in near-zero density fog
        let base_intensity = 1200.0 * daylight + 100.0 * night;
        let time_modifier = 1.0 + twilight * 1.5;
        volume.light_intensity = base_intensity * time_modifier * preset_config.light_intensity;
        
        volume.scattering = smoothing.current_scattering;
        // mie_direction controls forward scattering asymmetry
        // Lower = more visible from all angles, higher = only toward sun
        volume.scattering_asymmetry = smoothing.current_asymmetry * mie_direction;
    }

    // Update fog uniforms for custom shaders (building, props, grass)
    fog_uniforms.fog_color = LinearRgba::new(fog_color[0], fog_color[1], fog_color[2], fog_color[3]);
    fog_uniforms.fog_start = start;
    fog_uniforms.fog_end = end;
    fog_uniforms.sun_dir = sun_dir;
    fog_uniforms.directional_exponent = 30.0 + twilight * 20.0;
    fog_uniforms.aerial_strength = mods.aerial_strength;
}

#[derive(Default)]
struct FogSmoothingState {
    current_density: f32,
    current_scattering: f32,
    current_absorption: f32,
    current_asymmetry: f32,
    current_boost: f32,
    boost_timer: f32,
    target_boost: f32,
}

fn update_shadow_cascades_from_fog(
    config: Res<FogConfig>,
    fog_range: Res<FogDistanceState>,
    mut cascades: Query<&mut CascadeShadowConfig, With<Sun>>,
) {
    if !config.distance.enabled {
        return;
    }

    if !(fog_range.is_changed() || config.is_changed()) {
        return;
    }

    let start = fog_range.start.max(0.0);
    let end = fog_range.end.max(start + MIN_DISTANCE_SPAN);
    let target_max = (end * SHADOW_FOG_FRACTION).max(start + MIN_DISTANCE_SPAN);

    for mut cascade in cascades.iter_mut() {
        let Some(current_max) = cascade.bounds.last().copied() else {
            continue;
        };
        if current_max <= 0.0 {
            continue;
        }

        let min_dist = cascade.minimum_distance;
        let target = target_max.max(min_dist + MIN_DISTANCE_SPAN);
        if (current_max - target).abs() < 0.5 {
            continue;
        }

        let scale = target / current_max;
        
        // Clone bounds to avoid mutable borrow overlap in loop
        let mut new_bounds = cascade.bounds.clone();
        
        for i in 0..new_bounds.len() {
            let mut val = new_bounds[i] * scale;
            if i == 0 {
                val = val.max(15.0);
            }
            new_bounds[i] = val.max(min_dist + 0.01);
            
            if i > 0 {
                let prev = new_bounds[i-1];
                if new_bounds[i] <= prev {
                    new_bounds[i] = prev + MIN_DISTANCE_SPAN;
                }
            }
        }
        
        cascade.bounds = new_bounds;
    }
}

/// Keep fog volume centered on camera
fn follow_camera_fog_volume(
    config: Res<FogConfig>,
    camera_query: Query<&Transform, With<FogCamera>>,
    mut volume_query: Query<&mut Transform, (With<GlobalFogVolume>, Without<FogCamera>)>,
) {
    let Ok(camera_tf) = camera_query.single() else { return };
    
    for mut tf in volume_query.iter_mut() {
        // Center volume on the camera so we're always inside the fog.
        tf.translation.x = camera_tf.translation.x;
        tf.translation.y = camera_tf.translation.y;
        tf.translation.z = camera_tf.translation.z;

        if config.is_changed() {
            tf.scale = Vec3::splat(config.volume.size);
        }
    }
}

// Helpers

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn twilight_factor(altitude: f32, band: f32) -> f32 {
    let centered = (altitude.abs() / band).min(1.0);
    (1.0 - centered).powi(2) * (1.0 - altitude.abs().min(1.0))
}

fn lerp_color3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn lerp_color4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

fn linear_fog_range(config: &FogConfig, scale: f32, min_end: Option<f32>) -> (f32, f32) {
    let scale = scale.clamp(MIN_DISTANCE_SCALE, MAX_DISTANCE_SCALE);
    let mut start = (config.distance.start * scale).max(0.0);
    let mut end = (config.distance.end * scale).max(0.0);
    if let Some(min_end) = min_end {
        if end < min_end {
            end = min_end;
        }
    }
    if end <= start + MIN_DISTANCE_SPAN {
        end = start + MIN_DISTANCE_SPAN;
    }
    let near_fade = config.distance.near_fade.clamp(0.0, 0.95);
    if near_fade > 0.0 {
        let max_start = (end - MIN_DISTANCE_SPAN).max(0.0);
        start = lerp(start, max_start, near_fade);
    }
    (start, end)
}

fn apply_color_modifiers3(color: [f32; 3], mods: &FogColorModifiers) -> [f32; 3] {
    let blue_shift = mods.blue_tint;
    [
        color[0] * (1.0 - blue_shift * 0.3) * mods.brightness,
        color[1] * (1.0 - blue_shift * 0.1) * mods.brightness,
        color[2] * (1.0 + blue_shift * 0.2) * mods.brightness,
    ]
}

fn apply_color_modifiers4(color: [f32; 4], mods: &FogColorModifiers) -> [f32; 4] {
    let rgb = apply_color_modifiers3([color[0], color[1], color[2]], mods);
    [rgb[0], rgb[1], rgb[2], color[3]]
}

fn indoor_density_boost(world: &VoxelWorld, position: Vec3) -> f32 {
    // Sampling pattern optimized for trees (canopy) and buildings
    // Radius ~3.0m (Widened): Aggressively detect trees/canopies to ensure god rays trigger
    let offsets = [
        Vec3::ZERO,
        Vec3::X * 3.0,
        Vec3::NEG_X * 3.0,
        Vec3::Z * 3.0,
        Vec3::NEG_Z * 3.0,
        Vec3::new(2.0, 0.0, 2.0),
        Vec3::new(-2.0, 0.0, -2.0),
        Vec3::new(2.0, 0.0, -2.0),
        Vec3::new(-2.0, 0.0, 2.0),
    ];
    let mut blocked = 0;
    // Check higher up (up to 32 blocks) to catch very tall pine tree canopies
    let check_height = 32;
    
    for offset in offsets {
        if column_blocked(world, position + offset, check_height) {
            blocked += 1;
        }
    }
    let ratio = blocked as f32 / offsets.len() as f32;
    // Significant boost indoors/under trees for visible shafts
    1.0 + ratio * 4000.0
}

fn column_blocked(world: &VoxelWorld, position: Vec3, max_height: i32) -> bool {
    let base = IVec3::new(
        position.x.floor() as i32,
        position.y.floor() as i32,
        position.z.floor() as i32,
    );
    for step in 1..=max_height {
        let pos = base + IVec3::Y * step;
        if let Some(voxel) = world.get_voxel(pos) {
            if voxel.is_solid() {
                return true;
            }
        }
    }
    false
}

/// Load fog configuration from YAML file
fn load_fog_config() -> Result<FogConfig, Box<dyn std::error::Error>> {
    #[derive(serde::Deserialize)]
    struct FogConfigFile {
        fog: FogConfig,
    }

    let config_str = std::fs::read_to_string("assets/config/fog.yaml")?;
    let config_file: FogConfigFile = serde_yaml::from_str(&config_str)?;
    Ok(config_file.fog)
}

/// Animate the dust/density texture offset to create movement in god rays
fn animate_dust_in_fog(
    time: Res<Time>,
    config: Res<FogConfig>,
    mut dust_state: ResMut<DustAnimationState>,
    mut volume_query: Query<&mut FogVolume, With<GlobalFogVolume>>,
) {
    // Get dust config from active preset
    let dust_config = match config.current_preset {
        FogPreset::Clear => &config.presets.clear.dust_animation,
        FogPreset::Balanced => &config.presets.balanced.dust_animation,
        FogPreset::Misty => &config.presets.misty.dust_animation,
        FogPreset::GodRays => &config.presets.god_rays.dust_animation,
    };

    if !dust_config.enabled {
        return;
    }

    // Update dust animation state
    dust_state.config = *dust_config;

    let dt = time.delta_secs();
    let speed = dust_config.speed;

    // Calculate wind-based movement direction
    let wind_dir = Vec2::new(
        dust_config.wind_direction[0],
        dust_config.wind_direction[1],
    ).normalize_or_zero();

    // Add subtle vertical drift and time-based variation for organic movement
    let time_factor = time.elapsed_secs();
    let vertical_drift = (time_factor * 0.3).sin() * 0.1; // Gentle up/down oscillation

    // Update offset with wind direction and subtle turbulence
    let turbulence_x = (time_factor * 0.7).sin() * 0.15;
    let turbulence_z = (time_factor * 0.5).cos() * 0.15;

    dust_state.offset += Vec3::new(
        (wind_dir.x + turbulence_x) * speed * dt,
        vertical_drift * speed * dt,
        (wind_dir.y + turbulence_z) * speed * dt,
    );

    // Apply the animated offset to the fog volume's density texture
    for mut volume in volume_query.iter_mut() {
        volume.density_texture_offset = dust_state.offset;
    }
}
