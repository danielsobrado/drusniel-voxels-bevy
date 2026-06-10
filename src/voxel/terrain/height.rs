use crate::constants::{MIN_BREAKABLE_Y, WATER_LEVEL};

use super::{
    NoiseGenerator, TerrainGenerator, WaterGenerationMetadata, smoothstep, smoothstep_range,
    soften_height_cap,
};

pub(super) const MIN_NORMAL_TERRAIN_SURFACE_Y: i32 = WATER_LEVEL - 4;
pub(super) const BASE_TERRAIN_ELEVATION: f32 = MIN_NORMAL_TERRAIN_SURFACE_Y as f32;

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Ridged noise for sharp mountain peaks.
    pub(super) fn ridged_noise(&self, x: f32, z: f32) -> f32 {
        let cfg = &self.config.mountains;
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = cfg.scale;
        let mut max_value = 0.0;

        for i in 0..cfg.octaves {
            // Offset each octave slightly for variation
            let sample = self.noise.sample_2d(
                x * frequency + i as f32 * 100.0,
                z * frequency + i as f32 * 100.0,
            );

            // Ridge transformation: 1.0 - |noise * 2 - 1|, then power for sharpness
            let centered = sample * 2.0 - 1.0; // Convert [0,1] to [-1,1]
            let ridge = 1.0 - centered.abs();
            let ridge = ridge.powf(cfg.ridge_power);

            value += ridge * amplitude;
            max_value += amplitude;

            amplitude *= cfg.persistence;
            frequency *= cfg.lacunarity;
        }

        (value / max_value) * cfg.amplitude
    }

    /// Calculates terrain height before water body bathymetry is applied.
    ///
    /// Uses multiple noise layers for varied terrain:
    /// - Continent layer for large-scale shape
    /// - Mountains with ridged noise for dramatic peaks
    /// - Hills for medium-scale variation
    /// - Detail for fine surface variation
    pub fn get_base_height(&self, world_x: i32, world_z: i32) -> i32 {
        let x = world_x as f32;
        let z = world_z as f32;
        let cfg = &self.config;

        let continent_noise = self.fbm_configurable(
            x,
            z,
            cfg.continent.scale,
            cfg.continent.octaves,
            cfg.continent.persistence,
            cfg.continent.lacunarity,
        );
        let continent = continent_noise * cfg.continent.amplitude * 0.55;

        // Mountain mask - determines where mountains appear (using lower frequency)
        let mountain_signal = self.fbm_configurable(
            x,
            z,
            cfg.mountains.scale * 0.25, // Lower frequency for mountain regions
            2,
            0.5,
            2.0,
        );

        // Ridged mountains, masked by mountain regions. The broad uplift keeps
        // mountain ranges tall even when the sharp ridge sample is between peaks.
        let mountain_region = mountain_signal.clamp(0.0, 1.0).powf(1.35);
        let massif_signal = self.fbm_configurable(
            x + 4096.0,
            z - 2048.0,
            cfg.mountains.massif_scale,
            3,
            0.52,
            2.0,
        );
        let massif_mask = smoothstep_range(cfg.mountains.massif_threshold, 1.0, massif_signal)
            .powf(cfg.mountains.massif_power.max(0.25))
            .max(self.massif_cell_mask(x, z));
        let mountain_region = (mountain_region * 0.55 + massif_mask * 0.8).clamp(0.0, 1.0);
        let mountains = self.ridged_noise(x, z) * mountain_region * (1.0 + massif_mask * 0.55);
        let mountain_uplift = cfg.mountains.amplitude * 0.18 * mountain_region
            + cfg.mountains.massif_amplitude * massif_mask;

        let valley_signal = self.fbm_configurable(
            x + 1375.0,
            z - 911.0,
            cfg.continent.scale * 2.2,
            3,
            0.55,
            2.0,
        );
        let valley_mask = smoothstep_range(0.22, 0.08, valley_signal);
        let valley_carve = valley_mask * 14.0 * (1.0 - mountain_region * 0.75);

        // Hills everywhere, scaled to shape traversal without lifting the
        // entire map into the camera path.
        let hill_noise = self.fbm_configurable(
            x,
            z,
            cfg.hills.scale,
            cfg.hills.octaves,
            cfg.hills.persistence,
            cfg.hills.lacunarity,
        );
        let hills = hill_noise * cfg.hills.amplitude * 0.45;

        // Fine detail.
        let detail_noise = self.fbm_configurable(
            x,
            z,
            cfg.detail.scale,
            cfg.detail.octaves,
            cfg.detail.persistence,
            cfg.detail.lacunarity,
        );
        let detail = detail_noise * cfg.detail.amplitude;

        let height =
            BASE_TERRAIN_ELEVATION + continent + mountains + mountain_uplift + hills + detail
                - valley_carve;
        // Normal land columns keep a continuous crust above bedrock. Water
        // body bathymetry is applied later and may carve beds lower than this.
        let min_surface = cfg.height.min.max(MIN_NORMAL_TERRAIN_SURFACE_Y as f32);
        let height = self.apply_edge_shoreline_shape(world_x, world_z, height);
        let height = soften_height_cap(height, min_surface, cfg.height.max);
        height.clamp(min_surface, cfg.height.max - 0.5) as i32
    }

    pub(super) fn massif_cell_mask(&self, x: f32, z: f32) -> f32 {
        let spacing = (1.0 / self.config.mountains.massif_scale.max(0.001)).clamp(128.0, 384.0);
        let cell_x = (x / spacing).floor() as i32;
        let cell_z = (z / spacing).floor() as i32;
        let mut strongest = 0.0f32;

        for dz in -1..=1 {
            for dx in -1..=1 {
                let cx = cell_x + dx;
                let cz = cell_z + dz;
                let offset_x = self.hash_position(cx.wrapping_mul(43), cz.wrapping_mul(59)) - 0.5;
                let offset_z = self.hash_position(cx.wrapping_mul(71), cz.wrapping_mul(37)) - 0.5;
                let height_t =
                    0.55 + self.hash_position(cx.wrapping_mul(97), cz.wrapping_mul(83)) * 0.45;
                let radius_t = self.hash_position(cx.wrapping_mul(113), cz.wrapping_mul(131));
                let center_x = (cx as f32 + 0.5 + offset_x * 0.55) * spacing;
                let center_z = (cz as f32 + 0.5 + offset_z * 0.55) * spacing;
                let radius = spacing * (0.42 + radius_t * 0.22);
                let dist_x = x - center_x;
                let dist_z = z - center_z;
                let dist = (dist_x * dist_x + dist_z * dist_z).sqrt();
                let falloff = (1.0f32 - dist / radius.max(1.0)).clamp(0.0, 1.0);
                let mask = smoothstep(falloff).powf(self.config.mountains.massif_power.max(0.25));
                strongest = strongest.max(mask * height_t);
            }
        }

        strongest
    }

    /// Calculates terrain height at a given world position.
    ///
    /// Water body bathymetry lowers terrain under lakes, ponds, and river
    /// channels before the usual water fill step runs.
    pub fn get_height(&self, world_x: i32, world_z: i32) -> i32 {
        self.get_height_and_water_generation_metadata(world_x, world_z)
            .0
    }

    pub(crate) fn get_height_and_water_generation_metadata(
        &self,
        world_x: i32,
        world_z: i32,
    ) -> (i32, WaterGenerationMetadata) {
        let base_height = self.get_base_height(world_x, world_z);
        let metadata =
            self.water_generation_metadata_for_base_height(world_x, world_z, base_height);
        let carved_height = if metadata.is_surface_water() {
            base_height.min(metadata.bed_y)
        } else {
            base_height
        };
        (
            carved_height.clamp(MIN_BREAKABLE_Y, self.config.height.max as i32),
            metadata,
        )
    }
}
