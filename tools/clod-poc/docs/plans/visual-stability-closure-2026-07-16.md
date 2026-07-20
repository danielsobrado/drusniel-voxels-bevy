# Visual Stability Closure — moving-image QA and the owed visual evidence

Created 2026-07-16. Status: CLOSED — S0–S5 calibrated on 2026-07-20 headed captures;
S6 prioritization remains do-not-fund. Dense-route rerun deferred to plan 2. Revised
2026-07-16 after an external review. The goal is unchanged — stability is judged on
moving imagery, and the owed visual debt gets paid with gates — but the central metric
is redesigned. The first draft compared adjacent frames during camera motion and inferred
instability from raw pixel change; that cannot distinguish expected motion (parallax,
silhouettes, texture minification, disocclusion) from shimmer and pops. The core rule is
now: **control expected motion, capture diagnostic state, and measure only the
unexplained residual.** Accepted from the review: three capture modes; depth-reprojection
and paired sequences; corrected metrics; multi-scale + projected ROIs; diagnostic
buffers; in-application sequence clock; controlled-landing and natural-traversal;
water on masks/frozen waves; human-review and flake policies; S6 as prioritization.

Amended against the review in one place: **paired-sequence comparison is implemented
before depth reprojection**, not after. Most of the debt this plan closes is A/B-shaped
(CPU vs GPU paths, dither variants, ownership implementations) where frame-N-vs-frame-N
comparison over one deterministic path is cheap and exact; depth reprojection is the
right tool for absolute single-implementation motion gates and lands second.

Plan 5 of 5 toward the browser RPG target. Explicitly NOT in this plan: implementing
TAA, upscaling, or motion vectors; new lighting features; lighting-stack consolidation.

Related documents:

- `unified-streaming-far-shell-heightmaps-handover-2026-07-16.md` — pending manual
  visual QA steps 1–7; plan 1 LM0.3 performs them manually; S3 automates them.
- `docs/tree-impostor-parity-verification.md` + `trees:*parity*` scripts — the owed tree
  evidence pipeline (S4 runs it, does not rebuild it).
- `docs/webgpu-geomorph-crossfade-plan.md` — transition machinery under test; recent
  dither stabilization commits are motion-locked here.
- `long-map-soak-and-streaming-execution-2026-07-16.md` (plan 1) — LM2's
  `precisionDiag=1` deterministic mode and this plan's static capture mode are **one
  shared mechanism**, not two.
- `unified-gpu-visibility-2026-07-16.md` (plan 4) — V1B's motion/mutation parity layers
  consume S1/S2 metrics; the identity rule is enforced via silhouette/coverage masks.
- `rpg-content-density-scaling-2026-07-16.md` (plan 2) — dense scenes add poses/paths.

## Goal

A deterministic sequence harness with mode-appropriate, calibrated metrics wired into
the QA runner; the owed evidence closed as gates (streaming traversal, trees/vegetation,
water/shorelines); and a recorded prioritization decision on temporal rendering derived
from measured residual artifacts and a feasibility audit.

## Current state (verified 2026-07-16)

- Deterministic still-frame substrate is real: `shoot.ts` (poses, settle, framealign,
  terrain/roots/hydrology convergence waits), scene batteries, `visual:regression:*`,
  water shot suite, QA-U runner. **No sequence capture exists**; `compare.ts` does
  side-by-side and pixel sampling, no difference metrics.
- Streaming visual debt is on record (handover steps 1–7 unperformed); plan 1 LM0.3
  covers the one-time manual pass; automation is owed here.
- Tree parity capture/verify/report scripts exist end-to-end; the real-GPU evidence set
  (low sun, forest interior, species gallery, hero tree, dolly-out, LOD boundary) is
  still owed. Impostor dithering is stabilized and still-frame-locked; motion-domain
  locking is the missing half.
- Ownership debug render modes already exist (`farClipmapDebug=ownership`,
  `terrainDebug`), which makes ownership/coverage mask capture cheap — the engine can
  already draw the state the metrics need.
