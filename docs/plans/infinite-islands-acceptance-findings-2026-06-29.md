# Infinite-Islands Acceptance — Findings (2026-06-29)

Native Windows / RTX 4080 run of the Playwright acceptance harness
(`npm --prefix tools/clod-poc run accept:infinite-islands`) against the local
Vite server at `http://127.0.0.1:5180/`. This records what the run actually
showed, the root cause of the gate failures, the chosen fix direction, and an
unrelated crash that blocked one scene.

Companion docs: the design plan
[`infinite-streaming-biome-islands-jiras.md`](infinite-streaming-biome-islands-jiras.md)
(ISLE-13 already carries the one-owner invariant) and the plan-mode draft.

Run folder: `tools/clod-poc/acceptance-runs/infinite-islands/2026-06-29T15-19-48/`.

## Scenes

| Scene | Mode | Result |
| --- | --- | --- |
| `walk` | live scripted walk | **Crashed during world build** (see "Walk-scene crash") — no stats |
| `biome-near` | frozen | Rendered clean; gates fail on overlaps/horizon |
| `biome-horizon` | frozen | Rendered clean; gates fail on overlaps/horizon |
| `final-near` | frozen | (post-crash; same overlap gate profile) |
| `final-horizon` | frozen | (post-crash; same overlap gate profile) |

Perf was never the problem: `frame_ms_p95` was **2.0–3.9 ms** against an 8 ms
budget. `streamer_far_shell_ownership_ok == 1`. No missing chunks/pages, no
gap holes (`live_clod_gap_holes`, `clod_far_gap_holes`, `ring_boundary_holes`
all 0).

## Canopy texture fix — applied, and it worked (but was not the cause)

Every scene previously logged:

```
THREE.WebGPURenderer: Unsupported texture type with RGBFormat. 1015
```

Root cause: [`canopy_texture.ts`](../../tools/clod-poc/src/canopy/canopy_texture.ts)
`makeRgbTexture` built the canopy species texture as a 3-channel
`THREE.RGBFormat` float texture. WebGPU has **no 3-channel float format**, so
`WebGPURenderer` rejects it. Fix: upload as `RGBAFormat` with alpha padded to 1
(the canopy material samples `.rgb`, so the padded channel is ignored). Canopy
unit tests stay green (20/20).

After the fix the `1015` error is **gone** (0 occurrences in the re-run). But
`horizon_hole_ratio` stayed **identical at 0.4975**. The hypothesis that the
texture error caused the horizon holes was **wrong** — see below.

## Root cause of the gate failures (one geometric issue, not three)

The three failing gates all come from the ownership coverage **oracle**
([`ownership_coverage_oracle.ts`](../../tools/clod-poc/src/stream/ownership_coverage_oracle.ts)),
which analytically samples ring ownership on a grid. None of them are rendering
metrics, which is why a texture fix could never move them.

Observed (both biome scenes, identical):

| Counter | Value | Gate |
| --- | --- | --- |
| `live_clod_overlap_cells` | 36 | must be 0 |
| `clod_far_overlap_cells` | 1012 | must be 0 |
| `horizon_hole_ratio` | 0.4975 | must be ≤ threshold |

### Why

