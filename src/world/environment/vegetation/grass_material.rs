use bevy::{
    diagnostic::FrameCount,
    pbr::{Material, MaterialPipeline, MaterialPipelineKey},
    prelude::*,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError,
    },
};
use bevy_mesh::MeshVertexBufferLayoutRef;
use bevy_shader::ShaderRef;

pub const VEGETATION_DEPTH_PREPASS_ENV: &str = "VOXEL_VEGETATION_DEPTH_PREPASS";

/// Uniform data for grass material - must match WGSL struct layout
/// Enhanced with contact shadow and SSS parameters
#[derive(Clone, Copy, ShaderType, Debug)]
#[repr(C)]
pub struct GrassMaterialUniform {
    pub base_color: LinearRgba,
    pub tip_color: LinearRgba,
    pub fog_color: LinearRgba,
    pub sun_direction: Vec4,

    pub wind_strength: f32,
    pub wind_speed: f32,
    pub wind_scale: f32,
    pub time: f32,
    pub fog_start: f32,
    pub fog_end: f32,
    pub aerial_strength: f32,
    pub sss_wrap: f32,
    pub sss_strength: f32,
    pub contact_shadow_strength: f32,
    pub grass_density: f32,
    pub shadow_length: f32,
    pub near_fade_start: f32,
    pub near_fade_end: f32,
    pub near_fade_min_alpha: f32,
    pub _padding: Vec4,
}

/// Runtime status for the opt-in vegetation camera depth prepass.
#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq)]
pub struct VegetationDepthPrepassConfig {
    pub enabled: bool,
}

impl VegetationDepthPrepassConfig {
    pub fn from_env() -> Self {
        Self::from_env_value(std::env::var(VEGETATION_DEPTH_PREPASS_ENV).ok().as_deref())
    }

    fn from_env_value(value: Option<&str>) -> Self {
        Self {
            enabled: value.map(env_flag_enabled).unwrap_or(false),
        }
    }

    pub fn status_label(&self) -> &'static str {
        if self.enabled { "on" } else { "off" }
    }
}

impl Default for VegetationDepthPrepassConfig {
    fn default() -> Self {
        Self::from_env()
    }
}

/// Custom grass material with wind animation and contact shadows
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
pub struct GrassMaterial {
    #[uniform(0)]
    pub uniform_data: GrassMaterialUniform,
}

impl GrassMaterial {
    pub fn new(
        base_color: LinearRgba,
        tip_color: LinearRgba,
        wind_strength: f32,
        wind_speed: f32,
        wind_scale: f32,
    ) -> Self {
        Self {
            uniform_data: GrassMaterialUniform {
                base_color,
                tip_color,
                fog_color: LinearRgba::new(0.7, 0.78, 0.88, 1.0),
                sun_direction: Vec4::new(0.3, 0.8, 0.4, 1.0),

                wind_strength,
                wind_speed,
                wind_scale,
                time: 0.0,
                fog_start: 80.0,
                fog_end: 220.0,
                aerial_strength: 1.0,
                sss_wrap: 0.5,
                sss_strength: 0.4,
                contact_shadow_strength: 0.7,
                grass_density: 0.6,
                shadow_length: 1.5,
                near_fade_start: 0.6,
                near_fade_end: 2.0,
                near_fade_min_alpha: 0.2,
                _padding: Vec4::ZERO,
            },
        }
    }

    /// Create a grass material with full customization
    pub fn with_settings(
        base_color: LinearRgba,
        tip_color: LinearRgba,
        wind_strength: f32,
        wind_speed: f32,
        wind_scale: f32,
        sss_wrap: f32,
        sss_strength: f32,
        contact_shadow_strength: f32,
    ) -> Self {
        Self {
            uniform_data: GrassMaterialUniform {
                base_color,
                tip_color,
                fog_color: LinearRgba::new(0.7, 0.78, 0.88, 1.0),
                sun_direction: Vec4::new(0.3, 0.8, 0.4, 1.0),

                wind_strength,
                wind_speed,
                wind_scale,
                time: 0.0,
                fog_start: 80.0,
                fog_end: 220.0,
                aerial_strength: 1.0,
                sss_wrap,
                sss_strength,
                contact_shadow_strength,
                grass_density: 0.6,
                shadow_length: 1.5,
                near_fade_start: 0.6,
                near_fade_end: 2.0,
                near_fade_min_alpha: 0.2,
                _padding: Vec4::ZERO,
            },
        }
    }
}

impl Default for GrassMaterial {
    fn default() -> Self {
        Self {
            uniform_data: GrassMaterialUniform {
                // Dark brown-green at base
                base_color: LinearRgba::new(0.2, 0.18, 0.08, 1.0),
                // Golden yellow at tip (Valheim style)
                tip_color: LinearRgba::new(0.95, 0.85, 0.45, 1.0),
                fog_color: LinearRgba::new(0.7, 0.78, 0.88, 1.0),
                sun_direction: Vec4::new(0.3, 0.8, 0.4, 1.0),

                wind_strength: 0.3,
                wind_speed: 1.5,
                wind_scale: 0.1,
                time: 0.0,
                fog_start: 80.0,
                fog_end: 220.0,
                aerial_strength: 1.0,
                sss_wrap: 0.5,
                sss_strength: 0.4,
                contact_shadow_strength: 0.7,
                grass_density: 0.6,
                shadow_length: 1.5,
                near_fade_start: 0.6,
                near_fade_end: 2.0,
                near_fade_min_alpha: 0.2,
                _padding: Vec4::ZERO,
            },
        }
    }
}