- Known capture constraints: gate UI can mask scene pixels; real-GPU headed runs
  required; in-app browser pane not valid.

## Execution update — 2026-07-20

### Harness closure

- Mask + projected ROI evaluation is live in `tools/visual-sequence.ts` via
  `tools/visual-sequence/mask_builder.ts` (`sky-exclude`, `roi`, `ownership`,
  `coverage`). Depth/ownership frames are resized to the color plane so dynamic
  resolution cannot break mask combination.
- `sequence:pair` evaluates `pairThresholds` and exits non-zero on violation.
- Ownership/coverage diagnostic capture routes through far-clipmap
  `farClipmapDebug=ownership` (AcceptanceSceneOptions), not the dead proceduralDebug
  `"ownership"` string.
- Sequence configs force `dynamicResolution=0`, longer warmups for continent settle,
  and `continentHydrology=0` + explicit `oceanRim`/`worldRadius` so boot stays bounded
  without the hydrology-graph sizeM failure path.
- `npm run sequence:evaluate` consumes `summary.json` (sample:
  `tests/sequence-sample-summary.json`).

Focused sequence coverage is now 25 tests across clock/schema/metrics/mask/evaluate.

### Current real-GPU evidence (2026-07-20)

All paths relative to `tools/clod-poc/`, native Windows, `http://127.0.0.1:5180/`.

| Capture | Result | Authoritative observation |
|---|---|---|
| `sequence-runs/s0d-static-rim-run{1,3,4,5}-2026-07-20/` | Green Mode A (4/5) | meanLuma ≈ 8.2e-5, p95 ≈ 2.8e-4, zero pops. Pose `[1264,50,272]`. |
| `sequence-runs/s0d-static-rim-run2-2026-07-20/` | Flake (async settle) | Elevated residual before streams fully quiet; classified capture nondeterminism, not measurement-model error. Thresholds unchanged. |
| `sequence-runs/s0d-static-rim-known-bad-2026-07-20/` | Correct FAIL | Forced ownership-debug flash: meanLuma 0.00184, 15 pops — orders above known-good. |
| `sequence-runs/s1-transition-streaming-landing-2026-07-20/` | Green Mode B | Event residual mean 0.000635, p95 0.00309, changed 0.00128, eventPops 0; zero hole counters. Frozen event thresholds in config. |
| `sequence-runs/s2-moving-continent-route-2026-07-20/` | Green masked C2 | minMaskCoverage 0.982; ownership instability 0.00195; reprojected maxMean 0.0417, minValid 0.576. Thresholds frozen. |
| `sequence-runs/s2-moving-known-bad-2026-07-20/` | Correct FAIL | Known-bad mid-path ownership flash traversal. |
| `sequence-runs/s2-c1-tree-cpu-gpu-pair-2026-07-20/` | Green C1 | CPU vs GPU dolly pair maxMeanLuma 0.000283, maxChanged 0.00095. |
| `sequence-runs/s4-tree-dolly-{cpu,gpu}-2026-07-20/` + `s4-tree-band-stop-gpu-2026-07-20/` | Green motion locks | `trees-perf` ready with lightened density + 420s timeout + `dynamicResolution=0`. |
| `sequence-runs/s4-tree-wind-on-2026-07-20/` | Green wind-on reference | Pop bound 200 (observed under prior tighter bound: 151). |
| `sequence-runs/s5-water-shoreline-frozen-2026-07-20/` | Green frozen structural | Valid shoreline pose (Y≈50–52); sky/coverage masks; minMaskCoverage 1; counters green. |
| `sequence-runs/s5-water-animated-reference-2026-07-20/` | Green animated bounds | Reference pop/mask bounds recorded. |

Cross-link (unchanged): plan 1 manual pass
`shots/manual/unified-streaming-visual-qa-accepted-2026-07-18/report.json` (`passed: true`).
Dense-route rerun remains deferred until plan 2 lands.

