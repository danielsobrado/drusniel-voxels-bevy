# Commercial-quality post-processing in Bevy 0.17 for voxel games

Document status (2026-05-17): historical Bevy 0.17 reference. The current repo baseline is Bevy 0.18.1, so verify every API snippet against current code and Bevy 0.18.1 docs before using it.

Current code note: this document was written for Bevy 0.17-era post-processing APIs. It remains useful for rendering rationale and quality targets, but it is not the current implementation guide for this repo.

Bevy 0.17 delivers a mature post-processing pipeline capable of achieving the polished aesthetic of games like Valheim -- combining stylized textures with modern lighting and effects. The key to commercial-quality graphics lies in properly configuring HDR rendering with TonyMcMapface tonemapping, subtle energy-conserving bloom, per-vertex ambient occlusion baked into voxel meshes, and cascade shadows tuned for large worlds. This report provides implementation guidance with working code examples for a Valheim/Skyrim-style 3D voxel game.

Bevy 0.17 reorganized post-processing into dedicated modules (`bevy::post_process`, `bevy::anti_alias`) and introduced breaking changes -- HDR is now a separate `Hdr` marker component rather than a camera flag. The rendering pipeline supports VBAO ambient occlusion, deferred rendering with screen-space reflections, volumetric fog with god rays, and multiple anti-aliasing methods. Performance optimization relies on per-chunk mesh generation, greedy meshing, frustum culling, and Tracy-based GPU profiling.

---

## Core rendering pipeline and HDR configuration

The foundation of commercial-quality graphics starts with HDR rendering, which enables high dynamic range values above 1.0 for realistic lighting and bloom effects. In Bevy 0.17, HDR activation changed significantly from previous versions -- instead of setting `Camera { hdr: true }`, you now add a separate `Hdr` marker component.

```rust
use bevy::{
    prelude::*,
    core_pipeline::tonemapping::{DebandDither, Tonemapping},
    post_process::bloom::{Bloom, BloomCompositeMode, BloomPrefilter},
    render::{
        camera::Exposure,
        view::{ColorGrading, ColorGradingGlobal, ColorGradingSection, Hdr},
    },
};

fn setup_camera(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Hdr,  // Required for bloom, auto-exposure, atmosphere
        Tonemapping::TonyMcMapface,  // Best for stylized fantasy games
        Exposure { ev100: 7.0 },
        ColorGrading {
            global: ColorGradingGlobal {
                exposure: 0.0,
                temperature: 0.05,       // Slight warmth for Norse aesthetic
                post_saturation: 1.15,   // Slightly vibrant
                ..default()
            },
            shadows: ColorGradingSection::default(),
            midtones: ColorGradingSection::default(),
            highlights: ColorGradingSection::default(),
        },
        Bloom {
            intensity: 0.15,
            composite_mode: BloomCompositeMode::EnergyConserving,
            prefilter: BloomPrefilter { threshold: 0.0, threshold_softness: 0.0 },
            ..default()
        },
        DebandDither::Enabled,
        Transform::from_xyz(-2.0, 2.5, 5.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

For tonemapping, TonyMcMapface serves as the default and works exceptionally well for stylized fantasy games. It desaturates bright colors gracefully and preserves vibrancy better than ACES. AgX from Blender 4.0 offers a more neutral alternative with excellent color preservation. Both require the `tonemapping_luts` cargo feature enabled by default. For cinematic cutscenes, AcesFitted provides that film-industry look but can make colors appear darker.

Bloom should use `EnergyConserving` composite mode for realistic light scattering without artificially brightening the scene. The `NATURAL` preset with 0.15 intensity works well for most stylized games. For a more retro 2000s glow effect, use `Additive` mode with a threshold around 0.6. Emissive materials with values above 1.0 (like `LinearRgba::rgb(13.99, 5.32, 2.0)`) create the bloom source.

---

## Ambient occlusion delivers essential depth

Screen Space Ambient Occlusion transforms flat voxel worlds into spaces with perceivable depth and grounding. Bevy 0.17 implements VBAO (Visibility Bitmask Ambient Occlusion), which replaced GTAO in Bevy 0.15 and provides significantly better quality on thin geometry through a bitmask approach allowing multiple occluded sectors.

```rust
use bevy::{
    anti_alias::taa::TemporalAntiAliasing,
    pbr::{ScreenSpaceAmbientOcclusion, ScreenSpaceAmbientOcclusionQualityLevel},
    prelude::*,
    render::view::Hdr,
};

