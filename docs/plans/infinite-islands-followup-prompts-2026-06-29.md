# Infinite-Islands Acceptance — Follow-up Execution Prompts (2026-06-29)

Three self-contained prompts, each to be run in a **fresh conversation**, to
close out the acceptance failures found in
[`infinite-islands-acceptance-findings-2026-06-29.md`](infinite-islands-acceptance-findings-2026-06-29.md).

Run them **in order**: Prompt 1 (ring fix) and Prompt 2 (walk crash) are
independent and can be done in parallel; Prompt 3 (re-run/sign-off) depends on
both.

---

## Shared context (paste into every prompt)

```
SHARED CONTEXT — read before doing anything.

- Repo: drusniel-voxels-bevy. Work is in tools/clod-poc (WebGPU/three.js voxel
  terrain prototype). Platform: native Windows 11, RTX 4080. Shell: PowerShell
  primary, Bash tool available. Determine Windows vs WSL and use correct paths.
- rtk is a token-saving CLI proxy. It is SAFE for `tsc` typecheck only. It
  SILENTLY BREAKS Vite tooling: `vitest` collects 0 tests with
  "Cannot read properties of undefined (reading 'config')"; `vite build` fails
  with "[vite:html-inline-proxy] No matching HTML proxy module found". So:
    - typecheck:  rtk npm --prefix tools/clod-poc run typecheck     (rtk OK)
    - tests:      npm --prefix tools/clod-poc test                  (NO rtk)
    - build:      npm --prefix tools/clod-poc run build             (NO rtk)
- Do NOT run vite build and vitest concurrently, and do not run cargo at the same
  time — concurrent runs corrupt tools/clod-poc/node_modules/.vite and produce a
  global "Cannot read properties of undefined (reading 'config')" failure across
  hundreds of files. If you see that, stop everything, delete
  tools/clod-poc/node_modules/.vite, and re-run a single command in isolation.
- A running dev server locks node_modules/.vite and @rollup/*.node; stop it
  before any reinstall.
- Run vitest as the FULL suite (npm --prefix tools/clod-poc test). Subset runs of
  files that import three/webgpu fail to load due to a self-polyfill quirk; only
  pure helper tests are safe to run as a subset.
- Profiling stays in the loop (repo CLAUDE.md). Visual/perf conclusions require a
  native Windows run, never WSL.

OWNERSHIP MODEL — facts established by the 2026-06-29 acceptance run:
- The streaming-ownership path has three camera-centered rings: live voxel chunks
  (radius ~200 m) < CLOD pages (radius 2048 m) < far-shell annulus
  (inner 2048 m .. outer 8192 m).
- The ownership coverage ORACLE
  (tools/clod-poc/src/stream/ownership_coverage_oracle.ts) analytically samples a
  grid and emits the gate counters: live_clod_overlap_cells, clod_far_overlap_cells,
  live_clod_gap_holes, clod_far_gap_holes, ring_boundary_holes, horizon_hole_ratio,
  missing_* . These are NOT rendering metrics.
- The acceptance harness is `npm --prefix tools/clod-poc run accept:infinite-islands`
  (tools/clod-poc/tools/infinite-islands-acceptance.ts). It defaults
  CLOD_POC_BASE_URL to http://127.0.0.1:5180/. Start the server first with:
    npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
  Run folders: tools/clod-poc/acceptance-runs/infinite-islands/<timestamp>/
  Each scene writes <scene>-phase0-report.json with the gate metrics.
- Do NOT reference any external code name in code comments.
```

---

## Prompt 1 — Make the streaming rings mutually exclusive (fix the overlap/horizon gates)

