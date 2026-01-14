use super::config::{MountainConfig, NoiseLayer};

/// Standard fBm noise
pub fn fbm(x: f32, z: f32, layer: &NoiseLayer, seed: u32) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = layer.scale;
    let mut max_value = 0.0;

    for i in 0..layer.octaves {
        let sample = simplex_2d(x * frequency, z * frequency, seed.wrapping_add(i));
        value += sample * amplitude;
        max_value += amplitude;

        amplitude *= layer.persistence;
        frequency *= layer.lacunarity;
    }

    (value / max_value) * layer.amplitude
}

/// Ridged noise for sharp mountain peaks
pub fn ridged_fbm(x: f32, z: f32, config: &MountainConfig, seed: u32) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = config.scale;
    let mut max_value = 0.0;

    for i in 0..config.octaves {
        let sample = simplex_2d(x * frequency, z * frequency, seed.wrapping_add(i + 100));

        // Ridge transformation: 1.0 - |noise|, then power for sharpness
        let ridge = 1.0 - sample.abs();
        let ridge = ridge.powf(config.ridge_power);

        value += ridge * amplitude;
        max_value += amplitude;

        amplitude *= config.persistence;
        frequency *= config.lacunarity;
    }

    (value / max_value) * config.amplitude
}

/// Combined terrain height at world position
pub fn sample_terrain_height(x: f32, z: f32, config: &super::config::TerrainConfig, seed: u32) -> f32 {
    // Large scale continent shape
    let continent = fbm(x, z, &config.continent, seed);

    // Mountain mask - determines where mountains appear
    let mountain_mask = (fbm(
        x,
        z,
        &NoiseLayer {
            scale: 0.002,
            amplitude: 1.0,
            octaves: 2,
            persistence: 0.5,
            lacunarity: 2.0,
        },
        seed.wrapping_add(500),
    ) + 0.3)
        .clamp(0.0, 1.0);

    // Ridged mountains, masked by continent
    let mountains = ridged_fbm(x, z, &config.mountains, seed) * mountain_mask;

    // Hills everywhere
    let hills = fbm(x, z, &config.hills, seed.wrapping_add(200));

    // Fine detail
    let detail = fbm(x, z, &config.detail, seed.wrapping_add(300));

    // Combine layers
    let height = continent + mountains + hills + detail;

    // Clamp to world bounds
    height.clamp(config.height.min, config.height.max)
}

// Placeholder - use your noise implementation
fn simplex_2d(x: f32, y: f32, seed: u32) -> f32 {
    // TODO: Replace with actual noise library call
    // e.g., noise::NoiseFn or simdnoise
    let _ = (x, y, seed);
    0.0
}
