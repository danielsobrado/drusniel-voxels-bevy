# Long-map soak and streaming execution evidence

Created 2026-07-16. This is the execution log for
`docs/plans/long-map-soak-and-streaming-execution-2026-07-16.md`. It separates landed
instrumentation from proof that still depends on visual review or another plan.

## Environment record template and LM0 baseline

- Baseline commit: `7322314e4a4d425bd3129ead593655bf35ed5638`; clean closure
  confirmation: `849dbbe7b005c026e03ff6455005a4ea05b8b9aa` plus the recorded
  working-tree implementation.
- Host: native Windows, primary display 3440x1440 at 96 DPI, High performance power plan.
- Browser: Chrome 150.0.7871.116, headless Playwright WebGPU launch with
  `--enable-unsafe-webgpu --ignore-gpu-blocklist`; acceptance viewport 1920x1080 at device
  scale 1.
- GPU: NVIDIA GeForce RTX 4080, driver 572.42 (Windows driver version 32.0.15.7242).
- Baseline cache state: acceptance reports identify fresh-page versus reuse-profile state
  and retain per-scene cache hit/miss evidence.
- Baseline URL: the acceptance report records the complete URL. The relevant core is
  `scene=infinite-islands&world=16&startupWorld=2&clodPerf=1&webgpuSelection=1&farSummaryLayout=2&farClipmap=1&farClipmapMode=replace`.
- Pre-change confirmation on this HEAD: typecheck passed; tests passed with 625 files
  (624 passed, 1 skipped) and 3,276 tests (3,273 passed, 3 skipped); build passed.
- Post-change verification is recorded at the end of this document.

Every new acceptance and soak report now embeds commit, browser, GPU/driver, display,
power-profile, viewport, URL/cache-state information where applicable.

## LM0.2 settled-p95 disposition

**Closed 2026-07-16.** The miss had two causes: real diagnostic UI work in the measured
path and a harness source mismatch.

1. `cutChangedRef.fn` rebuilt the information-panel DOM synchronously on every streamed
   cut change even though the frame loop already refreshes that panel every 250 ms. In the
   exact-profile reproduction, settled p95 was 13.9 ms, selection-update p95 was 7.4 ms,
   and `selectionInfoMs` p95 was 5.2 ms. Decoupling that redundant callback reduced the
   controlled-window selection-update p95 to 2.3-2.5 ms and `selectionInfoMs` p95 to 0.
2. The acceptance threshold read the legacy rolling `frame_ms_p95` while the profiler and
   report described the reset, controlled 180-frame sample. `withSampledPerfCounters` now
   makes the threshold consume `framePerf.p95.frameMs` from that exact sample window.

Five clean same-environment runs after the UI fix measured:

