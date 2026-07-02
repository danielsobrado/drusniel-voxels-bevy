# Terrain material support-map cache

The terrain material support-map path is enabled from:

```yaml
assets/config/procedural_support_maps.yaml
```

The current production-safe mode is:

```yaml
procedural_support_maps:
  enabled: true
  runtime_mode: generate_if_missing
  cache_dir: generated/procedural
```

This mode is intentional while the cache is still being validated. It allows the first local run to generate the support-map PNGs and manifest, then reuse them while the manifest hash matches the config and shader inputs.

## What is cached

The generated cache currently contains:

- `noise_a.png`
- `noise_b.png`
- `terrain_classification_a.png`
- `manifest.json`

`terrain_classification_a.png` packs derived terrain material masks as RGBA:

| Channel | Meaning |
|---|---|
| R | snow |
| G | wetness |
| B | vegetation |
| A | rock exposure |

These are derived caches only. They are not authoritative terrain data.

## Runtime behavior

At startup, `ProceduralSupportMapPlugin` checks the manifest and cache files. If they match, it loads cached assets. If they are missing and `runtime_mode` is `generate_if_missing`, it generates them and writes the cache.

The plugin exposes `ProceduralSupportMapStatus` so debug UI, bench rows, or smoke tests can inspect:

- whether the path is enabled,
- whether a cache is ready,
- whether assets came from cache or runtime generation,
- which manifest key is active,
- how many triplanar material variants received the support-map uniforms.

## Shipping / stable benchmark mode

After local validation, generate the cache once and commit the generated files under:

```text
assets/generated/procedural
```

Then change the config to:

```yaml
runtime_mode: cache_only
```

Use `cache_only` only after the generated PNGs and manifest are committed. Otherwise the terrain material cache will be disabled at startup.

## Current shader optimization

`SingleProjectionFar` and `HorizonProxy` enable `TERRAIN_VERTEX_SPLAT_CACHE`. In that mode the far-terrain shader reuses baked vertex material weights instead of recomputing biome splat weights per fragment.

Near terrain still uses the existing full biome-splat path for visual safety.

## Validation checklist

Run:

```bash
cargo fmt
cargo check
cargo test
```

Then compare at least:

```bash
cargo run --release -- --bench bench/scenes/visual-regression-performance100.toml
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Check visually:

- no black terrain,
- no wrong biome colors,
- no obvious far terrain tile boundaries,
- no shoreline/wetness regression,
- no near-terrain material loss.

## Pending follow-up

The next deeper optimization is to bind and sample `terrain_classification_a.png` directly in `triplanar_terrain.wgsl` for selected mid/far material tiers. That should be done after the current far vertex-splat cache passes `cargo check` and visual smoke tests.
