# Fable5 Parity 6 — Unified Deterministic Visual and Performance Regression System

Status: implementation plan.

Scope: `tools/clod-poc`, Rust/Bevy QA, committed baselines, native Windows GPU execution, and CI/static validation.

This plan is prescriptive. The implementer must not choose a different manifest format, capture contract, baseline policy, metric set, execution lanes, failure policy, timing policy, or update workflow.

This plan is the acceptance harness for the whole parity effort; build order and the reconciled frame budget it enforces live in `fable5-parity-index-and-budget-2026-07-15.md`. Stand up the harness early (QA-U1..U7) and add each feature's scene baseline as that plan lands.

## 1. Goal

Unify Drusniel's existing specialized screenshot, water, tree, CLOD, continent, performance, and acceptance tools into one deterministic regression system that can answer:

- Did the rendered image change?
- Where did it change?
- Is the change expected?
- Did dark regions become black or washed out?
- Did water, terrain, vegetation, caves, shadows, fog, or LOD ownership break?
- Did any GPU pass or frame percentile regress?
- Did the scene become nondeterministic?
- Can the exact failing frame be reproduced from one command?

The system must preserve existing specialized validators. It orchestrates them and records their outputs; it does not replace domain-specific hydrology, ownership, tree, CLOD, save, or voxel correctness checks.

## 2. Fixed execution lanes

Use exactly three lanes.

### 2.1 Lane A — Static PR gate

Runs on every pull request and local pre-commit verification.

It performs:

```text
TypeScript typecheck
Vitest
Vite production build
Rust formatting/check/tests for QA modules
manifest schema validation
baseline file existence and hash validation
capture-command generation
specialized validator unit tests
shader/layout source checks
```

Lane A does not claim visual or GPU performance acceptance.

### 2.2 Lane B — Native Windows real-GPU gate

Runs on the designated native Windows machine with Chrome WebGPU and the target discrete GPU.

The canonical profile is native Windows, Chrome WebGPU, 2560 x 1440 CSS pixels,
DPR 1, and `quality=balanced` on one designated discrete GPU. Its machine manifest
records OS build, adapter vendor/device/backend, driver, and Chrome major. Every absolute
millisecond allocation in Plans 1–5 refers to this exact profile. Their allocations are
sub-allocations of the binding `frame_ms_p95 <= 11.1` combined/movement gate, not
independent targets. The controlled stationary 8.0 ms figure is an advisory headroom
target only.

It performs:

```text
CLOD-POC deterministic captures
CLOD-POC GPU pass timings
CLOD-POC frame timing routes
Bevy deterministic captures
Bevy frame/GPU timing benches
image metrics
semantic region probes
determinism double-run checks
specialized acceptance commands
combined HTML/JSON/Markdown report
```

Lane B is the authoritative visual and performance gate.

### 2.3 Lane C — Scheduled full battery

Runs nightly and before release.

It includes every Lane B scene plus long routes, weather/time-of-day matrices, save/reload, edit invalidation, cave/voxel, and 30-minute soak tests.

No other lane names or meanings are introduced.

## 3. Repository layout

Create:

```text
validation/
  manifests/
    visual-regression.yaml
    performance-regression.yaml
    specialized-commands.yaml
  baselines/
    clod-poc/
      <scene-id>/
        baseline.png
        baseline.stats.json
        baseline.metrics.json
        baseline.sha256
    bevy/
      <scene-id>/
        baseline.png
        baseline.stats.json
        baseline.metrics.json
        baseline.sha256
  masks/
    <mask-id>.png
  reports/
    .gitkeep
```

Generated run artifacts are written outside committed baselines:

```text
validation-runs/<timestamp>/
  manifest.snapshot.yaml
  environment.json
  scenes/<target>/<scene-id>/
    actual.png
    actual.stats.json
    actual.metrics.json
    diff.png
    heatmap.png
    regions.json
    timing.json
    specialized/
  report.json
  report.md
  report.html
  junit.xml
```

Only `validation/baselines`, `validation/masks`, and manifests are committed. `validation-runs` is gitignored.

