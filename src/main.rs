//! Voxel Builder - A voxel sandbox game engine.
//!
//! This is the main entry point that initializes the Bevy app with all plugins.

use bevy::app::ScheduleRunnerPlugin;
use bevy::diagnostic::{
    EntityCountDiagnosticsPlugin, FrameTimeDiagnosticsPlugin, SystemInformationDiagnosticsPlugin,
};
use bevy::log::LogPlugin;
use bevy::prelude::*;
use bevy::render::RenderPlugin;
use bevy::render::settings::{Backends, RenderCreation, WgpuLimits, WgpuSettings};
use bevy::window::{PresentMode, Window, WindowPlugin, WindowResolution};
use clap::Parser;
use std::collections::HashMap;
use std::time::Duration;
use voxel_builder::atmosphere::{AtmosphereIntegrationPlugin, FogPlugin};
use voxel_builder::bench::{BenchCli, BenchConfig, BenchPlugin, bench_scene_requires_gameplay};
use voxel_builder::building::BuildingPlugin;
use voxel_builder::camera::plugin::CameraPlugin;
use voxel_builder::chat::ChatPlugin;
use voxel_builder::constants::{
    DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z, FALLBACK_BIND_GROUPS,
    FALLBACK_STORAGE_TEXTURES, MIN_SAMPLERS_PER_STAGE, MIN_TEXTURES_PER_STAGE,
};
use voxel_builder::debug_ui::DebugUiPlugin;
use voxel_builder::editor_bridge::EditorRuntimeBridgePlugin;
use voxel_builder::entity::EntityPlugin;
use voxel_builder::environment::AtmospherePlugin;
use voxel_builder::input::InputPlugin;
use voxel_builder::interaction::InteractionPlugin;
use voxel_builder::inventory_ui::InventoryUiPlugin;
use voxel_builder::map::MapPlugin;
use voxel_builder::menu::PauseMenuPlugin;
use voxel_builder::particles::ParticlePlugin;
use voxel_builder::physics::PhysicsPlugin;
use voxel_builder::player::PlayerPlugin;
use voxel_builder::props::PropsPlugin;
use voxel_builder::rendering::AdaptiveGIPlugin;
use voxel_builder::rendering::array_loader::AtlasMapping;
use voxel_builder::rendering::plugin::RenderingPlugin;
use voxel_builder::rendering::quality::RenderQualityPreset;
use voxel_builder::runtime_commands::RuntimeWriteCommandPlugin;
use voxel_builder::terrain::TerrainToolsPlugin;
use voxel_builder::vegetation::VegetationPlugin;
use voxel_builder::viewmodel::PickaxePlugin;
use voxel_builder::voxel::meshing::MeshMode;
use voxel_builder::voxel::plugin::VoxelPlugin;
use voxel_builder::voxel::plugin::WorldConfig;
use voxel_builder::voxel::world::{VoxelWorld, WorldBounds};
use voxel_builder::weather::WeatherPlugin;
use voxel_builder::world_rules::{ProtectedAreaRegistry, WorldRulesPlugin};

mod input;

