use bevy::prelude::*;
use serde::Deserialize;

use crate::camera::controller::PlayerCamera;
use crate::rendering::device::capabilities::GraphicsCapabilities;
use crate::rendering::water_ownership::{WaterOwnerMarker, WaterSurfaceOwner};

const WATER_CONFIG_PATH: &str = "assets/config/water.yaml";
const DEFAULT_LEVELS: u32 = 6;
const DEFAULT_CELLS_PER_LEVEL: u32 = 64;
const DEFAULT_BASE_CELL_SIZE: f32 = 1.0;
const DEFAULT_MAX_DISTANCE: f32 = 4000.0;
const DEFAULT_MIN_BODY_AREA: f32 = 2048.0;

#[derive(Resource, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WaterRendererConfig {
    pub near_voxel_meshes_enabled: bool,
    pub clipmap_enabled: bool,
    pub clipmap_min_body_area: f32,
    pub clipmap_max_distance: f32,
}

impl Default for WaterRendererConfig {
    fn default() -> Self {
        Self {
            near_voxel_meshes_enabled: true,
            clipmap_enabled: false,
            clipmap_min_body_area: DEFAULT_MIN_BODY_AREA,
            clipmap_max_distance: DEFAULT_MAX_DISTANCE,
        }
    }
}

#[derive(Resource, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WaterClipmapConfig {
    pub enabled: bool,
    pub levels: u32,
    pub cells_per_level: u32,
    pub base_cell_size: f32,
    pub max_distance: f32,
    pub min_body_area: f32,
    pub debug_visible: bool,
}

impl Default for WaterClipmapConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            levels: DEFAULT_LEVELS,
            cells_per_level: DEFAULT_CELLS_PER_LEVEL,
            base_cell_size: DEFAULT_BASE_CELL_SIZE,
            max_distance: DEFAULT_MAX_DISTANCE,
            min_body_area: DEFAULT_MIN_BODY_AREA,
            debug_visible: false,
        }
    }
}

impl WaterClipmapConfig {
    pub fn sanitized(mut self) -> Self {
        self.levels = self.levels.clamp(1, 12);
        self.cells_per_level = self.cells_per_level.max(4);
        self.base_cell_size = self.base_cell_size.max(0.25);
        self.max_distance = self.max_distance.max(self.base_cell_size);
        self.min_body_area = self.min_body_area.max(0.0);
        self
    }

    pub fn load_or_default() -> (WaterRendererConfig, Self) {
        match std::fs::read_to_string(WATER_CONFIG_PATH) {
            Ok(config_str) => match serde_yaml::from_str::<WaterClipmapFileConfig>(&config_str) {
                Ok(file_config) => (file_config.renderer, file_config.clipmap.sanitized()),
                Err(error) => {
                    warn!("Failed to parse water clipmap config: {error}; using defaults");
                    (WaterRendererConfig::default(), Self::default())
                }
            },
            Err(error) => {
                warn!("Failed to read {WATER_CONFIG_PATH}: {error}; using water clipmap defaults");
                (WaterRendererConfig::default(), Self::default())
            }
        }
    }

    pub fn effective_enabled(&self, renderer: &WaterRendererConfig) -> bool {
        self.enabled && renderer.clipmap_enabled
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct WaterClipmapFileConfig {
    renderer: WaterRendererConfig,
    clipmap: WaterClipmapConfig,
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct WaterClipmapOrigin {
    pub snapped_xz: Vec2,
    pub cell_size: f32,
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct WaterClipmapStatus {
    pub enabled: bool,
    pub force_disabled_integrated_gpu: bool,
    pub levels: u32,
    pub mesh_count: u32,
    pub origin: Vec2,
}

#[derive(Component)]
pub struct WaterClipmapLevel {
    pub level: u32,
}

pub struct WaterClipmapPlugin;

impl Plugin for WaterClipmapPlugin {
    fn build(&self, app: &mut App) {
        let (renderer_config, clipmap_config) = WaterClipmapConfig::load_or_default();
        app.insert_resource(renderer_config)
            .insert_resource(clipmap_config)
            .init_resource::<WaterClipmapOrigin>()
            .init_resource::<WaterClipmapStatus>()
            .add_systems(Update, (sync_clipmap_origin, sync_clipmap_placeholders).chain());
    }
}

fn sync_clipmap_origin(
    config: Res<WaterClipmapConfig>,
    camera: Query<&Transform, With<PlayerCamera>>,
    mut origin: ResMut<WaterClipmapOrigin>,
) {
    let Ok(camera_transform) = camera.single() else {
        return;
    };

    let cell_size = config.base_cell_size;
    let camera_xz = Vec2::new(camera_transform.translation.x, camera_transform.translation.z);
    origin.snapped_xz = (camera_xz / cell_size).round() * cell_size;
    origin.cell_size = cell_size;
}

fn sync_clipmap_placeholders(
    mut commands: Commands,
    renderer_config: Res<WaterRendererConfig>,
    config: Res<WaterClipmapConfig>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    origin: Res<WaterClipmapOrigin>,
    mut status: ResMut<WaterClipmapStatus>,
    existing: Query<(Entity, &WaterClipmapLevel)>,
) {
    let integrated = capabilities
        .as_ref()
        .map(|capabilities| capabilities.integrated_gpu)
        .unwrap_or(false);
    let enabled = config.effective_enabled(&renderer_config) && !integrated;

    if !enabled {
        for (entity, _) in &existing {
            commands.entity(entity).despawn();
        }
        *status = WaterClipmapStatus {
            enabled: false,
            force_disabled_integrated_gpu: integrated && config.effective_enabled(&renderer_config),
            levels: config.levels,
            mesh_count: 0,
            origin: origin.snapped_xz,
        };
        return;
    }

    let existing_count = existing.iter().count() as u32;
    if existing_count != config.levels {
        for (entity, _) in &existing {
            commands.entity(entity).despawn();
        }
        for level in 0..config.levels {
            commands.spawn((
                WaterClipmapLevel { level },
                WaterOwnerMarker {
                    owner: WaterSurfaceOwner::Clipmap,
                },
                Transform::from_translation(Vec3::new(origin.snapped_xz.x, 0.0, origin.snapped_xz.y)),
                GlobalTransform::default(),
                Visibility::Hidden,
            ));
        }
    }

    *status = WaterClipmapStatus {
        enabled: true,
        force_disabled_integrated_gpu: false,
        levels: config.levels,
        mesh_count: config.levels,
        origin: origin.snapped_xz,
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipmap_config_is_disabled_by_default() {
        let renderer = WaterRendererConfig::default();
        let config = WaterClipmapConfig::default();

        assert!(!config.effective_enabled(&renderer));
    }

    #[test]
    fn clipmap_config_sanitizes_ranges() {
        let config = WaterClipmapConfig {
            enabled: true,
            levels: 0,
            cells_per_level: 0,
            base_cell_size: 0.0,
            max_distance: 0.0,
            min_body_area: -1.0,
            debug_visible: false,
        }
        .sanitized();

        assert_eq!(config.levels, 1);
        assert_eq!(config.cells_per_level, 4);
        assert_eq!(config.base_cell_size, 0.25);
        assert_eq!(config.max_distance, 0.25);
        assert_eq!(config.min_body_area, 0.0);
    }
}
