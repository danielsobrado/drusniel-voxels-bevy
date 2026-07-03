# CLOD-POC Critical Path Fix Plan

Source of evidence: `validation-artifacts/clod-poc-p0-20260703T102957Z` (P0 run of 2026-07-03, scene `infinite-naadf-forest`, world 8, seed 1, WebGPU, renderScale preset 0.85, freeze=1).
All numbers below come from that run's `perf-p0-webgpu/summary.json`, `summary.md`, `TROUBLESHOOTING_HANDOFF.md`, `test.log`, and `perf-p0-webgpu.log`. No source code was changed while producing this plan.

## 1. Executive verdict

This run is a **P0 evidence gate failure compounded by a contaminated benchmark run, plus one missing-instrumentation problem**. Typecheck passed; one stale parity test failed (1/2099). Two of six P0 cases failed, but both failures trace to the repository being **committed to while the validation run was live against the Vite dev server**: git HEAD moved from `08925321` to `9b4df0ef` mid-run, Vite hot-reloaded the page, and the `combined-cache-and-early-reject-enabled` case booted a broken intermediate commit (`c7a138f2`, `ReferenceError: screenCoordinate is not defined` in `tree_node_material.ts`) that was already fixed 30 minutes later by `bd742b42`. On the performance side, the single dominant, well-measured fact is that the **`farSummaryMs` frame bracket consumes ~94% of the median frame (≈30 ms of a ≈32 ms frame) and ~99% of the 375–620 ms p95 spikes — in a frozen scene** — but that bracket wraps at least eight subsystems with no sub-attribution, so the first code change must be instrumentation, not optimization. Finally, the `far-summary-source-evidence` gate is **structurally impossible to pass in this scene** due to counter semantics, not a broken far-summary path.

## 2. Evidence summary

| area | evidence | verdict |
| --- | --- | --- |
| typecheck | exit 0 | pass |
| tests | exit 1 — 1/2099 failed: `scripts/wire-tree-parity.integration.test.mjs > applies TREE-9 six-species config wiring` (asserts a `spruce: species(0.09, 20, 64, 10.5, …)` literal that no longer exists in the live `tree_config` source) | fail — stale parity fixture, not a runtime bug |
| WebGPU P0 | ran WebGPU for all 6 cases, 4 passed, no WebGL fallback attempted (failures were not adapter/launch failures) | partial |
| frame time | frameMs p50 31.7–34.3 ms, p95 375–620 ms, p99 385–636 ms; engine-side `frame_ms_avg` 64–68 ms vs `frame_ms_p95` 34–38 ms confirms a rare-but-huge spike tail; farSummaryMs p50 29.5–32.2 ms / p95 371–616 ms tracks frameMs almost 1:1; renderMs p95 1.4–2.3 ms; vegetationTotalMs p95 3.5–5.4 ms; statsSync/selection ≈ 0.1 ms | **farSummary bracket is the whole frame** |
| terrain material cache | hits 304–310, misses 184–189, ready 35, stale 0, bakeMs 5.7–6.6 total, uploadMs 0; case pair: frame p95 619.8 (disabled) → 383.4 (enabled), p50 unchanged (31.7 → 33.2) | working; removes ~236 ms of worst-case spikes; not a median-frame lever |
| vegetation early reject | 16/601 clusters rejected (2.7%); candidates 213,449 → 211,264 (−1.0%); grass 147,456 → 147,456 (0%), trees 61,504 → 61,504 (0%), understory 4,489 → 2,304; vegetationTotalMs p95 3.5 → 3.6 (no win) | gate passed but system is ~inert: grass bails on `minClusterSize`, tree prefilter never runs |
| far-summary source | farSummary=0, terrainSampler=9, fallback=592 of 601 clusters; `summaryMissing`=0 | gate failed — counter semantics make far-summary invisible (see §4) |
| atlas packing | estimatedBytes 768,004; savings 4,147,196 B = 84.4% | pass |
| dirty atlas upload | early-reject cases: mode=dirty(1), reason=none(0), dirtyPixels 2,048/76,800 (2.7%), dirtyUploads=3 — but fullUploads=18 in a frozen-camera run; material-cache cases: mode=full(2), reason=threshold(5), dirtyPct=1.0 (expected for the 435 m teleport) | dirty path works; 18 full uploads per case unexplained |
| dynamic resolution | enabled=1, active=0, renderScale=0.85, adjustments=0, reason=1 in all passed cases | pass — no P0 contamination |
| shadow proxy | `shadow_proxy_build_ms` 1,997–3,161 ms cumulative per case; grid 512; 263,169 vertices; 449,464 tris; `updateFrame` is called inside the farSummaryMs bracket | measured heavyweight inside the dominant bracket |
| NAADF residency | `naadf_queued_jobs` 4,252 vs `naadf_committed_jobs` 8; resident chunks ~4,100 | queue appears permanently stalled or counter is misleading; also lives inside the farSummaryMs bracket |
| far-summary tile cache (`src/far-summary/`) | all `far_summary_tiles_*` counters = 0, `far_shell_rebuilds` = 0 | **inactive in this scene** — do not optimize it based on this run |
| run integrity | HEAD changed mid-run (`08925321` → `9b4df0ef`); combined case shows "Execution context was destroyed … navigation" + Vite `?t=` re-transform URLs; probe resets in *passed* cases are by-design (`hooks.reset()` after the dirty-atlas exercise, trigger frame 121 / reset frame 139) | 2 case failures are contamination, not product regressions |

