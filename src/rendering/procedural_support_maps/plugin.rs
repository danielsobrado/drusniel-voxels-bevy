use super::cache::{self, ManifestStatus};
use super::config::{ProceduralSupportMapConfig, ProceduralSupportMapRuntimeMode};
use super::manifest::ProceduralSupportMapManifest;
use super::material_bindings::{ProceduralSupportMapSource, ProceduralTerrainSupportMapHandles};
use super::recipes::ProceduralMaterialId;
use super::status::ProceduralSupportMapStatus;
use super::texture_images::{
    GeneratedProceduralSupportMapSet, generate_procedural_support_map_set,
};
use bevy::prelude::*;

use crate::rendering::triplanar_material::{TriplanarMaterial, TriplanarMaterialHandle};

pub struct ProceduralSupportMapPlugin;

impl Plugin for ProceduralSupportMapPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ProceduralSupportMapStatus>()
            .add_systems(Startup, setup_procedural_support_maps)
            .add_systems(Update, sync_procedural_support_maps_to_triplanar_materials);
    }
}

fn handles_from_generated(
    generated: GeneratedProceduralSupportMapSet,
    config: ProceduralSupportMapConfig,
    images: &mut Assets<Image>,
) -> ProceduralTerrainSupportMapHandles {
    let manifest = generated.manifest.clone();
    ProceduralTerrainSupportMapHandles {
        noise_a: images.add(generated.noise_a_image()),
        noise_b: images.add(generated.noise_b_image()),
        classification_a: images.add(generated.classification_a_image()),
        config,
        manifest,
        source: ProceduralSupportMapSource::GeneratedRuntime,
    }
}

fn handles_from_cache(
    config: &ProceduralSupportMapConfig,
    manifest: ProceduralSupportMapManifest,
    asset_server: &AssetServer,
) -> ProceduralTerrainSupportMapHandles {
    ProceduralTerrainSupportMapHandles {
        noise_a: asset_server.load(cache::asset_path(
            &config.cache_dir,
            &manifest.outputs.noise_a,
        )),
        noise_b: asset_server.load(cache::asset_path(
            &config.cache_dir,
            &manifest.outputs.noise_b,
        )),
        classification_a: asset_server.load(cache::asset_path(
            &config.cache_dir,
            &manifest.outputs.terrain_classification_a,
        )),
        config: config.clone(),
        manifest,
        source: ProceduralSupportMapSource::CachedAsset,
    }
}

pub fn setup_procedural_support_maps(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    asset_server: Res<AssetServer>,
) {
    let config = match ProceduralSupportMapConfig::load_or_default() {
        Ok(config) => config,
        Err(error) => {
            let message = format!("Procedural support maps disabled: {error}");
            warn!("{message}");
            commands.insert_resource(ProceduralSupportMapStatus::disabled(message));
            return;
        }
    };

    if !config.enabled {
        let message = "Procedural support maps disabled by config";
        info!("{message}");
        commands.insert_resource(ProceduralSupportMapStatus::disabled(message));
        return;
    }

    let expected_manifest = match ProceduralSupportMapManifest::expected(&config) {
        Ok(manifest) => manifest,
        Err(error) => {
            let message = format!("Procedural support maps disabled: {error}");
            warn!("{message}");
            commands.insert_resource(ProceduralSupportMapStatus::disabled(message));
            return;
        }
    };
    let manifest_key = manifest_key_for_manifest(&expected_manifest);
    let cache_status = match cache::manifest_status(&config.cache_dir, &expected_manifest) {
        Ok(status) => status,
        Err(error) => {
            warn!("Procedural support map cache ignored: {error}");
            ManifestStatus::Missing
        }
    };
    let cache_files_ready = cache_status == ManifestStatus::Match
        && cache::manifest_cache_files_exist(&config.cache_dir, &expected_manifest);

    if cache_files_ready && config.runtime_mode != ProceduralSupportMapRuntimeMode::ForceRegenerate
    {
        let handles = handles_from_cache(&config, expected_manifest, &asset_server);
        let status = ProceduralSupportMapStatus::ready(
            ProceduralSupportMapSource::CachedAsset,
            manifest_key,
            config.cache_dir.clone(),
            "Procedural support maps loaded from cache",
        );
        commands.insert_resource(handles);
        commands.insert_resource(status);
        info!("Procedural support maps loaded from cache");
        return;
    }

    if config.runtime_mode == ProceduralSupportMapRuntimeMode::CacheOnly {
        let message = "Procedural support map cache_only mode found no matching cache";
        warn!("{message}");
        commands.insert_resource(ProceduralSupportMapStatus::disabled(message));
        return;
    }

    let generated = match generate_procedural_support_map_set(&config) {
        Ok(generated) => generated,
        Err(error) => {
            let message = format!("Procedural support map generation failed: {error}");
            warn!("{message}");
            commands.insert_resource(ProceduralSupportMapStatus::disabled(message));
            return;
        }
    };

    if let Err(error) = generated.write_cache(&config.cache_dir) {
        warn!("Procedural support map cache write failed: {error}");
    }
    let status = ProceduralSupportMapStatus::ready(
        ProceduralSupportMapSource::GeneratedRuntime,
        manifest_key,
        config.cache_dir.clone(),
        "Procedural support maps generated",
    );
    let handles = handles_from_generated(generated, config, &mut images);
    commands.insert_resource(handles);
    commands.insert_resource(status);
    info!("Procedural support maps generated");
}

