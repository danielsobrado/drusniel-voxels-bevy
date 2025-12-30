# RTX 40xx Startup Texture Limit Check

## Purpose

Document the startup risk of "too many textures" and a repeatable test plan.

## Current Findings

- The largest single material is the building shader: 18 sampled textures plus 1 sampler.
  - Code: `src/rendering/building_material.rs`
  - Shader bindings: `assets/shaders/building.wgsl`
- Bevy 0.17 defaults to `WgpuSettingsPriority::Functionality`, which uses the adapter limits.
  - On an RTX 40xx, the adapter limit for sampled textures per stage is far above 18.
  - This should not panic on startup due to texture count.
- The only likely startup failure for "too many textures" is forcing lower limits
  (for example `WGPU_SETTINGS_PRIO=compatibility` or WebGL2 defaults).

## Test Plan (Later Verification)

### 1) Baseline run on RTX 40xx

Goal: confirm no startup panic related to texture limits.

Steps:
- Run the app normally.
- Watch for any WGPU limit error related to sampled textures.

Expected:
- No limit error on startup.

### 2) Force compatibility limits (intentional failure case)

Goal: validate the failure mode when limits are clamped.

Steps:
- Set environment variable `WGPU_SETTINGS_PRIO=compatibility`.
- Run the app.

Expected:
- Startup failure or validation error due to `max_sampled_textures_per_shader_stage`
  being 16 (lower than the 18 used by the building material).

### 3) Optional: log device limits

Goal: confirm actual device limits in logs.

Steps:
- Temporarily log `RenderDevice::limits()` during startup (any system with access to `RenderDevice`).
- Run on RTX 40xx.

Expected:
- `max_sampled_textures_per_shader_stage` reported well above 18.

## Notes

- This is a shader binding limit, not a texture memory limit.
- The blocky terrain uses array textures (2D arrays), which do not increase
  the sampled texture count per stage in the same way.
