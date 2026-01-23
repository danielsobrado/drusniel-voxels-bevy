# Blocky Textures Configuration

This document describes the texture configuration system for blocky (V0.1 style) terrain rendering.

## Overview

When pressing **F5**, the terrain rendering toggles between:
- **SurfaceNets**: Smooth, high-quality PBR terrain (default)
- **Blocky**: Classic Minecraft-style voxel terrain

As of this update, **F5 now applies to ALL LOD levels**, not just close chunks. Previously, only LOD0 (nearby terrain) would switch to blocky mode while distant terrain remained smooth.

## Configuration File

The texture mapping is defined in `config/blocky_textures.yaml`.

### Texture Source Options

```yaml
# Set to true to use V0.1 atlas textures, false for current PBR textures
use_atlas: false
```

- `use_atlas: false` (default): Uses individual PBR texture files from `assets/pbr/`
- `use_atlas: true`: Uses the classic pixel-art atlas from `assets/textures/atlas.png`

### Atlas Configuration

When `use_atlas: true`, textures are extracted from the atlas:

```yaml
atlas:
  path: "textures/atlas.png"
  tile_size: 64  # Each tile is 64x64 pixels
  tiles:
    grass_top: { row: 0, col: 0 }
    dirt: { row: 0, col: 1 }
    stone: { row: 0, col: 2 }
    # ... etc
```

The atlas (`assets/textures/atlas.png`) contains classic V0.1 textures in a 4x3 grid:

| Col 0 | Col 1 | Col 2 | Col 3 |
|-------|-------|-------|-------|
| Grass Top | Dirt | Stone | Coal |
| Sand | Clay | Water | Grass Side |
| Wood | Leaves | - | - |

### Individual Texture Files

When `use_atlas: false`, textures are loaded from individual files:

```yaml
textures:
  grass:
    albedo: "pbr/grass/albedo.png"
    normal: "pbr/grass/normal.png"
  dirt:
    albedo: "pbr/dirt/albedo.png"
    normal: "pbr/dirt/normal.png"
  # ... etc
```

### Voxel Type Mapping

Each voxel type maps to texture layer indices (0-3):

| Layer | Texture | Used By |
|-------|---------|---------|
| 0 | Grass | TopSoil (top/sides), Leaves |
| 1 | Dirt | SubSoil, Clay, Wood, TopSoil (bottom) |
| 2 | Rock | Rock, Bedrock, DungeonWall, DungeonFloor |
| 3 | Sand | Sand |

Per-face texture mapping is supported:

```yaml
voxel_mapping:
  TopSoil:
    top: 0      # grass on top
    side: 0     # grass on sides
    bottom: 1   # dirt on bottom
  Rock:
    all: 2      # rock on all faces
```

## Implementation Status

### Completed
- F5 toggle now applies blocky mode to **all LOD levels** (LOD0, LOD1, LOD2, LOD3)
- YAML configuration file structure for texture mapping

### Future Work
- Atlas texture extraction (loading from `atlas.png` when `use_atlas: true`)
- Runtime texture switching without restart

## Related Files

- `config/blocky_textures.yaml` - Texture configuration
- `src/interaction/debug.rs` - F5 toggle implementation
- `src/rendering/array_loader.rs` - Texture array loading
- `src/rendering/blocky_material.rs` - Blocky material definition
- `assets/textures/atlas.png` - V0.1 style texture atlas
- `assets/shaders/blocky_terrain.wgsl` - Blocky terrain shader

## Controls

- **F5**: Toggle between SurfaceNets (smooth) and Blocky terrain modes
