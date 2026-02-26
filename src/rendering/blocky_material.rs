use bevy::{
    prelude::*,
    pbr::{MaterialPipeline, MaterialPipelineKey, OpaqueRendererMethod},
    render::render_resource::{AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError},
};
use bevy_mesh::MeshVertexBufferLayoutRef;
use bevy_shader::ShaderRef;

// Same structure as Triplanar for convenience, though we might not use all fields in Blocky
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct BlockyUniforms {
    pub base_color: LinearRgba,
    pub tex_scale: f32,
    pub blend_sharpness: f32,
    pub normal_intensity: f32,
    pub parallax_scale: f32,
}

impl Default for BlockyUniforms {
    fn default() -> Self {
        Self {
            base_color: LinearRgba::WHITE,
            tex_scale: 1.0,
            blend_sharpness: 1.0,
            normal_intensity: 1.0,
            parallax_scale: 0.0,
        }
    }
}

#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct BlockyMaterial {
    #[uniform(0)]
    pub uniforms: BlockyUniforms,

    #[texture(1, dimension = "2d_array")]
    #[sampler(2)]
    pub diffuse_texture: Option<Handle<Image>>,
    // Normal texture removed to fix binding conflict with Bevy's default vertex shader
    // Binding slot 3 conflicts with Bevy's internal PBR bindings
}

impl Material for BlockyMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/blocky_terrain.wgsl".into()
    }

    // Use Bevy's default vertex shader to avoid binding conflicts
    // The custom vertex shader was causing "Bindings for [3] conflict" errors

    fn prepass_fragment_shader() -> ShaderRef {
        ShaderRef::Default
    }

    fn enable_prepass() -> bool {
        false
    }

    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Opaque
    }

    fn opaque_render_method(&self) -> OpaqueRendererMethod {
        OpaqueRendererMethod::Forward
    }

    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        _layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

#[derive(Resource)]
pub struct BlockyMaterialHandle {
    pub handle: Handle<BlockyMaterial>,
}