## 4. Canonical manifest

Create `validation/manifests/visual-regression.yaml` and
`validation/manifests/performance-regression.yaml` with schema version 1. Both use the
scene contract below. The visual manifest owns frozen image/region baselines; the
performance manifest owns 300+-frame stationary and movement routes. The loader merges
them into one scene registry and rejects duplicate scene IDs across files.

The existing `tools/clod-poc/config/qa_visual.yaml` and `qa_perf_move.yaml` are migration
inputs only. QA-U1 moves the first into the visual manifest and the second into the
performance manifest, then deletes both files in the
same change; generated copies and thin re-exports are forbidden. `src/qa/qaConfig.ts`
then reads only the canonical manifest and projects selected scenes into the existing QA
evaluator in memory. Existing `npm run qa` callers select manifest tags (`legacy-visual`
or `movement`) instead of passing a legacy config path, and all command examples and
`tools/perf-move.ts` comments are updated in that same change.

Existing `min: 0` checks become `required: false` informational metrics, never passing
gates. The existing 11.1 ms movement ceiling becomes the binding balanced gate; the
former 24 ms visual-scene ceiling is retained with `enforcement: advisory`, not release
performance acceptance. QA-U1 records every old scene/check ID and its new ID in a
parser test fixture so no gate silently disappears.

Top-level contracts (one root per file):

`visual-regression.yaml`:

```yaml
visual_regression:
  schema_version: 1
  baseline_version: 1
  default_target: clod-poc
  output_root: validation-runs
  scenes: []
```

`performance-regression.yaml`:

```yaml
performance_regression:
  schema_version: 1
  default_target: clod-poc
  output_root: validation-runs
  scenes: []
```

Scene contract:

```yaml
- id: forest-noon
  target: clod-poc
  lane: gpu
  enabled: true
  tags: [forest, lighting, trees]

  launch:
    world_seed: 19
    world_mode: continent
    scene: continent
    quality: balanced
    render_resolution_preset: high
    viewport: [2560, 1440]
    device_pixel_ratio: 1
    camera:
      position: [1200.0, 184.0, -640.0]
      yaw_deg: 132.0
      pitch_deg: -14.0
      fov_y_deg: 55.0
    lighting:
      time_of_day_hours: 12.0
      sun_elevation_deg: 55.0
      sun_azimuth_deg: 145.0
    weather:
      wind_time_s: 0.0
      cloud_time_s: 0.0
      particle_time_s: 0.0
      precipitation: none
    flags: {}

  settle:
    ready_timeout_ms: 120000
    warmup_frames: 240
    settle_frames: 60
    freeze_after_settle: true

  capture:
    checkpoint: final
    image: viewport
    include_hud: false
    include_debug_overlays: false

  baseline:
    image: validation/baselines/clod-poc/forest-noon/baseline.png
    stats: validation/baselines/clod-poc/forest-noon/baseline.stats.json
    metrics: validation/baselines/clod-poc/forest-noon/baseline.metrics.json
    mask: null

  image_gates:
    mean_absolute_error_max: 0.012
    p95_absolute_error_max: 0.040
    changed_pixel_fraction_max: 0.025
    edge_error_mean_max: 0.018
    luminance_mean_delta_max: 0.025
    luminance_stddev_delta_max: 0.030
    chroma_mean_delta_max: 0.025

  region_probes: []
  timing_gates: []
  counter_gates: []
  informational_metrics: []
  specialized_commands: []
```

All fields are required except `mask`, `region_probes`, `timing_gates`, `counter_gates`,
`informational_metrics`, and `specialized_commands`, which default to empty arrays.

Unknown fields fail manifest loading.

## 5. Deterministic runtime contract

Both CLOD-POC and Bevy expose the same logical QA interface.

### 5.1 CLOD-POC browser hook

Do not fork a second automation state surface. Keep `window.__drusnielClod` as the
runtime owner of `ready`, `error`, `diag`, `stats`, pose control, `settle`, and fly-cam
state. Expose `window.__drusnielQa` only as the thin typed adapter below: its methods
delegate to `__drusnielClod` or to QA-only freeze/world-state helpers. It owns no copied
ready/error/pose/stats state.

