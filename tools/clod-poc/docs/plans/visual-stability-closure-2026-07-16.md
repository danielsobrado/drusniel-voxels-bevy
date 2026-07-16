# Visual Stability Closure — moving-image QA and the owed visual evidence

Created 2026-07-16. Status: PLANNED (no code landed from this doc yet). Revised same day
after an external review. The goal is unchanged — stability is judged on moving imagery,
and the owed visual debt gets paid with gates — but the central metric is redesigned.
The first draft compared adjacent frames during camera motion and inferred instability
from raw pixel change; that cannot distinguish expected motion (parallax, silhouettes,
texture minification, disocclusion) from shimmer and pops, and would flag detailed
foliage and near cliffs as broken while missing real one-pixel seams. The core rule is
now: **control expected motion, capture diagnostic state, and measure only the
unexplained residual.** Accepted from the review: three separate capture modes (static
determinism / fixed-camera transition / moving camera); depth-reprojection residual and
paired deterministic sequences for motion; corrected metric definitions (no single
flicker score; pop events correlated with engine transitions, not "quiet neighbours");
multi-scale analysis plus engine-projected regions of interest instead of one 16×16
grid; optional diagnostic buffers (depth/ownership/coverage/LOD) so failures are
diagnosable; an in-application deterministic sequence clock (wall-clock Playwright loops
are not deterministic); S0 split into clock/schema/primitives/calibration; both
controlled-landing and natural-traversal streaming captures; water gated on masks and
frozen-wave structure, never animated final colour; the human-review policy inverted (a
confirmed defect may block through documented review before a metric exists); the
flaky-gate rule hardened (thresholds change only when the measurement model was wrong);
a storage/retention policy; and S4 reframed as temporal-prototype prioritization, not a
permanent closure. Verified before adopting: `tools/compare.ts` is side-by-side
composition + single-pixel sampling only, and `tools/shoot.ts` captures isolated states —
the metric layer is genuinely greenfield, as the review said.

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
- [ ] S0A clock + determinism test → green
- [ ] S0B schema landed
- [ ] S0C primitives + full fixture suite → green
- [ ] S0D calibration tables + human sign-off recorded here

### S1 — Static and transition metrics (modes A and B)

1. Mode-A gates on the shared diagnostic state: dither stability, resource-swap
   flashes, lighting-cache churn; also serves plan 1 LM2 rim-jitter captures.
2. Mode-B event harness: scripted single transitions (page landing via master-switch
   scripting, LOD swap, impostor swap, edit commit) with per-event transition_residual +
   engine-counter correlation.
- [ ] mode-A gates calibrated + green (poses recorded)
- [ ] mode-B event harness + per-event gates green

### S2 — Motion-compensated metrics (mode C)

1. Paired deterministic sequences first (C1): harness accepts two flag states or two
   builds, replays one path, produces paired_residual + mask comparisons.
2. Depth-reprojection residual (C2): depth capture, reprojection compute, disocclusion
   handling (newly revealed regions excluded from the residual, counted separately);
   validated against S0C fixtures and a known-good/known-bad traversal pair.
3. Multi-scale + projected-ROI masks wired into both.
- [ ] C1 paired harness green on a real A/B (dither variant or CPU/GPU flag)
- [ ] C2 reprojection residual calibrated (fixtures + traversal pair)
- [ ] ROI projection (seam band, shoreline, impostor annulus) landed

### S3 — Streaming and CLOD closure (pays the handover debt, automated)

1. **Controlled landings** (mode B): fixed camera, one page/clipmap transition each —
   hole flash, double render, normal/material discontinuity, ownership-gap gates,
   correlated with readiness/ownership/revision/fallback/queue counters.
2. **Natural traversal** (mode C2): walk-route segments with no freeze/release backlog
   (the freeze→position→resume scenario stays as a *diagnostic*, natural movement is
   the representative gate — releasing a frozen backlog is a worse burst than gameplay).
3. Cross-link results into plan 1 LM0.3 (manual pass) and the handover; dense-route
   rerun when plan 2 lands.
- [ ] controlled-landing gates green per transition class
- [ ] natural-traversal gates green (walk route)
- [ ] handover/plan-1 cross-links + dense rerun recorded

### S4 — Trees and vegetation closure

1. Run the existing parity pipeline for the owed still set (low sun, forest interior,
   species gallery, hero tree, dolly-out, LOD boundary) — real GPU, gate UI masked.
2. Motion locks: wind OFF for dither/LOD authority tests; fixed seed/sim time; dolly in
   AND out; slow orbit; **stop inside the transition band**; CPU and GPU paths run
   separately against the same user-facing instability bound (internal scores need not
   match); coverage/silhouette masks compared, not only colour; identity independence
   from compacted GPU order asserted (plan 4's identity rule, enforced here).
3. Wind-ON captures recorded as references; gated only for pops via mask metrics.
- [ ] owed parity evidence captured + verified + linked
- [ ] motion locks green on both paths (band-stop case included)
- [ ] wind-on references recorded

### S5 — Water and shoreline closure

1. Structural tests with **frozen wave time**: shoreline coverage mask, water ownership
   mask, water depth, near/far clipmap ID, surface-height continuity across the
   ownership boundary — geometry/ownership gates first, on masks, never animated colour.
2. Controlled-animation references second (bounded mask instability under animation).
3. The half-submerged camera becomes a **tracked issue with an owner and a decision
   slot** (underwater rendering scope), not a permanent "known ugly" note.
- [ ] frozen-wave structural gates green (masks + height continuity)
- [ ] animated reference bounds recorded
- [ ] half-submerged issue filed (owner + decision slot linked here)

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
- [ ] residual table compiled
- [ ] feasibility audit recorded
- [ ] prioritization decision recorded with the owner

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
