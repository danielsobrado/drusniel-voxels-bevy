pub mod loader;
pub mod materials;
pub mod spawner;

use bevy::prelude::*;
use serde::Deserialize;
use std::collections::HashMap;

pub struct PropsPlugin;

impl Plugin for PropsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PropAssets>()
            .init_resource::<PropConfig>()
            .init_resource::<spawner::PropsSpawned>()
            .init_resource::<spawner::PropsDebugSpawned>()
            .init_resource::<spawner::PropsLandmarksSpawned>()
            .init_resource::<LandmarkLocations>()
            .add_systems(Startup, loader::load_prop_config)
            .add_systems(
                Update,
                (
                    loader::track_asset_loading,
                    spawner::spawn_props_on_terrain,
                    spawner::spawn_debug_custom_props_near_player,
                    spawner::spawn_landmark_buildings,
                    materials::apply_style_overrides,
                )
                    .chain(),
            );
    }
}

/// Marker component for prop entities
#[derive(Component)]
pub struct Prop {
    pub id: String,
    pub prop_type: PropType,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PropType {
    Tree,
    Rock,
    Bush,
    Flower,
}

/// Cached scene handles for all props
#[derive(Resource, Default)]
pub struct PropAssets {
    pub scenes: HashMap<String, Handle<Scene>>,
    pub loaded: bool,
}

/// Cached landmark building positions for minimap markers.
#[derive(Resource, Default, Clone)]
pub struct LandmarkLocations {
    pub positions: Vec<Vec3>,
}

/// Root configuration loaded from YAML
#[derive(Resource, Default, Deserialize, Clone)]
pub struct PropConfig {
    #[serde(default)]
    pub props: PropCategories,
    #[serde(default)]
    pub style: StyleConfig,
}

#[derive(Default, Deserialize, Clone)]
pub struct PropCategories {
    #[serde(default)]
    pub trees: Vec<PropDefinition>,
    #[serde(default)]
    pub rocks: Vec<PropDefinition>,
    #[serde(default)]
    pub bushes: Vec<PropDefinition>,
    #[serde(default)]
    pub flowers: Vec<PropDefinition>,
}

#[derive(Deserialize, Clone)]
pub struct PropDefinition {
    pub id: String,
    pub path: String,
    #[serde(default = "default_scale_range")]
    pub scale_range: [f32; 2],
    #[serde(default = "default_scale_jitter")]
    pub scale_jitter: f32,
    #[serde(default)]
    pub y_offset: f32,
    #[serde(default)]
    pub spawn_on: Vec<String>,
    #[serde(default = "default_density")]
    pub density: f32,
    #[serde(default)]
    pub min_slope: f32,
    #[serde(default = "default_max_slope")]
    pub max_slope: f32,
    #[serde(default)]
    pub max_count: Option<u32>,
}

fn default_scale_range() -> [f32; 2] {
    [0.8, 1.2]
}

fn default_scale_jitter() -> f32 {
    0.0
}

fn default_density() -> f32 {
    0.01
}

fn default_max_slope() -> f32 {
    0.5
}

#[derive(Deserialize, Clone)]
pub struct StyleConfig {
    #[serde(default = "default_saturation_boost")]
    pub saturation_boost: f32,
    #[serde(default = "default_roughness_min")]
    pub roughness_min: f32,
    #[serde(default = "default_metallic_max")]
    pub metallic_max: f32,
    #[serde(default)]
    pub custom: CustomStyleConfig,
}

impl Default for StyleConfig {
    fn default() -> Self {
        Self {
            saturation_boost: 0.1,
            roughness_min: 0.7,
            metallic_max: 0.1,
            custom: CustomStyleConfig::default(),
        }
    }
}

fn default_saturation_boost() -> f32 {
    0.1
}

fn default_roughness_min() -> f32 {
    0.7
}

fn default_metallic_max() -> f32 {
    0.1
}

#[derive(Deserialize, Clone)]
pub struct CustomStyleConfig {
    #[serde(default = "default_custom_saturation_boost")]
    pub saturation_boost: f32,
    #[serde(default = "default_custom_brightness_boost")]
    pub brightness_boost: f32,
    #[serde(default = "default_custom_roughness_min")]
    pub roughness_min: f32,
    #[serde(default = "default_custom_metallic_max")]
    pub metallic_max: f32,
    #[serde(default = "default_custom_disable_normal_maps")]
    pub disable_normal_maps: bool,
    #[serde(default = "default_custom_disable_occlusion_maps")]
    pub disable_occlusion_maps: bool,
}

impl Default for CustomStyleConfig {
    fn default() -> Self {
        Self {
            saturation_boost: 0.15,
            brightness_boost: 0.05,
            roughness_min: 0.85,
            metallic_max: 0.0,
            disable_normal_maps: true,
            disable_occlusion_maps: true,
        }
    }
}

fn default_custom_saturation_boost() -> f32 {
    0.15
}

fn default_custom_brightness_boost() -> f32 {
    0.05
}

fn default_custom_roughness_min() -> f32 {
    0.85
}

fn default_custom_metallic_max() -> f32 {
    0.0
}

fn default_custom_disable_normal_maps() -> bool {
    true
}

fn default_custom_disable_occlusion_maps() -> bool {
    true
}
