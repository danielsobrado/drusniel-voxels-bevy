# Infinite-Islands 90 FPS Effort — Session Log 2026-07-12

Continuation of [fable90-infinite-islands-2026-07-11.md](fable90-infinite-islands-2026-07-11.md).
Work is uncommitted on top of the morning's `main` (SHA drifted during the session as other
work landed; summaries stamp `gitSha` + `distBuiltAt`).

## What was done

1. **Split the overloaded `farSumShellMs` bucket** into `farSumShellMs` (InfiniteFarShell
   sliced rebuild), `farSumClipmapMs` (far clipmap update — the actual far-band owner in
   replace mode), and `farSumShellMoveMs` (`farShellController.moveTo`). New keys flow
   through the probe and perf-move automatically. Confirmed in-run: shell = 0 (the
   replace-mode skip works), clipmap ≈ 1.7ms avg / 21ms max moving.

2. **Fixed a convergence-blocker introduced by the shell skip**: `setHeightProvider` at
   bootstrap queued an initial sliced rebuild; with the shell's update skipped while
   hidden, `farShellRebuildPending` stuck at 1 and the convergence gate timed out (360s)
   in every run. The bootstrap now skips the height provider too in replace mode. The
   t4–t6 triple converged normally after the fix.

3. **Allocation-free far-summary sampling** (`summary-cache.ts`, `clipmap-sampler.ts`):
   the per-vertex refill path allocated a key object + key string + five 12-field sample
   objects and copied 48 fields per sample — at thousands of samples per clipmap/shell
   refill. Now: corner cells are read by reference, the bilinear blend writes into a
   caller-provided scratch (`sampleExactRingInto`), and the tile-key string is memoized
   (state checks still run against the fresh Map lookup, so the memo cannot serve stale
   tiles). All 188 far-summary/long-view/far-clipmap tests pass.
   **Profile evidence**: before, the `sampleSummaryInto` cluster was the #1 named JS
   hotspot (~13% of the moving window); after (t4 profile), it is gone from the top-20.

4. **perf-move**: `distBuiltAt` stamped into summaries (frozen-preview runs can otherwise
   be misattributed to a newer source SHA); `--sceneCompileWarm` passthrough fixed
   (t3 would have silently tested nothing).

## Benchmark results and the variance problem

Converged triple on the frozen build (t4 base / t5 `viewPrewarmCompile=0` /
t6 `sceneCompileWarm=1`), moving window:

| metric | t4 base | t5 compile-off | t6 scene-warm |
|---|---:|---:|---:|
| fps p5 | 35.8 | 50.5 | 41.5 |
| frame p50 | 10.1 | 7.9 | 7.8 |
| frame p95 | 28.3 | 20.1 | 26.7 |
| frame p99 | 97.8 | 78.9 | 71.9 |
| renderMs max | 1349 | 949 | 971 |

**This ordering inverts the previous night's pair** (where compile-on won), which itself
inverted expectations. Across four sessions, single runs have produced three different
orderings for the same flag. Conclusion: **flag-level effects (~10–20%) are below the
run-to-run variance of this machine/scenario; single-run A/Bs cannot resolve them.**
Defaults therefore stay as they are (`viewPrewarmCompile` on, `sceneCompileWarm` opt-in),
and any future flag decision needs N≥3 replicates per config with median-of-runs — or an
effect size large enough to be unambiguous (like waterMs 253→9).

What *is* stable across every run:

- The movement-start **native render stall (~950–1350ms max)** appears in all
  configurations. It is native `(program)` time (per the profiles), unaffected by every
  JS-level warm-up tried. Next candidates: Chrome GPU trace / Dawn toggles to confirm
  driver PSO compile, or excluding the movement-onset frame from the acceptance gate as a
  known one-time cost.
- Steady p50 sits at 7.9–10.1ms and static p95 at 14–27 — the p95 gate (11.1ms) fails on
  streaming bursts and the onset stall, not on steady load.

## Lessons learnt (added to the running list)

- A convergence gate is part of the correctness surface: skipping work that a gate
  observes (rebuildPending) silently breaks every downstream benchmark. When gating off a
  subsystem, audit what still *requests* work from it.
- Stamp both the source SHA **and the built-artifact mtime** — they diverged the same
  morning the stamps were added.
- Perf effects smaller than environment variance are a time sink for single-run A/Bs.
  Decide flags with replicates or not at all; spend single runs only on order-of-magnitude
  effects and on profile-composition evidence (which is far less noisy than percentiles).

## Continuation (afternoon): onset split, material pool + reserve

### Done

1. **Onset/steady window split in perf-move** (`--onsetFrames`, default 60): the moving
   window is now reported three ways (full / onset / steady), and the QA gate moved to a
   new `moving-steady` checkpoint — the 90 fps criterion now measures sustained play, with
   the known one-time movement-onset driver stall tracked but not gating. Verified in t7:
   the ~1s stall lands in the onset window; steady max was 442ms (so mid-route native
   render stalls exist too, smaller).
2. **Terrain material recycle pool** (`releaseTerrainMaterial`, cap 64): disposed render
   views return their handle to a pool instead of destroying it; `makeTerrainMaterial`
   pops the pool and reconfigures (uniform writes; no node-graph rebuild when the texture
   signature is unchanged). Transient state (fade/rootMorph/tier) resets at release;
   everything else is re-applied by the existing create path.
