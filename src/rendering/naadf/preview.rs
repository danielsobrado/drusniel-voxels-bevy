use bevy::prelude::*;

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct NaadfPreviewSettings {
    pub max_ray_steps: u32,
    pub bounce_count: u32,
    pub accumulation_enabled: bool,
}

impl Default for NaadfPreviewSettings {
    fn default() -> Self {
        Self {
            max_ray_steps: 256,
            bounce_count: 1,
            accumulation_enabled: false,
        }
    }
}