pub fn sync_procedural_support_maps_to_triplanar_materials(
    support_maps: Option<Res<ProceduralTerrainSupportMapHandles>>,
    triplanar_handles: Option<Res<TriplanarMaterialHandle>>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    mut status: Option<ResMut<ProceduralSupportMapStatus>>,
    mut applied_manifest_key: Local<Option<String>>,
) {
    let (Some(support_maps), Some(triplanar_handles)) = (support_maps, triplanar_handles) else {
        return;
    };

    let manifest_key = material_manifest_key(&support_maps);
    if applied_manifest_key.as_deref() == Some(manifest_key.as_str()) {
        return;
    }

    let handles = triplanar_material_handles(&triplanar_handles);
    let mut applied = 0usize;
    for handle in handles {
        if let Some(material) = materials.get_mut(handle) {
            apply_support_map_uniforms(material, &support_maps.config);
            applied += 1;
        }
    }

    if applied > 0 {
        *applied_manifest_key = Some(manifest_key);
        if let Some(status) = status.as_deref_mut() {
            status.record_material_variants_applied(applied);
        }
        info!(
            "Procedural support maps enabled for {applied} terrain material variants ({:?})",
            support_maps.source
        );
    }
}

fn manifest_key_for_manifest(manifest: &ProceduralSupportMapManifest) -> String {
    format!(
        "{}:{}:{}",
        manifest.schema_version, manifest.config_hash, manifest.shader_hash
    )
}

fn material_manifest_key(handles: &ProceduralTerrainSupportMapHandles) -> String {
    manifest_key_for_manifest(&handles.manifest)
}

fn triplanar_material_handles(handles: &TriplanarMaterialHandle) -> [&Handle<TriplanarMaterial>; 10] {
    [
        &handles.handle,
        &handles.cheap_handle,
        &handles.single_projection_far_handle,
        &handles.horizon_proxy_handle,
        &handles.atlas_only_debug_handle,
        &handles.wireframe_debug_handle,
        &handles.normals_debug_handle,
        &handles.wireframe_normals_debug_handle,
        &handles.flat_unlit_debug_handle,
        &handles.wireframe_flat_unlit_debug_handle,
    ]
}

