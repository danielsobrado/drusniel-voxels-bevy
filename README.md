# Drusniel Voxels

## Version History

### Current (v0.4-dev)
*   **Bevy 0.17 Rendering Stack**: HDR pipeline with tonemapping, bloom, debanding, and color grading on the main camera.
*   **Radiance Cascades GI**: Screen-space global illumination using voxel SDF data for efficient ray marching, providing realistic indirect lighting with multi-cascade probe system and temporal reprojection.
*   **Adaptive GI Enhancements**: Stochastic one-from-eight probe selection (~8x GI performance gain at Low quality), SDF-based terrain shadows leveraging voxel data, and screen-space contact shadows for vegetation micro-detail. Quality presets (Low/Medium/High/Ultra) with ~15% performance range. Toggle with Alt+1/2/3/4, debug with Alt+P.
*   **Aerial Perspective**: Custom shaders (buildings, props, grass) now blend toward fog color at distance, matching terrain fog behavior for consistent atmospheric depth.
*   **Environment Map Lighting**: Skybox-based IBL (Image-Based Lighting) for improved PBR reflections and ambient lighting that tracks time-of-day.
*   **Ambient + Atmospheric Effects**: GTAO (Ground Truth Ambient Occlusion via XeGTAO port), PCSS soft shadows, distance + volumetric fog with atmospheric falloff, and time-of-day color blending.
*   **Volumetric Clouds**: Raymarched volumetric clouds with temporal reprojection, Henyey-Greenstein scattering, and configurable cloud types (stratus/stratocumulus/cumulus).
*   **Enhanced Water**: Gerstner wave simulation with foam generation and caustic effects.
*   **Weather Particles**: GPU-accelerated weather system (rain/snow/dust) via bevy_hanabi with camera-following emitters.
*   **Vegetation Wind**: Multi-layer wind animation for vegetation (trunk sway, branch movement, leaf flutter) with configurable presets. Enhanced grass shader with SSS (subsurface scattering) and contact shadows for realistic foliage rendering.
*   **Vegetation Alpha Fade**: Grass-like props fade to a configurable minimum alpha near the camera to keep visibility through dense foliage. Tuned in the F4 settings.
*   **Shadow + LOD Alignment**: Cascade shadows tuned to fog visibility and chunk LOD cull distances to avoid dark banding.
*   **Texture Quality**: Texture arrays with mipmaps and anisotropic filtering for terrain, plus expanded PBR materials for buildings/props.
*   **Chunk LOD System**: High/low/culled LODs with skirts for seam hiding and integrated GPU fallbacks.
*   **Config-Driven Tuning**: YAML configs for fog, AO, terrain generation, props, camera exposure, clouds, water, wind, weather, and GI.
*   **World + Tools**: Save/load persistence, minimap, and debug overlays.
*   **Enhanced Terrain Tools**: Gradual sculpting (Raise/Lower/Level/Smooth) with brush size/strength controls and visual preview cursor. Toggled via T key with dedicated hotbar UI.
*   **UI + Modes**: Settings menu (graphics/atmosphere/fog/visual sliders), map overlay, inventory/hotbar, chat overlay, and photo mode (DoF/motion blur).
*   **Prop Persistence System**: Calculate-once, persist-forever prop placement with multi-sample terrain analysis, slope-based rotation, and chunk-based JSON storage. Props are precisely placed using 5-point sampling for accurate ground contact, then saved to `saves/props/` for instant loading on subsequent runs. Supports dirty chunk regeneration when terrain is modified.


### V0.3
*   **PBR Materials & Parallax Mapping**: Implemented PBR material blending and parallax occlusion mapping, specifically enhancing rock textures.
*   **Texture Splatting**: Added smooth triplanar material blending (texture splatting) using vertex weights for seamless terrain transitions.
*   **Surface Nets Improvements**: Addressed chunk seams and fixed UV mapping/repeat samplers for surface nets.
*   **Material & Mesh Updates**: Ongoing updates to materials and mesh generation.

*   **Smooth Slope Movement**: Enhanced character controller with bilinear terrain height detection and step-up logic for fluid movement over terrain.

![V0.3 Preview](docs/images/V0.3.jpg)

### V0.2
*   **Procedural Generation**: Added procedural grass mesh patches.
*   **Terrain & Environment**: Adjusted terrain balance by reducing sand beach areas; tweaked lighting and reintroduced water rendering.
*   **Assets**: Integrated new texture assets (PNG files).
*   **Rendering**: Improved visual fidelity with lighting adjustments.

