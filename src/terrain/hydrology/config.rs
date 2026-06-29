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
    #[serde(default)]
    pub fill: HydrologyFillConfig,
    #[serde(default)]
    pub accumulation: HydrologyAccumulationConfig,
    #[serde(default)]
    pub rivers: HydrologyRiversConfig,
    #[serde(default)]
    pub water_surface: HydrologyWaterSurfaceConfig,
    #[serde(default)]
    pub moisture: HydrologyMoistureConfig,
    #[serde(default)]
    pub talus: HydrologyTalusConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HydrologyFillConfig {
    pub enabled: bool,
    pub iterations: usize,
    pub epsilon_per_cell: f32,
    pub lake_delta: f32,
    pub marsh_delta: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HydrologyAccumulationConfig {
    pub particles: usize,
    pub max_steps: usize,
    pub flat_gradient_stop: f32,
    pub inertia: f32,
    pub jitter_seed: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HydrologyRiversConfig {
    pub river_threshold_add: f32,
    pub visible_water_threshold_add: f32,
    pub widen_radius: usize,
    pub carve_depth_m: f32,
    pub carve_power: f32,
    pub visible_depth_m: f32,
    pub visible_depth_power: f32,
    pub slope_gate_start: f32,
    pub slope_gate_end: f32,
    pub min_visible_depth: f32,
    pub guarantee_fallback_rivers: bool,
    pub fallback_main_river: bool,
    pub fallback_tributaries: bool,
    pub flow_speed_multiplier: f32,
    pub lake_surface_drop_m: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HydrologyWaterSurfaceConfig {
    pub wet_smooth_iterations: usize,
    pub wet_to_wet_cliff_slope_max: f32,
    pub far_reduce_factor: usize,
    pub far_level_min_cell_size: f32,
    pub dry_sentinel_depth: f32,
    pub far_lake_dominance: f32,
    pub far_river_dominance: f32,
    pub far_wet_threshold: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HydrologyMoistureConfig {
    pub enabled: bool,
    pub blur_radius: usize,
    pub lake_source: f32,
    pub river_source: f32,
    pub marsh_source: f32,
    pub dry_decay: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HydrologyTalusConfig {
    pub enabled: bool,
    pub iterations: usize,
    pub strength: f32,
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
            fill: HydrologyFillConfig::default(),
            accumulation: HydrologyAccumulationConfig::default(),
            rivers: HydrologyRiversConfig::default(),
            water_surface: HydrologyWaterSurfaceConfig::default(),
            moisture: HydrologyMoistureConfig::default(),
            talus: HydrologyTalusConfig::default(),
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
            fill: self.fill.normalized(),
            accumulation: self.accumulation.normalized(),
            rivers: {
                let mut rivers = self.rivers.normalized();
                rivers.flow_speed_multiplier = self.river_flow_speed_scale.max(0.0);
                rivers
            },
            water_surface: {
                let mut water_surface = self.water_surface.normalized();
                water_surface.far_reduce_factor = self.far_reduce_factor.max(1);
                water_surface.dry_sentinel_depth = self.dry_sink_offset.max(0.0);
                water_surface.wet_smooth_iterations = self.wet_smooth_iterations;
                water_surface.wet_to_wet_cliff_slope_max = self.wet_cliff_gradient_max.max(0.0);
                water_surface
            },
            moisture: {
                let mut moisture = self.moisture.normalized();
                moisture.blur_radius = self.moisture_blur_radius;
                moisture
            },
            talus: self.talus.normalized(),
        }
    }
}

impl Default for HydrologyFillConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            iterations: 900,
            epsilon_per_cell: 0.0045,
            lake_delta: 2.2,
            marsh_delta: 0.15,
        }
    }
}

impl HydrologyFillConfig {
    fn normalized(&self) -> Self {
        Self {
            enabled: self.enabled,
            iterations: self.iterations,
            epsilon_per_cell: self.epsilon_per_cell.max(0.0),
            lake_delta: self.lake_delta.max(0.0),
            marsh_delta: self.marsh_delta.max(0.0),
        }
    }
}

impl Default for HydrologyAccumulationConfig {
    fn default() -> Self {
        Self {
            particles: 350_000,
            max_steps: 220,
            flat_gradient_stop: 0.012,
            inertia: 0.45,
            jitter_seed: 12345,
        }
    }
}