```
[Paste SHARED CONTEXT above first.]

GOAL
Make the three streaming-ownership rings satisfy "exactly one OWNER per terrain
footprint" (ISLE-13) under a PRIORITY model (live > CLOD > far), and re-point the
acceptance gate at priority-owner counters. For the infinite-islands scene:
  live_clod_owner_overlap == 0   (priority: a cell owned by live is NOT clod-owned)
  clod_far_owner_overlap  == 0   (priority: a cell owned by clod is NOT far-owned)
  every covered cell has >= 1 owner (no un-owned cell)
WHILE KEEPING:
  live_clod_gap_holes == 0, clod_far_gap_holes == 0, ring_boundary_holes == 0,
  missing_live_chunks_in_required_radius == 0,
  missing_clod_pages_in_required_radius == 0,
  streamer_far_shell_ownership_ok == 1.

CRITICAL — READ THIS BEFORE WRITING CODE (geometric impossibility)
Do NOT try to drive the RAW coverage counters (live_clod_overlap_cells,
clod_far_overlap_cells, horizon_hole_ratio) to exactly 0 by moving radii. It is
geometrically IMPOSSIBLE. The far shell is a CIRCULAR RingGeometry annulus
(tools/clod-poc/src/systems/far_shell_controller.ts), while CLOD and live coverage
are SQUARE-TILE grids. At a circular boundary between two square-tile grids you
cannot have both zero overlap AND zero gap — square tiles always spill corners
past a circle:
  - far-inner at clodRadius        -> page corners spill inward  -> overlap (today)
  - far-inner at max corner reach  -> tile notches uncovered     -> gap
The same holds at the live<->CLOD boundary. Today's raw failures
(live_clod_overlap_cells 36, clod_far_overlap_cells 1012, horizon_hole_ratio
0.4975) are this spill band, where a page at level L loads when its CENTER
distance <= clodRadius + pageSize(L)*sqrt(2)/2
(tools/clod-poc/src/stream/page_filter.ts isVisualPageDistance) so its far CORNER
reaches clodRadius + pageSize(L)*sqrt(2) past the far-inner (= clodRadius today,
tools/clod-poc/src/streaming/streaming_ownership.ts:50). pageSize(L)=pageSizeM*2^L.

THE CORRECT MODEL — priority ownership
ISLE-13's "exactly one owner per footprint" is realized by priority, not by making
squares meet a circle:
  liveOwner = liveOwns(cell)
  clodOwner = clodOwns(cell) && !liveOwns(cell)
  farOwner  = inFarBand(cell) && !clodOwns(cell) && !liveOwns(cell)
Under priority, overlap is 0 BY CONSTRUCTION and a gap is a cell with NO owner in
any ring (still meaningful, still gated). The residual is z-fighting where far and
CLOD geometry are coplanar in the spill band — that is a RENDER-ORDER / DEPTH
problem, not an ownership-counter problem.

IMPLEMENTATION (propose, then implement; keep it surgical)
1. Oracle (tools/clod-poc/src/stream/ownership_coverage_oracle.ts): add priority-
   owner counters — assign each sampled cell exactly one owner by priority
   (live > clod > far) and count any priority-overlap (must be 0) and any covered-
   but-un-owned cell (the real gap). KEEP the existing raw *_overlap_cells and
   horizon_hole_ratio as INFORMATIONAL diagnostics (they will stay non-zero — that
   is the spill band; do NOT delete them, they show the band depth).
2. Far shell render path: draw the far shell UNDER the CLOD pages with a small
   depth/height offset so the geometric spill-band overlap cannot z-fight, and
   page-grid-align the far inner radius (streaming_ownership.ts farShellInnerM /
   farShellInnerRadiusForOwnership; consumed by terrain_ownership_runtime.ts and
   far_shell_controller.ts) so the spill band is at most one page deep. Keep
   streamer_far_shell_ownership_ok (far inner >= clod radius) true.
3. Acceptance gate (tools/clod-poc/src/phase0/phase0_metrics.ts and the harness
   thresholds): assert the PRIORITY-owner counters == 0 and *_gap_holes == 0,
   instead of raw *_overlap_cells == 0 (geometrically impossible). Update
   max_horizon_hole_ratio handling accordingly — horizon_hole_ratio as currently
   computed counts the spill band, so either compute it under priority or treat it
   as informational and gate on the priority counters. Document the change.
   Do NOT simply loosen a threshold without switching to the priority model.

FILES
- tools/clod-poc/src/streaming/streaming_ownership.ts  (ring radii; primary)
- tools/clod-poc/src/stream/page_plan.ts               (page selection)
- tools/clod-poc/src/stream/page_filter.ts             (isVisualPageDistance)
- tools/clod-poc/src/stream/terrain_ownership_runtime.ts (snapshot wiring)
- tools/clod-poc/src/stream/ownership_coverage_oracle.ts (the gate; tests)
- tools/clod-poc/src/systems/far_shell_controller.ts   (consumes far inner)
- existing unit tests next to each of the above (*.test.ts)

VERIFY (in this order)
- Add/extend a unit test on computeOwnershipCoverageCounters that drives a
  realistic snapshot (live 200, clod 2048, far 2048..8192, page grid) and asserts
  all overlaps AND gaps are 0. This is the deterministic gate; it must fail before
  your change and pass after.
- rtk npm --prefix tools/clod-poc run typecheck     (rtk OK)
- npm --prefix tools/clod-poc test                  (NO rtk; full suite green)
- npm --prefix tools/clod-poc run build             (NO rtk; green)
- Native Windows acceptance run (server first), then read the per-scene
  *-phase0-report.json and confirm the six counters above are 0/0/0 and gaps stay 0:
    npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
    npm --prefix tools/clod-poc run accept:infinite-islands

REPORT
The before/after oracle counters, the new far-inner formula, any gap/overlap
trade-off you had to make, and confirmation that *_gap_holes stayed 0.
```

---

## Prompt 2 — Root-cause the walk-scene crash (live frame loop `null.update`)

