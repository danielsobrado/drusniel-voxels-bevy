use crate::voxel::meshing_types::ATTRIBUTE_MORPH_TARGET;
use bevy::{
    pbr::{MaterialPipeline, MaterialPipelineKey, OpaqueRendererMethod},
    prelude::*,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError,
    },
};
use bevy_mesh::MeshVertexBufferLayoutRef;
use bevy_shader::ShaderRef;

/// Whether the GPU terrain geomorph gate is on (env `VOXELS_TERRAIN_MORPH`, read
/// once and cached). When off — the default — `TriplanarMaterial` keeps Bevy's stock
/// vertex/prepass shaders and the render path is byte-identical to pre-geomorph.
fn morph_gate_enabled() -> bool {
    crate::voxel::meshing::terrain_morph_config().enabled
}

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

/// Hex-tiling uniforms for terrain albedo/normal polish (shader-only).
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct HexTilingUniform {
    pub enabled: u32,
    pub normal_enabled: u32,
    pub rotation_strength: f32,
    pub color_border_contrast: f32,
    pub normal_border_contrast: f32,
    pub near_distance: f32,
    pub mid_distance: f32,
}

impl Default for HexTilingUniform {
    fn default() -> Self {
        Self {
            enabled: 0,
            normal_enabled: 0,
            rotation_strength: 1.0,
            color_border_contrast: 0.55,
            normal_border_contrast: 0.50,
            near_distance: 96.0,
            mid_distance: 160.0,
        }
    }
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
    /// Pipeline specialization flag: compile the hex-tiling shader branch.
    pub hex_tiling_shader_enabled: bool,

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
    /// Must be `dimension = "3d"` because the shader binding declares
    /// `texture_3d<f32>` (see `assets/shaders/triplanar_terrain.wgsl:287`).
    /// Without this, Bevy's `AsBindGroup` derives a 2D binding descriptor and
    /// `Device::create_bind_group` panics with "given a view with dimension = D3".
    #[texture(10, dimension = "3d")]
    #[sampler(11)]
    pub iso_band_volume: Option<Handle<Image>>,

    #[uniform(12)]
    pub iso_band_params: TerrainIsoBandUniforms,

    #[uniform(13)]
    pub hex_tiling: HexTilingUniform,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, Hash, PartialEq, Eq)]