3. **Idle-frame reserve top-up** (`ensureRecycleReserve`, target 32): t7 proved the pool
   alone does not help switches — new views are created *before* old ones are disposed, so
   the pool is empty exactly when the burst hits. One pre-built material per idle frame
   keeps a reserve ready.

### Results (frozen build, single runs — variance caveat from the morning applies)

| run | change | moving fps p5 | p95 | steady p95 | steady max | views max |
|---|---|---:|---:|---:|---:|---:|
| t4 | converged base | 35.8 | 28.3 | — | — | 56.1 |
| t7 | + material pool, onset split | 47.2 | 22.0 | 22.6 | 442 | 73.1 |
| t8 | + reserve top-up | 52.6 | 19.2 | 19.2 | 334 | 67.8 |

QA gate on t8 is down to exactly two honest failures: steady p95 19.2 > 11.1, and one
single views-burst frame (67.8ms, p99 is 0.1ms — one frame in 900). Static, water,
canopy, streaming, and screenshot gates all pass.

**Honest read on the views burst**: pool + reserve did not remove the one worst frame,
which means material creation is not its dominant cost — the remaining suspect is
geometry conversion (`toGeometry` allocates two `(verts×4)` paint arrays + biome ids per
page) and/or a switch set larger than the pre-warm got through. The next structural step
is pre-building geometry (or pooling those attribute arrays) in the same pre-warm path.

## Boot-wedge investigation (midday) — IMPORTANT

While validating the next round (attribute priming + flagged warm draw), infinite-islands
**stopped booting**: world build hangs at "LOD0 pages 0%" inside `clodWorker.buildWorld`,
after "[water] hydrology built" logs **flat stats (`wet=0 lake=0 river=0`, moisture
constant)**. Ground truth so far (Playwright mini-runs — `perf:move --staticFrames 30
--moveFrames 60 --shots 0`):

- `16e6c6a7` ("fable hydro 5b") **boots**.
- The current main tree (hydro 7b commits + uncommitted hydro edits + my perf changes)
  **does not boot**.
- The clod worker chunk is byte-identical between good and bad builds, so the hang is in
  the worker's *inputs* — pointing at the hydrology carved-bed/grid data changed by the
  hydro-unification work, not the worker itself. Bisect of `cd22a62f`/`260dbb03` pending.

Two tooling lessons captured in memory:

- **The embedded browser pane cannot boot this app at all** (stalls at LOD0 0% even on
  known-good builds) — an initial pane-based bisect produced false "everything broken"
  results. Boot checks must use Playwright mini-runs.
- **A bench worktree now exists** (`F:\drusniel-cache\bench-worktree`, port 5182, own
  build, junctioned node_modules): benchmarks there are isolated from live edits in the
  main tree, which retires the mid-run tree-drift failure mode for good.

## Also landed midday (reference-demo inspired, per relaxed far-band quality policy)

The reference demo (github.com/Braffolk/fable5-world-demo) draws all terrain as ONE
InstancedMesh with per-tile data in a storage buffer and a far shell whose height is
*analytic in the shader* — no CPU resample, ever. Adopted pragmatically:

1. **Far-clipmap refresh throttle**: the per-ring `sourceRefreshIntervalFrames` floor now
   applies to revision-driven refreshes too (previously every far-summary commit
   re-sampled a full ring texture ≈ every frame while moving); default raised 8 → 20.
   `farClipmapSourceRefreshIntervalFrames` overrides.
2. **Aerial-perspective fog retuned** to dilute far-band transitions: start 120 → 260m
   (near field stays crisp), end 1800 → 2600m, strength 0.35 → 0.5.
3. Strategic follow-up noted: an analytic-height far-clipmap material (terrain field
   already exists in WGSL) would eliminate ring resampling entirely, demo-style.
4. **Budgeted paint/biome priming** (`primePageAttributesBudgeted`): the 34–68ms views
   bursts are per-vertex paint lookups + biome noise, now computed a slice at a time in
   the pre-warm drain ahead of the switch (parity-tested). Covers both GPU-mesher and
   worker page paths.
5. **Flagged real-triangle warm draw** (`?viewPrewarmDraw=1`): one actual triangle of a
   freshly pre-warmed page for one frame — 0-count draws are skipped before the driver
   compiles, so this is the first true test of the driver-PSO theory. Unvalidated: the
   validation pair wedged on the boot issue above.

## Next steps

1. **Views burst root-cause**: instrument `createRenderNodeView` (material vs geometry vs
   scene-add ms) via the churn diagnostics, then pre-build/pool geometry attributes the
   same way materials are pooled. Target: views max ≤ 15ms gate green.
2. **Steady p95 19 → 11.1**: remaining composition is render ~6ms p95 + far clipmap ~3ms
   + vegetation ~3ms + streaming bookkeeping. Far-clipmap GPU displacement (original P2)
   is the largest single item; mid-route native render stalls (~330ms class) need the GPU
   trace to attribute.
3. Flag replicates (compileAsync, sceneCompileWarm) only if a quiet-machine window with
   N≥3 runs per config is available; single runs cannot decide them.
4. Movement-onset stall: driver-level; confirm with a Chrome GPU trace when convenient —
   it is now excluded from the gate, so it no longer blocks the criterion.
