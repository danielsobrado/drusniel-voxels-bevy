use super::errors::ProceduralSupportMapError;
use super::recipes::{ProceduralMaterialId, ProceduralMaterialRecipe};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const DEFAULT_PROCEDURAL_SUPPORT_MAP_CONFIG_PATH: &str =
    "assets/config/procedural_support_maps.yaml";

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProceduralSupportMapRuntimeMode {
    CacheOnly,
    #[default]
    GenerateIfMissing,
    ForceRegenerate,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProceduralSupportMapConfig {
    #[serde(default = "default_procedural_support_maps_enabled")]
    pub enabled: bool,
    #[serde(default = "default_seed")]
    pub seed: u32,
    #[serde(default)]
    pub runtime_mode: ProceduralSupportMapRuntimeMode,
    #[serde(default = "default_cache_dir")]
    pub cache_dir: String,
    #[serde(default)]
    pub noise: NoiseBakeConfig,
    #[serde(default)]
    pub terrain: TerrainTextureConfig,
    #[serde(default)]
    pub bark: BarkTextureConfig,
    #[serde(default = "default_terrain_material_quality")]
    pub terrain_material_quality: BTreeMap<String, TerrainMaterialQualityTier>,
    #[serde(default)]
    pub debug: ProceduralSupportMapDebugConfig,
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
    #[serde(default)]
    pub masks: TerrainMasksConfig,
    #[serde(default = "default_material_order")]
    pub material_order: Vec<ProceduralMaterialId>,
    #[serde(default = "default_material_recipes")]
    pub materials: BTreeMap<ProceduralMaterialId, ProceduralMaterialRecipe>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BarkTextureConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_bark_resolution")]
    pub resolution: u32,
    #[serde(default = "default_bark_species")]
    pub species: Vec<BarkSpeciesConfig>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BarkSpeciesConfig {
    pub id: String,
    pub label: String,
    pub params: BarkSynthesisParams,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct BarkSynthesisParams {
    pub plates: [f32; 2],
    pub warp: f32,
    pub fissure_w: f32,
    pub fissure_depth: f32,
    pub plate_round: f32,
    pub micro: f32,
    pub vert_crack: f32,
    pub lenticels: f32,
    pub deep: [f32; 3],
    pub high: [f32; 3],
    pub mottle: f32,
    pub rough_base: f32,
    pub rough_var: f32,
    pub normal_k: f32,
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct TerrainMasksConfig {
    #[serde(default = "default_slope_damp")]
    pub slope_damp: [f32; 2],
    #[serde(default = "default_snow_height")]
    pub snow_height: [f32; 2],
    #[serde(default = "default_snow_upness")]
    pub snow_upness: [f32; 2],
    #[serde(default = "default_moss_upness")]
    pub moss_upness: [f32; 2],
    #[serde(default = "default_gravel_slope")]
    pub gravel_slope: [f32; 2],
    #[serde(default = "default_wet_height")]
    pub wet_height: [f32; 2],
    #[serde(default = "default_wet_upness")]
    pub wet_upness: [f32; 2],
    #[serde(default = "default_wet_level")]
    pub wet_level_m: f32,
    #[serde(default = "default_page_lod_normal_fade")]
    pub page_lod_normal_fade_m: f32,
    #[serde(default = "default_meso_albedo_strength")]
    pub meso_albedo_strength: f32,
    #[serde(default = "default_wet_roughness")]
    pub wet_roughness: f32,
    #[serde(default = "default_wet_roughness_strength")]
    pub wet_roughness_strength: f32,
    #[serde(default = "default_snow_tint_strength")]
    pub snow_tint_strength: f32,
    #[serde(default = "default_moss_tint_strength")]
    pub moss_tint_strength: f32,
    #[serde(default = "default_gravel_tint_strength")]
    pub gravel_tint_strength: f32,
    #[serde(default = "default_wet_tint_strength")]
    pub wet_tint_strength: f32,
    #[serde(default = "default_moss_tint")]
    pub moss_tint: [f32; 3],
    #[serde(default = "default_gravel_tint")]
    pub gravel_tint: [f32; 3],
    #[serde(default = "default_wet_tint")]
    pub wet_tint: [f32; 3],
    #[serde(default = "default_snow_tint")]
    pub snow_tint: [f32; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TerrainMaterialQualityTier {
    pub max_noise_fetches: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProceduralSupportMapDebugConfig {
    #[serde(default = "default_debug_mode")]
    pub mode: String,
}

#[derive(Deserialize)]
struct ProceduralSupportMapConfigFile {
    #[serde(default)]
    procedural_support_maps: ProceduralSupportMapConfig,
}

impl Default for ProceduralSupportMapConfig {
    fn default() -> Self {
        Self {
            enabled: default_procedural_support_maps_enabled(),
            seed: default_seed(),
            runtime_mode: ProceduralSupportMapRuntimeMode::GenerateIfMissing,
            cache_dir: default_cache_dir(),
            noise: NoiseBakeConfig::default(),
            terrain: TerrainTextureConfig::default(),
            bark: BarkTextureConfig::default(),
            terrain_material_quality: default_terrain_material_quality(),
            debug: ProceduralSupportMapDebugConfig::default(),
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
            masks: TerrainMasksConfig::default(),
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

impl Default for TerrainMasksConfig {
    fn default() -> Self {
        Self {
            slope_damp: default_slope_damp(),
            snow_height: default_snow_height(),
            snow_upness: default_snow_upness(),
            moss_upness: default_moss_upness(),
            gravel_slope: default_gravel_slope(),
            wet_height: default_wet_height(),
            wet_upness: default_wet_upness(),
            wet_level_m: default_wet_level(),
            page_lod_normal_fade_m: default_page_lod_normal_fade(),
            meso_albedo_strength: default_meso_albedo_strength(),
            wet_roughness: default_wet_roughness(),
            wet_roughness_strength: default_wet_roughness_strength(),
            snow_tint_strength: default_snow_tint_strength(),
            moss_tint_strength: default_moss_tint_strength(),
            gravel_tint_strength: default_gravel_tint_strength(),
            wet_tint_strength: default_wet_tint_strength(),
            moss_tint: default_moss_tint(),
            gravel_tint: default_gravel_tint(),
            wet_tint: default_wet_tint(),
            snow_tint: default_snow_tint(),
        }
    }
}

impl Default for BarkTextureConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resolution: default_bark_resolution(),
            species: default_bark_species(),
        }
    }
}

impl Default for ProceduralSupportMapDebugConfig {
    fn default() -> Self {
        Self {
            mode: default_debug_mode(),
        }
    }
}

impl ProceduralSupportMapConfig {
    pub fn from_yaml_str(text: &str) -> Result<Self, ProceduralSupportMapError> {
        let file: ProceduralSupportMapConfigFile =
            serde_yaml::from_str(text).map_err(|source| {
                ProceduralSupportMapError::ParseConfig {
                    path: "<memory>".to_string(),
                    source,
                }
            })?;
        Ok(file.procedural_support_maps)
    }

    pub fn load_or_default() -> Result<Self, ProceduralSupportMapError> {
        let path = Path::new(DEFAULT_PROCEDURAL_SUPPORT_MAP_CONFIG_PATH);
        if !path.exists() {
            return Ok(Self::default());
        }
        let text =
            fs::read_to_string(path).map_err(|source| ProceduralSupportMapError::ReadConfig {
                path: path.display().to_string(),
                source,
            })?;
        serde_yaml::from_str::<ProceduralSupportMapConfigFile>(&text)
            .map(|file| file.procedural_support_maps)
            .map_err(|source| ProceduralSupportMapError::ParseConfig {
                path: path.display().to_string(),
                source,
            })
    }
}

/// Procedural support maps are opt-in and should usually be loaded from cache.
fn default_procedural_support_maps_enabled() -> bool {
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

fn default_bark_resolution() -> u32 {
    2048
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

fn default_slope_damp() -> [f32; 2] {
    [0.18, 0.92]
}

fn default_snow_height() -> [f32; 2] {
    [76.0, 130.0]
}

fn default_snow_upness() -> [f32; 2] {
    [0.58, 0.92]
}

fn default_moss_upness() -> [f32; 2] {
    [0.55, 0.92]
}

fn default_gravel_slope() -> [f32; 2] {
    [0.28, 0.72]
}

fn default_wet_height() -> [f32; 2] {
    [18.0, 28.0]
}

fn default_wet_upness() -> [f32; 2] {
    [0.42, 0.86]
}

fn default_wet_level() -> f32 {
    18.0
}

fn default_page_lod_normal_fade() -> f32 {
    16.0
}

fn default_meso_albedo_strength() -> f32 {
    0.08
}

fn default_wet_roughness() -> f32 {
    0.35
}

fn default_wet_roughness_strength() -> f32 {
    0.30
}

fn default_snow_tint_strength() -> f32 {
    0.22
}

fn default_moss_tint_strength() -> f32 {
    0.08
}

fn default_gravel_tint_strength() -> f32 {
    0.10
}

fn default_wet_tint_strength() -> f32 {
    0.20
}

fn default_moss_tint() -> [f32; 3] {
    [0.18, 0.32, 0.13]
}

fn default_gravel_tint() -> [f32; 3] {
    [0.42, 0.41, 0.39]
}

fn default_wet_tint() -> [f32; 3] {
    [0.18, 0.15, 0.12]
}

fn default_snow_tint() -> [f32; 3] {
    [0.86, 0.89, 0.90]
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

pub fn default_bark_species() -> Vec<BarkSpeciesConfig> {
    vec![
        BarkSpeciesConfig {
            id: "spruce".to_string(),
            label: "Spruce".to_string(),
            params: BarkSynthesisParams {
                plates: [16.0, 4.0],
                warp: 0.5,
                fissure_w: 0.34,
                fissure_depth: 0.85,
                plate_round: 0.25,
                micro: 0.3,
                vert_crack: 0.55,
                lenticels: 0.0,
                deep: [0.045, 0.032, 0.026],
                high: [0.21, 0.155, 0.115],
                mottle: 0.25,
                rough_base: 0.92,
                rough_var: 0.07,
                normal_k: 2.6,
            },
        },
        BarkSpeciesConfig {
            id: "pine".to_string(),
            label: "Pine".to_string(),
            params: BarkSynthesisParams {
                plates: [7.0, 9.0],
                warp: 0.35,
                fissure_w: 0.42,
                fissure_depth: 1.0,
                plate_round: 0.55,
                micro: 0.22,
                vert_crack: 0.1,
                lenticels: 0.0,
                deep: [0.05, 0.027, 0.016],
                high: [0.30, 0.155, 0.075],
                mottle: 0.35,
                rough_base: 0.88,
                rough_var: 0.1,
                normal_k: 3.0,
            },
        },
        BarkSpeciesConfig {
            id: "beech".to_string(),
            label: "Beech".to_string(),
            params: BarkSynthesisParams {
                plates: [5.0, 5.0],
                warp: 0.6,
                fissure_w: 0.85,
                fissure_depth: 0.12,
                plate_round: 0.1,
                micro: 0.12,
                vert_crack: 0.0,
                lenticels: 0.0,
                deep: [0.16, 0.15, 0.135],
                high: [0.30, 0.285, 0.25],
                mottle: 0.5,
                rough_base: 0.78,
                rough_var: 0.08,
                normal_k: 0.9,
            },
        },
        BarkSpeciesConfig {
            id: "birch".to_string(),
            label: "Birch".to_string(),
            params: BarkSynthesisParams {
                plates: [4.0, 3.0],
                warp: 0.3,
                fissure_w: 0.9,
                fissure_depth: 0.06,
                plate_round: 0.05,
                micro: 0.1,
                vert_crack: 0.0,
                lenticels: 1.0,
                deep: [0.46, 0.44, 0.42],
                high: [0.80, 0.79, 0.76],
                mottle: 0.22,
                rough_base: 0.62,
                rough_var: 0.18,
                normal_k: 0.7,
            },
        },
        BarkSpeciesConfig {
            id: "karst_gnarl".to_string(),
            label: "Karst gnarl".to_string(),
            params: BarkSynthesisParams {
                plates: [9.0, 3.0],
                warp: 1.4,
                fissure_w: 0.5,
                fissure_depth: 0.9,
                plate_round: 0.3,
                micro: 0.34,
                vert_crack: 0.3,
                lenticels: 0.0,
                deep: [0.05, 0.043, 0.036],
                high: [0.205, 0.18, 0.15],
                mottle: 0.3,
                rough_base: 0.93,
                rough_var: 0.05,
                normal_k: 2.8,
            },
        },
        BarkSpeciesConfig {
            id: "snag".to_string(),
            label: "Snag".to_string(),
            params: BarkSynthesisParams {
                plates: [11.0, 2.0],
                warp: 0.4,
                fissure_w: 0.3,
                fissure_depth: 0.7,
                plate_round: 0.15,
                micro: 0.26,
                vert_crack: 0.8,
                lenticels: 0.0,
                deep: [0.07, 0.065, 0.06],
                high: [0.26, 0.25, 0.23],
                mottle: 0.2,
                rough_base: 0.9,
                rough_var: 0.06,
                normal_k: 2.2,
            },
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_procedural_support_map_config_overrides() {
        let config = ProceduralSupportMapConfig::from_yaml_str(
            "
procedural_support_maps:
  seed: 17
  runtime_mode: cache_only
  noise:
    resolution: 32
  terrain:
    layer_resolution: 16
    material_order: [rock, grass]
    masks:
      slope_damp: [0.2, 0.8]
      meso_albedo_strength: 0.11
      snow_tint: [0.9, 0.91, 0.92]
  bark:
    resolution: 64
    species:
      - id: test_bark
        label: Test bark
        params:
          plates: [3.0, 4.0]
          warp: 0.25
          fissure_w: 0.5
          fissure_depth: 0.75
          plate_round: 0.2
          micro: 0.1
          vert_crack: 0.3
          lenticels: 0.0
          deep: [0.1, 0.08, 0.06]
          high: [0.3, 0.25, 0.2]
          mottle: 0.2
          rough_base: 0.8
          rough_var: 0.1
          normal_k: 2.0
  terrain_material_quality:
    debug_flat:
      max_noise_fetches: 0
    procedural_full:
      max_noise_fetches: 10
",
        )
        .expect("parse config");

        assert_eq!(config.seed, 17);
        assert_eq!(
            config.runtime_mode,
            ProceduralSupportMapRuntimeMode::CacheOnly
        );
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
        assert_eq!(config.terrain.masks.slope_damp, [0.2, 0.8]);
        assert_eq!(config.terrain.masks.meso_albedo_strength, 0.11);
        assert_eq!(config.terrain.masks.snow_tint, [0.9, 0.91, 0.92]);
        assert_eq!(config.bark.resolution, 64);
        assert_eq!(config.bark.species.len(), 1);
        assert_eq!(config.bark.species[0].id, "test_bark");
        assert_eq!(config.bark.species[0].params.plates, [3.0, 4.0]);
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