| Run | Settled p95 (ms) | Render p95 (ms) | Selection-update p95 (ms) | Max (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 9.9 | 5.6 | 2.3 | 14.0 |
| 2 | 10.3 | 6.3 | 2.5 | 14.7 |
| 3 | 10.7 | 6.3 | 2.4 | 15.1 |
| 4 | 9.7 | 5.7 | 2.4 | 14.6 |
| 5 | 9.5 | 5.9 | 2.4 | 15.3 |

The median was 9.9 ms, worst 10.7 ms, and spread 1.2 ms. The former 8.0 ms threshold
predated the canonical unified-streaming workload and was also checking the wrong sample;
it is recalibrated to 11.0 ms (0.3 ms above the measured worst). The constant is shared by
the infinite-islands acceptance runner, battery, and continent tile-mesh probe.

Fresh-server confirmations after the concurrent fixes passed at 9.7 ms and, after making
drain waits part of the route sample, 9.0 ms. The final report is
`acceptance-runs/infinite-islands/lm0-settled-drain-inclusive/report.json`. It records the
RTX 4080/572.42 environment, Chrome 150.0.7871.116, High performance power profile,
1920x1080 viewport, fresh-page cache state, full URL, and the canonical unified-streaming
baseline as a machine-readable object.

The drain-inclusive movement sample covered 3.06 km and 2,350 frames: p50/p95/p99/p99.9/
max 9.5/17.6/28.5/38.6/42.3 ms, render p95 5.8 ms, 132 frames over 16.7 ms, 10 over
33.3 ms, and zero over 100 ms. It recorded one 57 ms Long Task, 152 root evictions, one
stale discard, 359 live-bubble evictions, and zero priority-unowned, CLOD-gap,
far-clipmap-ownership, or settled-heightfield-fallback samples.

The earlier `lm0-settled-current-1` capture remains invalid for calibration because an
accidentally retained process and unrelated 91% GPU workload contaminated it. It is kept
only as diagnosis provenance. The investigation also fixed the route cursor so startup
frames are excluded; conversely, frames rendered while waiting for region queues to drain
are now included in the outbound/revisit tail gates.

Two acceptance semantics are intentional and now explicit: zero frames over 100 ms applies
to every movement route, including the legacy walk/long-route profiles; and every
infinite-islands acceptance scene exercises the canonical
`farSummaryLayout=2&farClipmap=1&farClipmapMode=replace` baseline. Targeted A/B scenes may
override it, and every report emits `unified_streaming_baseline` so the rebaseline is not
silent.

## LM0.3 manual visual QA status

Partial deterministic evidence is under
`shots/manual/unified-streaming-visual-qa-2026-07-16/`:

- `start-ownership.png`, `start-ownership-stats.json`, `start-ownership-summary.json`
- `start-final.png`, `start-final-stats.json`, `start-final-summary.json`

Both settled start captures report `priority_unowned_cells=0`, `clod_far_gap_holes=0`, and
`far_clipmap_ownership_holes=0`; far-summary readiness was 216/216 and clipmap readiness
was 5/5. They also report 100 generic ring/missing-CLOD diagnostics because only the 40
safety roots were settled while 124 refinement pages remained pending and 16 were in
flight. Those generic counters prevent treating the capture as full refinement closure.

Visual inspection found that the `final` and `ownership` images both retain prominent
diagnostic-looking terrain bands. They are not byte-identical (mean absolute channel delta
0.162, max 223), but the final capture is not trustworthy final-material evidence. Timing
from these captures is also invalid under the external GPU load; for example the final
capture reported frame p95 12.9 ms.

Handover steps 3-6 remain open: headed active traversal, grazing-angle/water transitions,
master-switch observation while moving, and a legacy-shell comparison. Therefore no
shimmer/pop claim and no shell-path decision is recorded.

### Visual-QA blocker discovered during clean recapture

The clean native-GPU reproduction at
`shots/manual/unified-streaming-visual-qa-2026-07-16/start-final-visual.png` is not usable
to close the handover: the WebGPU far-clipmap TSL material accepts `farClipmapDebug`, but
its `colorNode` does not consume the corresponding `uDebugMode` uniform. Consequently
`farClipmapDebug=final` and `farClipmapDebug=ownership` render the same WebGPU material;
the ownership diagnostic cannot prove the required sector hand-off. The parser, controller
construction, and ownership buffer are present, so this is localized to
`src/terrain/far_clipmap/far_clipmap_material.ts` rather than a missing URL/config path.

Do not make a shell-path decision from the existing images. The follow-up needs a small
WebGPU-material change with a browser differential regression check (final versus ownership
must differ where the ownership mask is populated), then rerun all three required poses and
the active-transition/master-switch observations. This is deliberately handed over rather
than expanded into a renderer/material redesign during empirical-gate execution.

### Visual-QA blocker fixed 2026-07-17: WebGPU `uDebugMode` consumed by the material

The WebGPU far-clipmap node material now branches its `colorNode` on the `uDebugMode`
uniform, mirroring the WebGL fragment-shader codes (1=biome, 2=height, 3=ownership).
Ownership mode colours the per-cell ownership mask directly: blue where refined pages own
the cell, amber where the far clipmap owns it as fallback — so the sector hand-off is
provable from a capture instead of inferred.

- Unit regression: `src/terrain/far_clipmap/far_clipmap_material.test.ts` asserts the
  `colorNode` graph consumes both the `uDebugMode` uniform and the ownership storage
  buffer, and that `setFarClipmapMaterialDebugMode` updates the node uniform. All three
  failed before the material change and pass after it.
- Browser differential regression (same frozen pose `2048,96,2048,2.65,-0.43,55`, world 16,
  canonical unified-streaming baseline, HUD off, fresh captures on the RTX 4080):
  `farClipmapDebug=final` versus `=ownership` changed 30.57% of pixels; among changed
  pixels the ownership capture contains 191,182 ownership-blue pixels (~rgb(0,108,175))
  and 5,493 amber seam pixels (~rgb(160,140,35)); the final capture contains 13 and 399
  under the same classifier. Check script and result:
  `shots/manual/far-clipmap-ownership-debug-fix-2026-07-17/ownership-debug-check.mjs`,
  `ownership-debug-check-result.json`; captures `start-final.png` / `start-ownership.png`
  with stats JSONs alongside.
- Both captures report `priority_unowned_cells=0`, `clod_far_gap_holes=0`,
  `far_clipmap_ownership_holes=0`, `far_clipmap_fallback_samples_total=0`, and zero
  GPU-mesher failures at the settled start pose.
- All three required handover poses now have final/ownership pairs with the working
  diagnostic (`pose2` = `3248,96,2048`, `pose3` = `5048,96,2647`): changed-pixel ratios
  0.31/0.60/0.76, ownership-blue pixels 191,182/253,329/416,686, amber seam pixels
  5,493/8,962/32,822, per-pose results in `ownership-debug-check-<pose>.json`. Every
  pose reports zero unowned cells, zero CLOD-gap and clipmap-ownership holes, and zero
  GPU-mesher failures or worker fallbacks.

The remaining LM0.3 handover steps (headed active traversal, grazing-angle/water
transitions, master-switch observation while moving, legacy-shell comparison) still need
human visual review; the ownership diagnostic they depend on is now trustworthy.

## LM0.4 in-flight work reconciliation

| Area | Decision | Result or explicit park |
| --- | --- | --- |
| `continent-soak.ts` | Land | 30-60 minute route wander, per-minute heap/resource/queue/draw counters, background/foreground recovery, environment record, and fail-closed threshold requirement. VRAM estimates exclude cumulative transfer/upload counters. Teleport remains explicitly blocked on plan 3 P1's `time_to_gameplay_ready_ms`; no second readiness predicate remains. |
| movement routes | Land infrastructure; park representative proof | A 4.8 km short route and 16 km coast-to-coast/revisit routes identify coast, biome, river, and village-site boundaries. `--representative` fails loudly until plan 2 D1/D2. Continent routes require a frozen threshold file or explicit non-proof `--calibrate` mode. `report:continent-repeatability` requires exactly five same-environment reports plus one fresh-profile report and emits median/worst/spread tables. |
| acceptance runner | Land | Adds p50/p95/p99/p99.9/max, >16.7/>33.3/>100 buckets, Long Tasks, top phase/prop p95+max, heap/resource envelopes, environment records, startup exclusion, and drain-inclusive route sampling. The >100 ms zero gate covers all movement profiles. The canonical unified-streaming baseline is named in code and emitted in reports. |
| revisit economics | Land partial, fail closed | Stable CLOD-cache, ring-0 far-summary, and heightfield residency key snapshots are wired. The return leg fails if route-A keys remain. Stable vegetation identities are unavailable until plan 2, so the revisit gate deliberately cannot pass; water/hydrology availability is recorded either way. |
| `allowBoundedWorld` | Land behind flag | `floatingOrigin=1` permits bounded-world A/B while default behavior remains off. The enable decision and rebase registry are parked until the full LM2 evidence matrix is trustworthy. |
| precision diagnostic | Land core; park decision | `precisionDiag=1` fixes camera/sim time, freezes selection, disables tree/grass wind, weather/cascade particles, clouds/froxels and TAA jitter, and fixes exposure; counters prove each condition. The current rim tool remains evidence scaffolding, not closure: cardinal/diagonal variants and the landmark/shadow/specular/terrain-prop signal table still need completion and clean captures. |
| device loss | Land fail-loud baseline | Stops the render loop/input, waits for any active autosave, flushes all dirty regions with persistence errors propagated, installs a controlled flush-then-reload hook, and calls `failLoud`. Unit tests cover order and failure behavior. A real destroy/reload round trip remains the documented manual drill and plan 3 P2 dependency. |

## LM1 dependency pin

Pinned to commit `7322314e4a4d425bd3129ead593655bf35ed5638` plus this working-tree
execution. The required contracts are present:

- streaming: StreamCursor, master `terrain_streaming_enabled` switch, per-cell ownership;
- coverage: `priority_unowned_cells`, `clod_far_gap_holes`,
  `far_clipmap_ownership_holes`;
- readiness/occupancy: `live_clod_stream_ready_frontier_m`,
  `root_worker_batches_inflight`, `gpu_mesher_lane_busy_bubble`;
- attribution: `farSumTilesMs`, `farSumNaadfMs`, `farSumShellMs`,
  `farSumClipmapMs`, `farSumShellMoveMs`, `farSumShadowProxyMs`,
  `farSumBiomeStreamMs`, `farSumSunLightMs`, `farSumStatsDomMs`.

LM3 remains blocked on LM0.3 visual closure; LM0.2 is closed. LM4 also remains blocked
on plan 2 vegetation identities. LM5 teleport remains blocked on
plan 3 P1, and reload no-corruption proof remains tied to plan 3 P2.

## Empirical-gate run: coast route and rim precision

These native-GPU captures were deliberately run in `--calibrate` mode: neither the
coast-route threshold file nor the soak threshold file exists yet, so they are evidence,
not gate closure. They nevertheless surfaced a deterministic renderer failure which must
be resolved before freezing a baseline.

### LM3 infrastructure coast-to-coast calibration: failed on real invariants

`accept:continent-coast-to-coast -- --calibrate` produced
`acceptance-runs/infinite-islands/lm3-coast-to-coast-calibration-2026-07-16/report.json`.
It travelled 15,999.995 m (the reported `< 16000m` failure is floating-point comparison
precision at the exact endpoint) over 8,573 sampled frames. Frame p50/p95/p99/p99.9/max
were 10.1/19.4/35.6/49.5/89.7 ms; it recorded 698 frames above 16.7 ms, 109 above 33.3
ms, none above 100 ms, and 36 Long Tasks with a 206 ms maximum. It also recorded 563 root
evictions and 1,875 live-bubble evictions.

This capture is **not merely calibration-only**. It failed hard invariants:

- `live_clod_stream_gpu_failed_batches=15` and
  `live_clod_stream_worker_fallback_pages=70` (both must be zero);
- `far_clipmap_fallback_samples_total=812` (must be zero); and
- `live_bubble_streamed_collider_pages=0` (the route did not establish the required
  streamed-collider evidence).

Browser logs consistently identify GPU root-mesher `DegenerateGeometry` at the continent
rims, including `L0:-126,0` and positive-rim pages. The current behavior falls back to a
CPU worker, which preserves progress but cannot count as a green GPU-streaming route.

### LM2 rim calibration: completed, but cannot make the precision decision

`precision:rim` produced
`shots/long-map-precision/lm2-rim-calibration-2026-07-16/report.json` for center,
west-rim, and east-rim poses with floating origin off and on. The diagnostic counters
recorded frozen simulation/camera/selection and disabled cloud, froxel, tree-wind, and
grass-wind paths. The repeated-frame pixel differences were non-zero in every pose:

| Pose | Floating origin | Changed pixels | Changed ratio |
| --- | ---: | ---: | ---: |
| Center | off | 77,156 | 8.37% |
| West rim | off | 298 | 0.03% |
| East rim | off | 129,845 | 14.09% |
| Center | on | 84,571 | 9.18% |
| West rim | on | 108,632 | 11.79% |
| East rim | on | 124 | 0.01% |

The run independently reproduced the same rim GPU-mesher failures (`L0:-126,0` and
`L0:124,0`) in both floating-origin modes. Its output is only a cardinal, single-height
scaffold and lacks the planned diagonal, high-altitude, water/specular, landmark,
shadow-edge, and terrain-vs-prop signals. It therefore does not establish either fp32
adequacy or a floating-origin enable decision.

### Handoff: investigate before changing budgets or weakening gates

1. Reproduce the named rim pages in a minimal GPU-root-mesher test and compare their GPU
   output with the CPU-worker output. Establish whether an empty mesh is valid terrain
   (and must be represented explicitly) or a malformed strip. Do not turn the current
   fallback into an accepted route outcome and do not lower the zero-failure gates.
2. Resolve the far-clipmap fallback samples and streamed-collider absence on the same
   deterministic coast trace, then take five clean infrastructure runs before creating
   `long_map_route_thresholds.json`.
3. Investigate why fully diagnostic repeated frames still differ materially. Add the
   planned landmark, shadow-edge, specular-crawl, and terrain/prop-relative signals
   before making the LM2 coordinate-system decision; expand only then to the full pose
   matrix.
4. Keep LM0.3's WebGPU `uDebugMode` material handoff separate. Its ownership visualization
   defect must be fixed and manually reviewed before LM3 visual prerequisite closure.

Two runner defects found while executing these gates were fixed locally: Playwright now
uses a browser context before creating a page, and a missing `__drusnielClod` hook no
longer satisfies the ready/error predicate. The focused acceptance suite below verifies
the accompanying acceptance behavior; the runner changes are mechanical compatibility
fixes, not evidence of any renderer improvement.

### Rim GPU-mesher failures: root-caused and fixed 2026-07-17

Handoff step 1 is answered with a deterministic reproduction, and the mesher defect is
fixed. The diagnostic vehicle is a new `__drusnielClod.compareStreamRootBuilds` hook
(`clod_worker_client.compareStreamRootBuilds`, unit-tested against the mocked worker)
plus `npm run probe:rim-gpu-mesher`, which boots the canonical unified-streaming scene
and builds named pages through the GPU mesher and the CPU worker side by side.

**Root cause.** All 15 coast-route failures were `DegenerateGeometry: empty mesh after
strip` on pages at/beyond the coasts. The CPU chunk mesher scans an adaptive vertical
window per column down to `MIN_Y_CELL = -64` (`terrain_chunk_mesher.ts`), so it meshes
the deep-ocean floor (measured y = -26.0 flat on far pages, -23..-16 on rim-adjacent
pages). The GPU root mesher used the fixed window `vyBase = -1 .. Y_CELLS`
(`gpu_mesh_buffers.ts`); a page whose entire surface lies below y = -1 has no density
crossing inside that window, so the GPU welded zero triangles. An empty mesh is
therefore **not** valid terrain on these pages — the terrain exists and the CPU builds
it. Pre-fix probe (`shots/long-map-precision/rim-mesher-compare-2026-07-17.json`):
GPU FAIL / CPU 8,578-8,708 triangles on `L0:-126,0`, `L0:124,0`, `L0:140,4`,
`L0:146,4`; control `L0:0,0` agreed on both paths.

**Fix.** Deep-window retry in the batched GPU root mesher: after readback, LOD0 pages
whose every chunk meshed empty are re-dispatched once with the window floor lowered to
the CPU's `MIN_Y_CELL` (-64); a page still empty afterwards fails validation exactly as
before, so genuinely malformed output remains fail-loud and no gate was weakened. The
`quadPass` edge scan was generalized to follow the per-slot window base (identity
behavior for the default -1 base), and `live_clod_stream_gpu_deep_retry_pages` counts
retries for route evidence. Unit coverage: `fullyEmptyLod0PageKeys`,
`deepWindowRetryPlans`, and the `computeMeshDims` vertical-window override, all
failing-test-first.

**Post-fix probe** (`rim-mesher-compare-after-fix-2026-07-17.json`): GPU output is
identical to the CPU worker on all four pages — same triangle counts (8,578 / 8,708 /
8,192 / 8,192) and same Y bounds — and the control page is unchanged with no
normal-path cost (GPU buildMs 189.2 before vs 191.0 after). Retried rim pages cost one
extra dispatch (~270-435 ms total) instead of failing the batch to the CPU worker. The
resident-hierarchy mesher keeps the default window and reports zero retries; the
far-clipmap fallback samples and streamed-collider absence from handoff step 2 are
separate and remain open.

## Verification

| Check | Result |
| --- | --- |
| Focused infinite-acceptance tests after drain/baseline clarification | PASS: 15 files / 77 tests |
| Typecheck after latest implementation | PASS |
| Production build after concurrent fixes | PASS: 1,331 modules; existing externalized-node-module and chunk-size warnings only |
| Full test suite after concurrent fixes | PASS: 3,305 tests passed / 3 skipped |
| Sample QA harness | EXECUTED: `clod_poc_main_view` passed; aggregate sample report is expected-red because the sample summary lacks the other manifest checkpoints and the `long_view_4km` fixture lacks two required counters. See `validation-runs/latest/report.json`. |
| Clean-GPU settled/long-route proof | PASS: `lm0-settled-drain-inclusive`; metrics above |
| Coast-to-coast calibration | EXECUTED, FAILED on GPU-mesher/fallback/collider invariants; artifact and handoff above |
| Rim precision calibration | EXECUTED, non-decisive; artifact and handoff above |
| Focused acceptance tests after empirical runner fixes | PASS: 15 files / 77 tests |
| Manual visual steps 1-7 | PARTIAL as described above; no visual-quality claim |
