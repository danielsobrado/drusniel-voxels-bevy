# CLOD crossfade stats export

This export is the observability layer for the PoC-style CLOD crossfade and
screen-door dither path.

Enable it with:

```bash
CLOD_PAGES=1 \
VOXEL_CLOD_CROSSFADE_BRIDGE=1 \
VOXEL_CLOD_CROSSFADE_MATERIAL=1 \
VOXEL_CLOD_CROSSFADE_STATS_CSV=1 \
cargo run --release
```

Optional knobs:

```bash
VOXEL_CLOD_CROSSFADE_STATS_CSV_PATH=bench-runs/<run>/clod-crossfade-runtime.csv
VOXEL_CLOD_CROSSFADE_STATS_SAMPLE_EVERY=1
```

## CSV columns

- `frame`
- `transition_id`
- `material_enabled`
- `stable_pages`
- `fade_in_pages`
- `fade_out_pages`
- `page_entities`
- `faded_entities`
- `visible_faded_entities`
- `stable_entities`
- `fade_in_entities`
- `fade_out_entities`
- `min_alpha`
- `max_alpha`

`stable_pages`, `fade_in_pages`, and `fade_out_pages` come from the runtime
bridge. The `*_entities` counters are measured from actual page entities carrying
`ClodPageFade`, so mismatches between runtime state and ECS/material state become
visible in benches.

## Why this is separate from screenshots

Dithered crossfades can look acceptable in a still frame while still hiding
problems such as stale fade-out entities, never-completing transitions, or a
material flag that is disabled during a bench. This CSV makes those cases
machine-checkable in a follow-up guard.