Create:

```ts
window.__drusnielQa = {
  schemaVersion: 1,
  ready(): boolean,
  error(): string | null,
  environment(): QaEnvironment,
  getPose(): QaPose,
  setPose(pose: QaPose): Promise<void>,
  setWorldState(state: QaWorldState): Promise<void>,
  settle(frames: number): Promise<void>,
  freeze(): Promise<void>,
  unfreeze(): Promise<void>,
  captureStats(): Promise<QaStats>,
  captureScreenshot(name: string): Promise<string>,
  runCheckpoint(name: string): Promise<void>,
};
```

`ready()` returns `Boolean(__drusnielClod.ready)`, `error()` wraps its error property,
`getPose`/`setPose`/`settle` delegate directly, and `captureStats()` snapshots
`__drusnielClod.stats`. Tests fail if the adapter and runtime hook disagree.

Create the implementation in:

```text
tools/clod-poc/src/qa/browser_contract.ts
tools/clod-poc/src/qa/browser_hook.ts
```

### 5.2 Bevy QA protocol

Extend `src/bin/qa.rs` and `src/diagnostics/qa/` to accept a scene manifest and launch the Bevy app in deterministic capture mode.

The Bevy runtime exposes the same state through a file/IPC capture result rather than JavaScript.

### 5.3 Freeze semantics

`freeze_after_settle: true` means:

```text
camera motion = frozen
wind simulation time = frozen
cloud time = frozen
particle time = frozen
water animation time = frozen
sun/time of day = frozen
procedural random epochs = frozen
probe/froxel/history updates = frozen after final convergence frame
streaming and async replacement commits = frozen only after all required readiness gates pass
```

The capture must not occur while required tiles, pages, atlases, impostors, probes, or pipelines are pending.

## 6. Environment recording

Every run writes `environment.json` containing:

```text
repository commit SHA
working tree dirty flag
target and build profile
OS version
browser and Chrome version
GPU adapter name/vendor/device/backend
driver version when available
WebGPU limits
screen and viewport
Node/npm versions
Rust/cargo versions
three.js version
Bevy version
manifest hash
baseline version
world source hash
terrain source version
shader bundle hashes
quality token and render-resolution preset
```

A run with a dirty working tree is allowed locally but its report status is `non_authoritative`. It cannot update committed baselines or produce a release PASS. A run whose adapter, driver, Chrome major, viewport, DPR, or quality differs from the accepted Lane B machine manifest is also `non_authoritative` until a deliberate rebaseline records the new environment.

## 7. Capture runner

Create:

```text
tools/clod-poc/tools/visual-regression.ts
tools/clod-poc/src/qa/capture/
  manifest.ts
  launch.ts
  browser.ts
  readiness.ts
  screenshot.ts
  stats.ts
  environment.ts
  specialized.ts
  report.ts
```

Command:

```powershell
npm --prefix tools/clod-poc run visual:regression -- --lane gpu
```

Add package scripts:

```json
"visual:validate": "tsx tools/visual-regression.ts --validate-only",
"visual:regression": "tsx tools/visual-regression.ts",
"visual:regression:smoke": "tsx tools/visual-regression.ts --tags smoke",
"visual:regression:full": "tsx tools/visual-regression.ts --lane full",
"visual:baseline:update": "tsx tools/visual-regression.ts --update-baseline"
```

The runner starts and stops its own Vite server using the existing server-first discipline. It must also support `--reuse-server` for local iteration.

## 8. Image metric pipeline

Use `sharp`, already present in the project. Do not add a second image-processing dependency.

Images are converted to linear Rec.709 RGB float values before metrics.

### 8.1 Required metrics

Compute:

```text
mean absolute RGB error
p50/p95/p99 absolute RGB error
changed pixel fraction above 0.05 linear error
linear luminance mean and standard deviation
mean chroma and chroma standard deviation
Sobel edge magnitude mean
mean absolute Sobel edge error
masked and unmasked versions of every metric
```

