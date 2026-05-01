use bevy::prelude::*;
use serde::Deserialize;

#[derive(Resource, Deserialize, Clone)]
pub struct CinematicConfig {
    pub depth_of_field: DofConfig,
    pub motion_blur: MotionBlurConfig,
    pub auto_focus: AutoFocusConfig,
}

#[derive(Deserialize, Clone)]
pub struct DofConfig {
    pub enabled: bool,
    pub mode: String,
    pub focal_distance: f32,
    pub aperture_f_stops: f32,
    pub max_blur_radius: f32,
    pub max_coc_diameter: f32,
}

#[derive(Deserialize, Clone)]
pub struct MotionBlurConfig {
    pub enabled: bool,
    pub shutter_angle: f32,
    pub samples: u32,
}

#[derive(Deserialize, Clone)]
pub struct AutoFocusConfig {
    pub enabled: bool,
    pub raycast_distance: f32,
    pub lerp_speed: f32,
}

impl Default for CinematicConfig {
    fn default() -> Self {
        Self {
            depth_of_field: DofConfig {
                enabled: true,
                mode: "Bokeh".to_string(),
                focal_distance: 10.0,
                aperture_f_stops: 2.8,
                max_blur_radius: 16.0,
                max_coc_diameter: 64.0,
            },
            motion_blur: MotionBlurConfig {
                enabled: true,
                shutter_angle: 0.5,
                samples: 3,
            },
            auto_focus: AutoFocusConfig {
                enabled: false,
                raycast_distance: 100.0,
                lerp_speed: 3.0,
            },
        }
    }
}

impl DofConfig {
    pub fn mode(&self) -> bevy::post_process::dof::DepthOfFieldMode {
        use bevy::post_process::dof::DepthOfFieldMode;

        match self.mode.to_lowercase().as_str() {
            "gaussian" => DepthOfFieldMode::Gaussian,
            "bokeh" => DepthOfFieldMode::Bokeh,
            _ => {
                #[cfg(target_arch = "wasm32")]
                {
                    DepthOfFieldMode::Gaussian
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    DepthOfFieldMode::Bokeh
                }
            }
        }
    }
}
