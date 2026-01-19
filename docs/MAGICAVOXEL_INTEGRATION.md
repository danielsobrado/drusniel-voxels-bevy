# MagicaVoxel .vox Import/Export Implementation Plan

## Overview

Add MagicaVoxel .vox file format support to enable:
- **Import**: Load .vox models and place them into the VoxelWorld
- **Export**: Save world regions as .vox files for editing in MagicaVoxel
- **Color Mapping**: Bidirectional mapping between MagicaVoxel's 256-color palette and the 12 VoxelType variants

## Crate Dependency

Add to `Cargo.toml`:
```toml
vox-format = "0.2"
```

**Why vox-format**: Supports both reading AND writing .vox files (unlike dot_vox which is read-only).

## File Structure

```
src/voxel/
├── mod.rs                 # Add: pub mod vox_io;
├── vox_io/
│   ├── mod.rs            # Module exports, events, plugin
│   ├── error.rs          # VoxError enum (thiserror)
│   ├── color_mapping.rs  # VoxelType <-> RGBA color conversion
│   ├── import.rs         # .vox file import logic
│   └── export.rs         # .vox file export logic
```

---

## 1. Error Types (`src/voxel/vox_io/error.rs`)

```rust
use bevy::prelude::*;
use thiserror::Error;
use std::path::PathBuf;

#[derive(Debug, Error)]
pub enum VoxError {
    #[error("Failed to read .vox file '{path}': {source}")]
    FileRead { path: PathBuf, #[source] source: std::io::Error },

    #[error("Failed to write .vox file '{path}': {source}")]
    FileWrite { path: PathBuf, #[source] source: std::io::Error },

    #[error("Failed to parse .vox file: {0}")]
    ParseError(String),

    #[error("Failed to encode .vox file: {0}")]
    EncodeError(String),

    #[error("Model dimensions {dimensions:?} exceed MagicaVoxel limit of 256^3")]
    ModelTooLarge { dimensions: IVec3 },

    #[error("Export region {min:?} to {max:?} is empty (no non-air voxels)")]
    EmptyRegion { min: IVec3, max: IVec3 },

    #[error("Import position {position:?} is outside world bounds")]
    OutOfBounds { position: IVec3 },
}
```

---

## 2. Color Mapping (`src/voxel/vox_io/color_mapping.rs`)

### Reference Colors for Each VoxelType

| VoxelType | RGB Color | Notes |
|-----------|-----------|-------|
| TopSoil | (76, 153, 76) | Green grass |
| SubSoil | (139, 90, 43) | Brown dirt |
| Rock | (128, 128, 128) | Gray stone |
| Bedrock | (64, 64, 64) | Dark gray |
| Sand | (237, 201, 175) | Tan/yellow |
| Clay | (170, 74, 68) | Reddish-brown |
| Water | (64, 164, 223, 180) | Blue, semi-transparent |
| Wood | (133, 94, 66) | Brown |
| Leaves | (34, 139, 34, 200) | Green, semi-transparent |
| DungeonWall | (96, 96, 96) | Stone gray |
| DungeonFloor | (112, 112, 112) | Lighter stone |

### Color Matching Algorithm

For import, use HSL color distance to find the closest VoxelType:
1. Convert RGBA to HSL
2. Calculate weighted distance: `hue_diff * 3.0 + sat_diff * 2.0 + light_diff`
3. Colors with alpha < 128 map to Air

### Export Palette

Build a 256-color palette with indices 1-11 for VoxelTypes (index 0 = empty/air).

---

## 3. Import Options & Implementation

### VoxImportOptions

```rust
pub struct VoxImportOptions {
    pub world_position: IVec3,      // Where to place model origin
    pub overwrite_existing: bool,   // Overwrite non-air voxels?
    pub rotation: VoxRotation,      // 90-degree increments
    pub model_index: usize,         // Which model if multi-model file
}

pub enum VoxRotation { None, Rotate90, Rotate180, Rotate270 }
```

### Coordinate System Conversion

MagicaVoxel uses: X right, Y forward, Z up
Game uses: X right, Y up, Z forward