impl HydrologyAccumulationConfig {
    fn normalized(&self) -> Self {
        Self {
            particles: self.particles,
            max_steps: self.max_steps,
            flat_gradient_stop: self.flat_gradient_stop.max(0.0),
            inertia: self.inertia.clamp(0.0, 0.98),
            jitter_seed: self.jitter_seed,
        }
    }
}

impl Default for HydrologyRiversConfig {
    fn default() -> Self {
        Self {
            river_threshold_add: 14.0,
            visible_water_threshold_add: 320.0,
            widen_radius: 2,
            carve_depth_m: 7.5,
            carve_power: 1.35,
            visible_depth_m: 3.3,
            visible_depth_power: 2.2,
            slope_gate_start: 0.50,
            slope_gate_end: 0.24,
            min_visible_depth: 0.05,
            guarantee_fallback_rivers: true,
            fallback_main_river: true,
            fallback_tributaries: true,
            flow_speed_multiplier: 1.0,
            lake_surface_drop_m: 2.0,
        }
    }
}

impl HydrologyRiversConfig {
    fn normalized(&self) -> Self {
        Self {
            river_threshold_add: self.river_threshold_add.max(0.0),
            visible_water_threshold_add: self.visible_water_threshold_add.max(0.0),
            widen_radius: self.widen_radius,
            carve_depth_m: self.carve_depth_m.max(0.0),
            carve_power: self.carve_power.max(0.0),
            visible_depth_m: self.visible_depth_m.max(0.0),
            visible_depth_power: self.visible_depth_power.max(0.0),
            slope_gate_start: self.slope_gate_start.max(0.0),
            slope_gate_end: self.slope_gate_end.max(0.0),
            min_visible_depth: self.min_visible_depth.max(0.0),
            guarantee_fallback_rivers: self.guarantee_fallback_rivers,
            fallback_main_river: self.fallback_main_river,
            fallback_tributaries: self.fallback_tributaries,
            flow_speed_multiplier: self.flow_speed_multiplier.max(0.0),
            lake_surface_drop_m: self.lake_surface_drop_m.max(0.0),
        }
    }
}

impl Default for HydrologyWaterSurfaceConfig {
    fn default() -> Self {
        Self {
            wet_smooth_iterations: 2,
            wet_to_wet_cliff_slope_max: 0.35,
            far_reduce_factor: 8,
            far_level_min_cell_size: 12.0,
            dry_sentinel_depth: 2.0,
            far_lake_dominance: 0.4,
            far_river_dominance: 0.3,
            far_wet_threshold: 0.1,
        }
    }
}

impl HydrologyWaterSurfaceConfig {
    fn normalized(&self) -> Self {
        Self {
            wet_smooth_iterations: self.wet_smooth_iterations,
            wet_to_wet_cliff_slope_max: self.wet_to_wet_cliff_slope_max.max(0.0),
            far_reduce_factor: self.far_reduce_factor.max(1),
            far_level_min_cell_size: self.far_level_min_cell_size.max(0.0),
            dry_sentinel_depth: self.dry_sentinel_depth.max(0.0),
            far_lake_dominance: self.far_lake_dominance.clamp(0.0, 1.0),
            far_river_dominance: self.far_river_dominance.clamp(0.0, 1.0),
            far_wet_threshold: self.far_wet_threshold.clamp(0.0, 1.0),
        }
    }
}

impl Default for HydrologyMoistureConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            blur_radius: 4,
            lake_source: 1.0,
            river_source: 0.85,
            marsh_source: 0.65,
            dry_decay: 0.82,
        }
    }
}

impl HydrologyMoistureConfig {
    fn normalized(&self) -> Self {
        Self {
            enabled: self.enabled,
            blur_radius: self.blur_radius,
            lake_source: self.lake_source.clamp(0.0, 1.0),
            river_source: self.river_source.clamp(0.0, 1.0),
            marsh_source: self.marsh_source.clamp(0.0, 1.0),
            dry_decay: self.dry_decay.clamp(0.0, 1.0),
        }
    }
}

impl Default for HydrologyTalusConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            iterations: 8,
            strength: 0.12,
        }
    }
}

impl HydrologyTalusConfig {
    fn normalized(&self) -> Self {
        Self {
            enabled: self.enabled,
            iterations: self.iterations,
            strength: self.strength.max(0.0),
        }
    }
}
