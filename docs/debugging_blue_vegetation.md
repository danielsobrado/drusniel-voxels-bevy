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