The far-shell inner radius is set to **exactly** the nominal CLOD radius:
[`streaming_ownership.ts:50`](../../tools/clod-poc/src/streaming/streaming_ownership.ts#L50)
`farShellInnerM = clodRadiusM` (= 2048 m here). The `>=` invariant
(`streamer_far_shell_ownership_ok`) therefore passes at equality.

But CLOD pages are quantized to a **page grid**. A page at level `L` is loaded
when its **center** distance ≤ `clodRadius + pageSize·√2/2`
([`page_filter.ts`](../../tools/clod-poc/src/stream/page_filter.ts)), so the
page's far **corner** reaches:

```
clodRadius + pageSize(L)·√2     where pageSize(L) = pageSizeM · 2^L
```

That corner reach extends **past** the far-shell inner radius (= `clodRadius`).
The oracle's `clodOwns` is corner-inclusive (any loaded page covering the cell),
so the annulus just outside `clodRadius` is owned by **both** CLOD and far shell:

- `clod_far_overlap_cells: 1012` — that double-owned annulus (`clod && far`).
- `horizon_hole_ratio: 0.4975` — at the boundary band around `clodRadius`, the
  inner half is single-owned (pass) and the outer half is double-owned
  (`clod && far`, which the oracle counts as a "hole"). ≈ 0.5 **by
  construction**. Same root cause as the overlap.
- `live_clod_overlap_cells: 36` — the analogous inner leak: pages whose center is
  just outside `liveRadius` have corners reaching back inside it, so CLOD and
  live both own those cells.

So it is **one** model issue — page-center quantization makes square CLOD
coverage spill past the circular ring radii — surfaced three ways, not three
independent bugs.

## Chosen fix direction: mutually exclusive rings

Decision (locked): make the rings actually mutually exclusive, matching the
approved plan ("far shell never overlaps playable terrain") and ISLE-13's
one-owner invariant. Rejected alternative: treat the spill as an intentional
seam-blend band and relax the oracle gates.

### The quantization tension (a geometric impossibility, not a tuning problem)

**Key discovery while designing the fix:** the far shell is a *circular*
`RingGeometry` annulus
([`far_shell_controller.ts:146`](../../tools/clod-poc/src/systems/far_shell_controller.ts#L146)),
while CLOD and live coverage are *square-tile* grids. At a circular boundary
between two square-tile grids you **cannot** have both zero overlap **and** zero
gap — square tiles always spill their corners past a circle:

- Far-inner at `clodRadius` → page corners spill inward → **overlap** (today).
- Far-inner at the max page corner (`clodRadius + pageSize(maxLevel)·√2`) → at
  radials between page centers the tile notches aren't covered and far hasn't
  started → **gap** (`clod_far_gap_holes`).

The identical impossibility holds at the live↔CLOD boundary (live chunk corners
spill out, clod page corners spill in). So `overlap == 0 AND gap == 0` with a
circular far annulus is **not achievable by radius tuning** — one direction
always breaks.

### The correct model: priority ownership (live > CLOD > far)

ISLE-13's actual requirement is "**exactly one owner per footprint**," which is
faithfully realized by *priority*, not by making squares meet a circle:

- `liveOwner  = liveOwns(cell)`
- `clodOwner  = clodOwns(cell) && !liveOwns(cell)`
- `farOwner   = inFarBand(cell) && !clodOwns(cell) && !liveOwns(cell)`

Under priority, every covered cell has exactly one owner (overlap = 0 **by
construction**), and a gap is a cell with **no** owner in any ring — still
meaningful and still gated. The residual concern is z-fighting where far and CLOD
geometry are coplanar in the spill band; that is a **render-order / depth-offset**
problem (draw far under CLOD, small polygon/height offset), *not* an
ownership-counter problem.

Planned approach (to implement next):

1. **Oracle** ([`ownership_coverage_oracle.ts`](../../tools/clod-poc/src/stream/ownership_coverage_oracle.ts)):
   add priority-owner counters (`*_owner_*`) and make the *gate* assert the
   priority model (unique owner, no un-owned covered cell). Keep raw-coverage
   overlap as an informational diagnostic (it will stay non-zero — that is the
   spill band, handled by render order, not a failure).
2. **Far shell**: draw under CLOD with a depth/height offset in the spill band so
   the geometric overlap cannot z-fight; page-grid-align the far inner radius so
   the spill band is at most one page deep.
3. **Acceptance gate** ([`phase0_metrics.ts`](../../tools/clod-poc/src/phase0/phase0_metrics.ts)
   / harness): assert the priority-owner counters == 0 and `*_gap_holes == 0`,
   instead of raw `*_overlap_cells == 0` (which is geometrically impossible).

This touches performance-sensitive streaming-ownership core
([`streaming_ownership.ts`](../../tools/clod-poc/src/streaming/streaming_ownership.ts),
[`page_plan.ts`](../../tools/clod-poc/src/stream/page_plan.ts),
[`page_filter.ts`](../../tools/clod-poc/src/stream/page_filter.ts)) plus the far
shell render path, so it lands isolated with the oracle test as the gate.

> **Note for whoever executes Prompt 1:** do **not** try to drive raw
> `*_overlap_cells` to exactly 0 by moving radii — it is impossible (above).
> Implement priority ownership and re-point the gate at the priority counters.

## Walk-scene crash (separate from the gates)

The `walk` scene (the only **live**, non-frozen scene, exercising streaming over
a route) crashed during world build and produced no stats:

```
[clod-poc] FATAL: Uncaught error [Uncaught TypeError: Cannot read properties of
null (reading 'update'), at .../src/app/bootstrap/ui/frame_loop_startup.ts:262]
[combat] failed to load first-person weapon model TypeError: Failed to fetch
walk-phase0-report: "timed out waiting for ready; last progress: building world (0.5)"
```

- `null.update` originates around the frame-loop startup config block in
  [`frame_loop_startup.ts:262`](../../tools/clod-poc/src/app/bootstrap/ui/frame_loop_startup.ts#L262)
  (the `farSummary` / `construction` callback wiring region).
- Co-occurs with `[combat] failed to load weapon model: Failed to fetch`,
  pointing at a live-frame-loop / asset-fetch hiccup during build rather than the
  ownership model.
- The two **frozen** biome scenes built and rendered fine, so the crash is
  specific to the live frame-loop path.

Status: **fixed.** Reconciling the record, there were actually **two distinct
failure modes** on the live walk path at different points in the session (the
source shifted repeatedly under parallel work), and both are now fixed:

1. **Frame-loop controller-closure `null.update` race.** The original artifact
   recorded the page error for `walk` and `final-horizon` at the transpiled
   `frame_loop_startup.ts:262` location — the frame-loop config boundary where
   optional controllers (`farSummary`/`onFarSummaryUpdate`,
   `session.naadfStatsController`, `combat`, `spells`, overlay stats) are wired.
   A callback captured a controller that could be replaced/torn down after
   startup, so it re-read a now-null owner and called `.update()` on it. Fixed by
   stabilizing those closures in
   [`frame_loop_startup.ts:136`](../../tools/clod-poc/src/app/bootstrap/ui/frame_loop_startup.ts#L136).
   The co-occurring weapon-model `Failed to fetch` warning was a red herring: the
   combat controller is constructed before async GLTF load, and a failed model
   fetch leaves a valid hidden weapon controller.

2. **FXAA post-process defaults crash in the environment GUI.** A later,
   source-mapped live repro (Playwright + full console) caught a *different*
   deterministic crash on the same walk path:

   ```
   gui.add failed — property: postProcessFxaaEdgeThreshold, value: undefined
   TypeError: Cannot read properties of undefined (reading 'name')
       at createEnvironmentGui (src/ui/gui/environment_gui.ts)
       ... at bootstrapClodPoc (src/app/bootstrap/clod_poc_bootstrap.ts:316)
   ```

   The FXAA defaults had been dropped from
   [`postprocess.ts`](../../tools/clod-poc/src/environment/postprocess.ts) (the
   `PostProcessSettings` interface, the `Required<>` fallback, and the parser)
   while the rest of the pipeline still expected them — the `fxaa:` block in
   `config/postprocess.yaml`, the `postProcessFxaa*` fields in
   `app/state/environment_state.ts`, the FXAA controls in
   `ui/gui/environment_gui.ts`, and the `fxaa`/`aa` query override. So
   `DEFAULT_POST_PROCESS_SETTINGS.fxaaEdgeThreshold` resolved to `undefined`,
   flowed into `state.postProcessFxaaEdgeThreshold`, and lil-gui's
   `gui.add(...).name(...)` threw because `add()` returns `undefined` for an
   `undefined` value — throwing inside `bootstrapClodPoc` so
   `__drusnielClod.ready` never flipped true. Fixed by restoring the three FXAA
   fields in the interface, the fallback
   (`fxaaEnabled: true, fxaaEdgeThreshold: 0.125, fxaaSubpixelBlend: 0.75`), and
   the yaml parser.

Final regression evidence:

- Run folder:
  `tools/clod-poc/acceptance-runs/infinite-islands/2026-06-30T18-10-39/`
  (earlier green run: `2026-06-30T14-31-28/`).
- `walk-phase0-report.json` has `available:true`, scene `infinite-islands`.
- `walk` counters: `priority_owner_overlap_cells=0`, `priority_unowned_cells=0`,
  `ring_boundary_holes=0`, `frame_ms_p95≈2.6`.
- All five scenes (`walk`, `biome-near`, `biome-horizon`, `final-near`,
  `final-horizon`) passed with no page errors. Full verification: typecheck +
  1764 tests + build + qa green.

## Summary of next actions

1. Keep the priority-owner gate as the acceptance model; do not reintroduce raw
   overlap/horizon-zero gates.
2. Treat the old `null.update` crash as covered by the five-scene acceptance
   regression unless it reappears with a new artifact.
3. Continue from the green 2026-06-30 acceptance run into the remaining island
   visual/content work.