![V0.2 Preview](docs/images/V0.2.jpg)

### V0.1
*   **Core Systems**: Initial implementation work.
*   **Chunk Rendering**: Fixed visibility issues with chunk boundary faces.
*   **Modesty Fix**: Adjustments for content appropriateness for tilable terrain.

![V0.1 Preview](docs/images/V0.1.jpg)

## Controls

### General
*   **Escape**: Toggle Pause Menu / Close Chat
*   **M**: Toggle Map Overlay
*   **Shift + M**: Toggle Edit Mode

### Debug & Development
*   **F3**: Toggle Debug Overlay (FPS, position, chunk stats, targeted block info)
*   **F4**: Toggle Inspector & Settings Window (LOD sliders, vegetation tweaks, foliage alpha fade)
*   **F6**: Toggle Water Visibility (debug builds only)
*   **F7**: Toggle Grass Visibility (debug builds only)
*   **F12**: Toggle Photo Mode (DoF, motion blur)
*   **G**: Print Detailed Block Debug Info to Console

#### F3 Overlay Sub-toggles (all use Alt+)
*   **Alt+V**: Toggle Vertex Corners Display
*   **Alt+T**: Toggle Texture Debug Details
*   **Alt+N**: Toggle Multiplayer Debug Info
*   **Alt+C**: Toggle Chunk Statistics (uniformity, LOD, mesh counts)
*   **Alt+P**: Toggle Prop Debug (targeted prop, alpha/fade info)

#### Adaptive GI Controls (Alt+)
*   **Alt+1**: Low Quality (Approx. 8x faster, Contact Shadows OFF)
*   **Alt+2**: Medium Quality
*   **Alt+3**: High Quality (Default, Contact Shadows ON)
*   **Alt+4**: Ultra Quality
*   **Alt+P**: Toggle Probe Selection Debug Log
*   **Alt+C**: Toggle Contact Shadows Debug Log (in console)


### Movement
*   **W / A / S / D**: Move Forward, Left, Back, Right
*   **Space**: Jump (Walk Mode) / Fly Up (Fly Mode)
*   **Left Shift**: Sprint (Walk Mode) / Fly Down (Fly Mode)
*   **Left Ctrl**: Turbo Speed (Fly Mode)
*   **Tab**: Toggle Fly/Walk Mode
*   **R**: Reset Position to Spawn

### Interaction
*   **Left Click**: Break Block / Attack Entity
*   **Right Click**: Place Block

### Terraforming Mode (Toggle with T)
*   **T**: Toggle Mode (Switch Hotbar)
*   **1**: Raise Tool
*   **2**: Lower Tool
*   **3**: Level Tool (Right-click to set target height)
*   **4**: Smooth Tool
*   **Left Click**: Apply Tool
*   **Shift + Scroll**: Adjust Brush Radius
*   **Ctrl + Scroll**: Adjust Brush Strength

### Edit Mode (Toggle with Shift + M)
*   **Left Click + Drag**: Move Block
*   **Q / E** or **Mouse Wheel**: Rotate Dragged Block
*   **Delete**: Toggle Delete Mode
    *   **Left Click**: Delete Block (while in Delete Mode)

### Photo Mode (Toggle with F12)
*   **Mouse Wheel**: Adjust Focus Distance
*   **Q / E**: Adjust Aperture (f-stops)

### Chat
*   **Ctrl + A**: Open Chat
*   **Enter**: Send Message

## Free Texture Sources Guide

All sources are CC0 (public domain) - no attribution required.

---

## Primary Sources

| Source | Style | Best For | URL |
|--------|-------|----------|-----|
| **3DTextures.me** | Stylized/Hand-painted | Buildings, Props | https://3dtextures.me/category/stylized-textures/ |
| **Poly Haven** | Photorealistic | Terrain (modify for stylized) | https://polyhaven.com/textures |
| **ambientCG** | Photorealistic PBR | Ground, Rocks | https://ambientcg.com/ |
| **CGBookcase** | Photorealistic | Stone, Brick | https://www.cgbookcase.com/textures |
| **FreeStylized** | Stylized | Buildings, Environment | https://freestylized.com/all-textures/ |

---

## Buildings (Full PBR)

Download from **3DTextures.me** - already stylized with all maps included.

### Wood Planks
**Source:** https://3dtextures.me/2022/02/23/stylized-wood-wall-001/
```
Download -> Rename files:
  Stylized_Wood_Wall_001_basecolor.jpg  -> albedo.png
  Stylized_Wood_Wall_001_normal.jpg     -> normal.png
  Stylized_Wood_Wall_001_roughness.jpg  -> roughness.png
  Stylized_Wood_Wall_001_ambientOcclusion.jpg -> ao.png

Place in:
  assets/pbr/buildings/wood_plank/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  └── ao.png
```