Missing artifacts/counters (exact gaps):

- No sub-timing inside `farSummaryMs` — cannot attribute the 30 ms median to NAADF vs shadow proxy vs far shell vs sun-light vs stats-DOM work.
- No per-case record of git HEAD / page-reload count in case JSONs.
- `terrainMaterialBakeMs`/`terrainMaterialUploadMs` are null in the cache-disabled case (counters gated on the cache flag), so the pair's p95 delta cannot be decomposed.
- The two failed cases have all metrics null (no partial snapshot was persisted on timeout).

## 3. Critical path ranking

| rank | bottleneck | evidence | expected win | risk |
| ---: | --- | --- | --- | --- |
| 1 | `farSummaryMs` bracket dominates frame: 29.5–32.2 ms of a 31.7–34.3 ms median frame, and 371–616 ms of every p95 spike, with a frozen camera | frameMs vs farSummaryMs percentiles across all four passed cases | path from ~31 fps to 60+ fps target; cannot size until the bracket is split (rank-1 fix is instrumentation) | very low (timing brackets only) |
| 2 | benchmark integrity: live dev-server + mid-run commits killed 2 cases (`screenCoordinate` fatal; 240 s timeout with probe target 300 while HEAD-era code had no oracle clamp) | combined-case error stack with Vite `?t=` URLs; HEAD delta in handoff; commit timeline (`c7a138f2` broke, `bd742b42` fixed, `95b48b4d` added oracle clamp post-run) | next run produces 6/6 comparable cases; unblocks `cases-passed` gate | low |
| 3 | steady-state spike tail: ~5% of sampled frames ≥ 375 ms even with cache enabled; suspects inside the bracket: shadow proxy builds (2.0–3.2 s cumulative, 263k verts) and 18 full atlas uploads | `shadow_proxy_build_ms`, `fullUploads`, farSummaryMs p95 | eliminate most >100 ms frozen-scene frames | medium — attribution needed first (rank 1) |
| 4 | `far-summary-source-evidence` gate unpassable by construction: grass (576/601 clusters) skips classification via `minClusterSize`, far-summary *accepts* return `null` and fall through, trees never enter the prefilter | source counters 0/9/592; `vegetation_slot_prefilter.ts` bail path; provider accept-falls-through at `vegetation_terrain_reject_provider.ts:174` | gate becomes meaningful; no runtime perf change | low |
| 5 | early-reject delivers −1.0% candidates; grass and trees untouched | before/after candidate counters per kind | GPU candidate-budget headroom (147k grass candidates), not frame ms (vegetationTotalMs is already 3.5 ms) | medium |

## 4. Failed gates

### Gate: `cases-passed`

