use bevy::prelude::*;
use bevy::light::{CascadeShadowConfig, FogVolume, VolumetricFog, VolumetricLight};
use bevy::pbr::{DistanceFog, FogFalloff};
use bevy::render::render_resource::ShaderType;
use crate::atmosphere::config::{FogColorModifiers, FogConfig, FogFalloffMode};
use crate::environment::{AtmosphereSettings, Sun};
use crate::voxel::plugin::LodSettings;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

pub struct FogPlugin;

const BASE_PRESET_DENSITY: f32 = 0.0009; // "Balanced" preset baseline for scaling.
const VOLUME_DENSITY_SCALE: f32 = 1.0; // Volumetric density scale for visible god rays
const MIN_VOLUME_DENSITY: f32 = 0.01; // Minimum to ensure shafts are visible
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
            .add_systems(Startup, setup_fog)
            .add_systems(
                Update,
                (
                    sync_fog_toggles,
                    update_fog_from_atmosphere,
                    update_shadow_cascades_from_fog,
                    follow_camera_fog_volume,
                    debug_god_rays_status,
                ).chain(),
            );
    }
}

/// Debug system to verify all god rays components exist
fn debug_god_rays_status(
    time: Res<Time>,
    mut last_log: Local<f32>,
    mut fps_samples: Local<Vec<f32>>,
    fog_volume_query: Query<(&FogVolume, &Transform), With<GlobalFogVolume>>,
    volumetric_fog_query: Query<&VolumetricFog, With<FogCamera>>,
    volumetric_light_query: Query<(&VolumetricLight, &DirectionalLight), With<Sun>>,
    camera_query: Query<&Transform, With<FogCamera>>,
) {
    // Track FPS
    let fps = 1.0 / time.delta_secs().max(0.001);
    fps_samples.push(fps);
    if fps_samples.len() > 60 {
        fps_samples.remove(0);
    }
    let avg_fps = fps_samples.iter().sum::<f32>() / fps_samples.len() as f32;

    // Only log every 5 seconds
    *last_log += time.delta_secs();
    if *last_log < 5.0 {
        return;
    }
    *last_log = 0.0;

    let has_fog_volume = fog_volume_query.iter().next().is_some();
    let has_volumetric_fog = volumetric_fog_query.iter().next().is_some();
    let has_volumetric_light = volumetric_light_query.iter().next().is_some();

    if has_fog_volume && has_volumetric_fog && has_volumetric_light {
        if let (Ok((volume, vol_tf)), Ok(cam_tf), Ok(vfog), Ok((_, sun))) = (
            fog_volume_query.single(),
            camera_query.single(),
            volumetric_fog_query.single(),
            volumetric_light_query.single(),
        ) {
            info!(
                "God rays ACTIVE (FPS={:.0}): density={:.4}, scattering={:.2}, absorption={:.5}, intensity={:.1}, scale={:.0}, steps={}",
                avg_fps,
                volume.density_factor,
                volume.scattering,
                volume.absorption,
                volume.light_intensity,
                vol_tf.scale.x,
                vfog.step_count,
            );
        }
    } else {
        let camera_count = camera_query.iter().len();
        warn!(
            "God rays MISSING (FPS={:.0}): FogVolume={}, VolumetricFog={}, VolumetricLight={}, CameraCount={}",
            avg_fps, has_fog_volume, has_volumetric_fog, has_volumetric_light, camera_count
        );
    }
}

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

fn spawn_global_fog_volume(commands: &mut Commands, config: &FogConfig) {
    // Use config values for proper god rays - low absorption for brightness
    let density = config.volume.density.max(MIN_VOLUME_DENSITY);
    let size = config.volume.size;
    let scattering = config.volume.scattering;
    let absorption = config.volume.absorption;
    let asymmetry = config.volume.scattering_asymmetry;
    
    info!(
        "Spawning FogVolume: density={:.4}, scattering={:.2}, absorption={:.4}, size={:.0}",
        density, scattering, absorption, size
    );

    commands.spawn((
        Name::new("GlobalFogVolume"),
        GlobalFogVolume,
        FogVolume {
            density_factor: density,
            scattering,
            absorption,
            scattering_asymmetry: asymmetry,
            ..default()
        },
        Transform::from_scale(Vec3::splat(size)),
    ));
}

