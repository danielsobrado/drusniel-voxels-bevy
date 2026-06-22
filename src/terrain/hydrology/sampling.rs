use bevy::prelude::*;

use super::field::VisualHydrologyField;

impl VisualHydrologyField {
    pub fn world_position_for_cell(&self, x: usize, z: usize) -> Vec2 {
        self.metadata.world_min
            + Vec2::new(
                (x as f32 + 0.5) * self.metadata.cell_size.x,
                (z as f32 + 0.5) * self.metadata.cell_size.y,
            )
    }

    pub fn cell_for_world_position(&self, world_xz: Vec2) -> Option<UVec2> {
        let local = world_xz - self.metadata.world_min;
        if local.x < 0.0
            || local.y < 0.0
            || local.x >= self.metadata.world_size.x
            || local.y >= self.metadata.world_size.y
        {
            return None;
        }

        let x = (local.x / self.metadata.cell_size.x).floor() as usize;
        let z = (local.y / self.metadata.cell_size.y).floor() as usize;
        let max = self.metadata.resolution.saturating_sub(1);
        Some(UVec2::new(x.min(max) as u32, z.min(max) as u32))
    }

    pub fn sample_water_y_nearest(&self, world_xz: Vec2) -> Option<f32> {
        let cell = self.cell_for_world_position(world_xz)?;
        Some(self.water_y[self.index(cell.x as usize, cell.y as usize)])
    }

    pub fn sample_wet_mask_nearest(&self, world_xz: Vec2) -> Option<u8> {
        let cell = self.cell_for_world_position(world_xz)?;
        Some(self.wet_mask[self.index(cell.x as usize, cell.y as usize)])
    }

    pub fn sample_flow_nearest(&self, world_xz: Vec2) -> Option<Vec2> {
        let cell = self.cell_for_world_position(world_xz)?;
        Some(self.flow_dir_speed[self.index(cell.x as usize, cell.y as usize)])
    }
}
