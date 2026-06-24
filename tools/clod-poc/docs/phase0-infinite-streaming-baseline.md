# Phase 0: Infinite Streaming Baseline

Phase 0 creates an honest measurement harness for the CLOD PoC. It answers:

1. Does `scene=long-view-4km` actually cover at least 4096 meters?
2. Does the current PoC have visible holes or missing far coverage?
3. Are far shell, shadow proxy, canopy shell, CLOD page counts, and fallback counters reported honestly?
4. Can we simulate future lazy streaming movement without implementing streaming yet?
5. Can later phases compare before/after runs with the same scene paths and same metrics?

## What Phase 0 Measures

- **effective_visible_m**: The actual distance the far shell reaches. For the current PoC with `worldCells=1024` and `radiusFactor=1.5`, this is `1536` meters — not 4096.
- **visible_target_met**: Whether `effective_visible_m >= target_visible_m`. Currently `false`.
- **Far shell stats**: Triangle count, grid resolution, radius.
- **Shadow proxy**: Triangle count and inert status (no real shadows in PoC).
- **Canopy shell**: Triangle count and enabled status.
- **CLOD page counts**: Per-LOD page counts and selected page counts.
- **Streaming simulation**: Required and missing chunks/pages for a hypothetical infinite streamer.
- **Frame timing**: P95, P99, average frame time.

## What Phase 0 Does NOT Implement

- Real infinite streaming (that's Phase 1)
- Shadow parity (shadow proxy is inert in PoC)
- Visual upgrades
- Bevy/Rust production changes

## Expected Current Failures

The current PoC has `worldCells = 1024` (16 * 4 * 16). The far shell reaches `1024 * 1.5 = 1536` meters. This is far short of the 4096 meter target.

Phase 0 reports this honestly. The result will be:

```
BASELINE_RECORDED_WITH_EXPECTED_FAILURES
```

This is not a bug — it is the honest baseline that later phases will improve.

## How to Run

```bash
cd tools/clod-poc
npm install
npm run test
npm run typecheck
npm run phase0
```

## Output

Reports are written to `phase0-runs/<timestamp>/`:

```
phase0-runs/<timestamp>/
  summary.json
  long-view-4km.json
  long-view-forest-4km.json
  long-view-edit-stress.json
  infinite-stream-straight.json
  infinite-stream-fast-turn.json
  screenshots/
    long-view-4km.png
    long-view-forest-4km.png
    infinite-stream-straight.png
```

## Console Output

```
Phase 0 CLOD PoC Long-View Baseline

Scene                         Target  Effective  Met    FarTris    MissPg   P95
long-view-4km                    4096       1536    NO      15360        0   18.4
long-view-forest-4km             4096       1536    NO      15360        0   21.2
infinite-stream-straight         4096       1536    NO      15360       48   19.6

Result: BASELINE_RECORDED_WITH_EXPECTED_FAILURES
```

## Interpreting Reports

### `visible_target_met = false`

The current far shell does not reach 4096 meters. This is expected. Phase 1+ must extend the far shell or implement lazy streaming to achieve the target.

### `streamer_simulated_missing_chunks > 0`

An infinite streamer moving toward the world edge would need chunks that don't exist in the finite PoC world. This reveals where Phase 1 must add streaming support.

### `shadow_proxy_inert = 1`

The shadow proxy exists but produces no visible shadows because the PoC has no shadow-casting light. Phase 2+ may wire real shadows.

### `horizon_hole_ratio = -1`

No real horizon hole check is implemented. Phase 2+ should add a conservative check.

## How Later Phases Use Reports

1. **Phase 1** (lazy streaming): Should reduce `streamer_simulated_missing_chunks` to 0 while maintaining performance.
2. **Phase 2** (far summary clipmaps): Should increase `effective_visible_m` toward 4096+.
3. **Phase 3** (infinite far shells): Should achieve `visible_target_met = true`.
4. **Shadow parity**: Should set `shadow_proxy_inert = 0`.
5. **Canopy parity**: Should report real canopy metrics.

Each phase should re-run `npm run phase0` and compare against this baseline.

## Why `worldCells * 1.5` Is Not a Real 4 km Guarantee

The formula `farRadius = worldCells * radiusFactor` with `radiusFactor = 1.5` gives:

- `worldCells = 1024` → `farRadius = 1536`
- `worldCells = 2048` → `farRadius = 3072`
- `worldCells = 4096` → `farRadius = 6144`

But `worldCells` is fixed by the PoC config: `WORLD * chunks_per_page * chunk_size`. Increasing `WORLD` to reach 4096 cells would require `WORLD = 64` (64 * 4 * 16 = 4096), which is a 4x increase in build time and memory. The PoC currently uses `WORLD = 16` for long-view scenes.

Phase 0 makes this explicit in the metrics rather than hiding it behind a misleading scene name.