- **Failure detail:** failed cases `gpu-early-reject-enabled-with-debug-oracle` (Perf probe timed out after 240000 ms: 162/300 samples, 282 observed frames) and `combined-cache-and-early-reject-enabled` (Missing `window.__drusnielPerf` snapshot).
- **Likely root cause (combined case):** mid-run commit `c7a138f2` removed the `screenCoordinate` import from `src/trees/tree_node_material.ts` while line ~189 still used it; Vite dev server hot-reloaded the running page ("Execution context was destroyed … navigation"), the rebooted app threw `ReferenceError: screenCoordinate is not defined` in `buildMaterial` during vegetation startup, boot never reached ready (`lastProgress: "building world", 0 frames`). Already fixed by `bd742b42` (import present at HEAD, [tree_node_material.ts:26](../../src/trees/tree_node_material.ts)).
- **Likely root cause (oracle case):** at the tested revision the probe had no oracle sample-window clamp (page reported `targetSampleFrames: 300`; the 60/120 clamp landed post-run in `95b48b4d`, [perf_probe.ts:175-179](../../src/app/frame_loop/perf_probe.ts)). The case also ran at roughly half the frame pace of the identical `gpu-early-reject-enabled` case (log lines 171–182: ~7 observed frames/poll vs ~13) during the window when the repo was being committed to and re-transformed. Note: `debugValidateCpuOracle` is parsed in [terrain_rejection_config.ts:78](../../src/vegetation/terrain_rejection_config.ts) but **consumed nowhere in `src/`** — the oracle case currently exercises no oracle code path at all.
- **Files to inspect:** `tools/perf-p0.ts` (runner: reload detection, per-case HEAD capture, partial snapshot on timeout), `src/app/frame_loop/perf_probe.ts` (clamp already landed), `src/vegetation/terrain_rejection_config.ts` (dead flag).
- **Smallest fix to try first:** re-run the suite on a quiescent tree at HEAD (both direct causes already have fixes committed) — see §6. Then apply Fix 1.2 so this failure mode is detected instead of silently corrupting cases.
- **Expected change after fix:** 6/6 cases report metrics; `cases-passed` gate passes; oracle case completes within timeout at 60 warmup/120 samples.

### Gate: `far-summary-source-evidence`

- **Failure detail:** "early-reject enabled cases did not expose far-summary source usage" — `vegetationGpuSourceFarSummary` = 0 in every case, while fallback = 592 and sampler = 9.
- **Likely root cause:** three compounding, none of which is "far summary is broken":
  1. Grass contributes 576 of 601 clusters and **never enters classification**: [vegetation_slot_prefilter.ts:139-147](../../src/vegetation/vegetation_slot_prefilter.ts) bails to `fullVisibilityPrefilterResult` when `clusterSizeM < gpuEarlyReject.minClusterSize` (16 m default in [terrain_rejection_config.ts:40](../../src/vegetation/terrain_rejection_config.ts)), and that function labels every cluster `source: conservativeFallback, reason: "disabled"`.
  2. By design, a far-summary consult that *passes* coverage returns `null` and falls through to the terrain sampler ([vegetation_terrain_reject_provider.ts:174](../../src/vegetation/vegetation_terrain_reject_provider.ts)); only `noCoverage` rejects attribute to `naadfFarSummary`. A fully-covered forest scene therefore legitimately yields 0 far-summary-sourced decisions even when the summary field is published and sampled (`window.__drusnielTerrainSummary` **is** set — [world_build_startup.ts:348](../../src/app/bootstrap/world_build_startup.ts)).
  3. Trees never run the slot prefilter at all (tree source counters 0/0/0, candidates 61,504 unchanged), so trees can never contribute far-summary evidence.
- **Files to inspect:** `src/vegetation/vegetation_terrain_reject_provider.ts`, `src/vegetation/vegetation_slot_prefilter.ts`, `tools/perf-p0-gates.ts` ([gateFarSummarySourceEvidence, lines 131-148](../../tools/perf-p0-gates.ts)).
- **Smallest fix to try first:** count far-summary *consultations* (field present + finite samples) as their own counter and let the gate accept `consulted > 0` as evidence (Fix 1.3). Do not change rejection behavior.
- **Expected change after fix:** new counter `vegetationGpuFarSummaryConsulted` > 0 for the 25 understory clusters (and any future kinds); gate passes with the detail string reporting consulted vs decided-by counts; `vegetationGpuSourceFarSummary` may legitimately stay 0 in fully-covered scenes.

## 5. Fix plan

### Phase 1 — Evidence blockers

#### Fix 1.1 — Split the `farSummaryMs` bracket into sub-phase timings (highest priority)