/// Pre-flight GPU detection to query actual device limits before Bevy initializes.
///
/// This function creates a temporary wgpu instance to probe the GPU's actual capabilities,
/// ensuring we request appropriate limits for our shaders without exceeding hardware support.
///
/// # Returns
/// A tuple of `(WgpuLimits, Option<Backends>)` where:
/// - `WgpuLimits` contains the texture/sampler limits to request
/// - `Option<Backends>` specifies which graphics backend to use (DX12 on Windows, auto elsewhere)
fn detect_gpu_limits() -> (WgpuLimits, Option<Backends>) {
    #[cfg(target_os = "windows")]
    let (backends, backend_name) = (wgpu::Backends::DX12, "DX12");
    #[cfg(target_os = "macos")]
    let (backends, backend_name) = (wgpu::Backends::METAL, "Metal");
    #[cfg(target_os = "linux")]
    let (backends, backend_name) = (wgpu::Backends::VULKAN, "Vulkan");
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let (backends, backend_name) = (wgpu::Backends::all(), "Auto");

    eprintln!(
        "[GPU] Initializing wgpu instance with backend: {}",
        backend_name
    );
    eprintln!("[GPU] Target OS: {}", std::env::consts::OS);
    eprintln!("[GPU] Target Arch: {}", std::env::consts::ARCH);

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        ..Default::default()
    });

    // List all available adapters for debugging
    eprintln!("[GPU] Enumerating available adapters...");
    let adapters: Vec<_> = instance.enumerate_adapters(wgpu::Backends::all());
    for (i, adapter) in adapters.iter().enumerate() {
        let info = adapter.get_info();
        eprintln!(
            "[GPU]   [{}] {} ({:?}, {:?})",
            i, info.name, info.backend, info.device_type
        );
    }
    eprintln!("[GPU] Found {} adapter(s)", adapters.len());

    // Try to get the best adapter
    eprintln!("[GPU] Requesting high-performance adapter...");
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }));

    if let Ok(adapter) = adapter {
        let info = adapter.get_info();
        let device_limits = adapter.limits();
        let features = adapter.features();

        println!("╔══════════════════════════════════════════════════════════════╗");
        println!("║                    GPU PRE-FLIGHT DETECTION                  ║");
        println!("╠══════════════════════════════════════════════════════════════╣");
        println!("║ GPU: {:<55} ║", truncate_str(&info.name, 55));
        println!("║ Backend: {:<51?} ║", info.backend);
        println!("║ Device Type: {:<47?} ║", info.device_type);
        println!("║ Driver: {:<52} ║", truncate_str(&info.driver, 52));
        println!(
            "║ Driver Info: {:<47} ║",
            truncate_str(&info.driver_info, 47)
        );
        println!("╠══════════════════════════════════════════════════════════════╣");
        println!(
            "║ Max Textures/Stage: {:<40} ║",
            device_limits.max_sampled_textures_per_shader_stage
        );
        println!(
            "║ Max Samplers/Stage: {:<40} ║",
            device_limits.max_samplers_per_shader_stage
        );
        println!("║ Max Bind Groups: {:<43} ║", device_limits.max_bind_groups);
        println!(
            "║ Max Storage Textures: {:<38} ║",
            device_limits.max_storage_textures_per_shader_stage
        );
        println!(
            "║ Max Texture Dimension 2D: {:<34} ║",
            device_limits.max_texture_dimension_2d
        );
        println!(
            "║ Max Buffer Size: {:<43} ║",
            format_bytes(device_limits.max_buffer_size)
        );
        println!("╠══════════════════════════════════════════════════════════════╣");
        println!("║ Required Min Textures: {:<37} ║", MIN_TEXTURES_PER_STAGE);
        println!("║ Required Min Samplers: {:<37} ║", MIN_SAMPLERS_PER_STAGE);
        println!("╚══════════════════════════════════════════════════════════════╝");

        // Log additional debug info
        eprintln!("[GPU] Selected adapter: {} ({:?})", info.name, info.backend);
        eprintln!(
            "[GPU] Vendor ID: 0x{:04X}, Device ID: 0x{:04X}",
            info.vendor, info.device
        );
        eprintln!("[GPU] Features enabled: {:?}", features);

        // Check if limits are sufficient
        if device_limits.max_sampled_textures_per_shader_stage < MIN_TEXTURES_PER_STAGE {
            eprintln!(
                "[GPU] WARNING: Device max_sampled_textures ({}) < required ({})",
                device_limits.max_sampled_textures_per_shader_stage, MIN_TEXTURES_PER_STAGE
            );
        }
        if device_limits.max_samplers_per_shader_stage < MIN_SAMPLERS_PER_STAGE {
            eprintln!(
                "[GPU] WARNING: Device max_samplers ({}) < required ({})",
                device_limits.max_samplers_per_shader_stage, MIN_SAMPLERS_PER_STAGE
            );
        }

        // Use actual device limits, but ensure minimums for our shaders
        let limits = WgpuLimits {
            max_sampled_textures_per_shader_stage: device_limits
                .max_sampled_textures_per_shader_stage
                .max(MIN_TEXTURES_PER_STAGE),
            max_samplers_per_shader_stage: device_limits
                .max_samplers_per_shader_stage
                .max(MIN_SAMPLERS_PER_STAGE),
            max_storage_textures_per_shader_stage: device_limits
                .max_storage_textures_per_shader_stage,
            max_bind_groups: device_limits.max_bind_groups,
            ..WgpuLimits::default()
        };

        eprintln!(
            "[GPU] Configured limits: textures={}, samplers={}, bind_groups={}",
            limits.max_sampled_textures_per_shader_stage,
            limits.max_samplers_per_shader_stage,
            limits.max_bind_groups
        );

        #[cfg(target_os = "windows")]
        {
            eprintln!("[GPU] Using DX12 backend for Bevy");
            return (limits, Some(Backends::DX12));
        }
        #[cfg(not(target_os = "windows"))]
        {
            eprintln!("[GPU] Using default backend for Bevy");
            return (limits, None);
        }
    }

    // Fallback if no adapter found - use safe defaults
    eprintln!("[GPU] ERROR: Could not detect GPU adapter!");
    eprintln!("[GPU] Requested backend: {}", backend_name);
    eprintln!("[GPU] Using fallback limits (may cause issues)");

    let limits = WgpuLimits {
        max_sampled_textures_per_shader_stage: MIN_TEXTURES_PER_STAGE,
        max_samplers_per_shader_stage: MIN_SAMPLERS_PER_STAGE,
        max_storage_textures_per_shader_stage: FALLBACK_STORAGE_TEXTURES,
        max_bind_groups: FALLBACK_BIND_GROUPS,
        ..WgpuLimits::default()
    };

    #[cfg(target_os = "windows")]
    return (limits, Some(Backends::DX12));
    #[cfg(not(target_os = "windows"))]
    return (limits, None);
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} bytes", bytes)
    }
}