```
[Paste SHARED CONTEXT above first.]

GOAL
The infinite-islands `walk` scene (the only LIVE, non-frozen acceptance scene)
crashes during world build and produces no stats. Find the root cause and fix it
so the walk scene boots, reaches ready, and produces a phase0 report. The two
FROZEN biome scenes build and render fine, so the fault is specific to the live
frame-loop path.

SYMPTOMS (from acceptance-runs/infinite-islands/2026-06-29T15-19-48/)
- walk-phase0-report.json: { available:false,
    error:"walk: timed out waiting for ready; last progress: building world (0.5)" }
- Console:
    [clod-poc] FATAL: Uncaught error [Uncaught TypeError: Cannot read properties
      of null (reading 'update'), at
      .../src/app/bootstrap/ui/frame_loop_startup.ts:262]
    [combat] failed to load first-person weapon model TypeError: Failed to fetch

INVESTIGATION
- Open tools/clod-poc/src/app/bootstrap/ui/frame_loop_startup.ts around line 262
  (the config-object region wiring farSummary / construction / floatingOrigin
  callbacks). Identify which object's `.update()` is being called on null in the
  streaming/live path. Note the transpiled line may differ slightly; trace the
  actual runtime owner, not just the source line.
- Determine whether the null owner is something the streaming infinite-islands
  scene is expected to construct but doesn't (a controller that is only created
  for non-streaming scenes, or vice versa), versus a timing/asset race during
  world build.
- The co-occurring `[combat] failed to load weapon model: Failed to fetch` may be
  a red herring (network/asset hiccup) or may be on the same init path — confirm
  whether the weapon-model failure leaves a combat/controller object null that is
  later `.update()`d. Reproduce locally:
    npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
  then load the exact walk URL the harness uses (see
  tools/clod-poc/tools/infinite-islands-acceptance.ts for the walk scene URL;
  it includes scene=infinite-islands&proceduralDebug=biome and NO freeze=1).

FIX
Make the live frame-loop path robust for the infinite-islands scene: guard the
null `.update()` owner (only update when present) AND/OR construct the missing
controller for the streaming scene, whichever is correct per the design. Do not
silently swallow a genuinely-required-missing controller — if the streaming scene
SHOULD have it, build it; if it legitimately may be absent, guard it.

VERIFY
- rtk npm --prefix tools/clod-poc run typecheck   (rtk OK)
- npm --prefix tools/clod-poc test                (NO rtk; full suite green)
- Native Windows: start the dev server and run the acceptance harness; confirm the
  `walk` scene now reaches ready and writes a walk-phase0-report.json with
  available:true and real stats (perf was already healthy: p95 ~2-4 ms):
    npm --prefix tools/clod-poc run accept:infinite-islands

REPORT
The null owner identified, why it was null in the streaming scene, the fix, and
the walk scene's phase0 report (available:true) after the fix.
```

---

## Prompt 3 — Re-run acceptance and sign off all five scenes (native Windows / RTX 4080)

```
[Paste SHARED CONTEXT above first.]
DEPENDS ON: Prompt 1 (ring fix) and Prompt 2 (walk crash) both merged.

GOAL
Run the infinite-islands acceptance harness on native Windows / RTX 4080 and
confirm ALL FIVE scenes (walk, biome-near, biome-horizon, final-near,
final-horizon) pass: zero overlaps, zero gaps, horizon_hole_ratio within
threshold, perf within budget, and the walk scene produces real stats.

STEPS
1. Start the dev server directly (NOT through rtk):
     npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
2. Run the harness (defaults to http://127.0.0.1:5180/):
     npm --prefix tools/clod-poc run accept:infinite-islands
3. Read the newest run folder under
   tools/clod-poc/acceptance-runs/infinite-islands/<timestamp>/ and, for every
   scene's <scene>-phase0-report.json, assert (priority-owner model from Prompt 1):
     live_clod_owner_overlap == 0   (priority: live cell not also clod-owned)
     clod_far_owner_overlap  == 0   (priority: clod cell not also far-owned)
     live_clod_gap_holes == 0, clod_far_gap_holes == 0, ring_boundary_holes == 0
     every covered cell has >= 1 owner (no un-owned covered cell)
     missing_live_chunks_in_required_radius == 0
     missing_clod_pages_in_required_radius == 0
     streamer_far_shell_ownership_ok == 1
     frame_ms_p95 <= 8
     (walk scene only) phase0 report available:true with non-zero stats
   NOTE: raw live_clod_overlap_cells / clod_far_overlap_cells / horizon_hole_ratio
   are INFORMATIONAL (square-tile-vs-circle spill band) and stay non-zero — gate on
   the priority-owner counters, not the raw ones.
   Confirm the harness exit code is 0 (ACCEPT_EXIT==0) and there is NO
   "Unsupported texture type with RGBFormat. 1015" in the console output.
4. If any gate still fails, capture the failing counters and the scene, and hand
   back to Prompt 1 or Prompt 2 as appropriate — do not relax thresholds.

REPORT
A table of the five scenes x the gate counters, the harness exit code, p95 per
scene, and a clear pass/fail verdict. Update
docs/plans/infinite-islands-acceptance-findings-2026-06-29.md with the final
green run (folder timestamp + numbers).
```

---

## Status

- [ ] **Prompt 1** — mutually-exclusive rings (overlap/horizon gates → 0)
- [ ] **Prompt 2** — walk-scene `null.update` crash
- [ ] **Prompt 3** — native re-run + five-scene sign-off (depends on 1 & 2)
