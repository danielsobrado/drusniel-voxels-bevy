use bevy::prelude::*;
use bevy::render::batching::gpu_preprocessing::{GpuPreprocessingMode, GpuPreprocessingSupport};
use bevy::render::render_resource::{TextureFormat, TextureFormatFeatureFlags};
use bevy::render::renderer::{RenderAdapter, RenderAdapterInfo};
use bevy::render::view::ViewTarget;
use wgpu::DeviceType;

#[derive(SystemSet, Debug, Hash, PartialEq, Eq, Clone)]
pub struct GraphicsDetectionSet;

/// Runtime information about the active GPU's rendering capabilities.
#[derive(Resource, Clone, Debug, Default, PartialEq)]
pub struct GraphicsCapabilities {
    pub adapter_name: Option<String>,
    pub integrated_gpu: bool,
    pub taa_supported: bool,
    pub ray_tracing_supported: bool,
}

impl GraphicsCapabilities {
    pub fn conservative_weather_path(&self) -> bool {
        self.integrated_gpu
    }
}

/// Determine whether the current adapter can support temporal anti-aliasing (TAA).
pub fn detect_graphics_capabilities(
    adapter: Option<Res<RenderAdapter>>,
    adapter_info: Option<Res<RenderAdapterInfo>>,
    mut capabilities: ResMut<GraphicsCapabilities>,
    mut commands: Commands,
) {
    let (Some(adapter), Some(adapter_info)) = (adapter, adapter_info) else {
        warn_once!(
            "Render adapter not available yet; TAA will remain disabled until capabilities are known"
        );
        return;
    };

    let hdr_features = adapter.get_texture_format_features(ViewTarget::TEXTURE_FORMAT_HDR);
    let sdr_features = adapter.get_texture_format_features(TextureFormat::bevy_default());
    let hdr_filterable = hdr_features
        .flags
        .contains(TextureFormatFeatureFlags::FILTERABLE);
    let sdr_filterable = sdr_features
        .flags
        .contains(TextureFormatFeatureFlags::FILTERABLE);
    let features = adapter.features();
    let new_capabilities = GraphicsCapabilities {
        adapter_name: Some(adapter_info.name.clone()),
        integrated_gpu: matches!(adapter_info.device_type, DeviceType::IntegratedGpu),
        taa_supported: hdr_filterable && sdr_filterable,
        ray_tracing_supported: features
            .contains(bevy::render::settings::WgpuFeatures::EXPERIMENTAL_RAY_QUERY),
    };

    if *capabilities == new_capabilities {
        return;
    }

    *capabilities = new_capabilities;

    info!(
        adapter = %adapter_info.name,
        backend = ?adapter_info.backend,
        integrated_gpu = capabilities.integrated_gpu,
        taa_supported = capabilities.taa_supported,
        ray_tracing_supported = capabilities.ray_tracing_supported,
        hdr_filterable,
        sdr_filterable,
        "Detected GPU capabilities",
    );

    if capabilities.integrated_gpu {
        commands.insert_resource(GpuPreprocessingSupport {
            max_supported_mode: GpuPreprocessingMode::None,
        });
        info!("Integrated GPU detected; disabling GPU preprocessing.");
    }
}

/// Copy capabilities from the render world back into the main app.
pub fn sync_capabilities_to_main(
    capabilities: Res<GraphicsCapabilities>,
    main_world: Option<ResMut<bevy::render::MainWorld>>,
) {
    if !capabilities.is_changed() {
        return;
    }

    let Some(mut main_world) = main_world else {
        return;
    };
    let main_world = main_world.as_mut();

    if let Some(mut main_capabilities) = main_world.get_resource_mut::<GraphicsCapabilities>() {
        if *main_capabilities != *capabilities {
            *main_capabilities = capabilities.clone();
        }
    } else {
        main_world.insert_resource(capabilities.clone());
    }
}