Rec.709 luminance:

```text
Y = 0.2126 R + 0.7152 G + 0.0722 B
```

Chroma metric:

```text
C = max(R,G,B) - min(R,G,B)
```

### 8.2 Diff outputs

Write:

```text
diff.png
  side-by-side baseline and actual with labels

heatmap.png
  absolute linear RGB error mapped from black to white

changed-mask.png
  binary pixels above the scene threshold
```

The report must link all three.

### 8.3 Masks

Masks are grayscale PNGs:

```text
0 = ignore pixel
255 = fully gate pixel
intermediate = metric weight
```

Masks may exclude nondeterministic UI, browser borders, or deliberately stochastic particle regions. They may not mask terrain, water, vegetation, shadows, fog, or LOD boundaries merely to make a scene pass.

Mask file hashes are recorded in the baseline metrics.

## 9. Region probes

Region probes are mandatory for semantic lighting and ownership checks.

Contract:

```yaml
region_probes:
  - id: canopy-shadow
    rect_normalized: [0.10, 0.50, 0.20, 0.20]
    gates:
      luminance_mean: { min: 0.04, max: 0.32 }
      chroma_mean: { min: 0.02, max: 0.30 }
      black_pixel_fraction: { max: 0.02 }
      clipped_pixel_fraction: { max: 0.01 }
```

Required probe metrics:

```text
mean/min/max luminance
luminance p05/p50/p95
mean chroma
black pixel fraction where luminance < 0.01
clipped pixel fraction where any channel > 0.99
mean RGB
edge magnitude
```

Probe IDs must be unique per scene.

Use region probes for:

- no-black forest interiors;
- lit foliage versus ambient foliage;
- cave darkness and cave-mouth transition;
- water reflection/refraction regions;
- sky and cloud exposure;
- snow highlights;
- far terrain silhouette;
- LOD boundary occupancy;
- fog shaft brightness versus shadowed fog.

## 10. Timing gates

Timing gates read frame and GPU-pass summaries.

Contract:

```yaml
timing_gates:
  - metric: frame_ms_p95
    max: 11.1
    enforcement: required
  - metric: frame_ms_p99
    max: 12.0
    enforcement: required
  - metric: gpu_passes.probeGiTotal
    max: 3.0
    enforcement: required
  - metric: main_thread.vegetationTotalMs_p95
    max: 1.0
    enforcement: required
```

Every timing scene records:

```text
frame p50/p95/p99/max
render p50/p95/p99/max
main-thread named buckets
GPU render/compute totals
per-pass GPU timings
readback/debug flags
sample count
warmup count
```

Rules:

- minimum measured sample count is 300 frames;
- warmup frames are excluded;
- debug readbacks must be off;
- vsync-limited FPS is not a valid timing metric;
- a run missing a required metric fails;
- `>= 0` gates are forbidden;
- relative-only performance gates are forbidden; every gate has an absolute maximum;
- reports also show baseline delta, but baseline delta does not replace the absolute maximum.
- `enforcement` is exactly `required` or `advisory`; omitted means `required`.
- advisory thresholds produce `ADVISORY_EXCEEDED`, never PASS or release failure.

Stationary scenes encode the 8.0 ms headroom target as an
`enforcement: advisory` timing gate. It does not produce PASS and does not fail the
binding gate. Per-plan A/B scenes report
feature-off, feature-on, and their measured frame p95 delta; no assumed compute/raster
overlap is subtracted.

## 11. Counter gates

Counter gate contract:

```yaml
counter_gates:
  - key: application_errors
    equals: 0
  - key: vegetation_gpu_overflow_count
    equals: 0
  - key: clod_page_ownership_conflicts
    equals: 0
  - key: far_clipmap_fallback_samples_this_frame
    equals: 0
  - key: probe_gi_valid_probes
    min: 1
```

Allowed operators:

```text
equals
min
max
between
```

Missing required counters fail.

Optional counters must be explicitly marked `required: false`; absence is then reported as `not_applicable`, never PASS.

