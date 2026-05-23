use bevy::{
    pbr::{MaterialPipeline, MaterialPipelineKey, OpaqueRendererMethod},
    prelude::*,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError,
    },
};
use bevy_mesh::MeshVertexBufferLayoutRef;
use bevy_shader::ShaderRef;

/// All triplanar material uniforms in a single struct for proper GPU alignment
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct TriplanarUniforms {
    /// Base color tint (vec4)
    pub base_color: LinearRgba,
    /// World units per texture repeat (lower = higher resolution, e.g., 2.0)
    pub tex_scale: f32,
    /// How sharply to blend between projections (higher = sharper transitions)
    pub blend_sharpness: f32,
    /// Normal map intensity (1.0 = full strength)
    pub normal_intensity: f32,
    /// Parallax depth scale for displacement
    pub parallax_scale: f32,
    /// Baked ambient occlusion strength (0.0 = V0.3 look, 1.0 = full AO)
    pub ao_strength: f32,
    pub rain_factor: f32,
    pub wetness: f32,
    pub in_rainy: f32,
    pub snow_factor: f32,
    pub in_snowy: f32,
    pub puddle_strength: f32,
    pub puddle_noise_scale: f32,
    pub puddle_normal_strength: f32,
    pub snow_tint_strength: f32,
    pub weather_time: f32,
    pub weather_flags: u32,
}

/// High byte of `weather_flags` stores chunk LOD (0–3) for debug wireframe tinting.
pub const TRIPLANAR_DEBUG_LOD_FLAG_SHIFT: u32 = 24;
pub const TRIPLANAR_DEBUG_LOD_FLAG_MASK: u32 = 0xFF << TRIPLANAR_DEBUG_LOD_FLAG_SHIFT;

pub fn triplanar_weather_flags_with_debug_lod(flags: u32, lod_index: u8) -> u32 {
    (flags & !TRIPLANAR_DEBUG_LOD_FLAG_MASK)
        | ((lod_index as u32 & 0xFF) << TRIPLANAR_DEBUG_LOD_FLAG_SHIFT)
}

/// Volume bounds for the terrain iso-band debug overlay. `epsilon <= 0` disables the overlay.
#[derive(Clone, Copy, ShaderType, Debug, Default)]
pub struct TerrainIsoBandUniforms {
    pub world_min: Vec3,
    pub _pad0: f32,
    pub inv_extent: Vec3,
    pub epsilon: f32,
    pub mismatch_threshold: f32,
    pub _pad1: f32,
    pub _pad2: f32,
    pub _pad3: f32,
}

impl Default for TriplanarUniforms {
    fn default() -> Self {
        Self {
            // Warm tint for natural V0.3-like terrain colors (slightly golden/peachy)
            base_color: LinearRgba::new(1.0, 0.97, 0.92, 1.0),
            tex_scale: 2.0,
            blend_sharpness: 4.0,
            normal_intensity: 1.0,
            parallax_scale: 0.04,
            ao_strength: 0.0, // Default to V0.3 look (no baked AO)
            rain_factor: 0.0,
            wetness: 0.0,
            in_rainy: 0.0,
            snow_factor: 0.0,
            in_snowy: 0.0,
            puddle_strength: 0.0,
            puddle_noise_scale: 0.085,
            puddle_normal_strength: 0.0,
            snow_tint_strength: 0.0,
            weather_time: 0.0,
            weather_flags: 0,
        }
    }
}

/// Custom triplanar PBR terrain material with multiple terrain types
#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
#[bind_group_data(TriplanarMaterialKey)]
pub struct TriplanarMaterial {
    #[uniform(0)]
    pub uniforms: TriplanarUniforms,

    pub quality: TerrainMaterialQuality,

    // Grass textures (mat 0)
    #[texture(1)]
    #[sampler(2)]
    pub grass_albedo: Option<Handle<Image>>,
    #[texture(3)]
    pub grass_normal: Option<Handle<Image>>,

    // Rock textures (mat 1)
    #[texture(4)]
    pub rock_albedo: Option<Handle<Image>>,
    #[texture(5)]
    pub rock_normal: Option<Handle<Image>>,

    // Sand textures (mat 2)
    #[texture(6)]
    pub sand_albedo: Option<Handle<Image>>,
    #[texture(7)]
    pub sand_normal: Option<Handle<Image>>,

    // Dirt textures (mat 3)
    #[texture(8)]
    pub dirt_albedo: Option<Handle<Image>>,
    #[texture(9)]
    pub dirt_normal: Option<Handle<Image>>,