fn setup_ssao_camera(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Hdr,
        Msaa::Off,  // REQUIRED: SSAO incompatible with MSAA
        ScreenSpaceAmbientOcclusion {
            quality_level: ScreenSpaceAmbientOcclusionQualityLevel::High,
            constant_object_thickness: 0.5,  // Increase for voxel terrain
        },
        TemporalAntiAliasing::default(),  // Reduces SSAO noise significantly
        Transform::from_xyz(-2.0, 2.0, -2.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

Critical constraints: SSAO requires `Msaa::Off` and works only on native platforms (Vulkan, DirectX12, Metal). WebGL2 and WebGPU lack compute shader support. TAA is strongly recommended alongside SSAO to reduce noise. Quality levels range from `Low` (fastest, noisiest) to `Ultra` (most expensive).

For voxel games specifically, baked per-vertex ambient occlusion provides better results than screen-space techniques at zero runtime cost. Calculate AO at mesh generation time using neighboring voxel data:

- Check 8 neighbors in a 3x3 grid around each face vertex
- Compute occlusion level (0-3) based on adjacent block count
- Store 4 occlusion values per face, interpolate bilinearly
- Fix anisotropy by flipping quad diagonal when `ao[1] + ao[2] > ao[0] + ao[3]`

This per-vertex AO creates the distinctive chunky look of Minecraft and similar games while costing nothing at runtime.

---

## Shadow configuration for large voxel worlds

Cascade shadow maps require careful tuning for open-world voxel games to balance quality across viewing distances. The `CascadeShadowConfigBuilder` provides the primary configuration mechanism.

```rust
use bevy::{
    light::{CascadeShadowConfigBuilder, DirectionalLightShadowMap, ShadowFilteringMethod},
    prelude::*,
};

fn setup_shadows(mut commands: Commands) {
    commands.spawn((
        DirectionalLight {
            color: Color::srgb(1.0, 0.95, 0.85),  // Warm sunlight
            illuminance: 32000.0,
            shadows_enabled: true,
            shadow_depth_bias: 0.02,   // Prevents shadow acne
            shadow_normal_bias: 1.8,   // Prevents Peter Panning
            ..default()
        },
        Transform::from_xyz(50.0, 100.0, 50.0).looking_at(Vec3::ZERO, Vec3::Y),
        CascadeShadowConfigBuilder {
            num_cascades: 4,
            minimum_distance: 1.0,      // Skip very near shadows
            maximum_distance: 256.0,    // Match view distance
            first_cascade_far_bound: 15.0,  // Larger for voxel games
            overlap_proportion: 0.2,    // Smooth cascade transitions
            ..default()
        }.build(),
    ));
}
```

Insert `DirectionalLightShadowMap { size: 4096 }` as a resource for higher shadow resolution. The `ShadowFilteringMethod` camera component controls edge quality -- `Gaussian` provides good balance for voxel games, while `Temporal` offers best quality when combined with TAA. For performance on low-end hardware, use `Hardware2x2`.

Bias settings prevent common artifacts: `shadow_depth_bias` at 0.02 handles self-shadowing without detaching shadows from objects, while `shadow_normal_bias` at 1.8 prevents shadow artifacts along surface normals. Increase these slightly for voxel terrain if artifacts appear.

---

## Fog creates atmospheric depth and hides draw distance

Distance fog serves double duty -- creating atmospheric mood while hiding chunk loading at the edge of visibility. Bevy 0.17 renamed `FogSettings` to `DistanceFog` and supports multiple falloff modes.

```rust
use bevy::prelude::*;

fn setup_atmospheric_fog(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        DistanceFog {
            color: Color::srgba(0.35, 0.48, 0.66, 1.0),
            directional_light_color: Color::srgba(1.0, 0.95, 0.85, 0.5),
            directional_light_exponent: 30.0,  // Sun glow concentration
            falloff: FogFalloff::from_visibility_colors(
                150.0,  // Visibility distance
                Color::srgb(0.35, 0.5, 0.66),   // Extinction color
                Color::srgb(0.8, 0.844, 1.0),   // Inscattering color
            ),
        },
    ));
}
```

For stylized games, `Linear` falloff with explicit start/end distances offers the most artistic control. `Atmospheric` mode provides realistic scattering but may be overkill for stylized aesthetics. The `directional_light_color` creates a sun glow effect particularly effective for golden-hour Norse aesthetics.

Volumetric fog adds god rays and localized fog regions through separate components:

```rust
use bevy::light::{FogVolume, VolumetricFog, VolumetricLight};

fn setup_volumetric(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        VolumetricFog {
            ambient_intensity: 0.0,
            step_count: 64,  // Quality vs performance
            jitter: 0.5,     // For TAA
            ..default()
        },
    ));

    // Enable god rays on the sun
    commands.spawn((
        DirectionalLight { shadows_enabled: true, ..default() },
        VolumetricLight,
    ));

    // Global fog volume
    commands.spawn((
        FogVolume {
            density_factor: 0.05,
            scattering: 0.3,
            absorption: 0.1,
            scattering_asymmetry: 0.8,
            ..default()
        },
        Transform::from_scale(Vec3::splat(100.0)),
    ));
}
```

---

## Anti-aliasing choices for voxel terrain

Bevy 0.17 provides four anti-aliasing methods, each with distinct tradeoffs for voxel games. SMAA or TAA work best for terrain rendering where texture aliasing and distant shimmering are common problems.

| Method | Performance | Quality | Best For |
| --- | --- | --- | --- |
| MSAA | Medium (scales with triangles) | High geometry only | Simple scenes |
| FXAA | Very Low | Lower, blurry | Mobile/Web |
| SMAA | Low | Medium-High | General voxel games |
| TAA | Medium (scales with resolution) | Highest | High-end, cinematic |

```rust
use bevy::anti_alias::{
    smaa::{Smaa, SmaaPreset},
    taa::TemporalAntiAliasing,
    contrast_adaptive_sharpening::ContrastAdaptiveSharpening,
};

// Recommended for quality
commands.spawn((
    Camera3d::default(),
    Msaa::Off,
    TemporalAntiAliasing::default(),
    ContrastAdaptiveSharpening {
        enabled: true,
        sharpening_strength: 0.6,  // Counter TAA blur
        denoise: false,
    },
));

// Recommended for performance
commands.spawn((
    Camera3d::default(),
    Msaa::Off,
    Smaa { preset: SmaaPreset::High },
));
```

MSAA only handles geometry edges -- it will not help with texture aliasing common in voxel games. TAA reduces temporal flickering on distant terrain but causes ghosting on fast-moving objects. Combine TAA with Contrast Adaptive Sharpening at strength 0.6 to counteract blur.

---

## Depth of field and motion blur for cinematic moments

Both effects suit cutscenes and menus rather than core gameplay. Motion blur remains divisive; many players disable it immediately.

```rust
use bevy::post_process::{
    dof::{DepthOfField, DepthOfFieldMode},
    motion_blur::MotionBlur,
};

// Cinematic camera for cutscenes
commands.spawn((
    Camera3d::default(),
    Hdr,
    DepthOfField {
        mode: DepthOfFieldMode::Bokeh,  // Gaussian for web
        focal_distance: 5.0,
        aperture_f_stops: 1.0,
        ..default()
    },
    MotionBlur {
        shutter_angle: 0.5,  // 180-degree cinematic standard
        samples: 2,
    },
));
```

`DepthOfFieldMode::Bokeh` creates realistic hexagonal bokeh but only works on native platforms. Use `Gaussian` for WebGPU. Motion blur requires `shutter_angle` between 0.125-0.5 for cinematic effect; values above 1.0 are non-physical but useful for mimicking film blur at high framerates.

---

## Screen space reflections require deferred rendering

SSR in Bevy 0.17 works only with deferred rendering and affects surfaces with `perceptual_roughness` below 0.3. For stylized games without highly reflective surfaces, consider skipping SSR entirely.

```rust
use bevy::{
    core_pipeline::prepass::{DeferredPrepass, DepthPrepass, NormalPrepass},
    pbr::{DefaultOpaqueRendererMethod, ScreenSpaceReflections},
    prelude::*,
};

fn main() {
    App::new()
        .insert_resource(DefaultOpaqueRendererMethod::deferred())
        .add_plugins(DefaultPlugins)
        .run();
}

fn setup_ssr(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Msaa::Off,
        DepthPrepass,
        NormalPrepass,
        DeferredPrepass,
        ScreenSpaceReflections {
            perceptual_roughness_threshold: 0.3,
            linear_steps: 32,
            ..default()
        },
    ));
}
```

For water rendering in a voxel game, SSR provides accurate reflections on calm water surfaces. Rougher materials (above 0.3) will not show SSR effects -- use environment maps or reflection probes instead.

---

## Performance optimization for voxel worlds

The most impactful optimization is single mesh per chunk. Spawning individual entities per voxel face creates millions of draw calls; combining into chunk meshes reduces this to hundreds.

```rust
// CRITICAL: Single mesh per chunk
let chunk_mesh = generate_chunk_mesh(&chunk_data);
commands.spawn((
    Mesh3d(meshes.add(chunk_mesh)),
    chunk_transform,
));
```

Greedy meshing combines adjacent faces with identical properties (same texture, same AO values) into larger quads, dramatically reducing vertex counts. Include 18x18x18 data for 16x16x16 chunks to handle boundary faces correctly.

For GPU profiling, use Tracy with the `trace_tracy` feature:

```bash
cargo run --release --features bevy/trace_tracy
```

GPU timing appears in a separate "RenderQueue" row. Lock GPU clocks to base speeds for accurate measurements and focus on the MTPC column in statistics rather than individual frame data.

Post-processing performance budget at 60 FPS:

- Bloom: 0.5-1ms
- SSAO: 1-2ms (most expensive)
- TAA: 0.5-1ms
- Color grading: 0.1ms
- Tonemapping: <0.1ms
- Reserve 2-3ms total for post-processing

---

## Learning from commercial games

Valheim's distinctive look combines intentionally low-resolution textures with modern lighting and post-processing. The contrast between retro textures and sophisticated effects creates its visual identity. Key effects include heavy distance fog, sun shafts (god rays), warm color grading, and per-vertex ambient occlusion.

Minecraft RTX demonstrates full path-tracing with global illumination, but for non-RTX games, shader packs like BSL and SEUS achieve similar results through:

- Realtime shadows with soft filtering
- Volumetric light (god rays)
- SSAO for corner darkening
- Bloom from light sources
- Reflection on water surfaces
- PBR materials with roughness/metallic

Hytale explicitly describes their approach as "modern stylized voxel game with retro pixel-art textures" -- textures at 32px multiples, low polygon counts by design, and custom light propagation rather than full PBR.

---

## Recommended post-processing stack order

Based on industry practice and Bevy's render graph:

1. SSAO (before main lighting for deferred)
2. Main scene render
3. TAA/DLSS (temporal accumulation)
4. Bloom (before DoF to avoid artifacts)
5. Motion Blur
6. Depth of Field
7. Auto Exposure
8. Tonemapping (HDR to SDR)
9. CAS/Sharpening (counter TAA blur)
10. FXAA (if used instead of TAA)
11. Chromatic Aberration
12. Vignette (if using community crates)

Critical: Apply Depth of Field after Bloom to prevent artifacts around out-of-focus highlights. Tonemapping must precede color grading since artistic correction works in LDR space.

---

## Complete working example for Bevy 0.17

```rust
use bevy::{
    prelude::*,
    anti_alias::smaa::{Smaa, SmaaPreset},
    core_pipeline::tonemapping::Tonemapping,
    light::{CascadeShadowConfigBuilder, DirectionalLightShadowMap},
    pbr::ScreenSpaceAmbientOcclusion,
    post_process::bloom::Bloom,
    render::view::Hdr,
};

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .insert_resource(DirectionalLightShadowMap { size: 4096 })
        .add_systems(Startup, setup)
        .run();
}

fn setup(mut commands: Commands) {
    // Camera with full post-processing
    commands.spawn((
        Camera3d::default(),
        Hdr,
        Msaa::Off,
        Tonemapping::TonyMcMapface,
        Bloom::NATURAL,
        ScreenSpaceAmbientOcclusion::default(),
        Smaa { preset: SmaaPreset::High },
        DistanceFog {
            color: Color::srgba(0.35, 0.48, 0.66, 1.0),
            directional_light_color: Color::srgba(1.0, 0.95, 0.85, 0.5),
            directional_light_exponent: 30.0,
            falloff: FogFalloff::Linear { start: 50.0, end: 200.0 },
        },
        Transform::from_xyz(0.0, 50.0, 50.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));

    // Sun with cascade shadows
    commands.spawn((
        DirectionalLight {
            illuminance: 32000.0,
            shadows_enabled: true,
            ..default()
        },
        CascadeShadowConfigBuilder {
            num_cascades: 4,
            maximum_distance: 256.0,
            ..default()
        }.build(),
        Transform::from_rotation(Quat::from_euler(EulerRot::XYZ, -0.5, 0.5, 0.0)),
    ));
}
```

## Conclusion

Achieving commercial-quality graphics in Bevy 0.17 requires balancing visual fidelity against performance constraints inherent to voxel rendering. The most impactful techniques are per-vertex baked ambient occlusion (zero runtime cost, defines voxel aesthetic), proper cascade shadow configuration (prevents artifacts across viewing distances), and energy-conserving bloom with TonyMcMapface tonemapping (modern lighting without oversaturation).

For a Valheim/Skyrim aesthetic, prioritize warm color grading, atmospheric fog that hides chunk boundaries, and subtle god rays over photorealistic effects. Skip SSR unless your water surfaces specifically require it -- the deferred rendering requirement and roughness limitations make it less valuable for stylized games. Invest in greedy meshing and per-chunk mesh generation before adding expensive post-processing; no amount of effects will save performance lost to millions of draw calls.

The new `bevy::post_process` and `bevy::anti_alias` import paths in 0.17 reflect Bevy's maturing architecture. Future releases promise built-in resolution scaling and expanded effect options, but the current pipeline already supports commercial-quality results when configured intentionally.
