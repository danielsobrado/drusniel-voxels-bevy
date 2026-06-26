# CLOD-POC Construction Runtime

The CLOD-POC now has a small runtime construction loop based on the reusable Bevy construction design, not a direct Unity/RustLikeGame port.

Construction pieces are props/entities. CLOD terrain/page rebuilds only happen when a foundation-like piece requests terrain conforming.

## Controls

| Key / input | Action |
|---|---|
| `B` | Toggle building mode and the build menu |
| Build menu buttons | Select construction piece |
| `1..9` | Select construction piece |
| `R` | Rotate selected piece by 90 degrees |
| `X` | Toggle snap mode |
| Right click | Place the current valid ghost |
| `?construction=0` | Disable construction runtime |

## Current behavior

- Floors, fences, and pillars can be freely placed on terrain.
- Walls require snap placement.
- Snap points are indexed in a spatial hash.
- Ghost preview colors:
  - green: valid free placement
  - blue: valid snapped placement
  - red: invalid placement
- A small build UI appears when building mode is active.
- Placed pieces persist in `localStorage` under the configured key.
- Foundation categories configured under `terrain_conform.foundation_categories` can request terrain fill/trim.
- Terrain conforming goes through the existing terrain edit worker path, so LOD0 mesh swaps, vegetation rebuilds, and parent-page dirtying happen only for actual terrain changes.

## Source files

```text
tools/clod-poc/config/construction.yaml
tools/clod-poc/src/construction/types.ts
tools/clod-poc/src/construction/config.ts
tools/clod-poc/src/construction/snap_index.ts
tools/clod-poc/src/construction/placement.ts
tools/clod-poc/src/construction/construction_controller.ts
tools/clod-poc/src/terrain/editing/terrain_edit_service.ts
```

## Deliberate boundary

Do not dirty CLOD pages for walls, fences, pillars, roofs, or other prop-only pieces.

Dirty CLOD pages only when construction changes terrain, such as:

- foundation pad fill
- terrain trim above a foundation pad
- future terrain conform/flatten tools
- future material/vegetation mask edits caused by construction

## Not implemented yet

- Real mesh assets for pieces.
- Physics colliders for placed construction pieces.
- Support propagation/collapse in CLOD-POC. The Bevy game runtime already has this and should remain the reference.
