use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct VisualHydrologyConfig {
    pub enabled: bool,
    pub resolution: usize,
    pub far_reduce_factor: usize,
    pub dry_sink_offset: f32,
    pub wet_smooth_iterations: usize,
    pub wet_cliff_gradient_max: f32,
    pub moisture_blur_radius: usize,
    pub river_flow_min_slope: f32,
    pub river_flow_speed_scale: f32,
    pub debug_dump: bool,
}

impl Default for VisualHydrologyConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resolution: 512,
            far_reduce_factor: 8,
            dry_sink_offset: 2.0,
            wet_smooth_iterations: 2,
            wet_cliff_gradient_max: 0.35,
            moisture_blur_radius: 4,
            river_flow_min_slope: 0.002,
            river_flow_speed_scale: 1.0,
            debug_dump: false,
        }
    }
}

impl VisualHydrologyConfig {
    pub fn normalized(&self) -> Self {
        Self {
            enabled: self.enabled,
            resolution: self.resolution.max(1),
            far_reduce_factor: self.far_reduce_factor.max(1),
            dry_sink_offset: self.dry_sink_offset.max(0.0),
            wet_smooth_iterations: self.wet_smooth_iterations,
            wet_cliff_gradient_max: self.wet_cliff_gradient_max.max(0.0),
            moisture_blur_radius: self.moisture_blur_radius,
            river_flow_min_slope: self.river_flow_min_slope.max(0.0),
            river_flow_speed_scale: self.river_flow_speed_scale.max(0.0),
            debug_dump: self.debug_dump,
        }
    }
}