- **Goal:** attribute the ~30 ms/frame median and the 375–620 ms spikes to a specific subsystem.
- **Files:** [clod_poc_bootstrap.ts:408-431](../../src/app/bootstrap/clod_poc_bootstrap.ts) (composite `onFarSummaryUpdate`), [frame_loop_startup.ts:348-356](../../src/app/bootstrap/ui/frame_loop_startup.ts) (outer wrapper adding sun-light + stats-display work), `src/app/frame_loop/perf_probe_types.ts`, `perf_probe_constants.ts`, `perf_probe.ts`, `perf_probe_helpers.ts`.
- **Implementation idea:** inside the two closures, wrap each callee in `performance.now()` deltas accumulated into new per-frame sample fields: `farSumNaadfMs` (`naadfIntegration.update`), `farSumShadowProxyMs` (`shadowProxyController.updateFrame`), `farSumShellMs` (`infiniteFarShell.update` + `moveTo` + `setRenderOriginOffset`), `farSumSunLightMs` (`sunLightRuntime.update` + `syncSunLightCounters`), `farSumStatsDomMs` (`naadfStatsController.updateDisplay`), `farSumTilesMs` (`farSummaryIntegration.update`), `farSumBiomeStreamMs`. Export p50/p95 for each through the existing percentile machinery so they land in `summary.json`.
- **Risk:** very low; timing-only. Keep the existing `farSummaryMs` total untouched so runs stay comparable.
- **Test:** `npm run typecheck`, `npm test` (extend `perf_probe.test.ts` with the new fields), then the smoke run in §6.
- **Expected output:** the new sub-buckets sum to ≈ farSummaryMs; one or two buckets will carry the 30 ms median — that names the Phase 2 target.
- **Rollback:** remove the sub-bracket fields; no behavior change possible.

#### Fix 1.2 — Make the P0 runner immune to (or loud about) mid-run tree changes

- **Goal:** never again lose cases to HMR reloads or mid-run commits.
- **Files:** `tools/perf-p0.ts`.
- **Implementation idea:** (a) record `git rev-parse HEAD` + dirty status at case start and end into each case JSON, and mark the case `contaminated` when they differ or when a `framenavigated` event fires mid-case; (b) preferred: serve P0 from a static build (`vite build` + `vite preview --strictPort`) instead of the dev server, so file edits can't reload the page; (c) on probe timeout, persist the partial `__drusnielPerf` snapshot instead of dropping all metrics.
- **Risk:** low; runner-only. `vite preview` changes the base URL handling — keep the dev-server path as a flag for interactive debugging.
- **Test:** run the smoke command in §6, touch a source file mid-case, and verify the case is flagged instead of silently restarting.
- **Expected output:** case JSONs carry `gitHead`, `navigations`, `contaminated` fields; timeouts still produce partial percentiles.
- **Rollback:** revert runner; artifact schema is additive.

#### Fix 1.3 — Make the far-summary-source gate satisfiable (consultation counter)

- **Goal:** `far-summary-source-evidence` measures whether the far summary *participated*, not only whether it issued the final reject.
- **Files:** `src/vegetation/vegetation_terrain_reject_provider.ts` (increment a consulted counter in `createTerrainSummaryRejectProvider.classifyCluster` when the field exists and samples are finite), `src/vegetation/vegetation_slot_prefilter.ts` (surface it in `sourceCounts`/result), `src/app/frame_loop/perf_probe_types.ts` + `perf_probe.ts` (expose `vegetationGpuFarSummaryConsulted`), [tools/perf-p0-gates.ts:131-148](../../tools/perf-p0-gates.ts) (pass on `farSummaryUses > 0 || consulted > 0`, report both).
- **Risk:** low; counters only, no decision change.
- **Test:** unit tests in `vegetation_terrain_reject_provider.test.ts` and `perf-p0-gates.test.ts`; then smoke run.
- **Expected output:** consulted ≈ number of classified clusters with the summary present (≥ 25 in this scene); gate passes with honest detail.
- **Rollback:** gate falls back to the old `farSummaryUses > 0` check.

#### Fix 1.4 — Repair the TREE-9 parity test

- **Goal:** green test suite (currently 2098/2099).
- **Files:** `scripts/wire-tree-parity.integration.test.mjs` (and the wiring script/fixture it applies).
- **Implementation idea:** the assertion expects a `spruce: species(0.09, 20, 64, 10.5, …)` literal in the live `tree_config` source; the source has since moved species defaults (config-driven via `config/trees.yaml`). Update the fixture/expected block to the current source shape — or, if TREE-9 wiring is fully landed, convert the test to assert the semantic outcome (six species present in `TREE_SPECIES`) instead of a source substring.
- **Risk:** low; test-only.
- **Test:** `npm test`.
- **Expected output:** 2099/2099.
- **Rollback:** n/a.

#### Fix 1.5 — Decide the debug-oracle case: wire it or drop it

