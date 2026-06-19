use super::errors::ProceduralTextureError;
use super::recipes::{ProceduralMaterialId, ProceduralMaterialRecipe};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const DEFAULT_PROCEDURAL_TEXTURE_CONFIG_PATH: &str = "assets/config/procedural_textures.yaml";

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProceduralTextureRuntimeMode {
    CacheOnly,
    #[default]
    GenerateIfMissing,
    ForceRegenerate,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProceduralTextureConfig {
    #[serde(default = "default_procedural_textures_enabled")]
    pub enabled: bool,
    #[serde(default = "default_seed")]
    pub seed: u32,
    #[serde(default)]
    pub runtime_mode: ProceduralTextureRuntimeMode,
    #[serde(default = "default_cache_dir")]
    pub cache_dir: String,
    #[serde(default)]
    pub noise: NoiseBakeConfig,
    #[serde(default)]
    pub terrain: TerrainTextureConfig,
    #[serde(default = "default_terrain_material_quality")]
    pub terrain_material_quality: BTreeMap<String, TerrainMaterialQualityTier>,
    #[serde(default)]
    pub debug: ProceduralTextureDebugConfig,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct NoiseBakeConfig {
    #[serde(default = "default_resolution")]
    pub resolution: u32,
    #[serde(default)]
    pub periods: NoiseBakePeriods,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct NoiseBakePeriods {
    pub value: f32,
    pub fbm: f32,
    pub ridged: f32,
    pub worley: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TerrainTextureConfig {
    #[serde(default = "default_resolution")]
    pub layer_resolution: u32,
    #[serde(default = "default_macro_variation")]
    pub macro_variation_m: [f32; 2],
    #[serde(default = "default_meso_variation")]
    pub meso_variation_m: [f32; 2],
    #[serde(default = "default_micro_variation")]
    pub micro_variation_m: [f32; 2],
    #[serde(default)]
    pub micro_normal: MicroNormalConfig,
    #[serde(default = "default_material_order")]
    pub material_order: Vec<ProceduralMaterialId>,
    #[serde(default = "default_material_recipes")]
    pub materials: BTreeMap<ProceduralMaterialId, ProceduralMaterialRecipe>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct MicroNormalConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_micro_fade_start")]
    pub fade_start_m: f32,
    #[serde(default = "default_micro_fade_end")]
    pub fade_end_m: f32,
    #[serde(default = "default_micro_max_strength")]
    pub max_strength: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TerrainMaterialQualityTier {
    pub max_noise_fetches: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProceduralTextureDebugConfig {
    #[serde(default = "default_debug_mode")]
    pub mode: String,
}

#[derive(Deserialize)]
struct ProceduralTextureConfigFile {
    #[serde(default)]
    procedural_textures: ProceduralTextureConfig,
}

impl Default for ProceduralTextureConfig {
    fn default() -> Self {
        Self {
            enabled: default_procedural_textures_enabled(),
            seed: default_seed(),
            runtime_mode: ProceduralTextureRuntimeMode::GenerateIfMissing,
            cache_dir: default_cache_dir(),
            noise: NoiseBakeConfig::default(),
            terrain: TerrainTextureConfig::default(),
            terrain_material_quality: default_terrain_material_quality(),
            debug: ProceduralTextureDebugConfig::default(),
        }
    }
}

impl Default for NoiseBakeConfig {
    fn default() -> Self {
        Self {
            resolution: default_resolution(),
            periods: NoiseBakePeriods::default(),
        }
    }
}

impl Default for NoiseBakePeriods {
    fn default() -> Self {
        Self {
            value: 256.0,
            fbm: 64.0,
            ridged: 32.0,
            worley: 128.0,
        }
    }
}

impl Default for TerrainTextureConfig {
    fn default() -> Self {
        Self {
            layer_resolution: default_resolution(),
            macro_variation_m: default_macro_variation(),
            meso_variation_m: default_meso_variation(),
            micro_variation_m: default_micro_variation(),
            micro_normal: MicroNormalConfig::default(),
            material_order: default_material_order(),
            materials: default_material_recipes(),
        }
    }
}

impl Default for MicroNormalConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            fade_start_m: default_micro_fade_start(),
            fade_end_m: default_micro_fade_end(),
            max_strength: default_micro_max_strength(),
        }
    }
}

impl Default for ProceduralTextureDebugConfig {
    fn default() -> Self {
        Self {
            mode: default_debug_mode(),
        }
    }
}

impl ProceduralTextureConfig {
    pub fn from_yaml_str(text: &str) -> Result<Self, ProceduralTextureError> {
        let file: ProceduralTextureConfigFile =
            serde_yaml::from_str(text).map_err(|source| ProceduralTextureError::ParseConfig {
                path: "<memory>".to_string(),
                source,
            })?;
        Ok(file.procedural_textures)
    }

    pub fn load_or_default() -> Result<Self, ProceduralTextureError> {
        let path = Path::new(DEFAULT_PROCEDURAL_TEXTURE_CONFIG_PATH);
        if !path.exists() {
            return Ok(Self::default());
        }
        let text =
            fs::read_to_string(path).map_err(|source| ProceduralTextureError::ReadConfig {
                path: path.display().to_string(),
                source,
            })?;
        serde_yaml::from_str::<ProceduralTextureConfigFile>(&text)
            .map(|file| file.procedural_textures)
            .map_err(|source| ProceduralTextureError::ParseConfig {
                path: path.display().to_string(),
                source,
            })
    }
}

/// Procedural terrain textures are opt-in: they add a startup bake and a per-fragment terrain
/// material pass, so they stay off unless explicitly enabled in the config.
fn default_procedural_textures_enabled() -> bool {
    false
}

fn default_enabled() -> bool {
    true
}

fn default_seed() -> u32 {
    1337
}

fn default_resolution() -> u32 {
    1024
}

fn default_cache_dir() -> String {
    "generated/procedural".to_string()
}

fn default_macro_variation() -> [f32; 2] {
    [2.0, 50.0]
}

fn default_meso_variation() -> [f32; 2] {
    [0.8, 4.0]
}

fn default_micro_variation() -> [f32; 2] {
    [0.05, 0.4]
}

fn default_micro_fade_start() -> f32 {
    45.0
}

fn default_micro_fade_end() -> f32 {
    85.0
}

fn default_micro_max_strength() -> f32 {
    0.35
}

fn default_terrain_material_quality() -> BTreeMap<String, TerrainMaterialQualityTier> {
    BTreeMap::from([
        (
            "debug_flat".to_string(),
            TerrainMaterialQualityTier {
                max_noise_fetches: 0,
            },
        ),
        (
            "procedural_macro".to_string(),
            TerrainMaterialQualityTier {
                max_noise_fetches: 2,
            },
        ),
        (
            "procedural_medium".to_string(),
            TerrainMaterialQualityTier {
                max_noise_fetches: 6,
            },
        ),
        (
            "procedural_full".to_string(),
            TerrainMaterialQualityTier {
                max_noise_fetches: 10,
            },
        ),
    ])
}

fn default_debug_mode() -> String {
    "final".to_string()
}

fn default_material_order() -> Vec<ProceduralMaterialId> {
    vec![
        ProceduralMaterialId::Grass,
        ProceduralMaterialId::Rock,
        ProceduralMaterialId::Sand,
        ProceduralMaterialId::Snow,
        ProceduralMaterialId::Dirt,
        ProceduralMaterialId::Moss,
        ProceduralMaterialId::Gravel,
        ProceduralMaterialId::WetSoil,
    ]
}

pub fn default_material_recipes() -> BTreeMap<ProceduralMaterialId, ProceduralMaterialRecipe> {
    use ProceduralMaterialId::*;
    let mut recipes = BTreeMap::new();
    recipes.insert(
        Grass,
        ProceduralMaterialRecipe::new([0.24, 0.42, 0.16], 0.85, 0.22, 0.18),
    );
    recipes.insert(
        Rock,
        ProceduralMaterialRecipe {
            strata_strength: Some(0.45),
            ..ProceduralMaterialRecipe::new([0.37, 0.36, 0.33], 0.78, 0.16, 0.32)
        },
    );
    recipes.insert(
        Sand,
        ProceduralMaterialRecipe::new([0.62, 0.54, 0.36], 0.95, 0.12, 0.08),
    );
    recipes.insert(
        Snow,
        ProceduralMaterialRecipe {
            sparkle_strength: Some(0.04),
            ..ProceduralMaterialRecipe::new([0.82, 0.86, 0.88], 0.55, 0.06, 0.06)
        },
    );
    recipes.insert(
        Dirt,
        ProceduralMaterialRecipe::new([0.34, 0.23, 0.14], 0.92, 0.18, 0.12),
    );
    recipes.insert(
        Moss,
        ProceduralMaterialRecipe {
            moisture_bias: Some(0.65),
            ..ProceduralMaterialRecipe::new([0.16, 0.31, 0.13], 0.98, 0.24, 0.10)
        },
    );
    recipes.insert(
        Gravel,
        ProceduralMaterialRecipe::new([0.42, 0.41, 0.39], 0.88, 0.14, 0.22),
    );
    recipes.insert(
        WetSoil,
        ProceduralMaterialRecipe::new([0.18, 0.13, 0.10], 0.38, 0.16, 0.10),
    );
    recipes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_procedural_texture_config_overrides() {
        let config = ProceduralTextureConfig::from_yaml_str(
            "
procedural_textures:
  seed: 17
  runtime_mode: cache_only
  noise:
    resolution: 32
  terrain:
    layer_resolution: 16
    material_order: [rock, grass]
  terrain_material_quality:
    debug_flat:
      max_noise_fetches: 0
    procedural_full:
      max_noise_fetches: 10
",
        )
        .expect("parse config");

        assert_eq!(config.seed, 17);
        assert_eq!(config.runtime_mode, ProceduralTextureRuntimeMode::CacheOnly);
        assert_eq!(config.noise.resolution, 32);
        assert_eq!(config.terrain.layer_resolution, 16);
        assert_eq!(
            config.terrain.material_order,
            vec![ProceduralMaterialId::Rock, ProceduralMaterialId::Grass]
        );
        assert!(
            config
                .terrain
                .materials
                .contains_key(&ProceduralMaterialId::WetSoil)
        );
        assert_eq!(
            config.terrain_material_quality["debug_flat"].max_noise_fetches,
            0
        );
        assert_eq!(
            config.terrain_material_quality["procedural_full"].max_noise_fetches,
            10
        );
    }
}
