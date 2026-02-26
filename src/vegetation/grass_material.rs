use bevy::{
    prelude::*,
    pbr::{Material, MaterialPipeline, MaterialPipelineKey},
    render::render_resource::{AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError},
};
use bevy_mesh::MeshVertexBufferLayoutRef;
use bevy_shader::ShaderRef;

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

/// Custom grass material with wind animation and contact shadows
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
pub struct GrassMaterial {
    #[uniform(0)]
    pub uniform_data: GrassMaterialUniform,
}

impl GrassMaterial {
    pub fn new(base_color: LinearRgba, tip_color: LinearRgba, wind_strength: f32, wind_speed: f32, wind_scale: f32) -> Self {
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

    fn prepass_vertex_shader() -> ShaderRef {
        "shaders/grass_prepass.wgsl".into()
    }

    fn prepass_fragment_shader() -> ShaderRef {
        "shaders/grass_prepass.wgsl".into()
    }

    fn enable_prepass() -> bool {
        // Bevy 0.18 prepass variants currently mismatch this custom alpha-cutout pipeline.
        // Keep prepass disabled until the shader IO is fully migrated.
        false
    }

    fn enable_shadows() -> bool {
        // Matches the temporary prepass disable above to avoid shadow-prepass specialization panics.
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

/// Plugin to add grass material support
pub struct GrassMaterialPlugin;

impl Plugin for GrassMaterialPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(MaterialPlugin::<GrassMaterial>::default())
            .init_resource::<GrassMaterialHandles>()
            .add_systems(Update, (update_grass_time, sync_grass_with_gi));
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
