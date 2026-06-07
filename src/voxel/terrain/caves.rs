use crate::constants::{
    CAVE_MAX_Y, CAVE_MIN_Y, CAVE_SURFACE_OFFSET, MOUNTAIN_THRESHOLD, TERRAIN_CAVE_FREQUENCY,
};

use super::{NoiseGenerator, TerrainGenerator};

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Checks if a position should be a cave.
    pub fn is_cave(&self, world_x: i32, world_y: i32, world_z: i32, terrain_height: i32) -> bool {
        if !self.config.caves.enabled {
            return false;
        }

        if world_y <= CAVE_MIN_Y || world_y >= CAVE_MAX_Y {
            return false;
        }

        if world_y >= terrain_height - CAVE_SURFACE_OFFSET {
            return false;
        }

        let x = world_x as f32;
        let y = world_y as f32;
        let z = world_z as f32;

        let cave_noise = self.noise.fbm_2d(
            x * TERRAIN_CAVE_FREQUENCY + y * 0.03,
            z * TERRAIN_CAVE_FREQUENCY + y * 0.02,
            3,
        );

        // Caves more common at lower depths
        let cave_threshold = MOUNTAIN_THRESHOLD + (y / 64.0) * 0.1;
        cave_noise > cave_threshold
    }
}