/// Truncates a string to a maximum length, adding "..." if truncated.
///
/// This function is Unicode-safe and will not panic on non-ASCII strings.
/// It counts characters rather than bytes to ensure proper truncation.
///
/// # Arguments
/// * `s` - The string to truncate
/// * `max_len` - Maximum length including the "..." suffix if truncated
///
/// # Returns
/// The original string if it fits, or a truncated version with "..." suffix
fn truncate_str(s: &str, max_len: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_len {
        s.to_string()
    } else if max_len <= 3 {
        // If max_len is too small for "...", just return dots
        ".".repeat(max_len)
    } else {
        let truncated: String = s.chars().take(max_len - 3).collect();
        format!("{}...", truncated)
    }
}

/// Logging configuration loaded from YAML.
#[derive(serde::Deserialize, Default)]
struct LoggingConfig {
    #[serde(default = "default_log_level")]
    default_level: String,
    #[serde(default)]
    modules: HashMap<String, String>,
}

fn default_log_level() -> String {
    "info".to_string()
}

/// Load logging configuration from YAML file and generate a filter string.
fn load_logging_config() -> String {
    let config_path = "assets/config/logging.yaml";

    let config: LoggingConfig = match std::fs::read_to_string(config_path) {
        Ok(contents) => match serde_yaml::from_str(&contents) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("[LOG] Failed to parse {}: {}", config_path, e);
                LoggingConfig::default()
            }
        },
        Err(e) => {
            eprintln!(
                "[LOG] Failed to read {}: {}, using defaults",
                config_path, e
            );
            LoggingConfig::default()
        }
    };

    // Build filter string: "default_level,module1=level1,module2=level2,..."
    let mut filter_parts = vec![config.default_level.clone()];

    for (module, level) in &config.modules {
        filter_parts.push(format!("{}={}", module, level));
    }

    let filter = filter_parts.join(",");
    eprintln!("[LOG] Filter: {}", filter);
    filter
}

fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name).as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("on")
    )
}

fn editor_runtime_requested(cli: &BenchCli) -> bool {
    cli.editor_runtime || env_flag("DRUSNIEL_EDITOR_RUNTIME")
}

