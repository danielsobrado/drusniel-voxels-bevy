# Chunk Boundary Face Visibility - Problem & Solution

Document status (2026-05-17): current technical note; verify file paths against code when editing.

## The Problem

When rendering a voxel world divided into chunks, faces at chunk boundaries were rendering incorrectly:
1. **Floating faces** appearing in the void (sky) outside the world
2. **Missing faces** causing gaps in terrain where you could see through to the sky

## Root Cause

The issue was in the `is_face_visible` function in `src/voxel/meshing.rs`. This function determines whether a block face should be rendered based on whether its neighbor is transparent (air, water, etc.).

### How Face Visibility Works

For each solid block, we check all 6 faces (Top, Bottom, North, South, East, West):
- If the neighbor block is **solid** → don't render the face (it's hidden)
- If the neighbor block is **transparent** (air) → render the face (it's visible)

### The Chunk Boundary Problem

When a block is at the edge of a chunk (e.g., local position x=15), its neighbor might be in a different chunk. The code handles this by:

1. First checking if the neighbor is within the same chunk (fast path)
2. If not, using `world.get_voxel()` to look up the neighbor in the world

The problem occurs when `world.get_voxel()` returns `None`:
- This happens when the neighbor position is **outside the world bounds**
- Examples: below y=0, above max Y, or outside X/Z boundaries

## The Bug

The original code returned `true` (render face) when `get_voxel()` returned `None`:

```rust
if let Some(neighbor_voxel) = world.get_voxel(neighbor_world_pos) {
    neighbor_voxel.is_transparent()
} else {
    true  // BUG: This renders faces into the void!
}
```

This caused faces to render into empty space outside the world, creating floating rectangles in the sky.

## First Fix Attempt (Partial)

We tried being "smart" about which faces to render at boundaries:

```rust
match face {
    Face::Bottom => neighbor_world_pos.y < 0,  // INVERTED LOGIC!
    Face::Top => true,
    _ => false,
}
```

**Problem**: The boolean logic was inverted! `neighbor_world_pos.y < 0` returns `true` when y=-1, which means "render the face" - the opposite of what we wanted.

## The Solution

The correct fix is simple: **never render faces when the neighbor is outside the world bounds**.

```rust
if let Some(neighbor_voxel) = world.get_voxel(neighbor_world_pos) {
    neighbor_voxel.is_transparent()
} else {
    // Outside world bounds - never render faces into the void
    false
}
```

### Why This Works

1. **Within world bounds**: `get_voxel()` returns `Some(voxel)`, and we correctly check if the neighbor is transparent
2. **Outside world bounds**: `get_voxel()` returns `None`, and we return `false` (don't render)

This eliminates floating faces because:
- Faces pointing into the void below y=0 → not rendered
- Faces pointing into the void at world X/Z edges → not rendered
- Faces pointing into the void above max Y → not rendered

### No Gaps in Terrain

You might wonder: "Won't this cause gaps at chunk boundaries within the world?"

No, because:
- All chunks within world bounds are generated at startup
- `get_voxel()` only returns `None` for positions truly outside the world
- For positions inside the world, the chunk exists and `get_voxel()` returns `Some(voxel)`

## Key Files

- `src/voxel/meshing.rs` - The `is_face_visible` function (lines 136-175)
- `src/voxel/world.rs` - The `get_voxel` function that returns `None` for out-of-bounds positions

## Debug Tools Added

Press **D** while looking at a block to see:
- Block position (world, chunk, local coordinates)
- Voxel type and atlas index
- All 6 neighbors with their types and whether they're in the same chunk
- Whether the chunk exists

This helps diagnose any future face visibility issues.

## Lessons Learned

1. **Simple is better**: The complex "smart" logic with per-face handling introduced bugs
2. **Boolean logic is tricky**: `y < 0` means "true when below zero" - easy to confuse with "hide when below zero"
3. **Trust the data**: If `get_voxel` returns `None`, the position is outside the world - don't render there
