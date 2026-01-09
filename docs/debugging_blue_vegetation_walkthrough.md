# Debugging Session: Blue Grass Rendering Artifacts

## Issue Description
Users reported instances of procedural grass rendering as solid blue or orange patches instead of the expected green/gold gradient. These artifacts appeared randomly mixed with correctly rendered grass and seemed to scale with density.

## Root Cause Analysis
The investigation followed a systematic elimination process:

1.  **Shader Logic**: Forced shader output to solid colors. Result: Mixed Green/Blue (artifacts persisted).
2.  **Material System**: Swapped `GrassMaterial` for `StandardMaterial` (Green). Result: **ALL GREEN**.
    *   *Inference*: The mesh generation and instance data were correct. The issue was specific to `GrassMaterial` or its pipeline.
3.  **Uniform Buffer**: Simplified `GrassMaterial` to an empty struct to test binding alignment/limits. Result: Failed (Mixed Green/Blue).
4.  **Resource Limits**: Reduced density to 1 blade/chunk. Result: Failed (Mixed Green/Blue).
5.  **Prepass Conflict**: Disabled the Depth/Normal Prepass for `GrassMaterial`. Result: **FIXED**.

### The Culprit: Prepass Conflict
The `GrassMaterial` did not implement a specialized vertex/fragment shader for Bevy's **Depth/Normal Prepass**.
- Bevy's `MaterialPlugin` enables the prepass by default.
- For `StandardMaterial`, Bevy handles this automatically.
- For custom materials, if the prepass shader logic is missing or incompatible with the custom vertex logic (e.g., wind animation), the prepass can fail or produce undefined results (zero vectors).
- In this case, the blue artifacts were likely the result of the main pass z-fighting with or being corrupted by a broken prepass render.

## Solution
Explicitly disable the prepass for the `GrassMaterial` plugin.

**File**: `src/vegetation/grass_material.rs`

```rust
impl Plugin for GrassMaterialPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(MaterialPlugin::<GrassMaterial> {
            prepass_enabled: false, // <--- THE FIX
            shadows_enabled: false,
            ..default()
        })
        .init_resource::<GrassMaterialHandles>()
        .add_systems(Update, update_grass_time);
    }
}
```

## Additional Improvements
- **Robustness**: Added NaN checks in `build_grass_patch_mesh` to prevent invalid geometry from crashing the pipeline.
- **Alignment**: Padded `GrassMaterialUniform` layout to be robust against potential alignment changes (though not the root cause here).
- **Cleanup**: Removed unused variables and imports in `grass_material.rs`.

## Verification
- Build: `cargo run --release`
- Result: All grass renders with correct gradients and wind animation. "Blue patches" are completely eliminated.