fn setup_fog(
    mut commands: Commands,
    config: Res<FogConfig>,
    mut debug_toggles: ResMut<crate::interaction::DebugDetailToggles>,
) {
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
        spawn_global_fog_volume(&mut commands, &config);
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
    time: Res<Time>,
    mut commands: Commands,
    mut config: ResMut<FogConfig>,
    debug_toggles: Res<crate::interaction::DebugDetailToggles>,
    camera_query: Query<(Entity, Option<&DistanceFog>, Option<&VolumetricFog>), With<FogCamera>>,
    volume_query: Query<Entity, With<GlobalFogVolume>>,
    mut trace_timer: Local<f32>,
) {
    // Periodic state log for debugging (every 2 seconds)
    *trace_timer += time.delta_secs();
    if *trace_timer > 2.0 {
        *trace_timer = 0.0;
        let has_vol = volume_query.iter().next().is_some();
        let cam_has_vfog = camera_query.iter().any(|(_, _, vf)| vf.is_some());
        warn!(
            "FOG STATE: config.enabled={}, toggle.enabled={}, FogVolume={}, CamVFog={}, toggle_changed={}, config_changed={}",
            config.volumetric.enabled, debug_toggles.volumetric_fog_enabled, has_vol, cam_has_vfog,
            debug_toggles.is_changed(), config.is_changed()
        );
    }

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
            spawn_global_fog_volume(&mut commands, &config);
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
    ambient: Res<AmbientLight>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<FogCamera>>,
    mut fog_query: Query<&mut DistanceFog, With<FogCamera>>,
    mut volumetric_query: Query<&mut VolumetricFog, With<FogCamera>>,
    mut volume_query: Query<&mut FogVolume, With<GlobalFogVolume>>,
) {
    let Some(atmo_settings) = atmosphere_settings else { return };

    // Get Mie settings from atmosphere (connected to menu settings)
    let mie_direction = atmo_settings.mie_direction;
    let mie_strength = atmo_settings.mie.x; // Use X component as overall strength
    
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

    let ambient_intensity = (ambient.brightness / 16000.0).clamp(0.01, 0.12)
        .max(config.volumetric.ambient_intensity);

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
    for mut volumetric in volumetric_query.iter_mut() {
        volumetric.ambient_color = ambient.color;
        volumetric.ambient_intensity = ambient_intensity;
        volumetric.step_count = config.volumetric.step_count;
        volumetric.jitter = config.volumetric.jitter;
    }
    
    let interior_boost = camera_query
        .single()
        .map(|camera| indoor_density_boost(&world, camera.translation))
        .unwrap_or(1.0);

    // Update volumetric fog volume
    for mut volume in volume_query.iter_mut() {
        // Use config density directly - lower values = more transparent fog
        let density = config.volume.density.clamp(MIN_VOLUME_DENSITY, MAX_VOLUME_DENSITY);
        volume.density_factor = density;
        volume.absorption = config.volume.absorption;
        volume.fog_color = Color::srgba(fog_color[0], fog_color[1], fog_color[2], 1.0);
        volume.light_tint = Color::srgba(
            directional_color[0],
            directional_color[1],
            directional_color[2],
            1.0,
        );
        // High light intensity for visible god rays (50-100 range for bright shafts)
        let base_intensity = 50.0 * daylight + 10.0 * night;
        volume.light_intensity = base_intensity * (1.0 + twilight * 1.5);
        // For testing: use config scattering directly without modifications
        volume.scattering = config.volume.scattering;
        // mie_direction controls forward scattering asymmetry
        // Lower = more visible from all angles, higher = only toward sun
        volume.scattering_asymmetry = config.volume.scattering_asymmetry * mie_direction;
    }

    // Update fog uniforms for custom shaders (building, props, grass)
    fog_uniforms.fog_color = LinearRgba::new(fog_color[0], fog_color[1], fog_color[2], fog_color[3]);
    fog_uniforms.fog_start = start;
    fog_uniforms.fog_end = end;
    fog_uniforms.sun_dir = sun_dir;
    fog_uniforms.directional_exponent = 30.0 + twilight * 20.0;
    fog_uniforms.aerial_strength = mods.aerial_strength;
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
        for bound in cascade.bounds.iter_mut() {
            *bound = (*bound * scale).max(min_dist + 0.01);
        }
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
    let offsets = [
        Vec3::ZERO,
        Vec3::X * 0.5,
        Vec3::NEG_X * 0.5,
        Vec3::Z * 0.5,
        Vec3::NEG_Z * 0.5,
    ];
    let mut blocked = 0;
    for offset in offsets {
        if column_blocked(world, position + offset, 8) {
            blocked += 1;
        }
    }
    let ratio = blocked as f32 / offsets.len() as f32;
    1.0 + ratio * 1.5
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
