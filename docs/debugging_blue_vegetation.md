# Debugging Blue Texture Regression

## Issue
Users reported a regression where vegetation (specifically grass) appeared "blue" or had "blue waves" moving through it.

## Root Cause Analysis
1.  **Blocky Material UVs**: The initial investigation found that `BlockyMaterial` was using Texture Arrays, but `meshing.rs` was generating UVs for a Texture Atlas. This caused incorrect sampling (zoomed-in textures). This was fixed by updating `meshing.rs` to use 0..1 UVs.
2.  **Leaves Material Mapping**: Trees (Leaves) were mapping to the "Dirt" material (index 3) instead of "Grass" (index 0) in Surface Nets mode. This was fixed by updating `get_blocky_material_index` in `meshing.rs`.
3.  **Underwater Spawning**: The primary cause of the "blue waves" was a regression in `src/vegetation/mod.rs`. The check to prevent grass from spawning underwater (`if v0.y <= (WATER_LEVEL + 1) as f32`) was missing.
    *   **Effect**: Grass blades were spawning *inside* the water volume.
    *   **Visual**: The water shader/fog (or simply being submerged) tinted the grass blue. The "waves" effect occurred because the water surface undulates, causing the grass to dip in and out of the "blue" underwater state, or the wind moved the grass into the water volume.

## Resolution
1.  **Fixed UV Generation**: Updated `src/voxel/meshing.rs` to generate 0..1 UVs for texture arrays.
2.  **Fixed Material Mapping**: Remapped `VoxelType::Leaves` to use the Grass material (0).
3.  **Restored Logic**: Restored the `WATER_LEVEL` check in `src/vegetation/mod.rs` to prevent underwater grass spawning.

## Verification
-   Verified colors were correct (green/gold) after fixes.
-   Verified wind animation works correctly without causing artifacts.

## Regression: 2026-01-08 (Persistent Blue/Orange Grass)

### Symptoms
- Patches of grass appear solid **Blue** or **Orange** (flat shading), intermixed with correctly rendered Green grass.
- The issue scales with grass density/count.

### Investigation Steps
1.  **Shader Output Tests**:
    -   Forced `grass.wgsl` to output **solid Green**. -> Result: Mixed Green and Blue grass persisted.
    -   Induced **Syntax Error** in `grass.wgsl`. -> Result: Green grass turned Magenta (error), but Blue grass **remained Blue**.
    -   **Conclusion**: The "Blue" grass is **NOT** using the active `GrassMaterial` shader. It is a fallback state.

2.  **Mesh Integrity Test**:
    -   Added **Red Vertex Colors** to the generated mesh. -> Result: Blue grass remained Blue (did not pick up vertex colors).
    -   **Conclusion**: The fallback material likely does not use vertex colors or ignores them.

3.  **Material Swap Test (Definitive)**:
    -   Replaced `GrassMaterial` with `StandardMaterial` (Green, Double-Sided) in `attach_procedural_grass_to_chunks`.
    -   Result: **ALL Grass rendered correctly as Green.**
    -   **Conclusion**: The `GrassInstance` mesh generation and `Transform` logic are correct. The issue is strictly within `GrassMaterial` instantiation or binding.

### Root Cause
The `GrassMaterial` is failing to bind for a subset of chunks, causing Bevy to render them with a default/fallback material (likely a wireframe or unlit debug material that appears blueish/grey). This is likely due to:
-   **Bind Group Limit Exhaustion**: Too many unique `GrassMaterial` instances are being created (one per chunk/material variant), exceeding the GPU's binding slots.
-   **Uniform Buffer Alignment**: The `GrassMaterialUniform` struct might have an alignment issue causing validation failures on some draw calls.

### Resolution Plan
1.  **Reduce Material Usage**: Instead of cloning materials for every chunk, use a global resource `Res<GrassSharedMaterials>` to store a fixed set (4-5) of material handles and reuse them across all chunks.
2.  **Verify Struct Alignment**: Ensure `GrassMaterialUniform` matches WGSL `std140` layout requirements (though it appears correct).
3.  **Switch to Storage Buffers (Optional)**: If uniform limits are hit, migrate to storage buffers (less likely needed if materials are shared).

### Failed Attempts
- **Disabling Time Updates**: Commented out `update_grass_time` to prevent per-frame uniform updates. Result: **Grass remained Blue**. This rules out dynamic update thrashing.
- **Hypothesis**: The issue is the `GrassMaterial` binding itself (Uniform Buffer size/alignment or Bind Group creation), independent of updates.

### Next Step: Empty Material Test
- Stripped `GrassMaterial` struct to be empty (no uniforms).
- Hardcoded all values in `grass.wgsl`.
- **Goal**: Verify if an empty BindGroup (0 uniforms) works. If yes, the uniform buffer layout was valid but incompatible.
- **Result**: **Green and Blue** (Mixed). Even with density=1, Vec4 alignment, and NaN checks, the issue persists.
- **Inference**: The issue is NOT:
    - Uniform Buffer Alignment/Size.
    - Uniform Update Thrashing (Time).
    - GPU Resource Exhaustion (Density=1).
    - Data Corruption (NaN checks).

### Current Status
- `StandardMaterial` -> Works Completely.
- `GrassMaterial` -> Mixed Failure.
- **Suspect**: `GrassMaterial` pipeline configuration or Shader/Mesh Attribute mismatch.
    - Is `alpha_mode` or `cull_mode` interacting poorly with the clustered renderer?

### Solution Found: Prepass Conflict
- **Test**: Disabled **Prepass** (Depth/Normal pass) in `GrassMaterialPlugin` and set shader to output **RED**.
- **Result**: **ALL RED**. The mixed Green/Blue artifacts disappeared completely.
- **Root Cause**: `GrassMaterial` does not implement a specialized vertex/fragment shader for the Prepass (Depth/Normal). By default, Bevy's `MaterialPlugin` enables the prepass. Bevy likely attempts to run a default prepass shader which fails or produces the "Blue" (Flat Normal) artifact for these instanced meshes, or z-fights with the main pass.
- **Fix**: Explicitly set `prepass_enabled: false` in `MaterialPlugin::<GrassMaterial>`.

## Resolution Steps
1.  **Disable Prepass**: `app.add_plugins(MaterialPlugin::<GrassMaterial> { prepass_enabled: false, ..default() })`.
2.  **Restore Logic**: Revert code to full `GrassMaterial` functionality (Uniforms, Wind, Colors) but keep Prepass disabled.