Metrics retained only for visibility use a separate non-gating contract:

```yaml
informational_metrics:
  - key: shadow_proxy.shadow_proxy_tris
    required: false
```

Informational metrics display a value or `NOT_APPLICABLE`; they cannot produce PASS or
FAIL and accept no `equals`/`min`/`max`/`between` operator. This is the required landing
place for legacy `min: 0` existence checks.

## 12. Specialized validator orchestration

Create `validation/manifests/specialized-commands.yaml`.

Supported commands are allowlisted by ID, not arbitrary shell strings.

Initial allowlist:

```text
clod_acceptance
infinite_islands_acceptance
continent_tiles_acceptance
phase5_voxel_overlay_acceptance
world_verify
water_hydrology
water_graph_semantics
water_streaming
water_seam
water_ownership
water_report
tree_parity_manifest
tree_parity_evidence
impostor_visual
lighting_verify
postfx_verify
bevy_qa
bevy_bench_guard
```

Each command record defines executable, fixed arguments, timeout, expected report path, and parser.

The scene manifest references IDs:

```yaml
specialized_commands:
  - water_ownership
  - lighting_verify
```

The runner stores stdout/stderr and parsed status under the scene artifact directory.

## 13. Determinism gate

Every Lane B scene runs twice from a fresh process and cache state specified by the scene.

Two modes:

```text
warm deterministic
  both runs may use persisted caches

cold deterministic
  both runs clear scene-specific caches before launch
```

The actual images from run A and run B must satisfy stricter thresholds than baseline comparison:

```text
mean absolute error <= 0.002
p95 absolute error <= 0.008
changed pixel fraction <= 0.002
all exact identity/signature counters equal
```

Compacted GPU lists use order-independent signatures because atomic append order is not
stable. For each list record: item count, XOR of `stable_id_lo`, XOR of
`stable_id_hi`, wrapping sum of a second shared-PCG mix of both words, and the same
values per category/LOD. These u32 accumulators are compared exactly. A sequential hash
of buffer order is forbidden. Together with Plan 2's opaque/coverage-dithered material
policy, append-order variation cannot change either the signature or blend result.

A determinism failure is reported separately from a baseline regression.

For scenes containing intentionally stochastic particles, simulation time and RNG epochs are frozen. A scene that remains stochastic is invalid and must be fixed; it is not excused with a broad mask.

## 14. Baseline policy

### 14.1 Baseline creation

A baseline may be created only from:

```text
clean main branch
Lane B authoritative environment
all scene correctness gates passing
all specialized validators passing
no overflow/readback/debug flags
manifest committed or staged with final hash
```

### 14.2 Baseline update command

```powershell
npm --prefix tools/clod-poc run visual:baseline:update -- --scene <id> --reason "<text>"
```

The command:

1. Runs the scene twice.
2. Requires determinism PASS.
3. Requires all non-image correctness gates PASS.
4. Writes new baseline image/stats/metrics/hash.
5. Writes `baseline-change.md` containing reason, old/new hashes, metric deltas, environment, and image links.
6. Refuses to run on dirty or non-main state unless `--local-preview` is used; local preview never modifies committed baselines.

### 14.3 Review requirement

Baseline changes must be isolated from unrelated source changes in the commit or PR whenever possible. The report lists every changed baseline and requires human review of side-by-side and heatmap images.

The tool never auto-accepts a visual change because a threshold was raised.

## 15. Initial scene battery

Create these mandatory CLOD-POC scenes:

```text
smoke-terrain-noon
continent-river-crossing
continent-4km-vista
forest-noon
forest-low-sun
forest-impostor-boundary
water-lake-shore
water-river-bend
water-clipmap-boundary
cave-mouth
voxel-edit-tunnel
construction-placement
probe-gi-forest
froxels-canopy-shafts
erosion-valley
dressing-forest-floor
```

Create these mandatory Bevy scenes:

```text
bevy-ridge-noon
bevy-forest-noon
bevy-water-shore
bevy-cave-mouth
bevy-clod-boundary
bevy-construction
```

Smoke-tagged Lane B scenes:

