# Terrain Rendering Modes

The voxel terrain system supports two mesh generation modes, each with different shaders for varying visual quality and performance characteristics.

## Mesh Modes

### SurfaceNets Mode (Default for Nearby Terrain)

Uses the **triplanar PBR shader** (`assets/shaders/triplanar_terrain.wgsl`) for high-quality terrain rendering:

- **True triplanar texturing** with proper projection blending
- **Full PBR pipeline**: albedo, normal maps, roughness per material
- **Multi-material blending**: grass, rock, sand, dirt with weight-based transitions
- **Wet sand effects**: dynamic darkening and roughness changes near water
- **Parallax mapping** for rock surfaces
- **Smooth Surface Nets geometry** for natural-looking terrain

This mode produces the rich, detailed look seen in V0.3 and earlier versions.

### Blocky Mode (Used for Distant/LOD Terrain)

Uses the **texture array shader** (`assets/shaders/blocky_terrain.wgsl`) for performance:

- **Texture2DArray** for efficient material indexing
- **Simpler PBR**: basic albedo with uniform roughness
- **Minecraft-style** blocky geometry (greedy meshing)
- **Lower GPU cost** suitable for distant chunks

## LOD Strategy

The terrain uses a hybrid approach for optimal quality/performance balance:

| Distance | Mesh Mode | Shader | Quality |
|----------|-----------|--------|---------|
| Nearby (Lod0) | SurfaceNets | Triplanar PBR | Highest |
| Medium (Lod1) | SurfaceNets (half-res) | Triplanar PBR | High |
| Far (Lod2) | SurfaceNets (quarter-res) | Triplanar PBR | Medium |
| Very Far (Lod3) | SurfaceNets (eighth-res) | Triplanar PBR | Low |
| Distant (LOD fallback) | Blocky | Texture Array | Performance |

### Integrated GPU Behavior

On integrated GPUs, the system automatically:
- Reduces LOD distances for better performance
- Uses **Blocky mode only for distant LOD chunks**
- **Preserves SurfaceNets for nearby terrain** to maintain visual quality

This ensures caves and nearby exploration areas retain the rich V0.3 visual style while maintaining playable framerate.

## Configuration

The mesh mode is set in `src/voxel/plugin.rs`:

```rust
.insert_resource(MeshSettings {
    mode: MeshMode::SurfaceNets,  // High-quality nearby terrain
})
.insert_resource(LodSettings {
    low_detail_mode: MeshMode::Blocky,  // Performance for distant chunks
    ..default()
})
```

## Related Files

- `assets/shaders/triplanar_terrain.wgsl` - High-quality triplanar PBR shader
- `assets/shaders/blocky_terrain.wgsl` - Performance-focused texture array shader
- `src/rendering/triplanar_material.rs` - Triplanar material definition
- `src/rendering/blocky_material.rs` - Blocky material definition
- `src/voxel/meshing.rs` - Mesh generation for both modes