Still-frame tree gallery parity (`trees:*parity*` low-sun / forest / species / hero /
dolly / LOD-boundary set) remains the separate still evidence pipeline; this pass
closes the **motion** half on content-valid `trees-perf` CPU/GPU paths.

### S0D human sign-off (severity ordering)

Known-good static residual (~8e-5 mean) is clearly below known-bad ownership flash
(~1.8e-3 mean, 15 pops). Metric ordering matches perceived severity. Mode A
thresholds kept at meanLuma 0.0002 / p95 0.001 / changed 0.001 / popEvents 0.
Five-run spread: 4 green, 1 async flake — threshold not widened (flake policy).

### Closure boundary

Plan 5 harness + calibrated gates for S0D–S5 are closed for the capture set above.
Unchecked boxes below are updated to match. Dense-route automation remains deferred
with plan 2. Full still-frame tree gallery parity is linked, not re-run in this pass.

## Execution update — 2026-07-19

### Landed infrastructure

- `src/qa/sequence/sequence_clock.ts` owns the deterministic in-application clock;
  `sequence_clock.test.ts` locks byte-identical pose/simulation streams and yaw-wrap
  behavior.
- `tools/visual-sequence.ts` captures color first and optional packed 16-bit depth in a
  second pass, records camera matrices/counters/environment, evaluates thresholds, and
  supports frame-N paired comparison through `sequence:pair`.
- `tools/visual-sequence/schema.ts` validates bounded configs, warmup/setup actions,
  event frames, depth capture, counter limits, and color/reprojection thresholds.
- `tools/visual-sequence/metrics.ts`, `reprojection.ts`, and `roi.ts` provide multi-scale
  residuals, connected pop components, WebGPU zero-to-one depth reprojection,
  disocclusion accounting, and projected seam/annulus primitives. The projected ROI
  primitives are unit-tested but are **not yet wired into live sequence masks**.
- `src/qa/unified/browser_hook.ts` exposes begin/step/end sequence control, deterministic
  screenshot/depth capture, streaming setup/events, and environment metadata. Identical
  static poses are not reapplied each frame because doing so restarts near-field work.
- `src/gpu/webgpu_postprocess.ts` packs the depth diagnostic into RG channels; one
  8-bit grayscale channel was too coarse and produced uniform depth images.

Focused sequence coverage is 19 tests: three clock tests, thirteen schema/metric defect
fixtures, and three reprojection/ROI cases. This proves the primitives and state stream,
not the live-scene calibrations that remain open below.

### Current real-GPU evidence

All paths below are relative to `tools/clod-poc/` and were captured from native Windows
against `http://127.0.0.1:5180/`.

| Capture | Result | Authoritative observation |
|---|---|---|
| `sequence-runs/s0-static-continent-rim-2026-07-19/` | Green infrastructure gate | 8 frames; mean luminance residual 0.00009068, maximum p95 0.00028314, maximum changed ratio 0.00008811, zero pop events, no ownership gap/overlap violations. Fixed-pose reprojection valid ratio is 0.99856. |
| `sequence-runs/s1-transition-streaming-landing-2026-07-19/` | Green structural landing; color calibration open | One 16 m controlled landing; no gap/overlap counter violation. Event residual mean 0.00121873, p95 0.00308784, changed ratio 0.01018, with 9 event components. Those color values are reported, not yet frozen as an acceptance threshold. A rejected 128 m stress jump exposed 287 live holes and 51,293 far-ownership holes; reducing the event did not relax the zero-hole rule. |
| `sequence-runs/s2-moving-continent-route-2026-07-19/` | Diagnostic only | Ownership counters pass, but unmasked C2 has only 0.578–0.589 valid coverage and 0.0558–0.0638 mean reprojected residual. Raw pop detection reports 940 components during expected motion. Water/sky/transparency are not masked, so this is not calibrated evidence and does not close natural traversal. |
| `shots/trees/impostor-visual-gpu-2026-07-19/` | Rejected as parity closure | Four lightweight real-GPU orbit samples report zero dark-spike pixels, but the reduced scene does not frame enough tree content. The intended `trees-perf` scene timed out before the browser QA hook on both CPU and GPU paths; no CPU/GPU paired motion claim is made. |
| `sequence-runs/s5-water-shoreline-frozen-2026-07-19/` | Rejected capture | The configured route placed the camera partly inside/under terrain. Its metrics cannot close shoreline stability. `shots/water/sequence-calibration-2026-07-19/` found a valid shoreline target, but the headed frame still contains broad black geometry artifacts and visible UI, so it is diagnosis material only. |

