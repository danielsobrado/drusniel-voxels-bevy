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

### Foam parity delivered on main (2026-07-19)

- PR #198/#200: coherent FBM foam, multiplicative speed × drop rapid eligibility,
  shared breakup, reduced river-shore activation, 0.52 coverage cap, and non-flat
  lighting in the HQ WebGPU material.
- PR #215: the performance WebGPU material now consumes the same shared foam authority;
  the old sine ribbons, additive rapid trigger, and flat-white mix are removed.
- PR #217: the WebGL fallback uses the same coverage thresholds, rapid contract,
  river-shore attenuation, cap, and environment-modulated foam colour.
- PR #220: deterministic high/low quality matrix with canonical shared cameras and direct
  structural, lighting, and temporal divergence gates.
- PR #222: both WebGPU tiers consume the existing GPU sun-visibility atlas; shaded foam
  coverage attenuates to a 0.55 floor with no CPU sampling or GPU readback.
- PR #226: acceptance now records and gates the active model revision, resolved tier,
  constants, zero CPU foam samples, and live sun-atlas state instead of inferring them
  from screenshots.

## Evidence

- Live gates: `npx tsx tools/verify-traced-carve.ts --url "http://127.0.0.1:PORT/?scene=infinite-islands&seed=1&world=8" --out qa-runs/...`
  (needs `CHROME_PATH` with FORWARD slashes). Latest pass: `qa-runs/traced-carve-verify-w3/`
  — 4/4 rings, continuity 100%, zero uncaptured errors, HQ water visible in shots.
- Perf: `perf-runs/water-carve-after/` (W1), `perf-runs/water-atlas-after/` (W2),
  `perf-runs/water-hq-ab/` (HQ +0.3 ms render p95). A `perf-runs/water-nofar-after/`
  run (W2.3, checks the waterMs max ≤ 2 ms gate) may exist if the background run at
  session end completed — check `summary.json` `moving.phases.waterMs.max`.
- Foam acceptance outputs are written below `shots/water/foam-acceptance/`; the matrix
  writes separate high/low reports plus `matrix-report.json`.

## Remaining (in priority order)

1. ~~Confirm the W2 budget gate~~ **DONE**: `perf-runs/water-nofar-after/` (HQ default
   tier) — moving waterMs p50 0.2 / p95 0.4 / **max 1.6 ms** (was 9.8): the max ≤ 2 ms
   gate is met by the L4/L5 removal. `perf-runs/water-nofar-low/` (low tier, same
   tree) confirms the gate holds on both tiers (waterMs max 1.3 low / 1.6 high, p95
   0.4). Its frame/render numbers came out *slower* than the high leg — nonphysical,
   so cross-run frame comparisons on this box are noise-dominated (±1–2 ms); trust
   only paired same-session legs, and take the HQ tier cost from the controlled A/B
   (+0.3 ms moving render p95). waterMs itself is stable and is the metric this gate
   reads.
2. ~~W4 acceptance integration~~ **DONE**: the infinite-islands acceptance battery has
   a perf-gated `water` case with deterministic close-river/aerial-river/lake/shore
   captures and assertions for continuity, uncaptured GPU errors, visible atlas rings,
   zero CPU field samples, and water p95/max budgets. Live pass:
   `acceptance-runs/infinite-islands/water-w4-live-final/` (`waterMs` p95 0.3 / max
   0.7 ms, continuity 100%, 4/4 levels, zero errors). Wet-margin mask contents remain
   unit-tested but are not yet exported as a live acceptance counter.
3. Run the merged foam quality matrix natively and attach the high/low report plus
   screenshots. The connector environment cannot provide Chrome/WebGPU evidence.
4. Add a deterministic shaded-versus-open-sun rapid proof at the same hydrology/camera
   conditions. The current contract proves atlas wiring and constants but not the final
   visual coverage/luminance ratio.
5. Add a headed WebGL lane. The fallback shader has source/unit parity after PR #217,
   but the current quality matrix intentionally forces WebGPU.
6. Replace the performance-only clipmap-level foam fade with one shared camera-distance
   policy across HQ, performance, and WebGL to prevent quality-switch and ring-boundary
   popping.
7. W1.3 leftover: `dressing_river_cobbles_accepted` still ~0 (density roll, W3 tuning).
8. Visual polish candidates: aerial dither speckle at shorelines (tune the near-water
   ramp), traced channels are single polylines (no confluence networks like fable5's
   flow accumulation — larger follow-up).

## Stable commands

```bash
npm --prefix tools/clod-poc run water:foam:accept:high
npm --prefix tools/clod-poc run water:foam:accept:low
npm --prefix tools/clod-poc run water:foam:accept:matrix
npm --prefix tools/clod-poc run water:verify:full
```

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