```text
smoke-terrain-noon
forest-noon
water-lake-shore
cave-mouth
bevy-ridge-noon
```

Lane C adds matrices:

```text
time of day: 06:30, 12:00, 17:30, 21:00
weather: clear, overcast, rain, snow
quality: potato, perf, balanced, ultra
movement: fixed shot, slow dolly, 4 km route
save state: fresh, edited, reload
```

## 16. Report status model

Every scene and overall run uses:

```text
PASS
FAIL
BASELINE_MISSING
NOT_APPLICABLE
NON_AUTHORITATIVE
ERROR
```

`BASELINE_MISSING` is non-failing only during explicit bootstrap mode. In normal Lane B/C it fails the run.

`NON_AUTHORITATIVE` never produces an overall PASS suitable for release.

The report includes:

```text
summary table
failed gates first
reproduction command
baseline/actual/diff/heatmap links
environment differences
image metrics
region probes
timing and counter gates
specialized validator status
determinism status
likely-cause hints
```

## 17. Likely-cause hints

Implement deterministic hints from failed metrics:

```text
black pixel increase
  -> shadow/GI/exposure regression

chroma collapse
  -> ambient/fog/desaturation regression

edge error concentrated at terrain boundaries
  -> CLOD ownership, seam, or displacement regression

large water-region error
  -> hydrology, clipmap ownership, SSR/refraction, or time freeze regression

far silhouette error
  -> far summary, CLOD selection, canopy shell, or atmosphere mismatch

frame p95 only
  -> periodic rebuild/upload/readback

frame max only during movement
  -> streaming commit, cache miss, or monolithic invalidation

GPU timing increase with stable frame timing
  -> asynchronous overlap or profiler artifact; inspect pass and readback flags
```

Hints are advisory and never alter pass/fail.

## 18. TypeScript module layout

Refactor/extend:

```text
tools/clod-poc/src/qa/
  qa.ts
  qaTypes.ts
  qaConfig.ts
  qaEvaluation.ts
  qaRunner.ts
  qaReportWriter.ts
```

Create:

```text
tools/clod-poc/src/qa/unified/
  schema.ts
  manifest.ts
  environment.ts
  browser_contract.ts
  readiness.ts
  capture.ts
  image_linear.ts
  image_metrics.ts
  edge_metrics.ts
  region_probes.ts
  masks.ts
  timing.ts
  counters.ts
  determinism.ts
  specialized.ts
  baseline.ts
  hints.ts
  report_json.ts
  report_markdown.ts
  report_html.ts
  junit.ts
  validation.ts
```

Rules:

- `schema.ts` owns the canonical schema.
- `image_linear.ts` is the only color-space conversion implementation.
- `baseline.ts` is the only module allowed to modify baseline files.
- `specialized.ts` executes allowlisted command IDs only.
- existing `qa.ts` becomes a compatibility facade and delegates to unified modules.
- existing `compare.ts`, `battery.ts`, `shoot.ts`, and perf tools remain but are invoked through the unified runner or retained as low-level tools.

## 19. Rust/Bevy module layout

Extend:

```text
src/diagnostics/qa/
  mod.rs
  config.rs
  scene.rs
  capture.rs
  image.rs
  probes.rs
  timing.rs
  report.rs
  runner.rs
```

Create:

```text
src/diagnostics/qa/unified/
  schema.rs
  manifest.rs
  environment.rs
  baseline.rs
  determinism.rs
  junit.rs
```

Rust consumes the same YAML scene schema. Fields not applicable to a target are still parsed and validated, then reported `NOT_APPLICABLE` only when the manifest explicitly allows it.

## 20. Implementation sequence

### QA-U1 — Schema and validation

- Add canonical manifests, strict parsers, path/hash checks, and command generation.
- Migrate every legacy QA scene/check through the ID mapping fixture, switch
  `qaConfig.ts` and callers to manifest tags, and delete both legacy YAML files.

Exit gate: malformed/unknown fields fail with exact paths and line context; the legacy
ID mapping is complete; repository search finds no runtime or command reference to
`config/qa_visual.yaml` or `config/qa_perf_move.yaml`.

