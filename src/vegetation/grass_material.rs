use bevy::{
    prelude::*,
    pbr::{Material, MaterialPipeline, MaterialPipelineKey},
    render::render_resource::{AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError},
};
use bevy_mesh::MeshVertexBufferLayoutRef;
use bevy_shader::ShaderRef;

/// Uniform data for grass material - must match WGSL struct layout
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct GrassMaterialUniform {
    pub base_color: LinearRgba,
    pub tip_color: LinearRgba,
    pub wind_strength: f32,
    pub wind_speed: f32,
    pub wind_scale: f32,
    pub time: f32,
}

/// Custom grass material with wind animation
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
                wind_strength,
                wind_speed,
                wind_scale,
                time: 0.0,
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
                wind_strength: 0.3,
                wind_speed: 1.5,
                wind_scale: 0.1,
                time: 0.0,
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

    fn alpha_mode(&self) -> AlphaMode {
        // Render fully opaque to avoid looking like ground-projected shadows
        AlphaMode::Opaque
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

/// Resource to store handles to grass materials for updating time
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

/// Plugin to add grass material support
pub struct GrassMaterialPlugin;

impl Plugin for GrassMaterialPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(MaterialPlugin::<GrassMaterial>::default())
            .init_resource::<GrassMaterialHandles>()
            .add_systems(Update, update_grass_time);
    }
}
