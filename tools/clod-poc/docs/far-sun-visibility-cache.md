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
- `build.material_tile_radius` controls the camera-centered tile radius queued for far material tinting.
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

## Far material integration

`InfiniteFarShell` reads the cache through a peek-only global hook. The lookup never queues cache work from the material path. It only uses already-built cache entries.

The far shell applies the result by modulating its vertex color attribute:

- `lit` keeps the base far material color.
- `shaded` darkens the vertex color.
- `missing` uses a conservative mid tint.
- `pending` stays neutral to avoid dark popping while the cache warms.

This works for both biome vertex colors and the WebGPU parity far terrain material because both use the shell color attribute.

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
- It does not yet feed the screen-space god-ray pass.
- Dynamic props and vegetation are not occluders.
- The cache should not extend CSM shadow distance.