fn apply_support_map_uniforms(
    material: &mut TriplanarMaterial,
    config: &ProceduralSupportMapConfig,
) {
    let masks = config.terrain.masks;
    material.uniforms.procedural_support_maps_enabled = 1.0;
    material.uniforms.procedural_snow_mask = Vec4::new(
        masks.snow_height[0],
        masks.snow_height[1],
        masks.snow_upness[0],
        masks.snow_upness[1],
    );
    material.uniforms.procedural_wet_mask = Vec4::new(
        masks.wet_height[0],
        masks.wet_height[1],
        masks.wet_upness[0],
        masks.wet_upness[1],
    );
    material.uniforms.procedural_slope_masks = Vec4::new(
        masks.moss_upness[0],
        masks.moss_upness[1],
        masks.gravel_slope[0],
        masks.gravel_slope[1],
    );
    material.uniforms.procedural_tint_strengths = Vec4::new(
        masks.snow_tint_strength,
        masks.moss_tint_strength,
        masks.gravel_tint_strength,
        masks.wet_tint_strength,
    );
    material.uniforms.procedural_material_roughness = Vec4::new(
        material_roughness(config, ProceduralMaterialId::Grass, 0.85),
        material_roughness(config, ProceduralMaterialId::Rock, 0.78),
        material_roughness(config, ProceduralMaterialId::Sand, 0.95),
        material_roughness(config, ProceduralMaterialId::Dirt, 0.92),
    );
    material.uniforms.procedural_moss_tint = Vec4::new(
        masks.moss_tint[0],
        masks.moss_tint[1],
        masks.moss_tint[2],
        0.0,
    );
    material.uniforms.procedural_gravel_tint = Vec4::new(
        masks.gravel_tint[0],
        masks.gravel_tint[1],
        masks.gravel_tint[2],
        0.0,
    );
    material.uniforms.procedural_wet_tint = Vec4::new(
        masks.wet_tint[0],
        masks.wet_tint[1],
        masks.wet_tint[2],
        0.0,
    );
    material.uniforms.procedural_snow_tint = Vec4::new(
        masks.snow_tint[0],
        masks.snow_tint[1],
        masks.snow_tint[2],
        0.0,
    );
    material.uniforms.procedural_material_params = Vec4::new(
        config.terrain.micro_normal.fade_start_m,
        config.terrain.micro_normal.fade_end_m,
        masks.wet_roughness,
        masks.wet_roughness_strength,
    );
}

fn material_roughness(
    config: &ProceduralSupportMapConfig,
    material_id: ProceduralMaterialId,
    fallback: f32,
) -> f32 {
    config
        .terrain
        .materials
        .get(&material_id)
        .map(|recipe| recipe.roughness)
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_map_uniforms_enable_cached_material_path() {
        let config = ProceduralSupportMapConfig::default();
        let mut material = TriplanarMaterial::default();

        apply_support_map_uniforms(&mut material, &config);

        assert_eq!(material.uniforms.procedural_support_maps_enabled, 1.0);
        assert_eq!(material.uniforms.procedural_snow_mask.x, config.terrain.masks.snow_height[0]);
        assert_eq!(material.uniforms.procedural_wet_mask.z, config.terrain.masks.wet_upness[0]);
        assert_eq!(
            material.uniforms.procedural_material_roughness.x,
            material_roughness(&config, ProceduralMaterialId::Grass, 0.85)
        );
    }

    #[test]
    fn manifest_key_changes_with_config_hash() {
        let config = ProceduralSupportMapConfig::default();
        let mut handles = ProceduralTerrainSupportMapHandles {
            noise_a: Handle::default(),
            noise_b: Handle::default(),
            classification_a: Handle::default(),
            config,
            manifest: ProceduralSupportMapManifest {
                schema_version: 1,
                seed: 1337,
                config_hash: "a".to_string(),
                shader_hash: "shader".to_string(),
                generated_at: "runtime".to_string(),
                noise_resolution: 8,
                outputs: super::super::manifest::ProceduralSupportMapManifestOutputs {
                    noise_a: "noise_a.png".to_string(),
                    noise_b: "noise_b.png".to_string(),
                    terrain_classification_a: "terrain_classification_a.png".to_string(),
                },
            },
            source: ProceduralSupportMapSource::GeneratedRuntime,
        };

        let first = material_manifest_key(&handles);
        handles.manifest.config_hash = "b".to_string();
        let second = material_manifest_key(&handles);

        assert_ne!(first, second);
    }
}
