use bevy::{
    prelude::*,
    pbr::OpaqueRendererMethod,
    render::render_resource::{AsBindGroup, ShaderType},
};
use bevy_shader::ShaderRef;

/// Props material uniform data - Medium PBR for RTX 40xx
/// Props warrant mid-tier treatment: albedo + normal + roughness + vertex AO
/// Texture samples per fragment: 9-12
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct PropsUniforms {
    /// Base color tint
    pub base_color: LinearRgba,
    /// World units per texture repeat
    pub tex_scale: f32,
    /// How sharply to blend between triplanar projections
    pub blend_sharpness: f32,
    /// Normal map intensity (1.0 = full strength)
    pub normal_intensity: f32,
    /// Uniform roughness fallback (used if no roughness map)
    pub default_roughness: f32,
}

impl Default for PropsUniforms {
    fn default() -> Self {
        Self {
            base_color: LinearRgba::WHITE,
            tex_scale: 1.0,
            blend_sharpness: 4.0,
            normal_intensity: 1.0,
            default_roughness: 0.8, // Default matte for wood props
        }
    }
}

/// Props material types
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum PropsMaterialType {
    #[default]
    Rock,
    Furniture,
    BarrelsCrates,
}

impl PropsMaterialType {
    /// Get default roughness for this prop type
    pub fn default_roughness(&self) -> f32 {
        match self {
            Self::Rock => 0.95,        // Very rough rock surface
            Self::Furniture => 0.75,   // Slightly polished wood
            Self::BarrelsCrates => 0.8, // Uniform rough wood
        }
    }

    /// Check if material uses roughness map
    pub fn uses_roughness_map(&self) -> bool {
        !matches!(self, Self::BarrelsCrates) // Barrels/crates use uniform roughness
    }
}

/// Medium PBR props material - 3-4 texture maps per material
/// Rocks: albedo + normal + roughness + vertex AO
/// Furniture: albedo + normal + roughness (vertex AO baked in Blender)
/// Barrels/Crates: albedo + normal only (uniform roughness)
#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct PropsMaterial {
    #[uniform(0)]
    pub uniforms: PropsUniforms,

    // Rock textures - full props PBR (minus metallic)
    #[texture(1)]
    #[sampler(2)]
    pub rock_albedo: Option<Handle<Image>>,
    #[texture(3)]
    pub rock_normal: Option<Handle<Image>>,
    #[texture(4)]
    pub rock_roughness: Option<Handle<Image>>,
    #[texture(5)]
    pub rock_ao: Option<Handle<Image>>,

    // Furniture textures - standard PBR (vertex AO baked)
    // #[texture(6)]
    // pub furniture_albedo: Option<Handle<Image>>,
    // #[texture(7)]
    // pub furniture_normal: Option<Handle<Image>>,
    // #[texture(8)]
    // pub furniture_roughness: Option<Handle<Image>>,

    // Barrel/crate textures - minimal (uniform roughness)
    // #[texture(9)]
    // pub crate_albedo: Option<Handle<Image>>,
    // #[texture(10)]
    // pub crate_normal: Option<Handle<Image>>,
}

impl Default for PropsMaterial {
    fn default() -> Self {
        Self {
            uniforms: PropsUniforms::default(),
            rock_albedo: None,
            rock_normal: None,
            rock_roughness: None,
            rock_ao: None,
            // furniture_albedo: None,
            // furniture_normal: None,
            // furniture_roughness: None,
            // crate_albedo: None,
            // crate_normal: None,
        }
    }
}

impl Material for PropsMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/props.wgsl".into()
    }

    fn prepass_fragment_shader() -> ShaderRef {
        ShaderRef::Default
    }

    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Opaque
    }

    fn opaque_render_method(&self) -> OpaqueRendererMethod {
        OpaqueRendererMethod::Forward
    }
}

/// Resource holding the props material handle
#[derive(Resource)]
pub struct PropsMaterialHandle {
    pub handle: Handle<PropsMaterial>,
}

/// Marker component for prop meshes that use props material
#[derive(Component)]
pub struct PropMesh {
    pub material_type: PropsMaterialType,
}
