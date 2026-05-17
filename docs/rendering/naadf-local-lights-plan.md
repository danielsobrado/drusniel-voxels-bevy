# NAADF Local Point-Light And Torch Infrastructure Plan

Status: planned documentation first  
Owner: rendering / NAADF preview  
Last updated: 2026-05-17

## Goal

Make local lights visible in NAADF preview without changing the default renderer
or promoting NAADF lighting by accident. The first visible milestone is a
dedicated NAADF local-light bench where warm torch-style point lights illuminate
voxel terrain in fullscreen NAADF preview.

The current NAADF preview lighting path is intentionally limited:

- `first_hit.wgsl` shades primary hits from material color, sun direction, and a
  simple ambient sky term.
- `gi_trace.wgsl` adds sun/sky bounce when preview bounces are enabled.
- Regular Bevy `PointLight` and held torch lights are not extracted into NAADF
  preview and therefore do not affect fullscreen NAADF output.

This plan adds a NAADF-local light path that is populated from Bevy point lights
but rendered by NAADF shaders.

## Non-Goals

- Do not change default application lighting.
- Do not route Path A radiance-cascade GI through local lights in the first
  implementation pass.
- Do not add clustered/deferred light binning in v1.
- Do not make local lights default-on for NAADF until bench evidence exists.
- Do not replace Bevy point-light rendering; NAADF consumes extracted copies.

## Phase 0: Documentation-Only Commit

Deliverables:

- Add this document.
- Add a short planned-work reference in `naadf-implementation-status.md`.
- Commit documentation before code changes.

Acceptance:

- No Rust, WGSL, TOML scene, or YAML config changes in the documentation commit.
- The implementation phases below are specific enough that code work can start
  without design decisions.

## Phase 1: Config, Data Model, And Extraction

### Config

Add preview-local-light settings under `NaadfPreviewConfig`:

```rust
pub local_lights_enabled: bool,
pub local_light_limit: u32,
pub local_light_shadows_enabled: bool,
```

Defaults:

- `local_lights_enabled = false`
- `local_light_limit = 16`
- `local_light_shadows_enabled = false`

Checked-in `assets/config/naadf.yaml` must keep local lights disabled. Bench
scenes may opt in.

Bench render toggles:

```toml
naadf_preview_local_lights_enabled = true
naadf_preview_local_light_limit = 16
naadf_preview_local_light_shadows_enabled = true
```

### CPU/Render Data Model

Create a small NAADF local-light module, for example
`src/rendering/naadf/local_lights.rs`.

Main-world extracted candidate:

```rust
pub struct NaadfLocalLight {
    pub position: Vec3,
    pub radius: f32,
    pub color: Vec3,
    pub intensity: f32,
    pub casts_shadow: bool,
}
```

GPU-facing record:

```rust
#[repr(C)]
pub struct NaadfLocalLightRecord {
    pub position_radius: [f32; 4],
    pub color_intensity: [f32; 4],
    pub flags_shadow_pad: [u32; 4],
}
```

WGSL mirror:

```wgsl
struct NaadfLocalLightRecord {
    position_radius: vec4<f32>,
    color_intensity: vec4<f32>,
    flags_shadow_pad: vec4<u32>,
}
```

Flags:

- bit 0: shadow enabled for this light.
- remaining bits reserved.

### Extraction Rules

Extract Bevy `PointLight + GlobalTransform` into a render-world
`ExtractedNaadfLocalLights` resource.

Filter:

- NAADF preview local lights must be enabled.
- light intensity must be greater than zero.
- light range/radius must be greater than zero.
- hidden lights are skipped if visibility is available in the query.

Ordering:

- Primary sort key: distance from active camera, ascending.
- Secondary sort key: intensity, descending.
- Tertiary sort key: entity id or stable insertion order.

Cap:

- Clamp config limit to a hard maximum of 64.
- Default/demo cap is 16.
- Record how many lights were culled by the cap.

## Phase 2: GPU Buffers, Bindings, And Counters

### GPU Resources

Add a local-light buffer allocation independent of chunk buffers, because local
lights are tiny and change per frame.

Minimum resources:

- storage buffer for up to 64 `NaadfLocalLightRecord`s.
- uniform or packed params field carrying:
  - visible light count
  - shadows enabled bit
  - reserved padding

Recommended first binding:

- `@group(3) @binding(25)` for local-light records.
- Add count/shadow flags to first-hit params or use a small new uniform if
  layout pressure makes that cleaner.

The existing NAADF first-hit bindings currently use 16-24; avoid conflicting
with entity-volume bindings 21-23 and stats binding 24.

### Counters

Add counters to `NaadfStats`, `NaadfRenderStatsSnapshot`, and bench timing:

- `naadf.local_lights_visible`
- `naadf.local_lights_uploaded`
- `naadf.local_lights_culled`
- `naadf.local_light_shadow_rays_last_frame`

