use bevy::render::settings::{Backends, WgpuLimits};

use crate::diagnostics::bench::BenchConfig;
use crate::shared::constants::{
    FALLBACK_BIND_GROUPS, FALLBACK_STORAGE_TEXTURES, MIN_SAMPLERS_PER_STAGE, MIN_TEXTURES_PER_STAGE,
};

/// Pre-flight GPU detection to query actual device limits before Bevy initializes.
///
/// This function creates a temporary wgpu instance to probe the GPU's actual capabilities,
/// ensuring we request appropriate limits for our shaders without exceeding hardware support.
///
/// # Returns
/// A tuple of `(WgpuLimits, Option<Backends>)` where:
/// - `WgpuLimits` contains the texture/sampler limits to request
/// - `Option<Backends>` specifies which graphics backend to use.
pub(super) fn detect_gpu_limits(use_vulkan_on_windows: bool) -> (WgpuLimits, Option<Backends>) {
    #[cfg(target_os = "windows")]
    let (backends, backend_name) = if use_vulkan_on_windows {
        (wgpu::Backends::VULKAN, "Vulkan")
    } else {
        (wgpu::Backends::DX12, "DX12")
    };
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
            eprintln!("[GPU] Using {} backend for Bevy", backend_name);
            return (limits, Some(backends));
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
    return (limits, Some(backends));
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

pub(super) fn visual_regression_bench_uses_vulkan(bench_config: Option<&BenchConfig>) -> bool {
    bench_config.is_some_and(|config| {
        matches!(
            config.scene_path.file_name().and_then(|name| name.to_str()),
            Some("visual-regression.toml" | "inventory-ui.toml")
        )
    })
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
