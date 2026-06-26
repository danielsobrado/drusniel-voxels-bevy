# CLOD-POC Construction Runtime

The CLOD-POC now has a small runtime construction loop based on the reusable Bevy construction design, not a direct Unity/RustLikeGame port.

## Controls

| Key / input | Action |
|---|---|
| `B` | Toggle building mode |
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
- Placed pieces persist in `localStorage` under the configured key.

## Source files

```text
tools/clod-poc/config/construction.yaml
tools/clod-poc/src/construction/types.ts
tools/clod-poc/src/construction/config.ts
tools/clod-poc/src/construction/snap_index.ts
tools/clod-poc/src/construction/placement.ts
tools/clod-poc/src/construction/construction_controller.ts
```

## Not implemented yet

- Terrain conforming / flattening under foundations.
- CLOD page dirtying after terrain-conforming placement.
- Real mesh assets for pieces.
- Physics colliders for placed construction pieces.
- Support propagation/collapse in CLOD-POC. The Bevy game runtime already has this and should remain the reference.