Counter meaning:

- `visible`: lights accepted after filtering before cap.
- `uploaded`: lights written to the GPU buffer after cap.
- `culled`: accepted-but-dropped because of cap.
- `shadow_rays`: estimated first-hit local-light shadow rays for the frame.

Zero-light behavior must publish zeros and keep output identical to current
NAADF preview.

## Phase 3: Primary-Hit Direct Local Lighting

Add direct point-light contribution in `first_hit.wgsl`.

For each uploaded light:

1. Compute vector from hit point to light.
2. Reject if distance is outside radius.
3. Use a stable falloff:

```wgsl
let range = max(light.position_radius.w, 0.001);
let dist01 = clamp(distance_to_light / range, 0.0, 1.0);
let attenuation = pow(1.0 - dist01, 2.0) / max(distance_to_light * distance_to_light, 1.0);
```

4. Apply Lambert term from hit normal to light direction.
5. Add `albedo * light_color * intensity * attenuation * lambert`.
6. If shadows are enabled, trace from hit point toward the light and zero the
   contribution when a nearer voxel blocks the ray.

Shadow ray constraints:

- Only run when global local-light shadows are enabled and light flag bit 0 is
  set.
- Start from `hit_position + normal * 0.08`.
- Max distance is light distance minus a small epsilon.
- Use a smaller max-step budget than primary rays if needed.
- Publish estimated shadow rays, not exact GPU atomics, for v1.

The sun/sky preview contribution remains unchanged.

## Phase 4: Torch/Demo Scene

Add a dedicated bench:

`bench/scenes/naadf/visual-regression-naadf-local-lights.toml`

Scene defaults:

- fullscreen NAADF preview.
- terrain meshes disabled for pure NAADF view.
- local lights enabled.
- local light limit 16.
- one preview bounce.
- twilight/night time of day.
- screenshot settle points matching other NAADF preview benches.

Demo lights:

- Use real Bevy `PointLight` entities, not hardcoded shader constants.
- Add a bench-only fixed light spawner, gated by a render toggle such as
  `naadf_preview_spawn_demo_lights = true`.
- Place warm torch-like lights near the current pyramid/checkpoint view so they
  visibly light sand/stone walls.
- Include one colored diagnostic light only if it helps validate extraction.

The existing `visual-regression-naadf-preview-only.toml` remains a baseline and
does not get demo lights.

## Phase 5: GI Bounce Integration

After Phase 3 is visually and performance clean, extend `gi_trace.wgsl` so
secondary-hit shading can include local-light contribution.

Rules:

- Reuse the same local-light records and caps.
- Keep behind `local_lights_enabled`.
- Prefer unshadowed local-light contribution at secondary hits initially.
- Add shadowed secondary lighting only if Phase 3 perf has enough margin.

Do not merge this phase until the direct-light demo bench clearly shows the
intended effect and bench guard remains clean.

## Tests

Unit tests:

- config defaults keep local lights disabled.
- checked-in YAML keeps local lights disabled.
- bench TOML toggles parse local-light fields.
- extraction filters disabled/zero-range/zero-intensity lights.
- extraction caps and sorts by distance then intensity.
- GPU record layout is 48 bytes and WGSL metadata references the expected
  fields.

Shader/layout tests:

- `first_hit.wgsl` declares the local-light record and binding.
- first-hit params carry local-light count or a local-light params uniform
  exists.
- zero local lights preserves the current shading path.

Bench verification:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-local-lights.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

Acceptance:

- Local-light bench shows visible warm light influence in fullscreen NAADF.
- Counters show `local_lights_uploaded > 0`.
- Existing preview-only and startup-stability benches keep local-light counters
  at zero unless opted in.
- Bench guard passes for the new scene and the existing NAADF preview scenes.

## Rollout Gates

Phase 1 can merge when config/extraction tests pass and defaults are off.

Phase 2 can merge when buffers/counters are wired and zero-light benches are
unchanged.

Phase 3 can merge when direct lights are visible in the demo bench and the
preview-only baseline remains unchanged.

Phase 4 can merge with the first visually inspected local-light screenshot and
bench guard output.

Phase 5 must be a separate review because it adds local lights to secondary
bounce shading and may materially change performance.

## Risks

- Local-light shadow rays can multiply preview cost by light count. Keep shadows
  off by default and cap light count hard.
- Bevy point-light range/intensity units may not map perfectly to NAADF preview
  color. The demo scene should tune values in bench config or spawner constants
  without changing runtime defaults.
- Local lights in fullscreen NAADF can appear inconsistent with the normal
  renderer until both paths share the same authored light entities. This is
  acceptable for the demo bench but must be documented before broader use.
- Adding bindings to NAADF shaders can silently break layout assumptions. Keep
  layout tests close to the shader binding declarations.
