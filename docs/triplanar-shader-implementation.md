# Triplanar Shader Implementation

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

## Overview

This document describes the implementation of true triplanar texture mapping for Surface Nets terrain rendering on the current Bevy 0.18.1 baseline. Triplanar mapping eliminates texture stretching on steep slopes by sampling the texture from three orthogonal projections and blending based on surface normal.

## Problem

Standard UV mapping causes texture stretching on surfaces that aren't aligned with the UV projection plane. For voxel terrain with arbitrary slopes, this results in visually poor texturing on cliff faces and angled surfaces.

## Solution

True triplanar mapping samples the texture three times per fragment:
- **YZ plane** (X-facing surfaces like east/west cliffs)
- **XZ plane** (Y-facing surfaces like tops/bottoms)
- **XY plane** (Z-facing surfaces like north/south cliffs)

The samples are blended using weights derived from the surface normal.

## Implementation

### Files Modified/Created

1. **`src/rendering/triplanar_material.rs`** - Custom Material implementation
2. **`assets/shaders/triplanar_terrain.wgsl`** - WGSL fragment shader
3. **`src/rendering/materials.rs`** - Material setup function
4. **`src/rendering/plugin.rs`** - Material plugin registration
5. **`src/voxel/meshing.rs`** - UV encoding for atlas index
6. **`src/voxel/plugin.rs`** - Material assignment for SurfaceNets mode

### Material Structure

```rust
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct TriplanarUniforms {
    pub base_color: LinearRgba,    // Tint color (vec4)
    pub tex_scale: f32,            // World units per texture tile
    pub blend_sharpness: f32,      // Normal-based blend falloff
    pub atlas_size: f32,           // Tiles per row in atlas (4.0 for 4x4)
    pub padding: f32,              // UV padding to prevent bleeding
}

#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct TriplanarMaterial {
    #[uniform(0)]
    pub uniforms: TriplanarUniforms,
    #[texture(1)]
    #[sampler(2)]
    pub color_texture: Option<Handle<Image>>,
}
```

### Shader Bindings

```wgsl
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: TriplanarUniforms;
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var color_texture: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var color_sampler: sampler;
```

### Blend Weight Calculation

```wgsl
fn triplanar_weights(world_normal: vec3<f32>) -> vec3<f32> {
    var weights = pow(abs(world_normal), vec3(sharpness));
    weights = weights / (weights.x + weights.y + weights.z);
    return weights;
}
```

## Critical Fix: Bind Group Number

### Problem

Initial implementation hardcoded `@group(2)` for material bindings, causing a pipeline validation error:

```
wgpu error: Validation Error
  In Device::create_render_pipeline, label = 'opaque_mesh_pipeline'
    Shader global ResourceBinding { group: 2, binding: 0 } is not available in the pipeline layout
    Storage class Storage { access: StorageAccess(LOAD) } doesn't match the shader Uniform
```

### Cause

Bevy's GPU-driven rendering uses bind group 2 for mesh/instance storage buffers, not material uniforms. Hardcoding the group number conflicts with Bevy's internal pipeline layout.

### Solution

Use Bevy's preprocessor substitution `#{MATERIAL_BIND_GROUP}` instead of hardcoded numbers:

```wgsl
// Wrong - causes pipeline conflict
@group(2) @binding(0) var<uniform> uniforms: TriplanarUniforms;

// Correct - Bevy substitutes the proper group number
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> uniforms: TriplanarUniforms;
```

This allows Bevy to substitute the correct bind group number during shader preprocessing, which may vary based on render pipeline configuration.

## UV Encoding

Instead of computing UVs on the CPU, the meshing code stores the atlas index in `UV.x`:

```rust
// Store atlas index in UV.x for shader-side triplanar computation
solid_mesh.uvs.push([atlas_idx as f32, 0.0]);
```

The shader extracts this and computes world-space UVs:

```wgsl
let atlas_idx = u32(in.uv.x + 0.5);  // Round to nearest integer
let uv = compute_tile_uv(world_pos.xz, atlas_idx);  // World-space UV
```

## Atlas Tile UV Calculation

```wgsl
fn compute_tile_uv(world_coord: vec2<f32>, atlas_index: u32) -> vec2<f32> {
    let tile_size = 1.0 / atlas_size;
    let usable_size = tile_size - padding * 2.0;

    let tile_x = f32(atlas_index % u32(atlas_size));
    let tile_y = f32(atlas_index / u32(atlas_size));

    let u_base = tile_x * tile_size + padding;
    let v_base = tile_y * tile_size + padding;

    let scaled = world_coord / tex_scale;
    let frac_uv = clamp(fract(scaled), 0.01, 0.99);

    return vec2(u_base + frac_uv.x * usable_size, v_base + frac_uv.y * usable_size);
}
```

## References

- [Bevy Material System Documentation](https://bevyengine.org/examples/shaders/shader-material/)
- [Bevy PR #20458 - MATERIAL_BIND_GROUP](https://github.com/bevyengine/bevy/pull/20458)
- [GPU Gems: Triplanar Texturing](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-1-generating-complex-procedural-terrains-using-gpu)
