use super::{is_spawnable_prop, PropAssets, PropConfig};
use crate::config::loader::load_config;
use bevy::prelude::*;
use std::collections::HashMap;

const PROPS_CONFIG_PATH: &str = "config/props.yaml";

/// Load prop configuration from YAML and queue all GLTF assets
pub fn load_prop_config(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut prop_assets: ResMut<PropAssets>,
) {
    let config: PropConfig = match load_config(PROPS_CONFIG_PATH) {
        Ok(c) => {
            info!("Loaded props config from {}", PROPS_CONFIG_PATH);
            c
        }
        Err(e) => {
            warn!("Failed to load props config: {}. Using defaults.", e);
            PropConfig::default()
        }
    };

    if config.props.trees.is_empty()
        && config.props.rocks.is_empty()
        && config.props.bushes.is_empty()
        && config.props.flowers.is_empty()
    {
        info!("No props defined in config, skipping asset loading");
        prop_assets.loaded = true;
        commands.insert_resource(config);
        return;
    }

    let mut scenes: HashMap<String, Handle<Scene>> = HashMap::new();

    // Queue all GLTF scenes
    let all_defs = config
        .props
        .trees
        .iter()
        .chain(config.props.rocks.iter())
        .chain(config.props.bushes.iter())
        .chain(config.props.flowers.iter());

    for def in all_defs {
        if !is_spawnable_prop(def) {
            info!(
                "Skipping non-spawnable prop asset load: {} (density={}, max_count={:?})",
                def.id, def.density, def.max_count
            );
            continue;
        }
        if scenes.contains_key(&def.id) {
            warn!("Duplicate prop id: {}", def.id);
            continue;
        }

        let scene_path = format!("{}#Scene0", def.path);
        let handle: Handle<Scene> = asset_server.load(&scene_path);
        scenes.insert(def.id.clone(), handle);
        info!("Queued prop asset: {} -> {}", def.id, def.path);
    }

    info!("Queued {} prop assets for loading", scenes.len());
    prop_assets.scenes = scenes;
    commands.insert_resource(config);
}

/// Track loading state of all prop assets
pub fn track_asset_loading(asset_server: Res<AssetServer>, mut prop_assets: ResMut<PropAssets>) {
    if prop_assets.loaded || prop_assets.scenes.is_empty() {
        return;
    }

    let mut loaded_count = 0;
    let mut failed_count = 0;
    let mut newly_failed = Vec::new();
    let total = prop_assets.scenes.len();

    for (id, handle) in prop_assets.scenes.iter() {
        match asset_server.get_load_state(handle.id()) {
            Some(bevy::asset::LoadState::Loaded) => loaded_count += 1,
            Some(bevy::asset::LoadState::Failed(_)) => {
                error!("Failed to load prop: {}", id);
                newly_failed.push(id.clone());
                failed_count += 1;
            }
            _ => {}
        }
    }
    for id in newly_failed {
        prop_assets.failed_ids.insert(id);
    }

    if loaded_count + failed_count >= total {
        prop_assets.loaded = true;
        info!(
            "Prop assets loaded: {}/{} (failed: {})",
            loaded_count, total, failed_count
        );
    }
}
