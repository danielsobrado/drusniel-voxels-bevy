use bevy::prelude::*;
use serde::Deserialize;

/// Wind system configuration
#[derive(Resource, Deserialize, Clone)]
pub struct WindConfig {
    pub enabled: bool,
    pub direction: [f32; 2],
    pub speed: f32,
    pub strength: f32,
    pub turbulence: f32,
    pub gust_strength: f32,
    pub gust_frequency: f32,
}

impl Default for WindConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            direction: [0.7, 0.3],
            speed: 5.0,
            strength: 1.0,
            turbulence: 0.3,
            gust_strength: 2.0,
            gust_frequency: 0.1,
        }
    }
}

/// Runtime wind state (animated values)
#[derive(Resource)]
pub struct WindState {
    pub direction: Vec2,
    pub speed: f32,
    pub strength: f32,
    pub turbulence: f32,
    pub gust_strength: f32,
    pub time: f32,
}

impl Default for WindState {
    fn default() -> Self {
        Self {
            direction: Vec2::new(0.7, 0.3).normalize(),
            speed: 5.0,
            strength: 1.0,
            turbulence: 0.3,
            gust_strength: 2.0,
            time: 0.0,
        }
    }
}

/// GPU uniform buffer for wind shaders
#[derive(Clone, Copy)]
#[repr(C)]
pub struct WindUniforms {
    pub direction: [f32; 2],
    pub speed: f32,
    pub strength: f32,
    pub turbulence: f32,
    pub gust_strength: f32,
    pub gust_frequency: f32,
    pub time: f32,
}

impl From<&WindState> for WindUniforms {
    fn from(state: &WindState) -> Self {
        Self {
            direction: [state.direction.x, state.direction.y],
            speed: state.speed,
            strength: state.strength,
            turbulence: state.turbulence,
            gust_strength: state.gust_strength,
            gust_frequency: 0.1,
            time: state.time,
        }
    }
}

/// Component for entities affected by wind
#[derive(Component)]
pub struct WindAffected {
    /// How much this entity responds to wind (0-1)
    pub wind_response: f32,
    /// Type of wind animation
    pub animation_type: WindAnimationType,
}

impl Default for WindAffected {
    fn default() -> Self {
        Self {
            wind_response: 1.0,
            animation_type: WindAnimationType::Grass,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WindAnimationType {
    Grass,      // Simple sway
    Tree,       // Complex multi-layer animation
    Bush,       // Medium complexity
    Foliage,    // Leaf flutter
}

pub struct WindPlugin;

impl Plugin for WindPlugin {
    fn build(&self, app: &mut App) {
        let config = load_wind_config().unwrap_or_else(|e| {
            warn!("Failed to load wind config: {}, using defaults", e);
            WindConfig::default()
        });

        let initial_state = WindState {
            direction: Vec2::new(config.direction[0], config.direction[1]).normalize(),
            speed: config.speed,
            strength: config.strength,
            turbulence: config.turbulence,
            gust_strength: config.gust_strength,
            time: 0.0,
        };

        app.insert_resource(config)
            .insert_resource(initial_state)
            .add_systems(Update, update_wind_state);
    }
}

pub fn load_wind_config() -> Result<WindConfig, Box<dyn std::error::Error>> {
    #[derive(Deserialize)]
    struct WindConfigFile {
        wind: WindConfig,
    }

    let config_str = std::fs::read_to_string("assets/config/wind.yaml")?;
    let config_file: WindConfigFile = serde_yaml::from_str(&config_str)?;
    Ok(config_file.wind)
}

fn update_wind_state(
    time: Res<Time>,
    config: Res<WindConfig>,
    mut state: ResMut<WindState>,
) {
    if !config.enabled {
        return;
    }

    // Update time
    state.time = time.elapsed_secs();

    // Optional: Add slow wind direction changes
    let dir_change_speed = 0.01;
    let target_dir = Vec2::new(config.direction[0], config.direction[1]).normalize();
    state.direction = state.direction.lerp(target_dir, dir_change_speed);

    // Optional: Add wind speed variation
    let noise = (state.time * 0.1).sin() * 0.2;
    state.speed = config.speed * (1.0 + noise);
}

/// Public API to change wind parameters at runtime
pub fn set_wind_direction(state: &mut WindState, direction: Vec2) {
    state.direction = direction.normalize_or_zero();
}

pub fn set_wind_strength(state: &mut WindState, strength: f32) {
    state.strength = strength.max(0.0);
}

pub fn set_wind_speed(state: &mut WindState, speed: f32) {
    state.speed = speed.max(0.0);
}
