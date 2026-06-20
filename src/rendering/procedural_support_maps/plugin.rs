use super::cache::{self, ManifestStatus};
use super::config::{ProceduralSupportMapConfig, ProceduralSupportMapRuntimeMode};
use super::manifest::ProceduralSupportMapManifest;
use super::material_bindings::{ProceduralSupportMapSource, ProceduralTerrainSupportMapHandles};
use super::texture_images::{
    GeneratedProceduralSupportMapSet, generate_procedural_support_map_set,
};
use bevy::prelude::*;

pub struct ProceduralSupportMapPlugin;

impl Plugin for ProceduralSupportMapPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup_procedural_support_maps);
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
            warn!("Procedural support maps disabled: {error}");
            return;
        }
    };

    if !config.enabled {
        info!("Procedural support maps disabled by config");
        return;
    }

    let expected_manifest = match ProceduralSupportMapManifest::expected(&config) {
        Ok(manifest) => manifest,
        Err(error) => {
            warn!("Procedural support maps disabled: {error}");
            return;
        }
    };
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
        commands.insert_resource(handles);
        info!("Procedural support maps loaded from cache");
        return;
    }

    if config.runtime_mode == ProceduralSupportMapRuntimeMode::CacheOnly {
        warn!("Procedural support map cache_only mode found no matching cache");
        return;
    }

    let generated = match generate_procedural_support_map_set(&config) {
        Ok(generated) => generated,
        Err(error) => {
            warn!("Procedural support map generation failed: {error}");
            return;
        }
    };

    if let Err(error) = generated.write_cache(&config.cache_dir) {
        warn!("Procedural support map cache write failed: {error}");
    }
    let handles = handles_from_generated(generated, config, &mut images);
    commands.insert_resource(handles);
    info!("Procedural support maps generated");
}
