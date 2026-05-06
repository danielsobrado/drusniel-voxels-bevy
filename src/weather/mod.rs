pub mod config;
pub mod particle_classify;
pub mod plugin;
pub mod state;

pub use config::{WeatherConfig, WeatherEffectConfig, WeatherLowGpuConfig, WeatherQuality};
pub use plugin::WeatherPlugin;
pub use state::{
    WEATHER_FLAG_ENABLED, WEATHER_FLAG_INTEGRATED_FALLBACK, WEATHER_FLAG_PRECIP_OVERLAY,
    WEATHER_FLAG_PUDDLE_DETAIL, WEATHER_FLAG_SNOW_TINT, WeatherKind, WeatherRuntime,
    WeatherShaderUniforms,
};
