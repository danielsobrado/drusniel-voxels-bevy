# Grass Shader Fix for Bevy 0.17

Document status (2026-05-17): historical implementation/debug note; preserve for context, but verify current behavior in code.

Current engine baseline: Bevy 0.18.1. The Bevy 0.17 API details in this document explain the original fix but are not current implementation guidance.

## Issue Summary

The grass rendering system was failing with shader validation errors, preventing grass blades from appearing in the voxel world. Multiple issues were identified and fixed.

## Problems Identified

### 1. Shader Bind Group Conflicts

**Symptom:** WGPU validation errors like:
```
Storage class Storage doesn't match the shader Uniform
Bindings for [4] conflict with other resource
Entry point vertex at Vertex is invalid
```

**Root Cause:** The shader was manually declaring bind group bindings that conflicted with Bevy's internal Material system:

```wgsl
// WRONG - manually declaring bindings that Bevy manages
@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var<uniform> mesh: Mesh;
@group(2) @binding(0) var<uniform> material: GrassMaterial;
```

In Bevy 0.17's Material system:
- Group 0: View bindings (managed by Bevy)
- Group 1: Various bindings (globals, lights, etc.)
- Group 2: Mesh data (NOT material data!)
- Material bindings use a dynamically assigned group number

**Solution:** Use the `#{MATERIAL_BIND_GROUP}` macro and import mesh functions instead of declaring bindings manually:

```wgsl
#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> material: GrassMaterial;
```

### 2. Debug Return Statements Preventing Spawning

**Symptom:** "Grass spawning disabled for debugging" log messages, no grass patches created.

**Root Cause:** Debug `return;` statements left in the code at lines 387 and 681 in `vegetation/mod.rs`:

```rust
// TEMPORARY: Skip grass spawning to debug blue shapes
info!("Grass spawning disabled for debugging");
return;
```

**Solution:** Removed the debug return statements to allow normal grass spawning flow.

### 3. Normal Vector Calculation (Previously Fixed)

**Symptom:** 0 grass instances being generated - all triangles filtered out.

**Root Cause:** Cross-product normal calculation was producing incorrect downward-pointing normals.

**Solution:** Use the mesh's stored `ATTRIBUTE_NORMAL` values with proper rotation transform instead of recalculating via cross-product.

## Final Working Shader Pattern

The shader follows the pattern from Bevy's `custom_vertex_attribute.wgsl` example:

```wgsl
#import bevy_pbr::mesh_functions::{get_world_from_local, mesh_position_local_to_clip}

struct GrassMaterial {
    base_color: vec4<f32>,
    tip_color: vec4<f32>,
    wind_strength: f32,
    wind_speed: f32,
    wind_scale: f32,
    time: f32,
};

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> material: GrassMaterial;

@vertex
fn vertex(vertex: Vertex) -> VertexOutput {
    let model = get_world_from_local(vertex.instance_index);
    // ... wind calculations ...
    out.clip_position = mesh_position_local_to_clip(model, local_pos);
    return out;
}
```

## Key Learnings

1. **Never manually declare view/mesh bindings** in custom Material shaders - Bevy manages these automatically
2. **Use `#{MATERIAL_BIND_GROUP}`** macro for material uniform bindings - Bevy replaces this at compile time
3. **Import mesh_functions** for transform operations - don't try to access mesh data directly
4. **Check for debug returns** that might short-circuit system execution
5. **Use stored normals** from mesh attributes rather than recalculating from geometry

## Files Changed

- `assets/shaders/grass.wgsl` - Complete rewrite using correct Bevy 0.17 Material patterns
- `src/vegetation/mod.rs` - Removed debug return statements, fixed normal calculation

## References

- Bevy 0.17 `custom_vertex_attribute.wgsl` example
- Bevy 0.17 `mesh_functions.wgsl` source
- Bevy Material documentation and AsBindGroup derive macro
