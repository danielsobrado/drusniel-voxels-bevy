use super::config::ProceduralSupportMapConfig;
use super::errors::ProceduralSupportMapError;
use serde::{Deserialize, Serialize};

pub const PROCEDURAL_TEXTURE_SCHEMA_VERSION: u32 = 3;
const PROCEDURAL_SHADER_SOURCES: &[&str] = &[
    include_str!("../../../assets/shaders/procedural/periodic_noise.wgsl"),
    include_str!("../../../assets/shaders/procedural/support_noise_bake.wgsl"),
    include_str!("../../../assets/shaders/procedural/terrain_classification_bake.wgsl"),
    include_str!("../../../assets/shaders/procedural/terrain_material_common.wgsl"),
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProceduralSupportMapManifest {
    pub schema_version: u32,
    pub seed: u32,
    pub config_hash: String,
    pub shader_hash: String,
    pub generated_at: String,
    pub noise_resolution: u32,
    pub outputs: ProceduralSupportMapManifestOutputs,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProceduralSupportMapManifestOutputs {
    pub noise_a: String,
    pub noise_b: String,
    pub terrain_classification_a: String,
}

impl ProceduralSupportMapManifest {
    pub fn expected(
        config: &ProceduralSupportMapConfig,
    ) -> Result<Self, ProceduralSupportMapError> {
        let shader_hash = stable_hash_str(&PROCEDURAL_SHADER_SOURCES.join("\n"));
        Ok(Self {
            schema_version: PROCEDURAL_TEXTURE_SCHEMA_VERSION,
            seed: config.seed,
            config_hash: stable_hash_value(&serde_json::json!({
                "schema_version": PROCEDURAL_TEXTURE_SCHEMA_VERSION,
                "seed": config.seed,
                "support_map_config": {
                    "noise": config.noise,
                    "classification": config.terrain.masks,
                },
            }))?,
            shader_hash,
            generated_at: "runtime".to_string(),
            noise_resolution: config.noise.resolution,
            outputs: ProceduralSupportMapManifestOutputs::for_config(config),
        })
    }

    pub fn matches_expected(&self, expected: &Self) -> bool {
        self.schema_version == expected.schema_version
            && self.seed == expected.seed
            && self.config_hash == expected.config_hash
            && self.shader_hash == expected.shader_hash
            && self.noise_resolution == expected.noise_resolution
            && self.outputs == expected.outputs
    }
}

impl ProceduralSupportMapManifestOutputs {
    pub fn for_config(_config: &ProceduralSupportMapConfig) -> Self {
        Self {
            noise_a: "noise_a.png".to_string(),
            noise_b: "noise_b.png".to_string(),
            terrain_classification_a: "terrain_classification_a.png".to_string(),
        }
    }
}

pub fn stable_hash_value(value: &serde_json::Value) -> Result<String, ProceduralSupportMapError> {
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
    use crate::rendering::procedural_support_maps::config::ProceduralSupportMapConfig;

    #[test]
    fn manifest_hash_changes_for_seed_and_schema_inputs() {
        let config = ProceduralSupportMapConfig::default();
        let base = ProceduralSupportMapManifest::expected(&config).expect("manifest");
        let mut changed = config.clone();
        changed.seed += 1;
        let changed_seed = ProceduralSupportMapManifest::expected(&changed).expect("manifest");
        let mut changed_runtime = config.clone();
        changed_runtime.enabled = !changed_runtime.enabled;
        changed_runtime.runtime_mode =
            crate::rendering::procedural_support_maps::config::ProceduralSupportMapRuntimeMode::CacheOnly;
        changed_runtime.cache_dir = "generated/procedural_shipping".to_string();
        let changed_runtime =
            ProceduralSupportMapManifest::expected(&changed_runtime).expect("manifest");
        let mut changed_masks = config.clone();
        changed_masks.terrain.masks.snow_height[0] += 1.0;
        let changed_masks =
            ProceduralSupportMapManifest::expected(&changed_masks).expect("manifest");

        assert_ne!(base.config_hash, changed_seed.config_hash);
        assert_eq!(base.config_hash, changed_runtime.config_hash);
        assert_ne!(base.config_hash, changed_masks.config_hash);
        assert_ne!(
            stable_hash_str(r#"{"schema_version":1}"#),
            stable_hash_str(r#"{"schema_version":2}"#)
        );
        assert!(!base.shader_hash.is_empty());
        assert_eq!(
            base.outputs.terrain_classification_a,
            "terrain_classification_a.png"
        );
    }

    #[test]
    fn manifest_match_ignores_generated_timestamp() {
        let config = ProceduralSupportMapConfig::default();
        let expected = ProceduralSupportMapManifest::expected(&config).expect("manifest");
        let mut on_disk = expected.clone();
        on_disk.generated_at = "2026-06-18T00:00:00Z".to_string();

        assert!(on_disk.matches_expected(&expected));
    }
}