fn run_editor_runtime(log_filter: String) {
    let size_chunks = IVec3::new(
        DEFAULT_WORLD_CHUNKS_X,
        DEFAULT_WORLD_CHUNKS_Y,
        DEFAULT_WORLD_CHUNKS_Z,
    );

    info!("Starting Drusniel editor runtime without a native Bevy window");

    let mut app = App::new();
    app.add_plugins(MinimalPlugins.set(ScheduleRunnerPlugin::run_loop(Duration::from_millis(16))))
        .add_plugins(LogPlugin {
            filter: log_filter,
            level: bevy::log::Level::TRACE,
            ..default()
        })
        .insert_resource(WorldConfig {
            size_chunks,
            chunk_size: voxel_builder::constants::CHUNK_SIZE_I32,
            greedy_meshing: true,
        })
        .insert_resource(WorldBounds::from_size_chunks(size_chunks))
        .insert_resource(VoxelWorld::new(size_chunks))
        .insert_resource(voxel_builder::voxel::meshing::MeshSettings {
            mode: MeshMode::SurfaceNets,
            ..default()
        })
        .insert_resource(RenderQualityPreset::default())
        .insert_resource(AtlasMapping::default())
        .insert_resource(ProtectedAreaRegistry::default())
        .add_plugins(RuntimeWriteCommandPlugin)
        .add_plugins(EditorRuntimeBridgePlugin::enabled());

    app.run();
}

fn main() {
    let cli = BenchCli::parse();
    let editor_runtime = editor_runtime_requested(&cli);
    let bench_config = BenchConfig::from_cli(&cli);
    if editor_runtime && bench_config.is_some() {
        eprintln!("--editor-runtime ignores --bench; start benchmark mode separately");
    }
    if cli.bench_headless {
        eprintln!("--bench-headless requested; this build falls back to windowed rendering");
    }

    // Load logging configuration from YAML
    let log_filter = load_logging_config();

    if editor_runtime {
        run_editor_runtime(log_filter);
        return;
    }

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
            .set(LogPlugin {
                filter: log_filter,
                level: bevy::log::Level::TRACE, // Allow all levels, filter controls what shows
                ..default()
            })
            .set(ImagePlugin::default_nearest())
            .set(WindowPlugin {
                primary_window: Some(Window {
                    resolution: WindowResolution::new(1920, 1080),
                    present_mode: if bench_config.is_some() {
                        PresentMode::AutoNoVsync
                    } else {
                        PresentMode::AutoVsync
                    },
                    ..default()
                }),
                ..default()
            })
            .set(RenderPlugin {
                render_creation: RenderCreation::Automatic(wgpu_settings),
                ..default()
            })
    };

    let mut app = App::new();
    if let Some(config) = bench_config.clone() {
        app.insert_resource(config);
    }

    app.add_plugins(plugins)
        .add_plugins((
            FrameTimeDiagnosticsPlugin::default(),
            EntityCountDiagnosticsPlugin::default(),
            SystemInformationDiagnosticsPlugin::default(),
        ))
        .add_plugins(VoxelPlugin)
        .add_plugins(WeatherPlugin)
        .add_plugins(RenderingPlugin)
        .add_plugins(WorldRulesPlugin)
        .add_plugins(RuntimeWriteCommandPlugin)
        .add_plugins(EditorRuntimeBridgePlugin::default())
        .add_plugins(AdaptiveGIPlugin)
        .add_plugins(CameraPlugin)
        .add_plugins(VegetationPlugin)
        .add_plugins(PropsPlugin)
        .add_plugins(AtmospherePlugin)
        .add_plugins(AtmosphereIntegrationPlugin) // Physical sky rendering
        .add_plugins(FogPlugin)
        .add_plugins(EntityPlugin)
        .add_plugins(ParticlePlugin);

    if let Some(config) = bench_config.as_ref() {
        if bench_scene_requires_gameplay(&config.scene_path) {
            app.add_plugins(PhysicsPlugin).add_plugins(PlayerPlugin);
        }
        app.add_plugins(BenchPlugin);
    } else {
        app.add_plugins(PhysicsPlugin)
            .add_plugins(PlayerPlugin)
            .add_plugins(InteractionPlugin)
            .add_plugins(PickaxePlugin)
            .add_plugins(MapPlugin)
            .add_plugins(InventoryUiPlugin)
            .add_plugins(ChatPlugin)
            .add_plugins(PauseMenuPlugin)
            .add_plugins(DebugUiPlugin)
            .add_plugins(TerrainToolsPlugin)
            .add_plugins(InputPlugin)
            .add_plugins(BuildingPlugin);
    }

    app.run();
}