```
MV.X → Game.X
MV.Y → Game.Z
MV.Z → Game.Y
```

### Import Flow

1. Load .vox file with `vox_format::from_file()`
2. Get model by index (default 0)
3. Get palette from file
4. For each voxel:
   - Convert coordinates (apply rotation)
   - Look up palette color
   - Map color to VoxelType using HSL distance
   - Place in world (respecting overwrite setting)
5. Return ImportResult with counts

---

## 4. Export Options & Implementation

### VoxExportOptions

```rust
pub struct VoxExportOptions {
    pub min: IVec3,              // Region min corner
    pub max: IVec3,              // Region max corner
    pub include_water: bool,     // Include water voxels?
    pub model_name: Option<String>,
}
```

### MagicaVoxel Limits

- Max model size: 256 x 256 x 256 voxels
- For larger regions, use `export_vox_chunked()` to split into multiple files

### Export Flow

1. Validate dimensions (< 256^3)
2. Iterate world region
3. Skip Air and optionally Water
4. Convert coordinates (Game → MagicaVoxel)
5. Map VoxelType to palette index
6. Build VoxData with model and palette
7. Write with `vox_format::to_file()`

### Chunked Export

For regions > 256^3, split into multiple files named `{base}_{x}_{y}_{z}.vox`.

---

## 5. Bevy Integration

### Events

```rust
#[derive(Event)]
pub struct ImportVoxEvent {
    pub path: PathBuf,
    pub options: VoxImportOptions,
}

#[derive(Event)]
pub struct ExportVoxEvent {
    pub path: PathBuf,
    pub options: VoxExportOptions,
}

#[derive(Event)]
pub enum VoxOperationComplete {
    ImportSuccess(ImportResult),
    ImportFailed(String),
    ExportSuccess(ExportResult),
    ExportFailed(String),
}
```

### Plugin

```rust
pub struct VoxIoPlugin;

impl Plugin for VoxIoPlugin {
    fn build(&self, app: &mut App) {
        app.add_event::<ImportVoxEvent>()
            .add_event::<ExportVoxEvent>()
            .add_event::<VoxOperationComplete>()
            .add_systems(Update, (handle_import_events, handle_export_events));
    }
}
```

### Integration

1. Add `pub mod vox_io;` to `src/voxel/mod.rs`
2. Add `app.add_plugins(vox_io::VoxIoPlugin);` in VoxelPlugin

---

## 6. Usage Examples

### Import

```rust
import_events.send(ImportVoxEvent {
    path: "assets/structures/house.vox".into(),
    options: VoxImportOptions {
        world_position: IVec3::new(100, 20, 100),
        overwrite_existing: false,
        rotation: VoxRotation::None,
        model_index: 0,
    },
});
```

### Export

```rust
export_events.send(ExportVoxEvent {
    path: "exports/my_build.vox".into(),
    options: VoxExportOptions {
        min: IVec3::new(90, 15, 90),
        max: IVec3::new(130, 50, 130),
        include_water: true,
        model_name: Some("My Build".to_string()),
    },
});
```

---

## 7. Testing Plan

1. **Unit tests** for color mapping (round-trip VoxelType → color → VoxelType)
2. **Integration tests** for export → import round-trip
3. **Manual testing**: Create model in MagicaVoxel, import, verify appearance

---

## 8. Critical Files to Reference

| File | Purpose |
|------|---------|
| `src/voxel/types.rs` | VoxelType enum and traits |
| `src/voxel/world.rs` | VoxelWorld API (get_voxel/set_voxel) |
| `src/voxel/persistence.rs` | Error handling patterns with thiserror |
| `src/voxel/meshing.rs` | Color mappings for reference |
| `src/voxel/mod.rs` | Module structure to update |

---

## 9. Future Enhancements

- File dialog integration with `rfd` crate
- Preview ghost before committing import
- Undo/redo support for imports
- Multi-model .vox files as prefab library
- Animation keyframe import

---

## Resources

- [Official .vox format spec](https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt)
- [vox-format crate docs](https://docs.rs/vox-format)
- [MagicaVoxel website](https://ephtracy.github.io/)
