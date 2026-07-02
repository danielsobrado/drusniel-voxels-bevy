# CLOD-POC far sun visibility cache

The CLOD-POC far sun visibility cache is a GPU-first far-lighting prototype. CPU code still builds the coarse visibility tiles, but the visual path uploads those tiles into a red-channel GPU atlas and samples that atlas in the far materials. The terrain summary remains the source of truth.

## Runtime behavior

- Configuration comes from `src/app/config/sun_light.yaml`.
- URL query flags override only runtime toggles:
  - `sunLightCache=0|1`
  - `sunLightStats=0|1`
  - `sunLightDebug=0|1`
- The existing far-summary frame hook updates the cache, so its cost is included in `farSummaryMs`.
- The cache builds a small number of tiles per frame under a millisecond budget.
- `build.material_tile_radius` controls the camera-centered tile radius queued for far material lighting.
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

## GPU material integration

The runtime uploads built visibility tiles into `drusniel-sun-light-visibility-atlas`, a red-channel `DataTexture`.

The far shaders sample that atlas by world position:

- `lit` keeps direct sun contribution.
- `shaded` attenuates direct sun contribution.
- `missing` uses a conservative mid value.
- not-yet-built areas default to lit to avoid dark popping while the cache warms.

The atlas uniforms are updated before the far-shell material update path each frame, so the far shell samples the current atlas origin and size. This path works for both:

- the non-parity `InfiniteFarShellMaterial`
- the WebGPU parity `FarTerrainMaterial`

CPU-side vertex color modulation is no longer the active visual path.

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

- The tile builder is still CPU-side. The render/material consumption path is GPU-first.
- It does not yet feed the screen-space god-ray pass.
- Dynamic props and vegetation are not occluders.
- The cache should not extend CSM shadow distance.