### Stone Brick
**Source:** https://3dtextures.me/2021/08/20/stylized-stone-wall-001/
```
Place in:
  assets/pbr/buildings/stone_brick/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  └── ao.png
```

### Metal Plates
**Source:** https://3dtextures.me/2022/06/15/stylized-metal-plates-001/
```
Place in:
  assets/pbr/buildings/metal_plate/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  ├── metallic.png    # This one has metallic map
  └── ao.png
```

### Thatch/Straw Roof
**Source:** https://3dtextures.me/2021/11/03/stylized-straw-roof-001/
```
Place in:
  assets/pbr/buildings/thatch/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  └── ao.png
```

### Wood Shingles (Roof)
**Source:** https://3dtextures.me/2021/11/10/stylized-wood-shingles-001/
```
Place in:
  assets/pbr/buildings/wood_shingles/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  └── ao.png
```

---

## Terrain (Albedo + Normal Only)

For Valheim style, download photorealistic then reduce saturation/add painterly filter in GIMP/Photoshop.

### Grass
**Source:** https://ambientcg.com/view?id=Grass001 (download 1K)
```
Download 1K-JPG:
  Grass001_1K-JPG_Color.jpg    -> albedo.png
  Grass001_1K-JPG_NormalGL.jpg -> normal.png
  (Ignore other maps - using uniform roughness)

Place in:
  assets/pbr/terrain/grass/
  ├── albedo.png
  └── normal.png
```

### Dirt
**Source:** https://ambientcg.com/view?id=Ground037 (download 1K)
```
Place in:
  assets/pbr/terrain/dirt/
  ├── albedo.png
  └── normal.png
```

### Rock
**Source:** https://ambientcg.com/view?id=Rock030 (download 1K)
```
Place in:
  assets/pbr/terrain/rock/
  ├── albedo.png
  └── normal.png
```

### Sand
**Source:** https://ambientcg.com/view?id=Ground054 (download 1K)
```
Place in:
  assets/pbr/terrain/sand/
  ├── albedo.png
  └── normal.png
```

### Tilled Soil
**Source:** https://ambientcg.com/view?id=Ground048 (download 1K)
```
Place in:
  assets/pbr/terrain/tilled_soil/
  ├── albedo.png
  └── normal.png
```

---

## Alternative: Stylized Terrain

For already-stylized terrain textures:

**Source:** https://3dtextures.me/2020/08/13/stylized-grass-001/
```
Place in:
  assets/pbr/terrain/grass/
  ├── albedo.png
  └── normal.png
```

**Source:** https://3dtextures.me/2020/10/15/stylized-dirt-001/
```
Place in:
  assets/pbr/terrain/dirt/
  ├── albedo.png
  └── normal.png
```

---

## Props/Rocks (Medium Detail)

### Large Rocks
**Source:** https://3dtextures.me/2022/01/12/stylized-cliff-001/
```
Place in:
  assets/pbr/props/rocks/rock_large/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  └── ao.png
```

### Cobblestone (for paths)
**Source:** https://3dtextures.me/2024/09/04/cobblestone-irregular-floor-001/
```
Place in:
  assets/pbr/props/cobblestone/
  ├── albedo.png
  ├── normal.png
  ├── roughness.png
  └── ao.png
```

### Wood Crate
**Source:** https://3dtextures.me/2021/09/29/stylized-crate-001/
```
Place in:
  assets/pbr/props/containers/crate/
  ├── albedo.png
  └── normal.png
```

---

## Crops (Minimal - Use Model Textures)

Crops use GLTF models with baked textures from Quaternius.
No separate texture downloads needed.

**Models Source:** https://poly.pizza/bundle/Ultimate-Crops-Pack-8rnVIzNDye

The GLTF files already include vertex colors and simple textures.

---

## Water (Shader-Driven)

Water uses procedural normals, but you can add a flow/normal map:

**Source:** https://ambientcg.com/view?id=Water002 (download 1K)
```
Only need normal map:
  Water002_1K-JPG_NormalGL.jpg -> flow_normal.png

Place in:
  assets/pbr/water/
  └── flow_normal.png
```

---

## Complete Folder Structure

