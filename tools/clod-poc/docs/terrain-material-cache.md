# Terrain Material Cache Prototype

This is a browser validation prototype for the material cache strategy. It informs Bevy/Rust NAADF/CLOD work but does not replace the production renderer.

## Existing Path

- Near CLOD pages remain mesh-derived. `ClodPageNode` carries `revision`, `sourceRevisions`, paint slots, and material weights.
- Terrain material UI/controllers select procedural, external PBR, or debug-flat modes and preserve the existing live shader fallback.
- NAADF far-summary tiles already carry derived height, dominant material, canopy coverage, water coverage, and tile `revision`.
- The far-summary GPU atlas already exposes height, material color, optional normal, and coverage textures to the far terrain shell shader.

## Cached Data

Config lives in `config/terrain_material_cache.yaml` and is parsed by `terrainMaterialCacheConfig.ts`.

The cache key includes source id, source revision, material revision, water revision, vegetation coverage revision, bake mode, resolution, and format profile. Visibility and CLOD cut movement update last-used state only; they do not change the key or force a bake.

Current channels:

- `macro_tint`: RGBA8 near-page macro/base color.
- `slope_curvature`: RG8 slope and curvature.
- `material_weights`: RGBA8 packed top terrain weights.
- `wetness_shoreline`: RG8 terrain wetness and shoreline influence.
- `far_color`: RGBA8 far-summary material color.
- `far_normal`: RG16F X/Z normal storage when normals are not height-derived.
- `coverage`: RG8 canopy and water coverage.

Water is not baked as terrain. Only low-frequency terrain masks such as wetness, shoreline, and water coverage are cached.

## Runtime Behavior

`TerrainMaterialCache.getOrQueue()` returns ready data when present. Missing data queues a budgeted bake and returns the existing shader/atlas fallback. If a source revision changes and stale data exists, stale data remains visible until the replacement bake is ready when `keep_stale_until_ready` is enabled.

Bakes are processed by frame budget:

- `max_tiles_baked_per_frame`
- `max_cpu_ms_per_frame`
- `max_bytes`

The cache prunes ready/stale entries by LRU when over budget. Failed bakes expose counters and fall back to the existing terrain material path.

## Integration

The NAADF far-summary atlas now requests cached far-summary material payloads per tile. If a baked `far_color` or `coverage` channel is ready, the atlas uses it; otherwise it uses the previous dominant-material and coverage path.

Dirty-rect upload is not currently implemented in this Three.js `DataTexture` atlas path. The upload abstraction records that dirty rects are unsupported and keeps updates bounded by tile/cache key rather than pretending a partial GPU upload happened.

## Fallback Ladder

1. Ready baked channel.
2. Stale baked channel when configured.
3. Existing live shader or far-summary atlas computation.
4. Explicit debug fallback only through debug controls.

Near terrain keeps the live full-quality path by default. Mid/far cache use is guarded by the material quality/config path and does not remove existing material modes.

## Debug And Counters

GUI folder: `terrain material cache`

- enabled
- force rebake
- show tile grid
- show invalidations
- debug channel

Stats counters:

- `terrainMaterialCacheHits`
- `terrainMaterialCacheMisses`
- `terrainMaterialCacheQueued`
- `terrainMaterialCacheBaking`
- `terrainMaterialCacheReady`
- `terrainMaterialCacheStale`
- `terrainMaterialCacheFailed`
- `terrainMaterialCacheEvictions`
- `terrainMaterialCacheBytes`
- `terrainMaterialBakeMs`
- `terrainMaterialUploadMs`

No GPU readbacks are required for normal gameplay or debug counters.

## Validation

Typecheck:

```powershell
npm --prefix tools/clod-poc run typecheck
```

Focused tests:

```powershell
npm --prefix tools/clod-poc test -- src/terrain/material-cache/terrainMaterialCacheConfig.test.ts src/terrain/material-cache/terrainMaterialCache.test.ts src/terrain/material-cache/terrainMaterialBakeProviders.test.ts src/naadf/gpu/farSummaryAtlas.test.ts
```

Vite build:

```powershell
npm --prefix tools/clod-poc run build
```

Perf A/B cases:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 120 --frames 300 --case terrain-material-cache-disabled --out perf-runs/terrain-material-cache-disabled
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 120 --frames 300 --case terrain-material-cache-enabled --out perf-runs/terrain-material-cache-enabled
```

Known limitation: on this WSL/Windows run, the headless WebGPU perf harness reached the app but failed before sample collection with `WebGPU device lost: destroyed`.