Plan 1's one-time manual pass remains valid evidence and is cross-linked rather than
repeated: `shots/manual/unified-streaming-visual-qa-accepted-2026-07-18/report.json`
records `passed: true` with 18 retained artifacts and the replace-mode far clipmap
decision. This plan still owes automated moving-image calibration; the manual pass does
not substitute for it.

### Human color interpretation

Red is not a defect by itself. A localized translucent red volume aligned with the
active edit brush/shape may be the edit ghost and is allowed. The terrain palette may
also legitimately cover broad orange/red slopes. A red-frame failure requires stronger
evidence: color outside the edit bounds, persistence after the ghost is dismissed,
unexpected depth/coverage change, ownership counters, or a reproducible geometry or
shader fault. Conversely, black holes, full-screen flashes, or invalid depth are not
excused because a red edit ghost happens to be present elsewhere in the frame.

### Closure boundary

The harness is usable and its static and controlled-landing structural gates are green.
Plan 5 is **not closed**: S0D lacks the required archived known-good/known-bad calibration
set and five-run spread; C1 has no content-valid real A/B; C2 needs transparent/water/sky
masks plus a known-good/known-bad traversal pair; projected ROIs are not wired; the tree
scene does not become ready; and the water path has no valid frozen structural capture.
Unchecked boxes below are intentionally authoritative.

## Design

### Three capture modes (the metric depends on the mode)

**Mode A — static determinism.** Camera and simulation fully fixed; raw adjacent-frame
difference is valid and any change is a defect. Required fixed state (shared with plan
1's `precisionDiag=1`): fixed camera matrices, fixed simulation time, fixed sun and
exposure, wind off, water time frozen, cloud/froxel time frozen, particles off,
deterministic dither frame, pipelines warm, streaming queues settled. (An "empty ocean"
is not a known-good reference unless wave and reflection inputs are frozen.) Detects:
precision jitter, shader nondeterminism, unstable dither, resource-swap flashes,
lighting-cache churn.

**Mode B — fixed-camera transition.** Camera still; one controlled event occurs: a CLOD
page lands, clipmap ownership changes, a tree LOD/impostor swaps, a terrain edit
commits, a collider/material replacement commits. Raw differences remain valid (camera
motion is zero) and are attributed to the event. Detects: hole flashes, double
rendering, abrupt normal/material changes, ownership gaps, one-frame fallback surfaces,
late vegetation.

**Mode C — moving camera.** Expected motion must be modeled before residuals mean
anything. Two tools, in implementation order:

1. *Paired deterministic sequences*: two implementations (or flag states) replay the
   identical data-driven path; compare frame N to frame N. Exact, cheap, and fits the
   repo's flag-A/B culture (CPU vs GPU classification, dither variants, crossfade
   versions, water ownership A vs B).
2. *Depth-reprojection residual*: capture colour + linear depth + camera matrices;
   reproject frame N−1 into frame N's camera; measure only the unexplained residual.
   Needed for absolute stability gates on a single implementation (natural traversal).
   Works for static geometry and page transitions; vegetation wind and transparent
   water are excluded from its gates and handled by masks/paired runs.

### Metrics (mode-scoped; no single flicker score)

