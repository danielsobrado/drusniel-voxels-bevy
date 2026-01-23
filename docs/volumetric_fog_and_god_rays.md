# Volumetric Fog & God Rays Implementation

## Overview
This document details the implementation of the volumetric fog system in **Drusniel Voxels**. The primary visual goal was to achieve a specific atmospheric style similar to *Valheim* or *Minecraft with shaders*:
1.  **Crystal Clear Outdoors**: No heavy "milky" fog washing out the landscape.
2.  **Dramatic God Rays (Volumetric Light)**: Visible light shafts streaming through windows in dungeons or through tree canopies.

## The Challenge
Standard volumetric fog implementations often face a trade-off:
*   **High Density**: Creates beautiful god rays but makes the entire world look foggy/milky (the "Whiteout" effect).
*   **Low Density**: Keeps the outdoors clear but makes god rays invisible because there isn't enough particulate matter to scatter the light.

## The Solution: Dynamic Interior Boosting
To get the best of both worlds, we implemented a **Dynamic Interior Fog Boost** system. The game detects when the camera is indoors or under cover and massively increases the local fog density and light intensity.

### How It Works
1.  **Detection (`indoor_density_boost`)**:
    *   The system raycasts/checks voxels immediately surrounding the camera (Up, Down, North, South, East, West).
    *   It calculates an "occlusion ratio" (0.0 to 1.0).
    *   Running at a throttled **10Hz** (every 0.1s) to save CPU.

2.  **The Multiplier**:
    *   If fully outdoors: Multiplier is `1.0`.
    *   If fully indoors: Multiplier ramps up to `4000.0`.
    *   **Reasoning**: Since our base outdoor density is extremely low (`0.00001`), we need a massive multiplier to bring it up to visible levels (`~0.04`) indoors.

3.  **Smoothing**:
    *   We use `lerp` (Linear Interpolation) on the boost value over time.
    *   This ensures that walking through a doorway doesn't cause the screen to "pop" or flash; the atmosphere gradually thickens.

## Configuration & Tuning Parameters

### 1. `assets/config/fog.yaml`
This file controls the baseline behavior.

| Parameter | Value | Reason |
| :--- | :--- | :--- |
| `volume.density` | **0.00001** | Extremely low to ensure the outdoors looks crisp and clear. |
| `volume.scattering` | **0.2** | Lowered from default (0.5+) to reduce the glow/washout effect of the sun. |
| `volume.scattering_asymmetry` | **0.6** | Controls forward scattering. Higher values (closest to 1.0) make god rays more intense when looking AT the sun. |
| `volumetric.step_count` | **32** | "Fast" preset. Good balance of performance and quality. |

### 2. Code Constants (`src/atmosphere/fog.rs`)
Some parameters are dynamic and handled in code to react to the day/night cycle.

| Variable | Logic/Value | Description |
| :--- | :--- | :--- |
| **base_intensity** | `300.0 * daylight` | The brightness of the volumetric light. Normal values are ~10. we use 300 to force shafts to be visible even with sparse fog. |
| **Indoor Multiplier** | `1.0 + ratio * 4000.0` | The magic number. Compensates for the ultra-low base density. |
| **start/end** | Dynamic | Shadow cascades are tightly fitted to the `fog_end` distance to maximize shadow resolution for the god rays. |

## Optimization
Volumetric fog is expensive. We applied several optimizations:
1.  **Throttled Checks**: The indoor detection runs only 10 times a second, not every frame.
2.  **Shadow Fitting**: `update_shadow_cascades_from_fog` ensures we don't render shadows far beyond where the fog (and god rays) fade out.
3.  **Variable Resolution**: The integrated GPU LOD system can disable volumetric fog or reduce step counts for lower-end hardware.

## How to Tune Further
*   **"I want stronger God Rays"**: Increase `base_intensity` in `src/atmosphere/fog.rs` (lines ~517) or increase `scattering_asymmetry` in yaml.
*   **"The outdoors looks too foggy"**: Decrease `density` in `fog.yaml` (currently `0.00001`). You may need to increase the Indoor Multiplier code to compensate.
*   **"The transition is too slow"**: Increase `interpolation_speed` in `src/atmosphere/fog.rs`.
