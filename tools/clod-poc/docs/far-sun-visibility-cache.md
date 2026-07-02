# CLOD-POC far sun visibility cache

The CLOD-POC far sun visibility cache is a CPU-built prototype cache for coarse far-terrain sun visibility. It is derived data. The terrain summary remains the source of truth.

## Runtime behavior

- Configuration comes from `src/app/config/sun_light.yaml`.
- URL query flags override only runtime toggles:
  - `sunLightCache=0|1`
  - `sunLightStats=0|1`
  - `sunLightDebug=0|1`
- The existing far-summary frame hook updates the cache, so its cost is included in `farSummaryMs`.
- The cache builds a small number of tiles per frame under a millisecond budget.
- Terrain edit revision changes clear cached entries before new tiles are built.

## Cache key

Each entry is keyed by:

- tile coordinates
- sun direction bin
- terrain edit revision

## Stored values

Each tile stores low-resolution values:

- `lit`
- `shaded`
- `missing`

Missing terrain remains explicit. It is not silently treated as lit.

## Debugging

The lil-gui folder is `sun light cache`.

Runtime counters are mirrored as `sunLightCache.*`:

- `active`
- `entries`
- `pendingTiles`
- `hits`
- `misses`
- `missingValues`
- `evictions`
- `refreshes`
- `tilesBuiltThisFrame`
- `buildMsLastFrame`
- `buildMsAvg`

The debug overlay is a small DOM canvas minimap of the cached tiles. It intentionally does not add a Three.js render pass.

## Limitations

- CPU-only PoC.
- It is not yet feeding far fog, god rays, or far shell material uniforms.
- Dynamic props and vegetation are not occluders.
- The cache should not extend CSM shadow distance.
