# Water Fable5-Parity Handover (2026-07-18)

State of the fable5-world-demo parity effort for rivers/lakes in `tools/clod-poc`.
Master plan (all phase statuses inline): `water-rivers-gpu-fable5-parity-plan-2026-07-17.md`.

## Done and committed on main (this branch of work)

- `ce96e1fc` W1: traced rivers/lakes carve streamed terrain (`carveInfiniteHydrologyHeight`
  / `createTracedHydrologyCarver` in `src/water/infinite_hydrology.ts`), wired into every
  terrain authority (CLOD worker override, stream roots, worker+client heightfield tiles,
  startup raster with carved fallback, hydrology tile worker). `river_continuity_pct`
  startup gate (probe floor 1.5 m). Live: 100% over 15 channels, transect bank 39.3 m →
  bed 21.3 m.
- `7c616950` traced-hydrology search-neighbourhood memoization (carve overhead
  +88 → +9 ms per worker tile).
- `2896ed4b` W2: atlas-driven clipmap rings L0–L3 (`waterHydrologyAtlasRuntime.ts`,
  `water_node_atlas_grid.ts`, Layout B in `hydrologyAtlas.ts`); zero CPU refills on
  those rings; kill switch `waterAtlasClipmap=0`.
- `499d3f5f`…`e9d9a3f8` (parallel session): SSR policy active on WebGPU, atlas snap-margin
  sizing, dithered near-water ramps, `waterQuality` tier + caustics in
  `water_quality_overrides.ts` (HQ = WebGPU default).
- Latest commit "drop overlapping coarse water rings on the atlas path (W2.3)": with the
  atlas active only L0–L3 exist (far clipmap owns 384 m+); also fixed the atlas-path
  clipmap config dropping the tier-resolved SSR visual.

## Evidence

- Live gates: `npx tsx tools/verify-traced-carve.ts --url "http://127.0.0.1:PORT/?scene=infinite-islands&seed=1&world=8" --out qa-runs/...`
  (needs `CHROME_PATH` with FORWARD slashes). Latest pass: `qa-runs/traced-carve-verify-w3/`
  — 4/4 rings, continuity 100%, zero uncaptured errors, HQ water visible in shots.
- Perf: `perf-runs/water-carve-after/` (W1), `perf-runs/water-atlas-after/` (W2),
  `perf-runs/water-hq-ab/` (HQ +0.3 ms render p95). A `perf-runs/water-nofar-after/`
  run (W2.3, checks the waterMs max ≤ 2 ms gate) may exist if the background run at
  session end completed — check `summary.json` `moving.phases.waterMs.max`.

## Remaining (in priority order)

1. Confirm the W2 budget gate with `perf-runs/water-nofar-after/` (waterMs p95 ≤ 0.3,
   max ≤ 2 ms; frame p95 delta water on/off ≤ 1 ms). If the run is missing, re-run:
   `npx tsx tools/perf-move.ts --baseUrl http://127.0.0.1:PORT/ --moveFrames 420 --water 1 --stones 0 --shots 0 --out perf-runs/water-nofar-after`
2. W4 acceptance integration: water gate in the infinite-islands (and continent walk)
   acceptances — aerial channel/close river/lake/shore shots + assertions
   (`webgpu_uncaptured_errors == 0`, `river_continuity_pct >= 95`, visible levels > 0,
   waterMs budget). `verify-traced-carve.ts` is the standing runner to fold in.
3. W1.3 leftover: `dressing_river_cobbles_accepted` still ~0 (density roll, W3 tuning).
4. Visual polish candidates: aerial dither speckle at shorelines (tune the near-water
   ramp), traced channels are single polylines (no confluence networks like fable5's
   flow accumulation — larger follow-up).

## Gotchas

- Trace/carve purity: channels/basins must trace against the BASE field only; both
  main thread and every worker construct carvers over `{ surfaceHeight: baseSurfaceHeight }`.
- One writer per atlas window (water = camera, vegetation = ring center); never call
  `atlas.update` from two callers with different centers (recenter flip-flop).
- With the atlas active, build the clipmap config from the tier-resolved
  `clipmapWaterConfig` (SSR visual) — regressed once already.
- Don't edit watched src files while a perf-move run points at a live dev server (HMR
  corrupts the measurement). Dev server: `npm run dev -- --host 127.0.0.1 --port 5199
  --strictPort` (5180 is the user's own server — leave it alone).
- Another session may share the working tree: stage explicit paths only.
