# Props System Integration

## File Placement

Copy files to your project:

```
src/props/mod.rs      -> src/props/mod.rs
src/props/loader.rs   -> src/props/loader.rs
src/props/spawner.rs  -> src/props/spawner.rs
src/props/materials.rs -> src/props/materials.rs

src/lib.rs            -> src/lib.rs (replace)
src/main.rs           -> src/main.rs (replace)

config/props.yaml     -> config/props.yaml
```

## Asset Download

### 1. Quaternius Stylized Nature (Recommended)

Download: https://quaternius.com/packs/stylizednature.html

Extract and rename to match config paths:
```
assets/models/trees/pine_large.glb
assets/models/trees/pine_small.glb
assets/models/trees/oak.glb
assets/models/trees/birch.glb
assets/models/rocks/boulder_large.glb
assets/models/rocks/boulder_small.glb
assets/models/plants/bush_green.glb
assets/models/plants/fern.glb
assets/models/plants/flower_red.glb
assets/models/plants/mushroom.glb
```

### 2. Kay Lousberg KayKit

Download: https://kaylousberg.itch.io/kaykit-nature

### 3. Kenney Nature Kit

Download: https://kenney.nl/assets/nature-kit

## Directory Structure

```
assets/
└── models/
    ├── trees/
    │   ├── pine_large.glb
    │   ├── pine_small.glb
    │   ├── oak.glb
    │   └── birch.glb
    ├── rocks/
    │   ├── boulder_large.glb
    │   ├── boulder_small.glb
    │   └── rock_flat.glb
    └── plants/
        ├── bush_green.glb
        ├── fern.glb
        ├── shrub.glb
        ├── flower_red.glb
        ├── flower_yellow.glb
        └── mushroom.glb
```

## Configuration

Edit `config/props.yaml` to:
- Adjust density (0.0 - 1.0, lower = sparser)
- Set spawn_on voxel types
- Control scale_range for size variation
- Limit max_count per prop type

## Conversion (if needed)

If assets are FBX format:

1. Open Blender
2. File → Import → FBX
3. File → Export → glTF 2.0 (.glb)
4. Enable: Apply Modifiers, +Y Up

## Troubleshooting

**Props not spawning:**
- Check console for asset load errors
- Verify file paths match config exactly
- Ensure density > 0

**Wrong colors:**
- Adjust `style.saturation_boost` in props.yaml
- For custom foliage, tweak `style.custom.*` to match the stylized palette
- Check source textures are embedded in GLB

**Performance issues:**
- Reduce `max_count` per type
- Lower `density` values
- Use LOD models if available
