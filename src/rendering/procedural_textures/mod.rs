pub mod cache;
pub mod config;
pub mod errors;
pub mod manifest;
pub mod noise_bake;
pub mod plugin;
pub mod recipes;
pub mod texture_images;

pub use plugin::{ProceduralTerrainTextureHandles, ProceduralTexturePlugin};

#[cfg(test)]
mod tests {
    #[test]
    fn triplanar_shader_imports_and_calls_procedural_material_common() {
        let shader = include_str!("../../../assets/shaders/triplanar_terrain.wgsl");

        assert!(shader.contains("procedural/terrain_material_common.wgsl"));
        assert!(shader.contains("sample_procedural_terrain_material"));
    }
}
