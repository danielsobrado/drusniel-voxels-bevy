# Task: Enable Visible God Rays & Add Atmospheric Dust

## Status: Completed (with Adjustments)

## User Objective
The user wants to see prominent, dramatic God Rays (Volumetric Light) without the outdoor environment looking "fog white".
The request for "textured dust" was also made.

## Outcome
*   **God Rays Visibility**: **SOLVED**.
    *   Using an aggressive light intensity boost (`1200.0x`), we made the rays visible even at very low fog densities (`0.0005`).
    *   This breaks the trade-off: The air remains clear (no whiteout), but the light shafts are bright enough to register.
*   **Textured Fog**: **DEFERRED**.
    *   Attempted to implement 3D noise texture for "dust", but encountered compilation errors due to Bevy API version mismatches (`FogVolume` field availability).
    *   Feature was reverted to ensure the game compiles and runs.

## Final Configuration
*   **Density**: `0.0005` (Clear air)
*   **Intensity**: `1200.0` (Blindingly bright shafts, tone-mapped down)
*   **Boost**: 3.0m radius detection for trees.

## Next Steps
*   If texture support is critical, we need to inspect the exact Bevy version and available `bevy_pbr` structs more closely in a dedicated session.
