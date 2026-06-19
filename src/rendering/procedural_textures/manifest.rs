use super::config::ProceduralTextureConfig;
use super::errors::ProceduralTextureError;
use super::recipes::ProceduralMaterialId;
use serde::{Deserialize, Serialize};

pub const PROCEDURAL_TEXTURE_SCHEMA_VERSION: u32 = 2;
const PROCEDURAL_SHADER_SOURCES: &[&str] = &[
    include_str!("../../../assets/shaders/procedural/noise_common.wgsl"),
    include_str!("../../../assets/shaders/procedural/terrain_material_common.wgsl"),
    include_str!("../../../assets/shaders/procedural/terrain_recipes.wgsl"),
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProceduralTextureManifest {
    pub schema_version: u32,
    pub seed: u32,
    pub config_hash: String,
    pub shader_hash: String,
    pub generated_at: String,
    pub noise_resolution: u32,
    pub layer_resolution: u32,
    pub material_order: Vec<ProceduralMaterialId>,
    pub outputs: ProceduralTextureManifestOutputs,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProceduralTextureManifestOutputs {
    pub noise_a: String,
    pub noise_b: String,
    pub terrain_albedo: Vec<String>,
    pub terrain_normal_roughness: Vec<String>,
}

impl ProceduralTextureManifest {
    pub fn expected(config: &ProceduralTextureConfig) -> Result<Self, ProceduralTextureError> {
        let shader_hash = stable_hash_str(&PROCEDURAL_SHADER_SOURCES.join("\n"));
        Ok(Self {
            schema_version: PROCEDURAL_TEXTURE_SCHEMA_VERSION,
            seed: config.seed,
            config_hash: stable_hash_value(&serde_json::json!({
                "schema_version": PROCEDURAL_TEXTURE_SCHEMA_VERSION,
                "seed": config.seed,
                "texture_config": {
                    "noise": config.noise,
                    "terrain": config.terrain,
                },
            }))?,
            shader_hash,
            generated_at: "runtime".to_string(),
            noise_resolution: config.noise.resolution,
            layer_resolution: config.terrain.layer_resolution,
            material_order: config.terrain.material_order.clone(),
            outputs: ProceduralTextureManifestOutputs::for_bevy_slots(),
        })
    }

    pub fn matches_expected(&self, expected: &Self) -> bool {
        self.schema_version == expected.schema_version
            && self.seed == expected.seed
            && self.config_hash == expected.config_hash
            && self.shader_hash == expected.shader_hash
            && self.noise_resolution == expected.noise_resolution
            && self.layer_resolution == expected.layer_resolution
            && self.material_order == expected.material_order
            && self.outputs == expected.outputs
    }
}

impl ProceduralTextureManifestOutputs {
    pub fn for_bevy_slots() -> Self {
        Self {
            noise_a: "noise_a.png".to_string(),
            noise_b: "noise_b.png".to_string(),
            terrain_albedo: ProceduralMaterialId::BEVY_TERRAIN_SLOTS
                .into_iter()
                .map(|id| format!("{}_albedo.png", id.cache_name()))
                .collect(),
            terrain_normal_roughness: ProceduralMaterialId::BEVY_TERRAIN_SLOTS
                .into_iter()
                .map(|id| format!("{}_normal_roughness.png", id.cache_name()))
                .collect(),
        }
    }
}

pub fn stable_hash_value(value: &serde_json::Value) -> Result<String, ProceduralTextureError> {
    Ok(stable_hash_str(&canonical_json(value)))
}

pub fn stable_hash_str(text: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => serde_json::to_string(value).unwrap_or_default(),
        serde_json::Value::Array(values) => {
            let inner = values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{inner}]")
        }
        serde_json::Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            let inner = keys
                .into_iter()
                .map(|key| {
                    let key_json = serde_json::to_string(key).unwrap_or_default();
                    format!("{key_json}:{}", canonical_json(&values[key]))
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{inner}}}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::procedural_textures::config::ProceduralTextureConfig;

    #[test]
    fn manifest_hash_changes_for_seed_and_schema_inputs() {
        let config = ProceduralTextureConfig::default();
        let base = ProceduralTextureManifest::expected(&config).expect("manifest");
        let mut changed = config.clone();
        changed.seed += 1;
        let changed_seed = ProceduralTextureManifest::expected(&changed).expect("manifest");
        let mut changed_runtime = config.clone();
        changed_runtime.enabled = !changed_runtime.enabled;
        changed_runtime.runtime_mode =
            crate::rendering::procedural_textures::config::ProceduralTextureRuntimeMode::CacheOnly;
        changed_runtime.cache_dir = "generated/procedural_shipping".to_string();
        let changed_runtime =
            ProceduralTextureManifest::expected(&changed_runtime).expect("manifest");
        let mut changed_terrain = config.clone();
        changed_terrain.terrain.layer_resolution += 1;
        let changed_terrain =
            ProceduralTextureManifest::expected(&changed_terrain).expect("manifest");

        assert_ne!(base.config_hash, changed_seed.config_hash);
        assert_eq!(base.config_hash, changed_runtime.config_hash);
        assert_ne!(base.config_hash, changed_terrain.config_hash);
        assert_ne!(
            stable_hash_str(r#"{"schema_version":1}"#),
            stable_hash_str(r#"{"schema_version":2}"#)
        );
        assert!(!base.shader_hash.is_empty());
        assert!(
            base.outputs
                .terrain_albedo
                .contains(&"grass_albedo.png".to_string())
        );
    }

    #[test]
    fn manifest_match_ignores_generated_timestamp() {
        let config = ProceduralTextureConfig::default();
        let expected = ProceduralTextureManifest::expected(&config).expect("manifest");
        let mut on_disk = expected.clone();
        on_disk.generated_at = "2026-06-18T00:00:00Z".to_string();

        assert!(on_disk.matches_expected(&expected));
    }
}
