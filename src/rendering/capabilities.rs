use bevy::prelude::*;
use bevy::render::batching::gpu_preprocessing::{GpuPreprocessingMode, GpuPreprocessingSupport};
use bevy::render::render_resource::{TextureFormat, TextureFormatFeatureFlags};
use bevy::render::renderer::{RenderAdapter, RenderAdapterInfo};
use bevy::render::view::ViewTarget;
use wgpu::DeviceType;

#[derive(SystemSet, Debug, Hash, PartialEq, Eq, Clone)]
pub struct GraphicsDetectionSet;

/// Runtime information about the active GPU's rendering capabilities.
#[derive(Resource, Clone, Debug, Default)]
pub struct GraphicsCapabilities {
    pub adapter_name: Option<String>,
    pub integrated_gpu: bool,
    pub taa_supported: bool,
    pub ray_tracing_supported: bool,
}

/// Determine whether the current adapter can support temporal anti-aliasing (TAA).
pub fn detect_graphics_capabilities(
    adapter: Option<Res<RenderAdapter>>,
    adapter_info: Option<Res<RenderAdapterInfo>>,
    mut capabilities: ResMut<GraphicsCapabilities>,
    mut commands: Commands,
    mut warned: Local<bool>,
) {
    if capabilities.adapter_name.is_some() {
        return;
    }

    if let (Some(adapter), Some(adapter_info)) = (adapter, adapter_info) {
        let hdr_features = adapter.get_texture_format_features(ViewTarget::TEXTURE_FORMAT_HDR);
        let sdr_features = adapter.get_texture_format_features(TextureFormat::bevy_default());

        let hdr_filterable = hdr_features
            .flags
            .contains(TextureFormatFeatureFlags::FILTERABLE);
        let sdr_filterable = sdr_features
            .flags
            .contains(TextureFormatFeatureFlags::FILTERABLE);
        let features = adapter.features();

        capabilities.adapter_name = Some(adapter_info.name.clone());
        capabilities.integrated_gpu = matches!(adapter_info.device_type, DeviceType::IntegratedGpu);
        capabilities.taa_supported = hdr_filterable && sdr_filterable;
        capabilities.ray_tracing_supported = features
            .contains(bevy::render::settings::WgpuFeatures::EXPERIMENTAL_RAY_QUERY);

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
    } else {
        if !*warned {
            warn!(
                "Render adapter not available yet; TAA will remain disabled until capabilities are known"
            );
            *warned = true;
        }
    }
}