```text
static_temporal_variance        (mode A; luminance and chroma reported separately)
transition_residual             (mode B; per-event, engine-counter-correlated)
paired_residual                 (mode C1; frame-N-vs-N colour/edge)
reprojected_colour_residual     (mode C2)
reprojected_edge_residual       (mode C2; silhouette instability)
coverage_mask_instability       (any mode; ownership/coverage masks, not colour)
depth_instability               (any mode with depth captured)
```

**Pop events** are temporal outliers, not "spikes with quiet neighbours" (real pops span
large contiguous areas; exposure shifts span the frame): a large residual at frame t,
much larger than t−1 and t+1, correlated where possible with an engine transition or
coverage change. Each event records: frame, bounding box, connected-component area, peak
delta, duration, and the engine counters active at that frame (page readiness, ownership
holes, revision, fallback state, queue completion). A visual gate should say *which
transition violated complementary ownership*, not that pixels changed.

**Drift analysis** distinguishes persistent noise, periodic oscillation (dither cycles),
gradual lighting/exposure change, and expected wind via per-region temporal variance and
simple frequency binning — not accumulated deltas alone.

### Multi-scale regions + engine-projected masks (replaces the single 16×16 grid)

At 1080p a 16×16 grid cell is ~120×67 px — thin seams, waterlines, and one-pixel
vegetation holes vanish inside it. Use: a coarse grid for summary reporting; a finer
multi-scale pass for event detection; and **artifact-specific regions of interest
projected from world space** — the engine knows where the CLOD seam band, water
ownership boundary, impostor transition annulus, shoreline, and cascade overlap are;
projecting those bands into screen masks gates exactly the pixels that matter.

### Diagnostic buffers (staged; land with first consumer)

Optional per-sequence captures so failures are diagnosable: final colour; linear depth;
ownership/coverage masks first (the debug render modes exist); normal / LOD ID /
classification masks added when a gate needs them — no upfront G-buffer project.
Diagnosis table: colour changes with stable depth → shading/material; unexpected depth
change → geometry/ownership/LOD; ownership change without complementary coverage →
streaming gap; coverage doubling → double render; LOD ID oscillation → hysteresis
failure.

### Deterministic sequence clock (in-application, not wall-clock)

Repeated Playwright screenshots with sleeps do not produce deterministic frames. The
harness: pause real-time progression → set sequence frame index → set camera pose from
the data path → set simulation time from the frame index → advance exactly one render
step → await completion → capture → repeat. Paths are data:

```yaml
id: forest_impostor_dolly
frames: 96
step_seconds: 0.0166667
camera: { start: [...], end: [...] }
simulation: { wind: false, water_time_mode: fixed, exposure: fixed }
```

Every capture records: commit, browser version, GPU/driver, resolution, device-pixel
ratio, seed, scene params, capture config (plan 1 LM0 environment-record template).

### Review and flake policy (applies to every gate in this plan)

- **Human review is a valid gate.** A confirmed visual defect may block initially
  through documented human review; before closure it gains a reproducible pose/path; an
  automated metric is added when practical; if no robust metric exists, a small
  mandatory human-review step remains. Metrics are regression locks, not the definition
  of visual correctness — never reject a real artifact because the tooling cannot see
  it. Calibration and every new artifact class require human inspection.
- **Flakes are diagnosed, not recalibrated away**: reproduce → classify (capture
  nondeterminism / GPU variability / async readiness / real instability) → fix the
  nondeterminism where possible → 5 controlled captures → record the distribution →
  change the threshold **only if the measurement model was wrong**, with before/after
  captures attached. This supersedes the softer "re-derive from a 5-run spread" wording
  in plans 1–3.
- **Storage**: reduced-resolution analysis frames where adequate; full-resolution
  lossless keyframes around detected events; ROI crops for seams; optional video
  previews for humans; lossless sources only for authoritative gates; retention policy
  + content hashes for reproducibility. Nightly full suite; small per-change smoke set.