- **Goal:** stop spending 240 s per run on a case whose distinguishing flag is dead code.
- **Files:** `src/vegetation/terrain_rejection_config.ts` (flag parsed, never consumed), `tools/perf-p0.ts` (case list), consumer to be created near the slot prefilter if wiring.
- **Implementation idea:** shortest path — remove the case from the required list (keep it optional) until `debugValidateCpuOracle` actually validates GPU decisions against the CPU oracle. If wiring it now: run the CPU oracle comparison on the prefilter decision set (CPU-side data already available in `vegetation_slot_prefilter.ts` — no GPU readback needed for a first version) and emit a mismatch counter. Keep the 60/120 probe clamp from `95b48b4d`.
- **Risk:** low. Dropping a required case loosens the gate — document it in `p0-performance-validation.md`.
- **Test:** full P0 run completes without timeout.
- **Expected output:** either a real `vegetationGpuOracleMismatch` counter, or a 5-case required set that finishes ~4 minutes faster.
- **Rollback:** restore the case to required.

### Phase 2 — Critical performance fixes (gated on Fix 1.1 attribution)

#### Fix 2.1 — Attack the top `farSummary` sub-bucket

- **Goal:** cut the ~30 ms/frame median cost; target frameMs p50 ≤ 20 ms in the same scene as a first milestone.
- **Files:** depends on attribution; pre-registered suspects with existing evidence:
  - `naadfIntegration.update` — `naadf_queued_jobs` stuck at 4,252 with only 8 committed suggests a per-frame scan over a never-draining queue (`src/naadf/...`, entry from [clod_poc_bootstrap.ts:422](../../src/app/bootstrap/clod_poc_bootstrap.ts)). Fix shape: drain-or-drop stale jobs; iterate a pending-set index instead of the full queue.
  - `shadowProxyController.updateFrame` — 2.0–3.2 s cumulative build (grid 512, 263k verts) inside the frame bracket. Fix shape: budget/chunk the rebuild, skip when camera frozen and terrain revision unchanged, or move mesh generation to a worker.
  - `naadfStatsController.updateDisplay` + `syncSunLightCounters` — DOM/stats work every frame ([frame_loop_startup.ts:351-354](../../src/app/bootstrap/ui/frame_loop_startup.ts)). Fix shape: throttle to the existing `statsHz` (4 Hz).
- **Risk:** medium — each suspect is a real subsystem; change one at a time.
- **Test:** the before/after commands in §6; compare `frameMs.p50`, `farSummaryMs.p50`, and the new sub-bucket in `summary.json`.
- **Expected output:** the targeted sub-bucket p50 drops by the amount the fix claims; frameMs p50 drops accordingly. Do not claim a win from FPS alone.
- **Rollback:** each fix behind its existing runtime flag or a one-commit revert.

#### Fix 2.2 — Kill the frozen-scene spike tail

- **Goal:** frameMs p95 ≤ 100 ms in the frozen sampled window (currently 375–620 ms).
- **Files:** attribution decides; candidates are the shadow proxy build path (above) and the far-summary atlas upload path (`src/naadf/gpu/farSummaryAtlas.ts` + `src/naadf/farSummaryAtlasUploadConfig.ts`) — investigate why a frozen-camera case logs **18 full uploads** (76,800 px each) against 3 dirty uploads with `fallbackReasonCode=0`; expected is a handful of initial uploads then dirty-only.
- **Implementation idea:** first reproduce with Fix 1.1 counters + a per-upload log; if full uploads recur in steady state, find what invalidates the whole atlas (revision bump? recenter at frame 121 counting twice? settle logic) and gate the full-invalidation path on actual full dirtiness. The `threshold` fallback (reason=5, dirtyPct=1.0) seen in the material-cache pair after the 435 m teleport is *correct* behavior — leave it.
- **Risk:** medium — upload correctness is visual; verify with the shot harness after changes.
- **Test:** §6 commands; compare `fullUploads`, `dirtyUploads`, `farSummaryMs.p95`, `frameMs.p95`.
- **Expected output:** fullUploads ≈ small constant (boot + exercise), p95 collapses toward p50.
- **Rollback:** revert; counters make regressions obvious.

#### Fix 2.3 — Default the terrain material cache on for P0 comparisons