```
assets/
|-- pbr/
|   |-- buildings/
|   |   |-- wood_plank/
|   |   |   |-- albedo.png
|   |   |   |-- normal.png
|   |   |   |-- roughness.png
|   |   |   `-- ao.png
|   |   |-- stone_brick/
|   |   |   `-- (same structure)
|   |   |-- metal_plate/
|   |   |   |-- albedo.png
|   |   |   |-- normal.png
|   |   |   |-- roughness.png
|   |   |   |-- metallic.png
|   |   |   `-- ao.png
|   |   |-- thatch/
|   |   |   `-- (same as wood_plank)
|   |   `-- wood_shingles/
|   |       `-- (same as wood_plank)
|   |
|   |-- terrain/
|   |   |-- grass/
|   |   |   |-- albedo.png
|   |   |   `-- normal.png
|   |   |-- dirt/
|   |   |   `-- (same structure)
|   |   |-- rock/
|   |   |   `-- (same structure)
|   |   |-- sand/
|   |   |   `-- (same structure)
|   |   `-- tilled_soil/
|   |       `-- (same structure)
|   |
|   |-- props/
|   |   |-- rocks/
|   |   |   `-- rock_large/
|   |   |       |-- albedo.png
|   |   |       |-- normal.png
|   |   |       |-- roughness.png
|   |   |       `-- ao.png
|   |   |-- cobblestone/
|   |   |   `-- (same structure)
|   |   `-- containers/
|   |       |-- crate/
|   |       |   |-- albedo.png
|   |       |   `-- normal.png
|   |       `-- barrel/
|   |           `-- (same structure)
|   |
|   `-- water/
|       `-- flow_normal.png
|
`-- models/
    `-- crops/
        |-- wheat/
        |   |-- stage_1.glb
        |   |-- stage_2.glb
        |   |-- stage_3.glb
        |   |-- stage_4.glb
        |   `-- stage_5.glb
        |-- carrot/
        |   `-- (same structure)
        `-- corn/
            `-- (same structure)
```

---

## Quick Download Script (PowerShell)

```powershell
# Create folder structure
$folders = @(
    "assets/pbr/buildings/wood_plank",
    "assets/pbr/buildings/stone_brick",
    "assets/pbr/buildings/metal_plate",
    "assets/pbr/buildings/thatch",
    "assets/pbr/buildings/wood_shingles",
    "assets/pbr/terrain/grass",
    "assets/pbr/terrain/dirt",
    "assets/pbr/terrain/rock",
    "assets/pbr/terrain/sand",
    "assets/pbr/terrain/tilled_soil",
    "assets/pbr/props/rocks/rock_large",
    "assets/pbr/props/cobblestone",
    "assets/pbr/props/containers/crate",
    "assets/pbr/props/containers/barrel",
    "assets/pbr/water",
    "assets/models/crops/wheat",
    "assets/models/crops/carrot",
    "assets/models/crops/corn"
)

foreach ($folder in $folders) {
    New-Item -ItemType Directory -Force -Path $folder
    Write-Host "Created: $folder"
}

Write-Host "`nFolder structure created. Download textures manually from:"
Write-Host "  Buildings: https://3dtextures.me/category/stylized-textures/"
Write-Host "  Terrain:   https://ambientcg.com/"
Write-Host "  Crops:     https://poly.pizza/bundle/Ultimate-Crops-Pack-8rnVIzNDye"
```

---

## File Naming Convention

When downloading, rename to this standard:

| Downloaded Name | Rename To |
|-----------------|-----------|
| `*_basecolor.*` or `*_Color.*` or `*_diffuse.*` | `albedo.png` |
| `*_normal.*` or `*_NormalGL.*` | `normal.png` |
| `*_roughness.*` | `roughness.png` |
| `*_metallic.*` or `*_Metalness.*` | `metallic.png` |
| `*_ambientOcclusion.*` or `*_AO.*` | `ao.png` |

**Note:** Convert JPG to PNG if needed for consistency. Most engines handle both, but PNG avoids compression artifacts on normal maps.

---

## Stylization Tips

If using photorealistic textures (Poly Haven, ambientCG) for Valheim style:

1. **Reduce saturation** by 20-30%
2. **Increase contrast** slightly
3. **Apply slight blur** (0.5-1px Gaussian)
4. **Reduce resolution** to 512x512 (intentional low-res look)
5. **Optional:** Add subtle hand-painted overlay

GIMP Filter chain:
```
Colors -> Hue-Saturation -> Saturation: -25
Colors -> Curves -> S-curve for contrast
Filters -> Blur -> Gaussian Blur -> 0.8px
Image -> Scale Image -> 512x512
```
