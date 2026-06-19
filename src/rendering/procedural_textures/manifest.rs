use super::config::ProceduralTextureConfig;
use super::errors::ProceduralTextureError;
use super::recipes::ProceduralMaterialId;
use serde::{Deserialize, Serialize};

pub const PROCEDURAL_TEXTURE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProceduralTextureManifest {
    pub schema_version: u32,
    pub seed: u32,
    pub config_hash: String,
    pub generated_at: String,
    pub noise_resolution: u32,
    pub layer_resolution: u32,
    pub material_order: Vec<ProceduralMaterialId>,
}

impl ProceduralTextureManifest {
    pub fn expected(config: &ProceduralTextureConfig) -> Result<Self, ProceduralTextureError> {
        Ok(Self {
            schema_version: PROCEDURAL_TEXTURE_SCHEMA_VERSION,
            seed: config.seed,
            config_hash: stable_hash_value(&serde_json::json!({
                "schema_version": PROCEDURAL_TEXTURE_SCHEMA_VERSION,
                "seed": config.seed,
                "config": config,
            }))?,
            generated_at: "runtime".to_string(),
            noise_resolution: config.noise.resolution,
            layer_resolution: config.terrain.layer_resolution,
            material_order: config.terrain.material_order.clone(),
        })
    }

    pub fn matches_expected(&self, expected: &Self) -> bool {
        self.schema_version == expected.schema_version
            && self.seed == expected.seed
            && self.config_hash == expected.config_hash
            && self.noise_resolution == expected.noise_resolution
            && self.layer_resolution == expected.layer_resolution
            && self.material_order == expected.material_order
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

        assert_ne!(base.config_hash, changed_seed.config_hash);
        assert_ne!(
            stable_hash_str(r#"{"schema_version":1}"#),
            stable_hash_str(r#"{"schema_version":2}"#)
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