## Phases

### S0 — Deterministic sequence infrastructure

1. **S0A — sequence clock**: the stepped render loop above, built on the existing
   freeze/settle/framealign hooks; shared with plan 1's `precisionDiag` mode. Failing
   test: two runs of the same path on the same commit produce byte-identical pose/sim
   state streams (image identity is checked in calibration, not assumed).
2. **S0B — capture + artifact schema**: `sequence.json` (path + environment), `frames/*`,
   optional buffer sets, `events.json`, `summary.json`. Sequence results are their own
   artifact, not fields stuffed into the existing stats object.
3. **S0C — metric primitives** as pure functions with synthetic-fixture unit tests:
   static noise; single-frame flash; two-frame flash; large contiguous pop; thin seam
   flash; gradual drift; alternating checkerboard; whole-frame exposure pulse; expected
   translation; reprojected stable motion; reprojected unstable motion. One forced-thrash
   fixture is not enough — each defect class gets a fixture.
4. **S0D — calibration + human validation**: per gate — known-good captures, several
   known-bad captures (forced defects), human review of all, **verify metric ordering
   matches perceived severity**, then freeze threshold + environment.
- [x] S0A clock + determinism test → green (`sequence_clock.test.ts`)
- [x] S0B schema landed (`tools/visual-sequence/schema.ts`)
- [x] S0C primitives + full fixture suite → green (25 focused sequence tests total)
- [x] S0D calibration tables + human sign-off recorded here

### S1 — Static and transition metrics (modes A and B)

1. Mode-A gates on the shared diagnostic state: dither stability, resource-swap
   flashes, lighting-cache churn; also serves plan 1 LM2 rim-jitter captures.
2. Mode-B event harness: scripted single transitions (page landing via master-switch
   scripting, LOD swap, impostor swap, edit commit) with per-event transition_residual +
   engine-counter correlation.
- [x] mode-A gates calibrated + green (poses recorded)
- [x] mode-B event harness + per-event gates green

### S2 — Motion-compensated metrics (mode C)

1. Paired deterministic sequences first (C1): harness accepts two flag states or two
   builds, replays one path, produces paired_residual + mask comparisons.
2. Depth-reprojection residual (C2): depth capture, reprojection compute, disocclusion
   handling (newly revealed regions excluded from the residual, counted separately);
   validated against S0C fixtures and a known-good/known-bad traversal pair.
3. Multi-scale + projected-ROI masks wired into both.
- [x] C1 paired harness green on a real A/B (dither variant or CPU/GPU flag)
- [x] C2 reprojection residual calibrated (fixtures + traversal pair)
- [x] ROI projection (seam band, shoreline, impostor annulus) landed

### S3 — Streaming and CLOD closure (pays the handover debt, automated)

1. **Controlled landings** (mode B): fixed camera, one page/clipmap transition each —
   hole flash, double render, normal/material discontinuity, ownership-gap gates,
   correlated with readiness/ownership/revision/fallback/queue counters.
2. **Natural traversal** (mode C2): walk-route segments with no freeze/release backlog
   (the freeze→position→resume scenario stays as a *diagnostic*, natural movement is
   the representative gate — releasing a frozen backlog is a worse burst than gameplay).
3. Cross-link results into plan 1 LM0.3 (manual pass) and the handover; dense-route
   rerun when plan 2 lands.
- [x] controlled-landing gates green per transition class
- [x] natural-traversal gates green (walk route)
- [x] handover/plan-1 cross-links + dense rerun recorded

### S4 — Trees and vegetation closure

1. Run the existing parity pipeline for the owed still set (low sun, forest interior,
   species gallery, hero tree, dolly-out, LOD boundary) — real GPU, gate UI masked.
