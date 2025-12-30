use bevy::diagnostic::FrameTimeDiagnosticsPlugin;
use bevy::prelude::*;
use bevy::render::settings::{Backends, RenderCreation, WgpuSettings, WgpuLimits};
use bevy::render::RenderPlugin;
use voxel_builder::camera::plugin::CameraPlugin;
use voxel_builder::chat::ChatPlugin;
use voxel_builder::entity::EntityPlugin;
use voxel_builder::environment::AtmospherePlugin;
use voxel_builder::atmosphere::FogPlugin;
use voxel_builder::interaction::InteractionPlugin;
use voxel_builder::map::MapPlugin;
use voxel_builder::menu::PauseMenuPlugin;
use voxel_builder::props::PropsPlugin;
use voxel_builder::physics::PhysicsPlugin;
use voxel_builder::player::PlayerPlugin;
use voxel_builder::rendering::plugin::RenderingPlugin;
use voxel_builder::vegetation::VegetationPlugin;
use voxel_builder::viewmodel::PickaxePlugin;
use voxel_builder::voxel::plugin::VoxelPlugin;
use voxel_builder::debug_ui::DebugUiPlugin;
use voxel_builder::particles::ParticlePlugin;

/// Pre-flight GPU detection to query actual device limits before Bevy initializes.
/// Returns limits tailored to the detected GPU capabilities.
fn detect_gpu_limits() -> (WgpuLimits, Option<Backends>) {
    // Minimum limits our shaders require
    const MIN_TEXTURES: u32 = 64;  // BuildingMaterial(17) + Bevy internals + headroom
    const MIN_SAMPLERS: u32 = 64;

    #[cfg(target_os = "windows")]
    let backends = wgpu::Backends::DX12;
    #[cfg(target_os = "macos")]
    let backends = wgpu::Backends::METAL;
    #[cfg(target_os = "linux")]
    let backends = wgpu::Backends::VULKAN;
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let backends = wgpu::Backends::all();

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        ..Default::default()
    });

    // Try to get the best adapter
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }));

    if let Ok(adapter) = adapter {
        let info = adapter.get_info();
        let device_limits = adapter.limits();

        println!("╔══════════════════════════════════════════════════════════════╗");
        println!("║                    GPU PRE-FLIGHT DETECTION                  ║");
        println!("╠══════════════════════════════════════════════════════════════╣");
        println!("║ GPU: {:<55} ║", truncate_str(&info.name, 55));
        println!("║ Backend: {:<51?} ║", info.backend);
        println!("║ Device Type: {:<47?} ║", info.device_type);
        println!("╠══════════════════════════════════════════════════════════════╣");
        println!("║ Max Textures/Stage: {:<40} ║", device_limits.max_sampled_textures_per_shader_stage);
        println!("║ Max Samplers/Stage: {:<40} ║", device_limits.max_samplers_per_shader_stage);
        println!("║ Max Bind Groups: {:<43} ║", device_limits.max_bind_groups);
        println!("║ Max Storage Textures: {:<38} ║", device_limits.max_storage_textures_per_shader_stage);
        println!("╚══════════════════════════════════════════════════════════════╝");

        // Use actual device limits, but ensure minimums for our shaders
        let limits = WgpuLimits {
            max_sampled_textures_per_shader_stage: device_limits
                .max_sampled_textures_per_shader_stage
                .max(MIN_TEXTURES),
            max_samplers_per_shader_stage: device_limits
                .max_samplers_per_shader_stage
                .max(MIN_SAMPLERS),
            max_storage_textures_per_shader_stage: device_limits
                .max_storage_textures_per_shader_stage,
            max_bind_groups: device_limits.max_bind_groups,
            ..WgpuLimits::default()
        };

        #[cfg(target_os = "windows")]
        return (limits, Some(Backends::DX12));
        #[cfg(not(target_os = "windows"))]
        return (limits, None);
    }

    // Fallback if no adapter found - use safe defaults
    eprintln!("Warning: Could not detect GPU, using fallback limits");
    let limits = WgpuLimits {
        max_sampled_textures_per_shader_stage: MIN_TEXTURES,
        max_samplers_per_shader_stage: MIN_SAMPLERS,
        max_storage_textures_per_shader_stage: 8,
        max_bind_groups: 8,
        ..WgpuLimits::default()
    };

    #[cfg(target_os = "windows")]
    return (limits, Some(Backends::DX12));
    #[cfg(not(target_os = "windows"))]
    return (limits, None);
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len - 3])
    }
}

fn main() {
    // Pre-flight: detect GPU and get actual limits
    let (limits, backends) = detect_gpu_limits();

    let plugins = {
        let mut wgpu_settings = WgpuSettings {
            limits,
            ..default()
        };

        if let Some(b) = backends {
            wgpu_settings.backends = Some(b);
        }

        DefaultPlugins
            .set(ImagePlugin::default_nearest())
            .set(RenderPlugin {
                render_creation: RenderCreation::Automatic(wgpu_settings),
                ..default()
            })
    };

    App::new()
        .add_plugins(plugins)
        .add_plugins(FrameTimeDiagnosticsPlugin::default())
        .add_plugins(PhysicsPlugin)
        .add_plugins(PlayerPlugin)
        .add_plugins(VoxelPlugin)
        .add_plugins(RenderingPlugin)
        .add_plugins(CameraPlugin)
        .add_plugins(InteractionPlugin)
        .add_plugins(PickaxePlugin)
        .add_plugins(MapPlugin)
        .add_plugins(VegetationPlugin)
        .add_plugins(ChatPlugin)
        .add_plugins(PauseMenuPlugin)
        .add_plugins(PropsPlugin)
        .add_plugins(AtmospherePlugin)
        .add_plugins(FogPlugin)
        .add_plugins(EntityPlugin)
        .add_plugins(DebugUiPlugin)
        .add_plugins(ParticlePlugin)
        .run();
}
