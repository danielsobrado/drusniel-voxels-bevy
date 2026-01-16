use bevy::prelude::*;
use bevy::color::LinearRgba;
use bevy_hanabi::prelude::*;
use serde::Deserialize;

/// Weather particle system configuration
#[derive(Resource, Deserialize, Clone)]
pub struct WeatherConfig {
    pub rain: RainConfig,
    pub snow: SnowConfig,
    pub dust: DustConfig,
}

#[derive(Deserialize, Clone)]
pub struct RainConfig {
    pub enabled: bool,
    pub intensity: f32,          // Particles per second (0-10000)
    pub drop_speed: f32,         // Fall speed in m/s
    pub drop_length: f32,        // Visual length of raindrops
    pub wind_influence: f32,     // How much wind affects rain
    pub splash_enabled: bool,
    pub color: [f32; 4],
}

#[derive(Deserialize, Clone)]
pub struct SnowConfig {
    pub enabled: bool,
    pub intensity: f32,
    pub fall_speed: f32,
    pub flake_size: f32,
    pub wind_influence: f32,
    pub accumulation: bool,
    pub color: [f32; 4],
}

#[derive(Deserialize, Clone)]
pub struct DustConfig {
    pub enabled: bool,
    pub intensity: f32,
    pub particle_size: f32,
    pub wind_influence: f32,
    pub color: [f32; 4],
}

impl Default for WeatherConfig {
    fn default() -> Self {
        Self {
            rain: RainConfig {
                enabled: false,
                intensity: 5000.0,
                drop_speed: 15.0,
                drop_length: 0.3,
                wind_influence: 0.5,
                splash_enabled: true,
                color: [0.7, 0.8, 0.9, 0.6],
            },
            snow: SnowConfig {
                enabled: false,
                intensity: 2000.0,
                fall_speed: 2.0,
                flake_size: 0.02,
                wind_influence: 0.8,
                accumulation: false,
                color: [1.0, 1.0, 1.0, 0.9],
            },
            dust: DustConfig {
                enabled: false,
                intensity: 500.0,
                particle_size: 0.01,
                wind_influence: 1.0,
                color: [0.8, 0.7, 0.5, 0.3],
            },
        }
    }
}

pub fn load_weather_config() -> Result<WeatherConfig, Box<dyn std::error::Error>> {
    let config_str = std::fs::read_to_string("assets/config/weather.yaml")?;
    let config: WeatherConfig = serde_yaml::from_str(&config_str)?;
    Ok(config)
}

/// Current weather state
#[derive(Resource, Default)]
pub struct WeatherState {
    pub current_type: WeatherType,
    pub intensity: f32,
    pub wind_direction: Vec2,
    pub wind_speed: f32,
    pub transition_timer: f32,
}

#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
pub enum WeatherType {
    #[default]
    Clear,
    Rain,
    Snow,
    Dust,
}

/// Handles for weather particle effects
#[derive(Resource)]
pub struct WeatherEffects {
    pub rain_effect: Option<Handle<EffectAsset>>,
    pub snow_effect: Option<Handle<EffectAsset>>,
    pub dust_effect: Option<Handle<EffectAsset>>,
    pub rain_splash_effect: Option<Handle<EffectAsset>>,
}

impl Default for WeatherEffects {
    fn default() -> Self {
        Self {
            rain_effect: None,
            snow_effect: None,
            dust_effect: None,
            rain_splash_effect: None,
        }
    }
}

/// Marker for weather particle emitters
#[derive(Component)]
pub struct WeatherEmitter {
    pub weather_type: WeatherType,
}

/// Component to follow camera for weather particles
#[derive(Component)]
pub struct FollowCamera {
    pub offset: Vec3,
}

pub struct WeatherParticlePlugin;

impl Plugin for WeatherParticlePlugin {
    fn build(&self, app: &mut App) {
        let config = load_weather_config().unwrap_or_else(|e| {
            warn!("Failed to load weather config: {}, using defaults", e);
            WeatherConfig::default()
        });

        app.insert_resource(config)
            .init_resource::<WeatherState>()
            .init_resource::<WeatherEffects>()
            .add_systems(Startup, setup_weather_effects)
            .add_systems(Update, (
                update_weather_emitters,
                follow_camera_system,
            ));
    }
}

