use bevy::{
    prelude::*,
    pbr::OpaqueRendererMethod,
    render::render_resource::{AsBindGroup, ShaderType},
};
use bevy_shader::ShaderRef;

/// Building material uniform data - Full PBR for RTX 40xx
/// Buildings deserve the most detail - players examine them closely when building
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct BuildingUniforms {
    /// Base color tint
    pub base_color: LinearRgba,
    /// World units per texture repeat (1024px textures, lower = higher detail)
    pub tex_scale: f32,
    /// How sharply to blend between triplanar projections
    pub blend_sharpness: f32,
    /// Normal map intensity (1.0 = full strength)
    pub normal_intensity: f32,
    /// Parallax depth scale (0.03-0.05 for buildings)
    pub parallax_scale: f32,
    /// Number of parallax iterations (4-8 for quality)
    pub parallax_steps: u32,
}

impl Default for BuildingUniforms {
    fn default() -> Self {
        Self {
            base_color: LinearRgba::WHITE,
            tex_scale: 1.0,       // 1 tile per world unit for building detail
            blend_sharpness: 8.0, // Sharp transitions for buildings
            normal_intensity: 1.0,
            parallax_scale: 0.04, // Subtle depth for wood/stone
            parallax_steps: 6,    // Balanced quality/performance
        }
    }
}

/// Building material types with per-material configuration
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum BuildingMaterialType {
    #[default]
    WoodPlank,
    StoneBrick,
    MetalPlate,
    Thatch,
}

impl BuildingMaterialType {
    /// Get parallax scale for this material type
    pub fn parallax_scale(&self) -> f32 {
        match self {
            Self::WoodPlank => 0.03,   // Subtle wood grain depth
            Self::StoneBrick => 0.05, // More pronounced stone depth
            Self::MetalPlate => 0.02, // Minimal for smooth metal
            Self::Thatch => 0.04,     // Moderate for straw texture
        }
    }

    /// Check if material needs metallic map
    pub fn uses_metallic(&self) -> bool {
        matches!(self, Self::MetalPlate)
    }
}

/// Full PBR building material - 5 texture maps + parallax
/// Texture samples per fragment: 15-18 (RTX 40xx handles this trivially)
#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct BuildingMaterial {
    #[uniform(0)]
    pub uniforms: BuildingUniforms,

    // Wood plank textures (material 0) - Full PBR
    #[texture(1)]
    #[sampler(2)]
    pub wood_albedo: Option<Handle<Image>>,
    #[texture(3)]
    pub wood_normal: Option<Handle<Image>>,
    #[texture(4)]
    pub wood_roughness: Option<Handle<Image>>,
    #[texture(5)]
    pub wood_ao: Option<Handle<Image>>,

    // Stone brick textures (material 1) - Full PBR
    // #[texture(6)]
    // pub stone_albedo: Option<Handle<Image>>,
    // #[texture(7)]
    // pub stone_normal: Option<Handle<Image>>,
    // #[texture(8)]
    // pub stone_roughness: Option<Handle<Image>>,
    // #[texture(9)]
    // pub stone_ao: Option<Handle<Image>>,

    // Metal plate textures (material 2) - Full PBR + Metallic
    // #[texture(10)]
    // pub metal_albedo: Option<Handle<Image>>,
    // #[texture(11)]
    // pub metal_normal: Option<Handle<Image>>,
    // #[texture(12)]
    // pub metal_roughness: Option<Handle<Image>>,
    // #[texture(13)]
    // pub metal_ao: Option<Handle<Image>>,
    // #[texture(14)]
    // pub metal_metallic: Option<Handle<Image>>,

    // Thatch textures (material 3) - Full PBR
    // #[texture(15)]
    // pub thatch_albedo: Option<Handle<Image>>,
    // #[texture(16)]
    // pub thatch_normal: Option<Handle<Image>>,
    // #[texture(17)]
    // pub thatch_roughness: Option<Handle<Image>>,
    // #[texture(18)]
    // pub thatch_ao: Option<Handle<Image>>,
}

impl Default for BuildingMaterial {
    fn default() -> Self {
        Self {
            uniforms: BuildingUniforms::default(),
            wood_albedo: None,
            wood_normal: None,
            wood_roughness: None,
            wood_ao: None,
            // stone_albedo: None,
            // stone_normal: None,
            // stone_roughness: None,
            // stone_ao: None,
            // metal_albedo: None,
            // metal_normal: None,
            // metal_roughness: None,
            // metal_ao: None,
            // metal_metallic: None,
            // thatch_albedo: None,
            // thatch_normal: None,
            // thatch_roughness: None,
            // thatch_ao: None,
        }
    }
}

impl Material for BuildingMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/building.wgsl".into()
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

/// Resource holding the building material handle
#[derive(Resource)]
pub struct BuildingMaterialHandle {
    pub handle: Handle<BuildingMaterial>,
}

/// Marker component for building meshes that use building material
#[derive(Component)]
pub struct BuildingMesh {
    pub material_type: BuildingMaterialType,
}