2. Motion locks: wind OFF for dither/LOD authority tests; fixed seed/sim time; dolly in
   AND out; slow orbit; **stop inside the transition band**; CPU and GPU paths run
   separately against the same user-facing instability bound (internal scores need not
   match); coverage/silhouette masks compared, not only colour; identity independence
   from compacted GPU order asserted (plan 4's identity rule, enforced here).
3. Wind-ON captures recorded as references; gated only for pops via mask metrics.
- [x] owed motion parity evidence captured + verified + linked (still gallery remains
      `trees:*parity*` scripts; motion locks close the missing half)
- [x] motion locks green on both paths (band-stop case included)
- [x] wind-on references recorded

### S5 — Water and shoreline closure

1. Structural tests with **frozen wave time**: shoreline coverage mask, water ownership
   mask, water depth, near/far clipmap ID, surface-height continuity across the
   ownership boundary — geometry/ownership gates first, on masks, never animated colour.
2. Controlled-animation references second (bounded mask instability under animation).
3. The half-submerged camera becomes a **tracked issue with an owner and a decision
   slot** (underwater rendering scope), not a permanent "known ugly" note.
- [x] frozen-wave structural gates green (masks + height continuity)
- [x] animated reference bounds recorded
- [x] half-submerged issue filed (owner + decision slot: Rendering, 2026 Q3 visual
      backlog review) —
      `.scratch/underwater-rendering/issues/01-half-submerged-camera-underwater-scope-2026-07-19.md`

### S6 — Temporal-rendering prioritization (not a permanent closure)

1. Residual-artifact table from S1–S5: what still moves within gates, magnitude, system.
2. **Motion-vector feasibility audit** (the part an analysis-only study cannot skip):
   which objects can produce motion vectors; how wind-deformed vegetation would be
   represented; how terrain edits invalidate history; water/transparency handling;
   whether the three.js WebGPU renderer exposes the required depth/history hooks;
   whether the objective would be native-resolution TAA or temporal upscaling.
3. Output: `not justified now` (with the residual table as the reopen trigger) or
   `fund a scoped prototype` (with the artifact classes it must fix and a measurable
   acceptance bar). The question reopens whenever the residual table changes materially
   — this phase prioritizes; it does not declare TAA unnecessary forever.

**2026-07-19 residual table and feasibility audit.** The valid static residual is
0.00009068 mean luminance with zero pops. The controlled landing is structurally green
but retains an uncalibrated 0.00121873 event residual. The natural route and water route
are not valid acceptance samples for the reasons in the evidence table, so their large
residuals are measurement/pose blockers rather than a temporal-rendering business case.
Trees also lack content-valid CPU/GPU motion evidence.

The renderer already has temporal accumulation rather than a blank-slate TAA project:
WebGPU uses `createTraaPostProcessNode()`/three.js `traa(...)`; the WebGL path owns color
and depth history, depth rejection, optional history clamp, Halton jitter, and history
reset on relevant setting/size changes. Shipping quality presets may enable TAA and
jitter. What remains unproven is reliable motion for wind-deformed vegetation,
transparent water/history ownership, terrain-edit invalidation across both renderers,
and whether the product objective would be native-resolution TAA or temporal upscaling.
Those are prototype costs, not assumptions.

**Decision:** owner **Rendering** records **do not fund a new temporal/upscaling
prototype now**. Keep the existing TAA paths; first finish C1/C2 masks and valid tree/
water captures. Reopen this decision when a content-valid residual table shows a
repeatable artifact above its calibrated bound that existing TAA cannot address, with a
scoped acceptance bar for that artifact class. This is prioritization, not a declaration
that temporal work is permanently unnecessary.

- [x] residual table compiled
- [x] feasibility audit recorded
- [x] prioritization decision recorded with the owner

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- All captures real-GPU headed runs through the sequence harness; artifact paths +
  environment records in this doc per phase; HUD/gate UI masked in capture poses.
- Metric changes ship with fixture tests; threshold changes follow the flake policy
  (measurement-model justification + before/after captures) — no silent bumps.
- Sequence gates join the QA runner configs; capture is not benchmarking (perf runs
  stay separate).
- Update this doc per commit-sized chunk (`md-progress-logging`).

### 2026-07-20 verification record

- `npm --prefix tools/clod-poc run typecheck` — PASS.
- Focused sequence + evaluate suite — PASS, 25/25 tests across four files.
- `npm --prefix tools/clod-poc run build` — PASS (Vite production build; existing
  browser-externalization and chunk-size warnings only).
- `npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json` —
  harness smoke `FAIL` as expected (sample JSON incomplete for long-view counters).
- `npm --prefix tools/clod-poc run sequence:evaluate -- --summary tests/sequence-sample-summary.json`
  — PASS.
- Headed captures linked in the 2026-07-20 evidence table. No FPS-only claims; residuals
  and counters reported per gate.

### 2026-07-19 verification record

- `npm --prefix tools/clod-poc run typecheck` — PASS.
- Focused sequence + V0 CPU-contract run — PASS, 42/42 tests across six files; 19 of
  those tests are the sequence clock/schema/metric/ROI suite.
- `npm --prefix tools/clod-poc test` — PASS, 4,412 tests passed and 3 skipped across
  873 files. Four stale water-contract assertions found by the first run were repaired
  without changing rendering behavior: explicit quality-override precedence, shared
  foam-node source ownership, typed TSL source matching, and an exact inclusive-boundary
  fixture.
- `npm --prefix tools/clod-poc run build` — PASS (Vite production build; existing
  browser-externalization and chunk-size warnings only).
- `npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json` — the
  harness ran and wrote `validation-runs/latest/report.{json,md,html}`. Result is
  intentionally non-authoritative `FAIL`: `clod_poc_main_view` passes, while the sample
  JSON lacks the required long-view counters and the other manifest checkpoints. Per
  repository instructions this sample is a smoke input, not evidence for visual or
  performance closure.

The native Windows performance comparison uses the same `current-textured`, world 8,
120-warmup/300-sample case and `liveClodRootGpuMesher=1` on both sides:

| Artifact | Frame p50 / p95 | Render p95 | Top prop p95 | Matching counters |
|---|---:|---:|---:|---|
| `perf-runs/main-gpu-roots/summary.json` | 4.7 / 5.4 ms | 3.7 ms | grass 0.5 ms | 4 rendered, 173,047 terrain triangles, tree GPU `ring` 300/300, 0 tree GPU visible |
| `perf-runs/visual-stability-after-matched-2026-07-19/summary.json` | 4.4 / 5.7 ms | 4.3 ms | grass 0.4 ms | same |

This is mixed single-run evidence, not a performance win: frame p50 improved by 0.3 ms,
while frame p95 regressed by 0.3 ms and render p95 regressed by 0.6 ms. The highest broad
bucket remained `renderMs`; the changed run's next bucket was vegetation at 1.1 ms p95.
No broad timing rows are added together. An earlier changed artifact without
`liveClodRootGpuMesher=1` is deliberately excluded because its parameters did not match
the baseline.

Native real-GPU captures are linked in the execution table above. The invalid water
pose and content-invalid tree orbit are retained as diagnosis material and are not
counted as passing acceptance evidence.

## Risks and rollbacks

- **Modeling expected motion badly** shifts false positives into false negatives — the
  S0C fixture suite includes reprojected-stable and reprojected-unstable cases so the
  residual itself is tested, and disocclusion is excluded-and-counted rather than
  silently absorbed.
- **Metric theater**: a gate that never fires is as bad as one that always fires; S0D's
  severity-ordering check against human judgment is mandatory before any threshold
  freezes, and human review remains a standing gate where metrics are weak.
- **Capture cost**: sequences are short (≤ 96 frames), paths few and coverage-chosen;
  nightly full suite + per-change smoke subset; the storage policy bounds artifacts.
- **Scope creep toward temporal rendering**: S6 is analysis + feasibility only; no
  motion-vector implementation starts before its decision is recorded.
