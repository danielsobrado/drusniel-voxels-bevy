use bevy::prelude::*;
use bevy::pbr::ScreenSpaceAmbientOcclusionQualityLevel;
use serde::Deserialize;

#[derive(Resource, Deserialize, Clone)]
pub struct AmbientOcclusionConfig {
    pub ssao: SsaoConfig,
    pub gtao: Option<GtaoConfig>,
    pub baked: BakedAoConfig,
}

#[derive(Deserialize, Clone)]
pub struct GtaoConfig {
    pub enabled: bool,
    pub quality: String,
    pub slice_count: u32,
    pub steps_per_slice: u32,
    pub radius: f32,
    pub falloff_range: f32,
    pub final_value_power: f32,
    pub sample_distribution_power: f32,
    pub thin_occluder_compensation: f32,
    pub depth_mip_sampling_offset: f32,
    pub denoise: GtaoDenoiseConfig,
    pub bent_normals: bool,
    pub disable_on_integrated_gpu: bool,
}

#[derive(Deserialize, Clone)]
pub struct GtaoDenoiseConfig {
    pub enabled: bool,
    pub spatial_radius: u32,
    pub spatial_sigma: f32,
    pub temporal_blend: f32,
    pub depth_threshold: f32,
    pub normal_threshold: f32,
}

#[derive(Deserialize, Clone)]
pub struct SsaoConfig {
    pub enabled: bool,
    pub quality: String,
    pub constant_object_thickness: f32,
    pub disable_on_integrated_gpu: bool,
}

#[derive(Deserialize, Clone)]
pub struct BakedAoConfig {
    pub enabled: bool,
    pub strength: f32,
    pub corner_darkness: f32,
    pub fix_anisotropy: bool,
}

impl Default for AmbientOcclusionConfig {
    fn default() -> Self {
        Self {
            ssao: SsaoConfig {
                enabled: false, // Disabled when using GTAO
                quality: "High".to_string(),
                constant_object_thickness: 0.5,
                disable_on_integrated_gpu: true,
            },
            gtao: Some(GtaoConfig {
                enabled: true,
                quality: "High".to_string(),
                slice_count: 3,
                steps_per_slice: 3,
                radius: 2.5,
                falloff_range: 1.0,
                final_value_power: 2.0,
                sample_distribution_power: 2.0,
                thin_occluder_compensation: 0.0,
                depth_mip_sampling_offset: 1.0,
                denoise: GtaoDenoiseConfig {
                    enabled: true,
                    spatial_radius: 2,
                    spatial_sigma: 1.5,
                    temporal_blend: 0.95,
                    depth_threshold: 0.1,
                    normal_threshold: 0.3,
                },
                bent_normals: true,
                disable_on_integrated_gpu: true,
            }),
            baked: BakedAoConfig {
                enabled: true,
                strength: 0.8,
                corner_darkness: 0.6,
                fix_anisotropy: true,
            },
        }
    }
}

impl SsaoConfig {
    pub fn quality_level(&self) -> ScreenSpaceAmbientOcclusionQualityLevel {
        match self.quality.to_lowercase().as_str() {
            "low" => ScreenSpaceAmbientOcclusionQualityLevel::Low,
            "medium" => ScreenSpaceAmbientOcclusionQualityLevel::Medium,
            "high" => ScreenSpaceAmbientOcclusionQualityLevel::High,
            "ultra" => ScreenSpaceAmbientOcclusionQualityLevel::Ultra,
            _ => ScreenSpaceAmbientOcclusionQualityLevel::High,
        }
    }
}

pub fn load_ambient_occlusion_config() -> Result<AmbientOcclusionConfig, Box<dyn std::error::Error>> {
    // Try loading new GTAO config first, fall back to legacy SSAO config
    if let Ok(config_str) = std::fs::read_to_string("assets/config/gtao.yaml") {
        #[derive(Deserialize)]
        struct GtaoConfigFile {
            gtao: GtaoConfig,
            baked: BakedAoConfig,
        }
        
        let config_file: GtaoConfigFile = serde_yaml::from_str(&config_str)?;
        return Ok(AmbientOcclusionConfig {
            ssao: SsaoConfig {
                enabled: false,
                quality: "High".to_string(),
                constant_object_thickness: 0.5,
                disable_on_integrated_gpu: true,
            },
            gtao: Some(config_file.gtao),
            baked: config_file.baked,
        });
    }
    
    // Fall back to legacy SSAO config
    #[derive(Deserialize)]
    struct AoConfigFile {
        ambient_occlusion: AmbientOcclusionConfig,
    }

    let config_str = std::fs::read_to_string("assets/config/ambient_occlusion.yaml")?;
    let config_file: AoConfigFile = serde_yaml::from_str(&config_str)?;
    Ok(config_file.ambient_occlusion)
}