fn setup_weather_effects(
    mut commands: Commands,
    mut effects: ResMut<Assets<EffectAsset>>,
    config: Res<WeatherConfig>,
) {
    let mut weather_effects = WeatherEffects::default();

    // Create rain effect
    if config.rain.enabled {
        weather_effects.rain_effect = Some(create_rain_effect(&mut effects, &config.rain));
        info!("Rain particle effect created");
    }

    // Create snow effect
    if config.snow.enabled {
        weather_effects.snow_effect = Some(create_snow_effect(&mut effects, &config.snow));
        info!("Snow particle effect created");
    }

    // Create dust effect
    if config.dust.enabled {
        weather_effects.dust_effect = Some(create_dust_effect(&mut effects, &config.dust));
        info!("Dust particle effect created");
    }

    commands.insert_resource(weather_effects);
}

fn create_rain_effect(
    effects: &mut Assets<EffectAsset>,
    config: &RainConfig,
) -> Handle<EffectAsset> {
    // Rain particles: vertical streaks falling fast
    let writer = ExprWriter::new();
    
    // Spawn position: large area above camera
    let spawn_pos = writer.lit(Vec3::ZERO).expr();
    let spawn_radius = writer.lit(50.0).expr();
    
    // Initialize particle properties
    let axis_y = writer.lit(Vec3::Y).expr();
    let init_pos = SetPositionCircleModifier {
        center: spawn_pos,
        axis: axis_y,
        radius: spawn_radius,
        dimension: ShapeDimension::Volume,
    };

    let axis_y2 = writer.lit(Vec3::Y).expr();
    let init_vel = SetVelocityCircleModifier {
        center: writer.lit(Vec3::new(0.0, -config.drop_speed, 0.0)).expr(),
        axis: axis_y2,
        speed: writer.lit(config.drop_speed * 0.1).expr(),
    };
    
    let init_lifetime = SetAttributeModifier::new(
        Attribute::LIFETIME,
        writer.lit(3.0).expr(),
    );
    
    // Color with alpha - pack as RGBA u32
    let color = LinearRgba::new(
        config.color[0],
        config.color[1],
        config.color[2],
        config.color[3],
    );
    let init_color = SetAttributeModifier::new(
        Attribute::COLOR,
        writer.lit(color.as_u32()).expr(),
    );
    
    // Size (elongated for rain streaks)
    let init_size = SetAttributeModifier::new(
        Attribute::SIZE,
        writer.lit(config.drop_length).expr(),
    );
    
    // Build effect
    let spawner = SpawnerSettings::rate(config.intensity.into());
    
    let effect = EffectAsset::new(32768, spawner, writer.finish())
        .with_name("rain")
        .init(init_pos)
        .init(init_vel)
        .init(init_lifetime)
        .init(init_color)
        .init(init_size)
        .render(OrientModifier::new(OrientMode::AlongVelocity));
    
    effects.add(effect)
}

fn create_snow_effect(
    effects: &mut Assets<EffectAsset>,
    config: &SnowConfig,
) -> Handle<EffectAsset> {
    // Snow: slow falling, swirling particles
    let writer = ExprWriter::new();
    
    let spawn_pos = writer.lit(Vec3::ZERO).expr();
    let spawn_radius = writer.lit(40.0).expr();
    
    let axis_y = writer.lit(Vec3::Y).expr();
    let init_pos = SetPositionCircleModifier {
        center: spawn_pos,
        axis: axis_y,
        radius: spawn_radius,
        dimension: ShapeDimension::Volume,
    };

    // Slow downward with some horizontal drift
    let axis_y2 = writer.lit(Vec3::Y).expr();
    let init_vel = SetVelocityCircleModifier {
        center: writer.lit(Vec3::new(0.0, -config.fall_speed, 0.0)).expr(),
        axis: axis_y2,
        speed: writer.lit(config.fall_speed * 0.5).expr(),
    };
    
    let init_lifetime = SetAttributeModifier::new(
        Attribute::LIFETIME,
        writer.lit(8.0).expr(),
    );
    
    let color = LinearRgba::new(
        config.color[0],
        config.color[1],
        config.color[2],
        config.color[3],
    );
    let init_color = SetAttributeModifier::new(
        Attribute::COLOR,
        writer.lit(color.as_u32()).expr(),
    );

    let init_size = SetAttributeModifier::new(
        Attribute::SIZE,
        writer.lit(config.flake_size).expr(),
    );

    let spawner = SpawnerSettings::rate(config.intensity.into());
    
    let effect = EffectAsset::new(32768, spawner, writer.finish())
        .with_name("snow")
        .init(init_pos)
        .init(init_vel)
        .init(init_lifetime)
        .init(init_color)
        .init(init_size);
    
    effects.add(effect)
}

