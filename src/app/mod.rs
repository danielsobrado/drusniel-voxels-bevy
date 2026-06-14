//! Application bootstrap and runtime mode selection.

pub mod runtime_lock;

mod cli;
mod gpu;
mod logging;
mod mode;
mod plugins;
mod window;

use crate::diagnostics::bench::{
    BenchPlugin, bench_scene_requires_gameplay, bench_scene_requires_inventory_ui,
    bench_scene_skips_props,
};
use crate::diagnostics::debug_ui::DebugUiPlugin;
use crate::editor::bridge::EditorRuntimeBridgePlugin;
use crate::editor::runtime::RuntimeWriteCommandPlugin;
use crate::gameplay::building::BuildingPlugin;
use crate::gameplay::camera::plugin::CameraPlugin;
use crate::gameplay::entity::EntityPlugin;
use crate::gameplay::input::InputPlugin;
use crate::gameplay::interaction::InteractionPlugin;
use crate::gameplay::player::PlayerPlugin;
use crate::gameplay::viewmodel::PickaxePlugin;
use crate::particles::ParticlePlugin;
use crate::physics::PhysicsPlugin;
use crate::props::PropsPlugin;
use crate::rendering::AdaptiveGIPlugin;
use crate::rendering::plugin::RenderingPlugin;
use crate::terrain::TerrainToolsPlugin;
use crate::ui::chat::ChatPlugin;
use crate::ui::inventory::InventoryUiPlugin;
use crate::ui::map::MapPlugin;
use crate::ui::menu::PauseMenuPlugin;
use crate::voxel::plugin::VoxelPlugin;
use crate::world::environment::AtmospherePlugin;
use crate::world::environment::atmosphere::{AtmosphereIntegrationPlugin, FogPlugin};
use crate::world::environment::vegetation::VegetationPlugin;
use crate::world::environment::weather::WeatherPlugin;
use crate::world::rules::WorldRulesPlugin;
use bevy::asset::AssetPlugin;
use bevy::diagnostic::{
    EntityCountDiagnosticsPlugin, FrameTimeDiagnosticsPlugin, SystemInformationDiagnosticsPlugin,
};
use bevy::log::LogPlugin;
use bevy::prelude::*;
use bevy::render::RenderPlugin;
use bevy::render::settings::{RenderCreation, WgpuSettings};
use bevy::window::{PresentMode, Window, WindowPlugin, WindowResolution};
use clap::Parser;

use self::cli::{BenchCli, BenchConfig};
use self::gpu::{detect_gpu_limits, visual_regression_bench_uses_vulkan};
use self::logging::load_logging_config;
use self::mode::{
    editor_native_viewport_requested, editor_runtime_requested, runtime_instance_kind,
};
use self::plugins::run_editor_runtime;
use self::runtime_lock::RuntimeInstanceLock;
use self::window::asset_file_path;

pub fn run() {
    let cli = BenchCli::parse();
    let editor_runtime = editor_runtime_requested(&cli);
    let editor_native_viewport = editor_native_viewport_requested(&cli);
    let bench_config = BenchConfig::from_cli(&cli);
    if (editor_runtime || editor_native_viewport) && bench_config.is_some() {
        eprintln!("--editor-runtime ignores --bench; start benchmark mode separately");
    }
    if cli.bench_headless {
        eprintln!("--bench-headless requested; this build falls back to windowed rendering");
    }
    let runtime_kind = runtime_instance_kind(
        editor_runtime,
        editor_native_viewport,
        bench_config.as_ref(),
    );
    let _runtime_lock = match RuntimeInstanceLock::acquire(runtime_kind) {
        Ok(lock) => {
            eprintln!("[LOCK] Runtime lock acquired: {}", lock.path().display());
            lock
        }
        Err(error) => {
            eprintln!("[LOCK] {error}");
            std::process::exit(2);
        }
    };

    // Load logging configuration from YAML
    let log_filter = load_logging_config();

    if editor_runtime && !editor_native_viewport {
        run_editor_runtime(log_filter);
        return;
    }

    // Pre-flight: detect GPU and get actual limits
    let visual_regression_uses_vulkan = visual_regression_bench_uses_vulkan(bench_config.as_ref());
    let (limits, backends) = detect_gpu_limits(visual_regression_uses_vulkan);

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
            .set(AssetPlugin {
                file_path: asset_file_path(),
                ..default()
            })
            .set(ImagePlugin::default_nearest())
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: if editor_native_viewport {
                        "Drusniel Bevy Viewport".to_string()
                    } else {
                        "Voxel Builder".to_string()
                    },
                    resolution: if std::env::var("VOXELS_BENCH_TINY_WINDOW")
                        .is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    {
                        // Software-render bench escape hatch (WSL/llvmpipe): a tiny
                        // window makes per-frame rasterisation near-free so the
                        // frame-budgeted gen/meshing pipeline can advance and reach
                        // the seam-audit checkpoint. Off by default; window size does
                        // not affect terrain geometry or the seam audit.
                        WindowResolution::new(80, 60)
                    } else if editor_native_viewport {
                        WindowResolution::new(1280, 720)
                    } else {
                        WindowResolution::new(1920, 1080)
                    },
                    decorations: !editor_native_viewport,
                    resizable: true,
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
        .add_plugins(crate::content::ContentPlugin)
        .add_plugins(VoxelPlugin)
        .add_plugins(WeatherPlugin)
        .add_plugins(RenderingPlugin)
        .add_plugins(WorldRulesPlugin)
        .add_plugins(RuntimeWriteCommandPlugin)
        .add_plugins(EditorRuntimeBridgePlugin::default())
        .add_plugins(AdaptiveGIPlugin)
        .add_plugins(CameraPlugin)
        .add_plugins(VegetationPlugin)
        .add_plugins(AtmospherePlugin)
        .add_plugins(AtmosphereIntegrationPlugin) // Physical sky rendering
        .add_plugins(FogPlugin)
        .add_plugins(EntityPlugin)
        .add_plugins(crate::audio::plugin::AudioEventsPlugin);

    let bench_skips_props = bench_config
        .as_ref()
        .is_some_and(|config| bench_scene_skips_props(&config.scene_path));
    if !bench_skips_props {
        app.add_plugins(PropsPlugin);
    }

    if !visual_regression_uses_vulkan {
        app.add_plugins(ParticlePlugin);
    }

    if let Some(config) = bench_config.as_ref() {
        if bench_scene_requires_gameplay(&config.scene_path) {
            app.add_plugins(PhysicsPlugin).add_plugins(PlayerPlugin);
        }
        if bench_scene_requires_inventory_ui(&config.scene_path) {
            app.add_plugins(InventoryUiPlugin);
        }
        app.add_plugins(BenchPlugin);
    } else if editor_native_viewport {
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
