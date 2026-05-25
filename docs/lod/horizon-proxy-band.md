# Terrain horizon proxy band

Document status (2026-05-25): current technical note; verify `src/voxel/plugin.rs` before editing.

## Purpose

The horizon proxy band keeps distant mountain silhouettes visible after normal high/medium terrain detail has ended, instead of letting fog-blue mountains disappear abruptly at the first cull frontier.

The rule is:

```text
Lod0/Lod1/Lod2: normal visible terrain detail bands
Lod3: cheap horizon proxy terrain
Culled: no terrain mesh
```

`Lod3` is intentionally retained beyond `LodSettings::cull_distance`. The old cull distance now marks the start of the proxy band, and true culling happens after `HORIZON_PROXY_BAND_DISTANCE`.

## Runtime behavior

Implementation lives in `src/voxel/plugin.rs`.

- `calculate_target_lod_with_hysteresis` routes chunks through `Lod3` until `horizon_proxy_cull_distance(settings)`.
- `horizon_proxy_cull_distance(settings)` is `settings.cull_distance + HORIZON_PROXY_BAND_DISTANCE`.
- `HORIZON_PROXY_BAND_DISTANCE` is currently `256.0` world units.
- `Lod3` terrain uses `TerrainMaterialQuality::HorizonProxy`.
- `TerrainMaterialQuality::HorizonProxy` uses single-projection albedo texture sampling with cheap material-weight blending, then returns an unlit fog-tinted silhouette before normal sampling, wetness, parallax, or PBR lighting.
- `Lod2` and `Lod3` terrain do not get `NeedsCollider`.
- `Lod2` and `Lod3` terrain remove stale live collider components when chunks downgrade into visual-only LODs.
- `Lod3` terrain gets `NotShadowCaster`.
- `Lod3` terrain is excluded from the water reflection render layer.
- Water meshes are cleared for `Lod3` chunks.

This makes the band terrain-only, silhouette-focused, textured enough to preserve mountain material variation, and cheap enough to keep through dense fog.

`Lod1` remains collidable. It sits close enough to the player that fast movement, spawn/collider catch-up, and LOD update latency can otherwise expose missing near-field collision before a chunk sharpens back to `Lod0`.

## Diagnostics

Use `Alt+K` to display chunk LOD boxes and log the non-empty LOD distribution.

Expected interpretation:

- Green boxes: `Lod0`, full nearby detail.
- Yellow boxes: `Lod1`.
- Orange/brown boxes: `Lod2`.
- Red boxes: `Lod3`, now also the horizon proxy band.
- Gray boxes: `Culled`, no terrain mesh expected.

If `Alt+0` makes distant mountains reappear, the terrain data exists and the problem is LOD/cull selection rather than world generation.

## Validation expectation

This is rendering/performance-sensitive. Use the visual regression bench before claiming performance or visual stability:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
```

Compare `bench-runs/<run>/summary.json` and inspect fixed checkpoint screenshots. The expected visual result is that fog-muted mountain silhouettes remain visible through the proxy band and only disappear once they are effectively hidden by fog.