fn create_dust_effect(
    effects: &mut Assets<EffectAsset>,
    config: &DustConfig,
) -> Handle<EffectAsset> {
    // Dust: drifting particles
    let writer = ExprWriter::new();
    
    let spawn_pos = writer.lit(Vec3::ZERO).expr();
    let spawn_radius = writer.lit(30.0).expr();
    
    let init_pos = SetPositionSphereModifier {
        center: spawn_pos,
        radius: spawn_radius,
        dimension: ShapeDimension::Volume,
    };
    
    // Slow random movement
    let init_vel = SetVelocitySphereModifier {
        center: writer.lit(Vec3::ZERO).expr(),
        speed: writer.lit(0.5).expr(),
    };
    
    let init_lifetime = SetAttributeModifier::new(
        Attribute::LIFETIME,
        writer.lit(10.0).expr(),
    );
    
    let color = LinearRgba::new(
        config.color[0],
        config.color[1],
        config.color[2],
        config.color[3],
    );
    let init_color = SetAttributeModifier::new(
        Attribute::COLOR,
        writer.lit(color.as_u32()).expr(),
    );

    let init_size = SetAttributeModifier::new(
        Attribute::SIZE,
        writer.lit(config.particle_size).expr(),
    );

    let spawner = SpawnerSettings::rate(config.intensity.into());

    let effect = EffectAsset::new(8192, spawner, writer.finish())
        .with_name("dust")
        .init(init_pos)
        .init(init_vel)
        .init(init_lifetime)
        .init(init_color)
        .init(init_size);
    
    effects.add(effect)
}

fn update_weather_emitters(
    mut commands: Commands,
    weather_state: Res<WeatherState>,
    weather_effects: Res<WeatherEffects>,
    emitters: Query<(Entity, &WeatherEmitter)>,
) {
    // Check if weather changed
    if !weather_state.is_changed() {
        return;
    }

    // Remove old emitters
    for (entity, emitter) in emitters.iter() {
        if emitter.weather_type != weather_state.current_type {
            commands.entity(entity).despawn();
        }
    }

    // Spawn new emitter if needed
    let effect_handle = match weather_state.current_type {
        WeatherType::Clear => return,
        WeatherType::Rain => weather_effects.rain_effect.clone(),
        WeatherType::Snow => weather_effects.snow_effect.clone(),
        WeatherType::Dust => weather_effects.dust_effect.clone(),
    };

    if let Some(handle) = effect_handle {
        commands.spawn((
            Name::new(format!("{:?} Weather", weather_state.current_type)),
            ParticleEffect::new(handle),
            Transform::from_translation(Vec3::new(0.0, 30.0, 0.0)),
            WeatherEmitter {
                weather_type: weather_state.current_type,
            },
            FollowCamera {
                offset: Vec3::new(0.0, 30.0, 0.0),
            },
        ));
    }
}

fn follow_camera_system(
    camera_query: Query<&Transform, With<Camera3d>>,
    mut followers: Query<(&mut Transform, &FollowCamera), Without<Camera3d>>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    for (mut transform, follow) in followers.iter_mut() {
        transform.translation = camera_transform.translation + follow.offset;
    }
}

/// Public API for changing weather
pub fn set_weather(
    weather_state: &mut WeatherState,
    weather_type: WeatherType,
    intensity: f32,
) {
    weather_state.current_type = weather_type;
    weather_state.intensity = intensity.clamp(0.0, 1.0);
}

/// Set wind parameters
pub fn set_wind(
    weather_state: &mut WeatherState,
    direction: Vec2,
    speed: f32,
) {
    weather_state.wind_direction = direction.normalize_or_zero();
    weather_state.wind_speed = speed;
}