impl Material for GrassMaterial {
    fn vertex_shader() -> ShaderRef {
        "shaders/grass.wgsl".into()
    }

    fn fragment_shader() -> ShaderRef {
        "shaders/grass.wgsl".into()
    }

    fn enable_prepass() -> bool {
        vegetation_depth_prepass_enabled()
    }

    fn enable_shadows() -> bool {
        // Grass remains excluded from shadow-specialized material variants. The camera depth
        // prepass is opt-in and independent from shadow-map rendering.
        false
    }

    fn alpha_mode(&self) -> AlphaMode {
        // Use Mask with cutoff for hard edges - avoids see-through grass
        // Grass has procedural alpha masking in fragment shader
        AlphaMode::Mask(0.5)
    }

    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        _layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        // Disable backface culling - grass blades should be visible from both sides
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

pub fn vegetation_depth_prepass_enabled() -> bool {
    VegetationDepthPrepassConfig::from_env().enabled
}

fn env_flag_enabled(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on" | "enabled"
    )
}

/// Resource to store handles to grass materials for updating time and sun direction
#[derive(Resource, Default)]
pub struct GrassMaterialHandles {
    pub handles: Vec<Handle<GrassMaterial>>,
}

/// System to update time uniform in all grass materials
pub fn update_grass_time(
    time: Res<Time>,
    mut materials: ResMut<Assets<GrassMaterial>>,
    handles: Res<GrassMaterialHandles>,
) {
    let elapsed = time.elapsed_secs();

    for handle in &handles.handles {
        if let Some(material) = materials.get_mut(handle) {
            material.uniform_data.time = elapsed;
        }
    }
}

/// System to update sun direction in grass materials
/// Should be called when sun position changes
pub fn update_grass_sun_direction(
    mut materials: ResMut<Assets<GrassMaterial>>,
    handles: Res<GrassMaterialHandles>,
    sun_direction: Vec3,
    sun_intensity: f32,
) {
    for handle in &handles.handles {
        if let Some(material) = materials.get_mut(handle) {
            material.uniform_data.sun_direction = Vec4::new(
                sun_direction.x,
                sun_direction.y,
                sun_direction.z,
                sun_intensity,
            );
        }
    }
}

pub fn log_vegetation_depth_prepass_status(config: Res<VegetationDepthPrepassConfig>) {
    info!(
        "Vegetation depth prepass: {} ({}={})",
        config.status_label(),
        VEGETATION_DEPTH_PREPASS_ENV,
        if config.enabled { "1" } else { "0" }
    );
}

pub fn record_vegetation_depth_prepass_status(
    frame: Res<FrameCount>,
    config: Res<VegetationDepthPrepassConfig>,
    mut timing: ResMut<crate::performance::AreaTimingRecorder>,
) {
    let enabled = if config.enabled { 1.0 } else { 0.0 };
    timing.record_count(frame.0, "Vegetation Depth Prepass Enabled", enabled);
}

/// Plugin to add grass material support
pub struct GrassMaterialPlugin;

impl Plugin for GrassMaterialPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(MaterialPlugin::<GrassMaterial>::default())
            .init_resource::<GrassMaterialHandles>()
            .init_resource::<VegetationDepthPrepassConfig>()
            .add_systems(Startup, log_vegetation_depth_prepass_status)
            .add_systems(
                Update,
                (
                    update_grass_time,
                    sync_grass_with_gi,
                    record_vegetation_depth_prepass_status,
                ),
            );
    }
}

/// System to sync grass material settings with Adaptive GI configuration
pub fn sync_grass_with_gi(
    settings: Res<crate::rendering::AdaptiveGISettings>,
    mut materials: ResMut<Assets<GrassMaterial>>,
) {
    if settings.is_changed() {
        for (_, material) in materials.iter_mut() {
            let data = &mut material.uniform_data;
            if settings.contact_shadows_enabled && settings.grass_self_shadow {
                data.contact_shadow_strength = settings.grass_ao_strength;
                data.shadow_length = settings.contact_shadow_length;
                data.grass_density = settings.grass_density;
            } else {
                data.contact_shadow_strength = 0.0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{VegetationDepthPrepassConfig, env_flag_enabled};

    #[test]
    fn env_flag_enabled_accepts_explicit_true_values() {
        for value in ["1", "true", "TRUE", "yes", "on", "enabled"] {
            assert!(env_flag_enabled(value), "expected {value} to enable prepass");
        }
    }

    #[test]
    fn env_flag_enabled_rejects_default_and_false_values() {
        for value in ["", "0", "false", "off", "disabled", "maybe"] {
            assert!(!env_flag_enabled(value), "expected {value} to keep prepass disabled");
        }
    }

    #[test]
    fn depth_prepass_config_is_disabled_without_env_value() {
        let config = VegetationDepthPrepassConfig::from_env_value(None);
        assert!(!config.enabled);
        assert_eq!(config.status_label(), "off");
    }

    #[test]
    fn depth_prepass_config_uses_env_value() {
        let config = VegetationDepthPrepassConfig::from_env_value(Some("true"));
        assert!(config.enabled);
        assert_eq!(config.status_label(), "on");

        let config = VegetationDepthPrepassConfig::from_env_value(Some("false"));
        assert!(!config.enabled);
        assert_eq!(config.status_label(), "off");
    }
}
