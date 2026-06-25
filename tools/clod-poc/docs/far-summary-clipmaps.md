# Far Summary Clipmaps

## Goal

Replace the old finite-world terrain summary with a camera-centered, lazy-streamed,
infinite-style far summary clipmap that can feed:

1. far terrain shell height/color/normal,
2. far shadow proxy,
3. far canopy shell,
4. future Bevy infinite streaming.

The old approach derived far shell radius from `worldSizeCells * radiusFactor` and baked
height textures from CLOD page envelopes. That tied the far shell to the finite built
world and could not extend past the world boundary without procedural fallback.

The new approach treats the world as conceptually infinite. Far summary tiles are keyed
by integer coordinates and stream around the camera's predicted position. Far shells
sample from this tile cache. Missing tiles fall back through stale cache entries ->
lower-detail rings -> procedural terrain field -> conservative default.

## Architecture

```
                ┌─────────────────────┐
                │  FarSummaryConfig   │  (src/far-summary/config.ts)
                └────────┬────────────┘
                         │ config
           ┌─────────────┼──────────────────┐
           ▼             ▼                  ▼
    ┌─────────────┐ ┌──────────┐  ┌──────────────────┐
    │ StreamCenter│ │Clipmap   │  │ SummaryTileCache │
    │ (prediction)│ │Rings     │  │ (lifecycle +     │
    └─────────────┘ └──────────┘  │  build budget)   │
                                  └────────┬─────────┘
                                           │
                                           ▼
                                  ┌──────────────────────┐
                                  │FarSummaryClipmap     │
                                  │Sampler (implements   │
                                  │ FarHeightProvider)   │
                                  └──────────┬───────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  FarTerrainShell     │
                                  │ (LV-2, camera-       │
                                  │  centered grid)      │
                                  └──────────────────────┘
```

Key files under `src/far-summary/`:

| File | Responsibility |
|------|---------------|
| `config.ts` | Far summary config (TypeScript object; TODO: YAML) |
| `types.ts` | Core data types: `FarSummaryTileState`, `FarSummarySample`, `FarSummaryTile`, `FarSummaryStats` |
| `tile-key.ts` | Integer tile key functions (`worldToTileCoord`, `tileKeyToString`) |
| `stream-center.ts` | Camera velocity tracking + position prediction |
| `clipmap-rings.ts` | Compute required tile set around predicted stream center |
| `summary-tile-builder.ts` | Build one summary tile from procedural terrain sampler |
| `summary-cache.ts` | Full tile lifecycle cache with build budget |
| `clipmap-sampler.ts` | `FarHeightProvider` implementation with fallback chain |
| `debug-overlay.ts` | Grid overlay + stats display |
| `stats.ts` | Counter management |
| `integration.ts` | Wires everything together into an update-once-per-frame loop |

## Tile lifecycle

```
missing → requested → building → ready
                                      ↓ (no longer in required set)
                                   stale
                                      ↓ (grace period expires)
                                 cooling
                                      ↓ (eviction grace expires)
                                 evicted
```

Rules:

- A tile is `requested` when it first appears in the required set.
- `building` is synchronous but budgeted per frame (configurable).
- `ready` tiles are fully built and sampleable.
- A tile moves to `stale` when it leaves the required set but remains sampleable for
  fallback.
- `cooling` tiles are waiting for the eviction grace period. They remain sampleable.
- `evicted` tiles are removed from the cache entirely.

## Rings and config

Configured in `DEFAULT_FAR_SUMMARY_CONFIG` (src/far-summary/config.ts). TODO: move to YAML.

Current defaults:

```yaml
rings:
  - name: near_far    # 1536-4096m, 32m cells, 32x32 tiles
  - name: mid_far     # 4096-8192m, 64m cells, 32x32 tiles
  - name: horizon     # 8192-16384m, 128m cells, 32x32 tiles
```

Each ring:
- Covers a square region around the predicted stream center.
- Tiles are keyed by integer grid coordinates.
- Higher rings have larger cells → fewer tiles for the same cover area.
- The inner radius of each ring avoids requesting tiles fully covered by the
  previous/nearer ring.

## Fallback order

When `FarSummaryClipmapSampler.sampleFull(worldX, worldZ, preferredRing)` is called:

1. **Exact tile hit**: find a `ready` or `stale` tile in the preferred ring that
   contains (worldX, worldZ).
2. **Lower ring**: if no tile in the preferred ring, try progressively lower ring
   indices (coarser resolution → may still cover the area).
3. **Stale tile**: any `stale` or `cooling` tile containing the point, regardless
   of ring.
4. **Procedural fallback**: sample the analytic terrain field (`surfaceHeightCore`)
   directly.
5. **Conservative default**: return `conservativeMissingHeightM` (default 0).

Increment debug counters for each fallback level.

## Far shell integration

The far terrain shell (`src/gpu/far_terrain_shell.ts`) was modified:

1. New `FarHeightProvider` interface:
   ```ts
   interface FarHeightProvider {
     sampleHeight(x: number, z: number): number;
     sampleNormal(x: number, z: number): THREE.Vector3;
   }
   ```
2. When `heightProvider` is set in options, the shell samples heights from the
   provider instead of from `TerrainSummaryField`.
3. The shell now accepts `centerX`/`centerZ` parameters for camera-relative
   positioning (previously always `worldSize / 2`).
4. `FarShellControllerDeps` was extended with `heightProvider` and `centerX`/`centerZ`.
5. `FarShellController` gained `setHeightProvider()` and `updateCenter()` methods.

## Debug toggles

The debug overlay (`src/far-summary/debug-overlay.ts`) provides:

| Feature | Description |
|---------|-------------|
| `showClipmapGrid` | Wireframe grid showing tile boundaries |
| `showRingColors` | Color-coded rings |
| `showTileStates` | Colored quads per tile state |
| `showTileGrid` | Clipmap ring grid lines |

Stats displayed in a `<pre>` element at bottom-right:

```
Far Summary:
  req: requested tiles
  bld: building tiles
  rdy: ready tiles
  stl: stale tiles
  evt: evicted tiles
  hit: cache hit %
  prc: procedural fallbacks
  lwr: lower-ring fallbacks
  blt: tiles built this frame
  ms:  build ms
  max: max build ms
```

## Known limitations

- Build is still synchronous but budgeted in the PoC.
- Summary data is CPU-side arrays, not GPU textures yet.
- Frustum-aware tile priority is deferred (uses simple square coverage).
- Shadow proxy/canopy proxy integration is partial (they still use the old
  TerrainSummaryField textures).
- Production Bevy port is not done in this phase.
- YAML config file not yet created (config lives in TypeScript defaults).
- The `long_view_4km` scene still uses the old TerrainSummaryField for its far
  shell; only `infinite-stream-far-summary` and `infinite-stream-slow-builds`
  use the new far summary clipmap.

## Next steps

1. Port the far summary clipmap to Bevy Rust.
2. Add Web Worker async tile builders (non-blocking).
3. Pack summary data into GPU textures for the LV-2/LV-3/LV-4 shells.
4. Implement frustum-aware tile priority culling.
5. Integrate with shadow proxy (LV-3) and canopy shell (LV-4).
6. Move config to YAML (`config/far_summary.yaml`).
7. Add canonical far summary data for the Bevy production pipeline.
