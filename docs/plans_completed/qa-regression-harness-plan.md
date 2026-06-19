# Plan: QA Regression Harness (steal the LAAS philosophy, adapt to Drusniel)

Status: in progress. Owner: TBD. Created 2026-06-17. First host-side slices
landed: `src/bin/qa.rs` consumes an existing Bevy bench `summary.json`, runs
image/probe/timing checks, and writes JSON/Markdown reports; clod-poc has a
report-only Node/TS runner that consumes precomputed capture metrics. Browser
capture / Playwright automation remains deferred.

This plan adds a durable, repeatable QA layer to Drusniel, modelled on the
verification harness in [`docs/reference/fable5-world-demo/`](../reference/fable5-world-demo/)
(the LAAS project). It is **not** a screenshot-only feature: it captures
deterministic scenes, screenshots, image diffs, pixel/region probes, timing
thresholds, and writes machine- + human-readable reports with clear failure
reasons.

The executable first targets are:

- **Rust / Bevy** — the main game. Extend the existing bench infrastructure in
  [`src/diagnostics/bench/`](../../src/diagnostics/bench/). Do **not** fork it.
- **clod-poc report-only QA** — a lightweight Node/TS runner that consumes a web
  summary JSON with precomputed screenshot metrics. This is not the full browser
  capture port.

