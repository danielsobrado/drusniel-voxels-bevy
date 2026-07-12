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

## Next steps

1. If flag decisions matter, run N≥3 replicates per config (≈45 min per pair) on an idle
   machine; otherwise leave defaults and revisit after the structural work.
2. Movement-onset stall: capture a `chrome://tracing`/GPU trace or run with Dawn's
   `enable_immediate_error_handling`/shader-cache toggles to confirm driver PSO compile;
   alternatively grade the QA gate to tolerate a bounded one-time onset stall.
3. Far clipmap remains the top steady far-band cost (`farSumClipmapMs` ~1.7 avg / 21 max
   moving) — GPU displacement (the original P2) or budgeted refills are the next
   structural candidates, now cleanly measurable via the split bucket.
4. `selectionSub.views` max 56–84ms persists at root switches — the structural fix is the
   transition-safe shared terrain material (P3), which removes per-node material creation
   entirely rather than scheduling it.