pub enum TerrainMaterialQuality {
    #[default]
    FullTriplanar,
    CheapTriplanar,
    SingleProjectionFar,
    HorizonProxy,
    AtlasOnlyDebug,
    WireframeDebug,
    NormalsDebug,
    WireframeNormalsDebug,
    FlatUnlitDebug,
    WireframeFlatUnlitDebug,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct TriplanarMaterialKey {
    quality: TerrainMaterialQuality,
    hex_tiling_shader_enabled: bool,
}

impl From<&TriplanarMaterial> for TriplanarMaterialKey {
    fn from(material: &TriplanarMaterial) -> Self {
        Self {
            quality: material.quality,
            hex_tiling_shader_enabled: material.hex_tiling_shader_enabled,
        }
    }
}

impl Default for TriplanarMaterial {
    fn default() -> Self {
        Self {
            uniforms: TriplanarUniforms::default(),
            quality: TerrainMaterialQuality::FullTriplanar,
            hex_tiling_shader_enabled: false,
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
            hex_tiling: HexTilingUniform::default(),
        }
    }
}

impl Material for TriplanarMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/triplanar_terrain.wgsl".into()
    }

    fn vertex_shader() -> ShaderRef {
        // Custom vertex stage only when the geomorph gate is on; otherwise keep the
        // stock mesh vertex shader so default terrain is unaffected (and so the morph
        // vertex layout below is never required of meshes that lack the attribute).
        if morph_gate_enabled() {
            "shaders/triplanar_terrain_vertex.wgsl".into()
        } else {
            ShaderRef::Default
        }
    }

    fn prepass_vertex_shader() -> ShaderRef {
        // The prepass DOES call `Material::specialize` (prepass/mod.rs:357), so we can
        // bind the morph attribute there too (see `specialize`), and we apply the same
        // static weld in the prepass — otherwise the un-morphed prepass depth would
        // fight the morphed forward pass (reverse-z `GreaterEqual`) and re-open seams.
        if morph_gate_enabled() {
            "shaders/triplanar_terrain_vertex.wgsl".into()
        } else {
            ShaderRef::Default
        }
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
        layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        // Disable backface culling to match v0.3 behavior
        descriptor.primitive.cull_mode = None;

        // GPU geomorph: when the gate is on AND this mesh carries the morph attribute
        // (SN terrain — MC chunks omit it; gate-on requires mc_transvoxel off), feed
        // ATTRIBUTE_MORPH_TARGET to the custom vertex shader at @location(8). This
        // `specialize` runs for BOTH the forward (`opaque_mesh_pipeline`) and the
        // prepass (`prepass_pipeline`) pipelines, and `forward_io::Vertex` and
        // `prepass_io::Vertex` use DIFFERENT location schemes — so the base layout must
        // be branched by pipeline, or the prepass loses an attribute it reads.
        // Untouched when the gate is off, so the default path is byte-identical.
        if morph_gate_enabled() && layout.0.contains(ATTRIBUTE_MORPH_TARGET.id) {
            let is_prepass = descriptor.label.as_deref() == Some("prepass_pipeline");
            descriptor.vertex.buffers[0] = if is_prepass {
                // prepass_io::Vertex: uv@1, uv_b@2, normal@3, color@7 (normal harmless
                // when the normal prepass is off — extra buffer attrs are ignored).
                layout.0.get_layout(&[
                    Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
                    Mesh::ATTRIBUTE_UV_0.at_shader_location(1),
                    Mesh::ATTRIBUTE_UV_1.at_shader_location(2),
                    Mesh::ATTRIBUTE_NORMAL.at_shader_location(3),
                    Mesh::ATTRIBUTE_COLOR.at_shader_location(7),
                    ATTRIBUTE_MORPH_TARGET.at_shader_location(8),
                ])?
            } else {
                // forward_io::Vertex: normal@1, uv@2, uv_b@3, color@5.
                layout.0.get_layout(&[
                    Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
                    Mesh::ATTRIBUTE_NORMAL.at_shader_location(1),
                    Mesh::ATTRIBUTE_UV_0.at_shader_location(2),
                    Mesh::ATTRIBUTE_UV_1.at_shader_location(3),
                    Mesh::ATTRIBUTE_COLOR.at_shader_location(5),
                    ATTRIBUTE_MORPH_TARGET.at_shader_location(8),
                ])?
            };
        }

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
                TerrainMaterialQuality::HorizonProxy => {
                    fragment.shader_defs.push("TERRAIN_HORIZON_PROXY".into());
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
                TerrainMaterialQuality::FlatUnlitDebug => {
                    fragment.shader_defs.push("TERRAIN_DEBUG_FLAT_UNLIT".into());
                }
                TerrainMaterialQuality::WireframeFlatUnlitDebug => {
                    fragment.shader_defs.push("TERRAIN_DEBUG_WIREFRAME".into());
                    fragment.shader_defs.push("TERRAIN_DEBUG_FLAT_UNLIT".into());
                }
            }
            if _key.bind_group_data.hex_tiling_shader_enabled {
                fragment.shader_defs.push("TERRAIN_HEX_TILING".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_tiling_uniform_defaults_match_config() {
        let uniform = HexTilingUniform::default();
        assert_eq!(uniform.enabled, 0);
        assert_eq!(uniform.normal_enabled, 0);
        assert_eq!(uniform.rotation_strength, 1.0);
        assert_eq!(uniform.color_border_contrast, 0.55);
        assert_eq!(uniform.normal_border_contrast, 0.50);
        assert_eq!(uniform.near_distance, 96.0);
        assert_eq!(uniform.mid_distance, 160.0);
    }

    #[test]
    fn triplanar_shader_references_hex_tiling_module() {
        let source = include_str!("../../../assets/shaders/triplanar_terrain.wgsl");
        assert!(source.contains("terrain/hextile.wgsl"));
        assert!(source.contains("terrain/surfgrad.wgsl"));
    }
}

/// Resource holding the triplanar terrain material handle
#[derive(Resource)]
pub struct TriplanarMaterialHandle {
    pub handle: Handle<TriplanarMaterial>,
    pub cheap_handle: Handle<TriplanarMaterial>,
    pub single_projection_far_handle: Handle<TriplanarMaterial>,
    pub horizon_proxy_handle: Handle<TriplanarMaterial>,
    pub atlas_only_debug_handle: Handle<TriplanarMaterial>,
    pub wireframe_debug_handle: Handle<TriplanarMaterial>,
    pub normals_debug_handle: Handle<TriplanarMaterial>,
    pub wireframe_normals_debug_handle: Handle<TriplanarMaterial>,
    pub flat_unlit_debug_handle: Handle<TriplanarMaterial>,
    pub wireframe_flat_unlit_debug_handle: Handle<TriplanarMaterial>,
}

impl TriplanarMaterialHandle {
    pub fn handle_for_quality(&self, quality: TerrainMaterialQuality) -> Handle<TriplanarMaterial> {
        match quality {
            TerrainMaterialQuality::FullTriplanar => self.handle.clone(),
            TerrainMaterialQuality::CheapTriplanar => self.cheap_handle.clone(),
            TerrainMaterialQuality::SingleProjectionFar => {
                self.single_projection_far_handle.clone()
            }
            TerrainMaterialQuality::HorizonProxy => self.horizon_proxy_handle.clone(),
            TerrainMaterialQuality::AtlasOnlyDebug => self.atlas_only_debug_handle.clone(),
            TerrainMaterialQuality::WireframeDebug => self.wireframe_debug_handle.clone(),
            TerrainMaterialQuality::NormalsDebug => self.normals_debug_handle.clone(),
            TerrainMaterialQuality::WireframeNormalsDebug => {
                self.wireframe_normals_debug_handle.clone()
            }
            TerrainMaterialQuality::FlatUnlitDebug => self.flat_unlit_debug_handle.clone(),
            TerrainMaterialQuality::WireframeFlatUnlitDebug => {
                self.wireframe_flat_unlit_debug_handle.clone()
            }
        }
    }
}
