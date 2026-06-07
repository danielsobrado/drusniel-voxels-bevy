use std::sync::atomic::{AtomicUsize, Ordering};

use bevy::log::debug;

use crate::constants::{
    BEACH_HEIGHT_OFFSET, TREE_HEIGHT_VARIANCE, TREE_LEAF_CHECK_RADIUS, TREE_LEAF_RADIUS,
    TREE_MIN_HEIGHT, TREE_SPAWN_THRESHOLD, WATER_LEVEL,
};

use super::{NoiseGenerator, TerrainGenerator};

static TREE_SPAWN_LOGS: AtomicUsize = AtomicUsize::new(0);

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Checks if a tree should spawn at a given location.
    pub fn should_spawn_tree(&self, world_x: i32, world_z: i32, terrain_height: i32) -> bool {
        if terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET {
            return false;
        }

        let tree_noise = self.hash_position(world_x.wrapping_mul(7), world_z.wrapping_mul(13));
        let spawn = tree_noise > TREE_SPAWN_THRESHOLD;
        if spawn && TREE_SPAWN_LOGS.fetch_add(1, Ordering::Relaxed) < 8 {
            debug!(
                "Tree spawn candidate at ({}, {}) height {} noise {:.3}",
                world_x, world_z, terrain_height, tree_noise
            );
        }
        spawn
    }

    /// Gets the height of a tree at a given location.
    pub fn get_tree_height(&self, world_x: i32, world_z: i32) -> i32 {
        let h = self.hash_position(world_x.wrapping_add(1000), world_z.wrapping_add(2000));
        TREE_MIN_HEIGHT + (h * TREE_HEIGHT_VARIANCE as f32) as i32
    }

    /// Checks if a position is part of a tree trunk.
    pub fn is_tree_trunk(
        &self,
        world_x: i32,
        world_y: i32,
        world_z: i32,
        terrain_height: i32,
    ) -> bool {
        if !self.should_spawn_tree(world_x, world_z, terrain_height) {
            return false;
        }

        let trunk_height = self.get_tree_height(world_x, world_z);
        let trunk_bottom = terrain_height + 1;
        let trunk_top = trunk_bottom + trunk_height;

        world_y >= trunk_bottom && world_y < trunk_top
    }

    /// Checks if a position is part of tree leaves.
    pub fn is_tree_leaves(&self, world_x: i32, world_y: i32, world_z: i32) -> bool {
        for dx in -TREE_LEAF_CHECK_RADIUS..=TREE_LEAF_CHECK_RADIUS {
            for dz in -TREE_LEAF_CHECK_RADIUS..=TREE_LEAF_CHECK_RADIUS {
                let check_x = world_x + dx;
                let check_z = world_z + dz;

                let check_height = self.get_height(check_x, check_z);

                if self.should_spawn_tree(check_x, check_z, check_height) {
                    let trunk_height = self.get_tree_height(check_x, check_z);
                    let trunk_top = check_height + 1 + trunk_height;
                    let leaf_center_y = trunk_top - 1;

                    let dx_f = dx as f32;
                    let dz_f = dz as f32;
                    let dy_f = (world_y - leaf_center_y) as f32;

                    let dist_sq = dx_f * dx_f + dy_f * dy_f * 1.5 + dz_f * dz_f;

                    if dist_sq < TREE_LEAF_RADIUS * TREE_LEAF_RADIUS {
                        if !(dx == 0 && dz == 0 && world_y < trunk_top) {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }
}
