use bevy::prelude::*;
use bevy::pbr::ScreenSpaceAmbientOcclusion;
use bevy::render::renderer::RenderAdapterInfo;
use wgpu::DeviceType;

use crate::rendering::ao_config::{AmbientOcclusionConfig, load_ambient_occlusion_config};

pub struct SsaoPlugin;

impl Plugin for SsaoPlugin {
    fn build(&self, app: &mut App) {
        let config = load_ambient_occlusion_config().unwrap_or_else(|e| {
            warn!("Failed to load AO config: {}, using defaults", e);
            AmbientOcclusionConfig::default()
        });

        app.insert_resource(config)
            .init_resource::<SsaoSupported>()
            .add_systems(Startup, detect_ssao_support)
            .add_systems(PostStartup, configure_camera_ssao);
    }
}

/// Tracks whether SSAO is supported on current hardware.
#[derive(Resource, Default)]
pub struct SsaoSupported(pub bool);

/// Marker for cameras with SSAO.
#[derive(Component)]
pub struct SsaoCamera;

fn detect_ssao_support(
    adapter_info: Option<Res<RenderAdapterInfo>>,
    config: Res<AmbientOcclusionConfig>,
    mut supported: ResMut<SsaoSupported>,
) {
    #[cfg(target_arch = "wasm32")]
    {
        supported.0 = false;
        info!("SSAO disabled: WebGL2 lacks compute shader support");
        return;
    }

    let mut is_integrated = false;
    let mut adapter_name = "Unknown GPU".to_string();

    if let Some(info) = adapter_info {
        adapter_name = info.name.clone();
        let name = adapter_name.to_lowercase();
        is_integrated = name.contains("intel")
            || name.contains("integrated")
            || matches!(info.device_type, DeviceType::IntegratedGpu);
    }

    if config.ssao.disable_on_integrated_gpu && is_integrated {
        supported.0 = false;
        warn!("SSAO disabled: Integrated GPU detected ({})", adapter_name);
        return;
    }

    supported.0 = config.ssao.enabled;
    info!("SSAO support: {} (GPU: {})", supported.0, adapter_name);
}

/// Returns SSAO component bundle for camera if supported.
pub fn ssao_camera_components(
    config: &AmbientOcclusionConfig,
    supported: &SsaoSupported,
) -> Option<ScreenSpaceAmbientOcclusion> {
    if !supported.0 || !config.ssao.enabled {
        return None;
    }

    Some(ScreenSpaceAmbientOcclusion {
        quality_level: config.ssao.quality_level(),
        constant_object_thickness: config.ssao.constant_object_thickness,
        ..default()
    })
}

fn configure_camera_ssao(
    mut commands: Commands,
    config: Res<AmbientOcclusionConfig>,
    supported: Res<SsaoSupported>,
    cameras: Query<Entity, (With<Camera3d>, Without<SsaoCamera>)>,
) {
    for entity in cameras.iter() {
        commands.entity(entity).insert(SsaoCamera);

        if let Some(ssao) = ssao_camera_components(&config, &supported) {
            commands.entity(entity).insert(ssao);
            info!("SSAO enabled on camera {:?}", entity);
        }
    }
}

/// Runtime toggle for SSAO (useful for settings menu).
pub fn toggle_ssao(
    mut commands: Commands,
    config: Res<AmbientOcclusionConfig>,
    supported: Res<SsaoSupported>,
    cameras: Query<(Entity, Option<&ScreenSpaceAmbientOcclusion>), With<SsaoCamera>>,
    enable: bool,
) {
    for (entity, existing) in cameras.iter() {
        if enable && existing.is_none() && supported.0 {
            if let Some(ssao) = ssao_camera_components(&config, &supported) {
                commands.entity(entity).insert(ssao);
            }
        } else if !enable && existing.is_some() {
            commands.entity(entity).remove::<ScreenSpaceAmbientOcclusion>();
        }
    }
}