- **Goal:** lock in the measured ~236 ms p95 improvement (619.8 → 383.4) as the baseline configuration.
- **Files:** `src/app/runtime_config.ts` / `src/app/config/clod_runtime.yaml` (wherever the default lives).
- **Implementation idea:** flip the default; keep the disabled case in P0 to preserve the evidence pair. Evidence: hits 304–310 vs misses 184–189, ready 35, stale 0, bake 5.7–6.6 ms total — cache is healthy.
- **Risk:** low.
- **Test:** §6 full run; `terrain-material-cache-evidence` gate must keep passing.
- **Expected output:** unchanged counters, better default UX.
- **Rollback:** flip the flag back.

### Phase 3 — Cleanup / deferred

- **3.1 Early-reject effectiveness (deferred until candidate budget matters):** grass clusters are excluded wholesale by `minClusterSize: 16`; trees never enter the prefilter. If GPU candidate counts (147k grass / 61.5k trees per rebuild) become the constraint, add per-kind cluster sizing or coarser grass clustering and wire the tree path. Not a frame-time fix — vegetationTotalMs p95 is already 3.5 ms.
- **3.2 Latent far-summary tile-cache churn:** [summary-cache.ts:194-234](../../src/far-summary/summary-cache.ts) marks ready tiles stale after 1 untouched frame and cools them after 2, while [integration.ts:85-92](../../src/far-summary/integration.ts) rebuilds with an **unbounded** default budget every frame. All `far_summary_tiles_*` counters were 0 in this run (system inactive in this scene), so this is *not* the measured bottleneck — but it will thrash the moment a scene activates it. Add a regression test before enabling it anywhere.
- **3.3 Dead debug flags:** `debugValidateCpuOracle` and `debugReadbackCounters` are parsed but unused — implement or remove (see Fix 1.5).
- **3.4 Persistent WebGPU warning:** "Draw with a vertex count of 0 is unusual" appears in every case; find the empty draw and skip it (cosmetic, but it pollutes warning counts used in reports).

## 6. Commands for the next engineer

Full validation after fixes:

```bash
cd tools/clod-poc
npm run typecheck
npm test
npm run perf:p0 -- --renderer webgpu --out ../../validation-artifacts/clod-poc-p0-after-fix --world 8 --seed 1 --warmup 120 --frames 300 --timeout 240000 --failOnGateFailure
```

Faster smoke run:

```bash
cd tools/clod-poc
npm run perf:p0 -- --renderer webgpu --out ../../validation-artifacts/clod-poc-p0-smoke --world 8 --seed 1 --warmup 30 --frames 60 --timeout 90000
```

Reminders (per repo instructions): do **not** run vitest/vite/perf tooling through `rtk` (only plain `tsc` typecheck is rtk-safe); run visual/perf benches from a native Windows shell, not WSL; and **do not edit or commit to the working tree while a P0 run is live** — that is what corrupted this run.

## 7. Do-not-do list

- Do not rewrite the renderer.
- Do not replace Three.js.
- Do not port this to Bevy yet.
- Do not add new debug readbacks to normal gameplay.
- Do not make dynamic resolution active during P0 evidence runs (it was correctly inactive here: active=0, reason=1 — keep it that way).
- Do not optimize stones unless stone timing is proven significant (no stone timing appeared in this run's hot path).
- Do not add broader telemetry unless a gate cannot be diagnosed without it — Fix 1.1's sub-brackets are the one telemetry addition this evidence justifies.
- Do not optimize the `src/far-summary/` tile cache off this run's numbers — its counters were all zero (inactive); see §5 item 3.2.
- Do not treat the material-cache pair's p95 numbers as precise: the two cases ran different exercise distances (bestMoveM 435.2 vs 307.2), so cross-pair comparisons carry noise until a re-run pins them.

## 8. Final recommended first patch

**The first code patch should be: split the `farSummaryMs` bracket into per-subsystem sub-timings** — edit [src/app/bootstrap/clod_poc_bootstrap.ts](../../src/app/bootstrap/clod_poc_bootstrap.ts) (composite `onFarSummaryUpdate`, lines 408–431) and [src/app/bootstrap/ui/frame_loop_startup.ts](../../src/app/bootstrap/ui/frame_loop_startup.ts) (outer wrapper, lines 348–356), plumb the new fields through `src/app/frame_loop/perf_probe_types.ts`, `perf_probe_constants.ts`, and `perf_probe.ts`, and re-run the §6 smoke command on a quiescent tree at HEAD. Expected validation improvement: the re-run alone should already flip `cases-passed` back to green (both direct case-failure causes are fixed in `bd742b42` and `95b48b4d`), and the new sub-buckets will name the owner of the ~30 ms/frame median cost — turning Phase 2 from guesswork into a one-line diff of a known number.