The later target is the full **clod-poc browser capture port**. It should reuse
the YAML/report schema so a regression looks the same in both. [§12](#12-clod-poc-port)
remains the deferred mapping.

---

## 0. The philosophy we are stealing (read this first)

From LAAS ([`README.md`](../reference/fable5-world-demo/README.md) §"The model
does its own QA", and [`STATUS.md`](../reference/fable5-world-demo/STATUS.md)):

| LAAS artifact | What it gives us | Drusniel analogue |
|---|---|---|
| [`tools/shoot.ts`](../reference/fable5-world-demo/tools/shoot.ts) | Boot a named scene/seed/time/cam, **wait for ready**, **settle** temporal effects, capture PNG + stats JSON, `--framealign` to pin TAA jitter phase, `--gpusample` for median GPU pass timings | Bench runner already does ready-wait, settle, screenshot points, area timings. We add deterministic checkpoint capture + per-pass timing extraction |
| [`tools/diff.ts`](../reference/fable5-world-demo/tools/diff.ts) | Pixel diff: amplified `\|a−b\|` image + **changed-pixel ratio** + **mean max-channel delta** | New `image_diff` module (Rust `image` crate is already a dep) |
| [`tools/compare.ts`](../reference/fable5-world-demo/tools/compare.ts) | Side-by-side compositor + **pixel sampling** (`value`, `sat`) for the no-black-shadows test | New region/pixel **probes** |
| [`tools/probe-*.ts`](../reference/fable5-world-demo/tools/) | **Per-bug probes** (wet margins, CSM, horizon, sun, cloud-lag…) that encode one specific regression as a numeric assertion | YAML-defined probes + a small set of bug probes shipped day one |
| `window.__laas` ([`Hooks.ts`](../reference/fable5-world-demo/src/core/Hooks.ts)) | Stable contract: `ready`, `error`, `settle(frames)`, `stats`, `getPose/setPose` | Bevy bench already has ready/render-ready signatures + settle; clod-poc needs a `window.__clod` equivalent |
| `STATUS.md` | Durable memory: current state, **known open issues at the top**, diagnosis logs, decisions | `docs/qa/STATUS.md` — never auto-edited per run |
| Named **bookmarks / camera poses** | Reproducible framing (`?cam=…`, keys 1–9) | Bench `[[checkpoint]]` poses + `screenshot_points` are already named camera paths |

Five things we keep verbatim in spirit:

1. **Screenshot battery** over named checkpoints — already present as
   `screenshot_points`; QA selects a subset and names them stably.
2. **Pixel / region probes** — numeric assertions on regions, not eyeballing.
3. **Per-bug probes** — every nasty regression gets a permanent probe so it can
   never silently return.
4. **Stable status log** — `STATUS.md` as durable cross-session memory, with
   known-flaky probes documented, never relaxed silently.
5. **Named camera paths** — deterministic poses + frozen time/weather/LOD so two
   builds are comparable.

Non-negotiable from LAAS: **the report is the durable output, not the terminal
log.** JSON + Markdown must stand alone.

---

## 1. Repository audit (done — findings)

### Rust / Bevy bench infra (extend, do not replace)

- **Entry / CLI**: [`src/diagnostics/bench/mod.rs`](../../src/diagnostics/bench/mod.rs)
  (~5.2k lines). `BenchCli` (clap) exposes `--bench`, `--bench-out`,
  `--bench-headless`. Wired in [`src/app/mod.rs:64`](../../src/app/mod.rs#L64)
  via `BenchConfig::from_cli` → `BenchPlugin`. Scene path auto-resolves under
  `bench/scenes/**`.
- **Scene config**: TOML, e.g.
  [`bench/scenes/visual/visual-regression-live-lod.toml`](../../bench/scenes/visual/visual-regression-live-lod.toml).
  Top-level keys (`seed`, `chunk_load_radius`, `freeze_terrain_lod_after_ready`,
  `world_cache_path`) + `[[checkpoint]]` with `position`, `look_at`,
  `time_of_day`, `hold_frames`, `fog_tier`, `motion`, and `screenshot_points`
  (named, frame-indexed). **These are our named camera paths already.**
- **Summary schema**: `BenchSummary` (`mod.rs:701`) → `bench-runs/<run>/summary.json`,
  `schema_version`, `scene`, `seed`, `git_sha`, `git_dirty`, `build_profile`,
  `platform`, `bevy_version`, `run_started_utc`, `duration_secs`,
  `render_toggles`, `checkpoints[]`. `CheckpointSummary` has `median_frame_ms`,
  `p99_frame_ms`, `areas: BTreeMap<String, AreaSummary>`, `runs[]`. `AreaSummary`
  = `{ median_ms, p99_ms, calls_per_frame, unit }`. `ScreenshotRecord` =
  `{ name, frame, elapsed_secs, path }`. **This is our timing + screenshot
  source of truth — QA consumes it, does not re-profile.**
- **Screenshots**: Bevy `Screenshot::primary_window()` + `save_to_disk` (PNG) to
  the run dir (`capture_bench_screenshot`, `mod.rs:3573`).
- **Ready / settle**: render-ready + terrain-ready signatures, settle frames,
  stable-frame counts already tracked (`BenchReadySignature`,
  `BenchRenderReadySignature`, `ready_wait_*`, `render_ready_*`).
- **Guard**: [`src/bin/bench_guard.rs`](../../src/bin/bench_guard.rs) (~46k lines)
  consumes `summary.json`; thresholds in
  [`assets/config/bench_guard.toml`](../../assets/config/bench_guard.toml)
  (TOML, ~850 lines). QA's timing thresholds are **complementary** to this, not a
  replacement.
- **Deps**: `image = "0.25"` (png) **already present** — no new image crate
  needed. `serde`, `serde_json` present. YAML: `serde_yaml` is **not** yet a dep
  (verify before assuming); add it, or reuse TOML if we want zero new deps (see
  [§2 decision](#2-qa-configuration)).
- **Output root** `bench-runs/` is **git-ignored** (`.gitignore`). Baselines must
  live elsewhere or be explicitly committed (see [§8](#8-baseline-workflow)).

### clod-poc (report runner exists; capture harness deferred)

- TypeScript / three.js / Vite at [`tools/clod-poc/`](../../tools/clod-poc/).
  `vitest` for tests, `tsx` for scripts, **`js-yaml` already a dependency**
  (YAML config is natural here), config already YAML-driven
  (`config/audio_events.yaml`).
- Current v1 has `src/qa.ts` plus `scripts/qa-runner.mjs`; it does not boot a
  browser or parse PNGs. No `window.__*` hooks, no Playwright capture command.
  The full LAAS-style contract (`window.__clod`) + browser harness remains
  deferred. When implemented, add `playwright` and one PNG reader (`pngjs`, or
  `sharp` matching LAAS) as devDeps — see [§12](#12-clod-poc-port).

### Decision: extend, don't fork

The Bevy bench already produces a run folder, named screenshots, timing, ready
gating, and git/env metadata. QA is a **post-processing + assertion layer** that
runs the bench scenes it is told to and then reads their `summary.json` +
screenshots. We add a thin capture-orchestration path only where the bench can't
already produce what a checkpoint needs.

---

## 2. QA configuration

**Path**: `assets/config/qa_visual.yaml` (Rust) and
`tools/clod-poc/config/qa_visual.yaml` (clod-poc) — same shape.

**Dependency decision (resolve in Phase 2, document the choice):**

- *Option A (preferred): add `serde_yaml`.* Matches the task brief's YAML
  requirement and reads naturally. One small, common crate.
- *Option B: reuse TOML* (zero new Rust deps; bench config is already TOML). The
  brief explicitly asks for YAML, so default to A unless the maintainer vetoes a
  new dep. **Recommendation: A.** clod-poc uses `js-yaml` regardless.

Config shape (full example lives in the brief; key points):

```yaml
qa:
  enabled: true
  output_root: "bench-runs"
  baseline_root: "bench-baselines"
  diff_root_name: "diffs"
  report_json_name: "qa-report.json"
  report_markdown_name: "qa-report.md"
  capture: { resolution: [1920,1080], warmup_frames: 120, settle_frames: 30,
             freeze_time: true, freeze_weather: true, freeze_lod_after_ready: true,
             hide_debug_overlay: true }
  image_diff: { enabled: true, fail_when_baseline_missing: false,
                changed_pixel_threshold: 0.08, max_changed_ratio: 0.02,
                max_rmse: 6.0, max_mean_abs_error: 3.0, write_diff_images: true }
  timing:
    enabled: true
    fail_on_threshold: true
    thresholds: { frame_p95_ms: 16.67, frame_p99_ms: 22.0, render_p95_ms: 12.0,
                  terrain_p95_ms: 4.0, water_p95_ms: 2.0, shadows_p95_ms: 3.0 }
  probes: { enabled: true }
  scenes:
    - id: "spawn_morning_smoke"
      bench_scene: "bench/scenes/visual/visual-regression.toml"
      checkpoint: "<real checkpoint name>"      # adapt to actual scene
      tags: ["smoke","terrain","sky","fog"]
      probes: [ … ]                              # see §5
```

Requirements:

- All config structs derive serde. Validate on load.
- **Typed errors**, no `unwrap`/`expect` outside tests:
  `QaConfigError::{DuplicateSceneId{id}, DuplicateProbeId{id},
  InvalidRegion{probe_id,region}, UnknownScene{id}, InvalidThreshold{metric,value},
  MissingCheckpoint{scene,checkpoint}}`.
- The YAML's `bench_scene` / `checkpoint` must resolve against the real TOML and
  its checkpoint names — validate at load, fail with `MissingCheckpoint` before
  doing any GPU work. **The example IDs in the brief (`spawn_morning`,
  `water_mid`, `look_sweep`) are placeholders; map them to real checkpoint names
  from the bench scenes** (e.g. live-lod's `forest-look-sweep` → `look_sweep`).
- Constants (default thresholds, schema version) in one place
  (`qa/constants.rs`), documented.

**Module layout (Rust)** — small files, split by responsibility, placed under
the existing diagnostics tree to avoid a parallel top-level module:

```
src/diagnostics/qa/
  mod.rs        # plugin/CLI glue, re-exports
  config.rs     # serde structs + validation
  errors.rs     # typed errors (QaConfigError, QaImageError, QaProbeError, QaTimingError)
  constants.rs  # defaults, schema_version
  image_diff.rs # PNG compare metrics + diff image
  probes.rs     # region_luminance / region_variance / pixel_luminance
  timing.rs     # consume summary.json areas → thresholds
  report.rs     # QaReport (serde) + Markdown renderer
  runner.rs     # orchestrate scenes → capture → diff → probe → timing → report
```

(If the maintainer prefers `src/qa/`, that's fine; keeping it under
`diagnostics/` matches `bench/` and `hole_probe/`.)

---

## 3. Report schema

**JSON**: `bench-runs/<run>/qa-report.json`, **Markdown**:
`bench-runs/<run>/qa-report.md`. Schema per the brief (`schema_version`,
`run_id`, timestamps, `git`, `environment`, `config_path`, `overall_status`,
`scenes[]` with `screenshots[].diff`, `probes[]`, `timing`, `failures[]`).

- Reuse the bench's existing git/env metadata collection (it already emits
  `git_sha`, `git_dirty`, `build_profile`, `platform`, `bevy_version`) so QA and
  bench agree.
- `overall_status ∈ {pass, fail, baseline_missing}`. `baseline_missing` alone is
  a **warning** → exit 0. Any `fail` → exit non-zero.
- Markdown includes: overall status, commit/branch/dirty, GPU/adapter/resolution,
  a scene table, failed thresholds, failed probes, screenshot/diff paths, the
  **exact reproduction command**, and next-action hints.
- Failure wording must name likely causes (LAAS style), e.g.:

  ```
  FAIL water_reflection_smoke / water_has_signal:
  mean luminance 0.004 below minimum 0.030.
  Likely: water material disabled, reflection layer missing, exposure broken,
  or screenshot captured before render-ready.
  ```

Add a serialization round-trip unit test (report → JSON → report).

---

## 4. Image diff

`image_diff.rs`, built on the existing `image` crate. Metrics: width/height
equality, changed-pixel ratio (per-pixel max-channel delta > `changed_pixel_threshold`),
mean absolute error, RMSE, max channel delta, optional amplified diff PNG
(mirrors [`diff.ts`](../reference/fable5-world-demo/tools/diff.ts)).

Rules: dimension mismatch → `QaImageError::DimensionMismatch{actual,expected}`
fail; baseline missing → `baseline_missing` (warn) or fail per
`fail_when_baseline_missing`; corrupt PNG → typed error, **never panic**; diff
images only when `write_diff_images`.

Unit tests (tiny generated images): identical pass; one changed pixel → exact
ratio; dimension mismatch fails; missing-baseline honours config; corrupt bytes →
`Err`.

**Determinism caveat (steal LAAS's lesson):** TAA/temporal jitter makes
unaligned captures differ ~20–27% from phase alone. Default QA scenes must set
`freeze_time/weather/lod_after_ready` and rely on the bench settle frames; if a
frame-phase align is needed later, add the analogue of `--framealign` rather than
loosening thresholds.

---

## 5. Pixel & region probes

`probes.rs`. Probe types (region coords normalized `[x0,y0,x1,y1]`, validated &
clamped):

1. `region_luminance` — mean luminance in range `[min,max]`.
2. `region_variance` — luminance stddev ≥ `min_luminance_stddev` (catches flat
   black / flat blue / missing render output — the LAAS "water not flat" test).
3. `pixel_luminance` — single normalized pixel in range.

Every probe records `id`, `type`, `screenshot` ref, `status`, `observed`,
`expected`, `failure reason`. Missing referenced screenshot →
`QaProbeError::MissingScreenshot{probe_id,screenshot}`. Invalid region/pixel →
caught in config validation (Phase 2), not at runtime.

Luminance convention: Rec.709 on sRGB bytes (`0.2126 R + 0.7152 G + 0.0722 B`),
normalized 0..1 — document it in `constants.rs`.

Unit tests: known tiny image region mean; flat image fails variance; pixel
sample; invalid coords fail validation; missing screenshot → clean `Err`.

---

## 6. Timing integration

`timing.rs`. **Do not invent a new profiler.** Parse the bench
`summary.json` we just produced:

- Frame `p95`/`p99`: bench currently emits `median_frame_ms` + `p99_frame_ms` per
  checkpoint. **TODO/known gap:** there is no `frame_p95_ms` field yet. Either
  (a) add `p95_frame_ms` to `CheckpointSummary` (small, surgical, benefits bench
  too) or (b) map the YAML `frame_p95_ms` threshold onto the available metric and
  document the substitution. Prefer (a); leave a clear TODO if deferred.
- Named areas (`render`, terrain, water, shadows) come from
  `CheckpointSummary.areas` keyed by area name → use `AreaSummary.p99_ms` /
  derive p95. **Map YAML metric names to real `areas` keys** (verify the exact
  strings the bench uses, e.g. "Render", "QueueMeshes"); per CLAUDE.md, do **not**
  sum broad timing rows — treat each as a separate symptom.
- A configured-but-absent metric → `missing_metric` status, which **fails** when
  `fail_on_threshold` unless the metric is marked optional →
  `QaTimingError::MissingRequiredMetric{metric}`.

Tests: parse a small fake summary JSON; threshold pass; threshold fail; missing
required metric fails clearly.

---

## 7. Runner integration

**Command (Rust, current host-side v1):**

```
cargo run --bin qa -- --config assets/config/qa_visual.yaml \
  --summary bench-runs/<run>/summary.json \
  --output bench-runs/qa/<label>
```

QA is **opt-in** and currently lives in `src/bin/qa.rs`, not in `BenchCli`.
Absent the separate binary invocation, nothing QA-related runs — **no gameplay/
startup path pays any cost** (acceptance #15). Existing `--bench` and
`bench_guard` keep working untouched.

Runner flow per scene: load config → for each scene run/reuse the named bench
scene → wait for the existing render-ready condition → capture named checkpoint
screenshots → read `summary.json` for timing → image-diff vs baseline → run
probes → apply timing thresholds → accumulate. Then write `qa-report.json` +
`qa-report.md`, exit non-zero on any `fail`, zero on pass / baseline_missing-only.

Two viable wiring strategies (pick the smaller at implementation time, document
which):

- **A — orchestrator binary** `src/bin/qa.rs`: current v1 post-processes existing
  run dirs (diff/probe/timing/report) purely on the host. A follow-up may shell/
  `Command` the existing `--bench <scene> --bench-out <run>` once per scene.
  Cleanest isolation, reuses the bench unchanged, easiest to also point at
  clod-poc later.
- **B — in-process plugin**: a `QaPlugin` that drives scenes inside one app run.
  More invasive to the 5k-line bench module.

**Recommendation: A.** It keeps QA as a thin layer over the bench, mirrors how
LAAS's `tools/` sit outside the engine, and matches "do not duplicate large
logic." Logging tag `[QA]` for progress; report is still the durable artifact.

---

## 8. Baseline workflow

```
cargo run --bin qa -- --config assets/config/qa_visual.yaml \
  --summary bench-runs/<run>/summary.json \
  --output bench-runs/qa/<label> \
  --update-baselines
```

- Never overwrite baselines by default; updating is explicit.
- Copy current checkpoint screenshots → `bench-baselines/<id>.png`; write
  `bench-baselines/baselines.json` manifest (`schema_version`, `updated_at_utc`,
  `git_commit`, `entries[]` with `id`, `path`, `source_run`).
- **`.gitignore` reality:** `bench-runs/` is ignored but `bench-baselines/` is
  **not** currently listed. Decision to document in `STATUS.md`: commit only
  small **smoke** baselines (a handful of 1080p PNGs is acceptable; the LAAS repo
  commits its `shots/` and `reference/`); keep large/derived baselines local and
  add `bench-baselines/*.png` to `.gitignore` with the manifest tracked. Default:
  **commit smoke baselines + manifest, ignore the rest.** Do the least-surprising
  thing and write the rule down.

---

## 9. Persistent QA status + docs

- `docs/qa/STATUS.md` — durable, **not** auto-edited per run. Purpose, active QA
  scenes, **known flaky probes (top of file, LAAS-style)**, last reviewed
  baseline update, how to add a scene/probe, how to reproduce a failure, and the
  hard rule: *never hide a real regression by relaxing a threshold without
  documenting why and when.*
- `docs/qa/visual-qa.md` — commands, config explanation, baseline workflow,
  report format, troubleshooting, common false positives, and three worked
  examples: a water bug probe, a LOD-seam probe, a fog/sky exposure probe.

Keep both short enough to maintain.

---

## 10. Bug-specific probes shipped day one

Map to **real** existing scenes/checkpoints (verify names; the live-lod scene has
`ridge-run-noon`, `jump-water-sunset`, `forest-look-sweep`):

1. **Spawn terrain/sky sanity** — region_luminance on a sky band (not black, not
   blown out) + a ground band; catches black frame, missing terrain, broken
   exposure, missing sky/fog. Scene: `visual-regression.toml`.
2. **Water reflection/refraction sanity** — region_luminance + region_variance
   over the water region; catches water disabled, reflection texture missing,
   flat output. Scene: a water bench (e.g. `bench/scenes/water/…` or the
   `jump-water-sunset` checkpoint). **Adapt to the real scene name.**
3. **LOD movement sanity** — variance/luminance across the
   `forest-look-sweep`/live-lod checkpoints; catches missing chunks, bad culling,
   terrain not ready before capture. This pairs with the existing seam/hole-probe
   tooling rather than duplicating it.

Prefer **region** probes for v1 (deterministic enough); reserve single-pixel
probes for cases where time/cam/render state is fully frozen.

---

## 11. Tests & validation

- Unit tests for: YAML config load + validation; image-diff metrics; probe
  metrics; timing threshold eval; report serialization round-trip.
- Run `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo test` for the new modules (narrowest relevant if repo has pre-existing
  unrelated failures — document them, don't hide them).
- Run at least one lightweight QA pass. **Per CLAUDE.md**, any change touching
  frame time must be benched with `--bench` on a deterministic visual scene and
  compared via `summary.json` + `bench_guard`. QA itself is host-side
  post-processing and should not move frame time, but confirm the bench scenes it
  drives still pass the guard. **Do not claim a full GPU visual QA pass unless it
  was actually executed** on this machine; if the environment can't run the GPU
  bench, run the pure-logic tests and say so explicitly in the summary.

---

## 12. clod-poc browser capture port

clod-poc gets the **closest port of LAAS's harness** because it is the same
shape (browser, three.js). Mirror, don't reinvent:

1. **Hooks** — add `window.__clod` (`src/qa/hooks.ts`) mirroring
   [`Hooks.ts`](../reference/fable5-world-demo/src/core/Hooks.ts): `ready`,
   `error`, `progress/progressMsg`, `stats` (fps, frameMs, p95, draws, tris,
   counters, `gpuPasses`), `settle(frames)`, `getPose/setPose`. Drive from
   URL params (`?seed`, `?cam`, `?freeze`, `?shot`) like LAAS.
2. **tools/** — port `shoot.ts`, `diff.ts`, `compare.ts` (the latter two are
   already engine-agnostic and can be copied near-verbatim). Add `qa.ts` that
   reads the **same `qa_visual.yaml` shape** (via `js-yaml`, already a dep),
   boots checkpoints over Playwright, captures, diffs, probes, and writes
   `qa-report.json` + `qa-report.md` with the **same schema** as Rust.
3. **Deps** — add `playwright` + one PNG lib (`pngjs`, or `sharp` to match LAAS)
   as devDeps. Document the WebGPU Playwright recipe from LAAS STATUS.md
   (`channel:'chromium'`, secure-context localhost) — that trap is already solved
   there.
4. **Scripts** — keep the current report-only `"qa"` command working, then add a
   capture command such as `"qa:capture": "tsx tools/qa_capture.ts …"` and
   `"qa:update-baselines": "… --update-baselines"` when browser capture lands.
5. **Reports & baselines** — same JSON/MD schema and `baselines.json` manifest so
   a regression reads identically across both repos. clod-poc's `.gitignore` is
   tiny; apply the same smoke-baseline policy.
6. **Shared report schema is the contract.** The only thing that must stay in
   lockstep between Rust and TS is the `qa-report.json` schema + the
   `qa_visual.yaml` shape. Pin both with `schema_version` and a short
   `docs/qa/schema.md`.

clod-poc already has `vitest`; add unit tests for the diff/probe/timing pure
functions there too.

---

## 13. Acceptance criteria (from the brief)

YAML config loads; invalid config fails usefully; existing bench/visual-regression
still works; QA produces `qa-report.json` + `qa-report.md`; image diff works vs
baselines; missing-baseline behaviour is config-controlled; region_luminance,
region_variance, pixel_luminance all work; timing thresholds in report; correct
process exit code; docs explain run + extend; unit tests cover pure logic; **no
gameplay path pays QA cost.**

## 14. Design constraints

Typed errors everywhere; no `unwrap`/`expect` outside tests; `[QA]` logging that
the reports never depend on; small single-responsibility files; no heavy new
deps (`image` already present on Rust; `js-yaml` already present on clod-poc;
justify `serde_yaml` and `playwright`/`pngjs` in the final summary); source
comments document durable invariants only, not this design.

---

## 15. Suggested execution order

1. Phase 2 config + errors + validation (+ `serde_yaml` decision) -> tests. Done in v1.
2. Phase 4 image_diff -> tests. Done in v1.
3. Phase 5 probes -> tests. Done in v1.
4. Phase 6 timing (decide p95 field) -> tests. v1 maps frame checks to existing `p99_frame_ms`; p95 remains deferred.
5. Phase 3 report (JSON + MD) -> round-trip test. Done in v1.
6. Phase 7 runner (strategy A binary) -> one lightweight pass. v1 consumes an existing `summary.json`; bench spawning is deferred.
7. Phase 8 baselines + manifest + `.gitignore` policy.
8. Phase 9 docs (`STATUS.md`, `visual-qa.md`).
9. Phase 10 ship the three bug probes against real checkpoints.
10. Phase 12 clod-poc port (hooks → tools → qa.ts), reusing schema.

Each phase: land code + tests behind the opt-in flag; the bench and `bench_guard`
must stay green throughout.