    /// Mesher SDF brick for iso-band debug (`epsilon <= 0` disables sampling in shader).
    #[texture(10)]
    #[sampler(11)]
    pub iso_band_volume: Option<Handle<Image>>,

    #[uniform(12)]
    pub iso_band_params: TerrainIsoBandUniforms,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, Hash, PartialEq, Eq)]
pub enum TerrainMaterialQuality {
    #[default]
    FullTriplanar,
    CheapTriplanar,
    SingleProjectionFar,
    AtlasOnlyDebug,
    WireframeDebug,
    NormalsDebug,
    WireframeNormalsDebug,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct TriplanarMaterialKey {
    quality: TerrainMaterialQuality,
}

impl From<&TriplanarMaterial> for TriplanarMaterialKey {
    fn from(material: &TriplanarMaterial) -> Self {
        Self {
            quality: material.quality,
        }
    }
}

impl Default for TriplanarMaterial {
    fn default() -> Self {
        Self {
            uniforms: TriplanarUniforms::default(),
            quality: TerrainMaterialQuality::FullTriplanar,
            grass_albedo: None,
            grass_normal: None,
            rock_albedo: None,
            rock_normal: None,
            sand_albedo: None,
            sand_normal: None,
            dirt_albedo: None,
            dirt_normal: None,
            iso_band_volume: None,
            iso_band_params: TerrainIsoBandUniforms::default(),
        }
    }
}

impl Material for TriplanarMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/triplanar_terrain.wgsl".into()
    }

    fn prepass_fragment_shader() -> ShaderRef {
        ShaderRef::Default
    }

    fn enable_prepass() -> bool {
        true
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
        // Disable backface culling to match v0.3 behavior
        descriptor.primitive.cull_mode = None;
        if let Some(fragment) = descriptor.fragment.as_mut() {
            match _key.bind_group_data.quality {
                TerrainMaterialQuality::FullTriplanar => {}
                TerrainMaterialQuality::CheapTriplanar => {
                    fragment.shader_defs.push("TERRAIN_CHEAP_TRIPLANAR".into());
                }
                TerrainMaterialQuality::SingleProjectionFar => {
                    fragment
                        .shader_defs
                        .push("TERRAIN_SINGLE_PROJECTION_FAR".into());
                }
                TerrainMaterialQuality::AtlasOnlyDebug => {
                    fragment.shader_defs.push("TERRAIN_ATLAS_ONLY_DEBUG".into());
                }
                TerrainMaterialQuality::WireframeDebug => {
                    fragment.shader_defs.push("TERRAIN_DEBUG_WIREFRAME".into());
                }
                TerrainMaterialQuality::NormalsDebug => {
                    fragment.shader_defs.push("TERRAIN_DEBUG_NORMALS".into());
                }
                TerrainMaterialQuality::WireframeNormalsDebug => {
                    fragment.shader_defs.push("TERRAIN_DEBUG_WIREFRAME".into());
                    fragment.shader_defs.push("TERRAIN_DEBUG_NORMALS".into());
                }
            }
        }
        Ok(())
    }
}

/// Resource holding the triplanar terrain material handle
#[derive(Resource)]
pub struct TriplanarMaterialHandle {
    pub handle: Handle<TriplanarMaterial>,
    pub cheap_handle: Handle<TriplanarMaterial>,
    pub single_projection_far_handle: Handle<TriplanarMaterial>,
    pub atlas_only_debug_handle: Handle<TriplanarMaterial>,
    pub wireframe_debug_handle: Handle<TriplanarMaterial>,
    pub normals_debug_handle: Handle<TriplanarMaterial>,
    pub wireframe_normals_debug_handle: Handle<TriplanarMaterial>,
}

impl TriplanarMaterialHandle {
    pub fn handle_for_quality(&self, quality: TerrainMaterialQuality) -> Handle<TriplanarMaterial> {
        match quality {
            TerrainMaterialQuality::FullTriplanar => self.handle.clone(),
            TerrainMaterialQuality::CheapTriplanar => self.cheap_handle.clone(),
            TerrainMaterialQuality::SingleProjectionFar => {
                self.single_projection_far_handle.clone()
            }
            TerrainMaterialQuality::AtlasOnlyDebug => self.atlas_only_debug_handle.clone(),
            TerrainMaterialQuality::WireframeDebug => self.wireframe_debug_handle.clone(),
            TerrainMaterialQuality::NormalsDebug => self.normals_debug_handle.clone(),
            TerrainMaterialQuality::WireframeNormalsDebug => {
                self.wireframe_normals_debug_handle.clone()
            }
        }
    }
}
