pub mod bark_synth;
pub mod cache;
pub mod config;
pub mod errors;
pub mod manifest;
pub mod noise_bake;
pub mod plugin;
pub mod recipes;
pub mod seed_streams;
pub mod texture_images;

pub use plugin::{
    ProceduralBarkTextureHandle, ProceduralBarkTextureHandles, ProceduralTerrainTextureHandles,
    ProceduralTexturePlugin,
};

#[cfg(test)]
mod tests {
    #[test]
    fn triplanar_shader_imports_and_calls_procedural_material_common() {
        let shader = include_str!("../../../assets/shaders/triplanar_terrain.wgsl");
        let common =
            include_str!("../../../assets/shaders/procedural/terrain_material_common.wgsl");

        assert!(shader.contains("procedural/terrain_material_common.wgsl"));
        assert!(shader.contains("sample_procedural_terrain_material"));
        assert!(shader.contains("procedural_snow_mask"));
        assert!(shader.contains("procedural_material_roughness"));
        assert!(common.contains("snow_mask_params"));
        assert!(!common.contains("smoothstep(76.0, 130.0"));
    }
}