### QA-U2 — Deterministic runtime hooks

- Add CLOD browser hook and Bevy capture state.
- Implement full freeze semantics and readiness checks.

Exit gate: repeated frozen captures have deterministic signatures.

### QA-U3 — Image metrics and reports

- Add linear conversion, metrics, probes, masks, diff/heatmap, JSON/Markdown/HTML/JUnit.

Exit gate: synthetic image tests validate every metric and threshold boundary.

### QA-U4 — Timing and counter integration

- Parse existing perf/stat outputs and enforce absolute gates.

Exit gate: missing metrics, readback flags, overflows, and threshold failures are correctly red.

### QA-U5 — Specialized command orchestration

- Add allowlist and parsers for current validators.

Exit gate: each command has pass/fail/missing-report tests.

### QA-U6 — Determinism double-run

- Add fresh-process A/B runs and strict image/signature comparison.

Exit gate: injected nondeterminism reliably fails.

### QA-U7 — Baseline workflow

- Add authoritative baseline creation/update and change report.

Exit gate: dirty/non-main updates are refused and valid updates produce all required files.

### QA-U8 — Initial CLOD and Bevy batteries

- Capture and commit the mandatory scene baselines.
- Wire Lane A/B/C commands.

Exit gate: smoke and full batteries produce authoritative reports.

## 21. Tests

Required unit/integration tests:

- strict manifest parsing and unknown-field rejection;
- duplicate scene/probe ID rejection;
- invalid baseline/mask path rejection;
- baseline hash verification;
- sRGB-to-linear conversion exact samples;
- Rec.709 luminance exact samples;
- absolute error percentiles;
- changed pixel fraction;
- Sobel edge metrics;
- weighted masks;
- region probe metrics and boundary cases;
- missing required timing metric failure;
- optional counter `NOT_APPLICABLE` behavior;
- allowlisted command enforcement;
- timeout and missing-report handling;
- freeze/readiness state machine;
- determinism threshold pass/fail;
- dirty-tree authority rejection;
- baseline update refusal and success paths;
- report JSON schema;
- JUnit failure mapping;
- HTML links resolve relative to report location;
- specialized validator output parsers;
- injected black-shadow, washout, seam, and timing regressions produce expected hints.

## 22. Performance gates for the QA system

QA overhead is outside measured frame windows.

During measured windows:

```text
screenshot capture = off
stats serialization = off
GPU readback counts = off except timestamp-query resolution already required by the perf run
DOM/HUD updates = disabled
report generation = after process exit
```

Runner limits:

```text
single screenshot metric evaluation <= 5 s at 2560x1440
single scene report generation <= 1 s excluding capture
smoke battery <= 15 min on native GPU host
full nightly battery <= 90 min
artifact retention <= 20 recent local runs unless pinned
```

## 23. Acceptance gates

The unified system is complete only when:

- all mandatory CLOD and Bevy scenes have committed baselines;
- Lane A validates every manifest and baseline hash;
- Lane B can run from one command and produce JSON/Markdown/HTML/JUnit;
- each scene has an exact reproduction command;
- deterministic double-run passes for all smoke scenes;
- image, region, timing, counter, and specialized failures are independently demonstrated by tests;
- baseline update refuses dirty/non-main state;
- debug readback artifacts cannot be mistaken for gameplay performance;
- no existing specialized validator is deleted or bypassed;
- a known visual regression and a known performance regression both make the full run fail.

## 24. Explicit non-goals

Do not:

- replace domain-specific validators with image comparison;
- use FPS as the primary timing metric;
- allow arbitrary shell commands in manifests;
- auto-update baselines after a failure;
- weaken thresholds to accept unexplained changes;
- mask terrain, water, vegetation, shadows, fog, or LOD boundaries broadly;
- call software-rendered CI output authoritative for visual quality;
- capture before streaming and asynchronous systems converge;
- compare images in gamma-encoded space;
- accept missing required metrics or counters;
- report a dirty-tree run as release-ready PASS.
