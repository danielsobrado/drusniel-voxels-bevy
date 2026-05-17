# Autonomous Performance Loop — Implementation Brief

**Audience:** an AI coding agent picking this up cold.
**Goal:** turn `drusniel-voxels` into a project where another agent (or the same one in a `/loop`) can run `cargo run --release -- --bench …`, read a JSON summary, decide what's slow, propose and apply a fix, re-run, and converge on a faster build — without a human in the path except for visual regression sign-off.

This document is the **single source of truth**. Read it end to end before writing code. Do not skim. The order of phases matters; later phases depend on earlier ones being correct.

---

## 1. Project context (read first)

You are working in a Bevy 0.18 voxel engine at `c:\Development\workspace\GitHub\drusniel-voxels` (Windows 11, PowerShell). The project uses:

- Forward rendering (deferred / SSR disabled — bind-group limits).
- `bevy_water 0.18.1` for water — do **not** fork it.
- Custom materials (`BlockyMaterial`, `TriplanarMaterial`, `BuildingMaterial`, `PropsMaterial`) using `#{MATERIAL_BIND_GROUP}` in WGSL.
- Target hardware: RTX 40xx primary, integrated-GPU fallback via `GraphicsCapabilities::integrated_gpu`.
- An in-flight set of optimizations (greedy water meshing, double-buffered displacement, throttled LOD, parallelized voxel scheduling, shader fast-paths) — most uncommitted on `main`.

### Bevy 0.18 API gotchas (these will trip you up)

- `Query::single()` / `single_mut()` — not `get_single()`.
- `bevy::camera::*` — not `bevy::render::camera`.
- `bevy::camera::visibility::RenderLayers` — moved in 0.17.
- `bevy::shader::Shader` — not `bevy::render::render_resource::Shader`.
- `RenderSystems::PrepareResources` — was `RenderSet::PrepareResources`.
- `RenderGraphExt` trait, `ViewNode` for post-process.
- `BindGroupLayoutDescriptor::new()` + `pipeline_cache.get_bind_group_layout(&desc)`.
- `RenderPassColorAttachment` requires `depth_slice: None`.
- `QueryItem<'w, '_, Q>` takes 2 lifetimes.
- `FrameCount` lives in `bevy::diagnostic`.
- The screenshot API has moved between 0.13 and 0.18; verify the exact symbol in the locked Bevy source before using it.

Three independent shader-pipeline-validation incidents have already happened in this codebase due to hardcoded `@group(2)` instead of `#{MATERIAL_BIND_GROUP}`. Do not introduce a fourth.

### What "fog is heavy" actually means

There are four effects called "fog":

1. `DistanceFog` — cheap.
2. `VolumetricFog` + `FogVolume` — **the expensive one**, ~32-step raymarch sampling cascaded shadows + 3D dust noise per step.
3. Screen-space god rays (`src/rendering/god_rays.rs`) — secondary cost.
4. CPU `indoor_density_boost` — negligible.

The config file at `assets/config/fog.yaml` literally says "Drops FPS from 40-50 to ~10 FPS." This is the dominant cost target. The autonomous loop must be able to identify and act on it without being told.

---

## 2. What you are building

A four-phase implementation. Each phase ends in a runnable, verifiable artifact. **Do not start a phase until the previous phase passes its "Done means" checklist.**

| Phase | Output | Done means |
|---|---|---|
| **A** Telemetry | F3 overlay shows per-area frame breakdown; F4 dumps CSV; `--features tracy` builds and connects | The user can read where time is spent in any frame |
| **B** Bench harness | `cargo run --release -- --bench <scene.toml>` runs scripted camera, dumps `summary.json` per checkpoint | A second invocation of the same scene reproduces median frame time within ±10% |
| **C** Fog cleanup | `FogQuality { Off, Low, Medium, High }` resource, default `Medium`, integrated-GPU auto-`Off`, night gating, throttled atmosphere update | Bench against `bench/scenes/visual/fog-tiers.toml` shows monotonic `Volumetric Fog` cost decrease across tiers |
| **D** Autonomous loop driver | `tools/perf-loop/` Rust (or Python) script that runs the bench, parses `summary.json`, selects the hottest area against a rule table, opens a branch, applies a candidate fix, re-runs, commits if faster, reverts if not | Running `tools/perf-loop --budget 10` produces 0–10 commits, each with a measurable improvement, and a `loop-report.md` |

Phases A → B → C are linear. Phase D consumes A and B; it does not require C to be merged but works better with it as a smoke test.

---

## 3. Phase A — Telemetry

### 3.1 Audit existing instrumentation

The project already has `AreaTimingRecorder` and an `area_timer(...)` RAII helper in `src/performance/`. Read that module first; do **not** introduce a new framework. Extend it.

Confirm or add `area_timer` calls in these systems (one short, stable name per area):

| File | System | Suggested area name |
|---|---|---|
| `src/voxel/plugin.rs` | `mesh_dirty_chunks_system` | `Mesh Dirty` |
| `src/voxel/plugin.rs` | `update_chunk_lod_system` | `LOD Update` |
| `src/voxel/plugin.rs` | `update_octree_system` | `Octree Rebuild` |
| `src/voxel/plugin.rs` | `update_visible_chunks_system` | `Visible Chunks` |
| `src/voxel/plugin.rs` | `update_chunk_face_visibility_system` | `Face Visibility` |
| `src/vegetation/mod.rs` | `collect_grass_instances` and animate systems | `Grass Collect`, `Grass Animate` |
| `src/rendering/water_displacement.rs` | step + upload | `Water Sim`, `Water Upload` |
| `src/rendering/water_reflection.rs` | reflection camera systems | `Reflection Render` |
| `src/atmosphere/fog.rs` | `update_fog_from_atmosphere` | `Fog Update` |
| `src/rendering/god_rays.rs` | post-process node | `God Rays` |
| `src/props/` | spawning + billboard | `Prop Spawn`, `Prop Billboard` |
| `src/physics/terrain_collider.rs` | (already instrumented) | `Collider Build` |

For volumetric fog itself, you cannot wrap Bevy's render-graph node from a system. Instead:

- Add a CPU-side `Fog Submit` area_timer covering the work in `update_fog_from_atmosphere`.
- For GPU-side cost, rely on Tracy (see §3.4) — Bevy's `RenderDiagnosticsPlugin` exposes per-pass GPU spans visible in Tracy. Document this in `loop-report.md`.

### 3.2 F3 overlay

Extend the F3 debug overlay (gated by `DebugOverlayState.visible` in `src/interaction/debug.rs`) with a sorted table:

```
Area                Avg ms   Max ms   p99 ms   Calls
Volumetric Fog       6.10     7.23     7.05      1
Mesh Dirty           3.21    18.42     9.10      1
Reflection Render    2.10     2.40     2.35      1
…
Frame total         16.40    22.10    18.90
```

- Rolling 60-frame window for averages and p99.
- Sort descending by avg ms.
- Frame total at the bottom uses Bevy's `FrameTimeDiagnosticsPlugin`.
- Show GPU frame time if available; otherwise omit the column rather than show `0.0`.

### 3.3 F4 CSV dump

Bind **F4** (verify free in the existing keymap; pick another free key if not) to dump the current rolling window as CSV to `./perf-dumps/frame-<UTC-iso8601>.csv`:

```
area,avg_ms,max_ms,p99_ms,calls_per_frame
Volumetric Fog,6.10,7.23,7.05,1.0
Mesh Dirty,3.21,18.42,9.10,1.0
…
__frame_total,16.40,22.10,18.90,1.0
```

The `__frame_total` row is conventional (leading underscore so it sorts first when needed) and required — Phase B and Phase D both parse it.

Print the absolute file path to stdout after writing. Phase B's harness reuses this writer verbatim; do not change the format later.

### 3.4 Tracy feature

Add a `tracy` feature in `Cargo.toml` that enables Bevy's tracing feature. The exact feature name in 0.18 is `trace_tracy` — verify against the locked source before committing. Document the build command in a one-line comment above the `[features]` block:

```toml
# cargo run --release --features tracy   # then connect Tracy 0.11.x
```

Do **not** make `tracy` a default feature.

### 3.5 README entry

Add a short "Profiling" section to `README.md`: F3 to view, F4 to dump, `--features tracy` for capture.

### 3.6 Phase A — Done means

- `cargo check --workspace` clean.
- `cargo run --release` boots; F3 toggles the table; F4 writes a parseable CSV containing every area listed in §3.1 plus `__frame_total`.
- `cargo build --release --features tracy` succeeds. (You don't need to actually capture in Tracy — just prove the feature compiles.)
- A 6-line note in the PR listing every instrumented area, the F4 keybinding chosen, the Tracy feature name, and one example CSV row.

---

## 4. Phase B — Bench harness

### 4.1 CLI

Add (or reuse if already present) `clap` and parse:

- `--bench <path>` — path to a TOML scene file. Activates bench mode.
- `--bench-out <dir>` — output directory (default `bench-runs/<timestamp>/`).
- `--bench-headless` — best-effort offscreen rendering. If the platform/back-end won't allow it cleanly, log a single warning and fall back to windowed; document in PR.
- Without `--bench`: behaviour unchanged.

### 4.2 Scene file format

TOML, hand-editable. Place a working example at `bench/scenes/visual/default.toml`:

```toml
seed = 12345
duration_warmup_secs = 3.0
median_runs = 3
chunk_load_radius = 6              # chunks around the camera that must be ready before measuring

[[checkpoint]]
name = "spawn-noon"
position = [0.0, 30.0, 0.0]
look_at = [10.0, 25.0, 10.0]
time_of_day = 0.5
hold_frames = 240
screenshot = true
# fog_tier optional — applied via FogQuality resource if Phase C has landed; ignored with a warning otherwise

[[checkpoint]]
name = "forest-sunset"
position = [128.0, 28.0, 64.0]
look_at = [148.0, 26.0, 84.0]
time_of_day = 0.85
hold_frames = 240
screenshot = true
```

A second scene `bench/scenes/visual/fog-tiers.toml` visits one fixed location with `fog_tier` cycling `high → medium → low → off`. This is the smoke test for Phase C.

### 4.3 Bench plugin

New module `src/bench/mod.rs`. Plugin `BenchPlugin` is added to the app **only** when `--bench` is parsed. The plugin:

1. Replaces normal `PlayerSpawnPlugin` behaviour: spawns a free camera at the first checkpoint, no controller, no physics body, no input handlers.
2. Forces deterministic state when `--bench` is active:
   - `vsync = false`
   - `Time::set_max_delta` to a small fixed value (e.g. 100 ms) so a hitch can't spike `delta_secs`.
   - World seed = scene file's `seed`.
   - `AtmosphereSettings::cycle_enabled = false` (the runner sets time directly).
3. Disables menus, toasts, debug input handlers — the bench owns the camera; user input must not move it.
4. Runs a state machine:

```
Warmup (duration_warmup_secs)
  └─> RunCheckpoint(i)
        ├─ snap camera (position + look_at)
        ├─ set AtmosphereSettings::time
        ├─ apply fog_tier if FogQuality resource exists, warn otherwise
        ├─ wait for chunks within chunk_load_radius to be Ready
        ├─ wait settle_frames (= 30) for transients
        ├─ reset AreaTimingRecorder rolling window
        ├─ hold hold_frames while accumulating
        ├─ dump CSV: <scene>-<checkpoint>-run<N>.csv
        ├─ if screenshot: capture swapchain to <scene>-<checkpoint>-run<N>.png
        └─ repeat median_runs times
  └─> AdvanceCheckpoint
…
Done → write summary.json → exit(0)
```

Use Bevy 0.18's `ScreenshotManager` (verify exact symbol). On screenshot failure, log a warning, continue, set `"screenshot": null` for that run in `summary.json`.

For "wait for chunks ready," do **not** wait on `ChunkGenerationState::is_complete` (the world is too big — never completes). Walk the chunks within `chunk_load_radius` of the camera and check `ChunkState::Ready` (or whatever the equivalent is in `src/voxel/world.rs`).

### 4.4 summary.json

Schema (this is the **stable contract** Phase D reads — do not change without bumping a version field):

```json
{
  "schema_version": 1,
  "scene": "default.toml",
  "seed": 12345,
  "git_sha": "3e0ad22",
  "git_dirty": true,
  "build_profile": "release",
  "platform": "windows",
  "bevy_version": "0.18.x",
  "run_started_utc": "2026-05-01T12:34:56Z",
  "duration_secs": 42.7,
  "checkpoints": [
    {
      "name": "spawn-noon",
      "fog_tier": "high",
      "median_frame_ms": 14.20,
      "p99_frame_ms": 18.70,
      "areas": {
        "Volumetric Fog": {"median_ms": 6.10, "p99_ms": 7.20, "calls_per_frame": 1.0},
        "Mesh Dirty":     {"median_ms": 0.40, "p99_ms": 1.10, "calls_per_frame": 1.0}
      },
      "runs": [
        {"frame_ms_median": 14.10, "csv": "default-spawn-noon-run0.csv", "screenshot": "default-spawn-noon-run0.png"},
        {"frame_ms_median": 14.30, "csv": "default-spawn-noon-run1.csv", "screenshot": null},
        {"frame_ms_median": 14.20, "csv": "default-spawn-noon-run2.csv", "screenshot": "default-spawn-noon-run2.png"}
      ]
    }
  ]
}
```

`git_sha` and `git_dirty` come from running `git rev-parse HEAD` and `git status --porcelain` at startup. If git is not present, set both to `null`.

### 4.5 README entry

Add a "Benchmarking" subsection under "Profiling":

```
cargo run --release -- --bench bench/scenes/visual/default.toml
# Output: bench-runs/<timestamp>/summary.json + per-checkpoint CSV + screenshots
```

### 4.6 Phase B — Done means

- `cargo run --release -- --bench bench/scenes/visual/default.toml` exits 0 and produces a complete `summary.json` with one entry per checkpoint, all `median_frame_ms` numeric (no `null`s), `__frame_total` row present in every CSV.
- Two consecutive runs against the same scene file produce median frame ms within ±10% per checkpoint (the determinism check). If not, document the residual nondeterminism source in the PR — do not paper over it.
- Without `--bench`, the game boots normally — full regression check.
- PR includes the actual `summary.json` from a real run, pasted inline.

---

## 5. Phase C — Fog cleanup

This is a bonus phase included so Phase D has a non-trivial smoke target. **Implement only after Phase B passes.** The full design is in the conversation history; the short version:

- New resource `FogQuality { tier: FogQualityTier }` with `enum FogQualityTier { Off, Low, Medium, High }`. Default `Medium`. Persisted via existing `src/menu/settings_persistence.rs` pattern with a `user_override: bool` flag.
- Tier → `(step_count, dust_enabled, volume_size)`:
  - `Off`: VolumetricFog component removed entirely.
  - `Low`: 8, false, 256.
  - `Medium`: 16, false, 384.
  - `High`: 32, true, 512.
- Tier overrides preset `step_count_override`. Document in `assets/config/fog.yaml` and the Rust default impl.
- Startup gate: if `GraphicsCapabilities::integrated_gpu` and `!user_override`, force `tier = Off`, log once.
- Time-of-day gate: when `daylight < 0.05 && twilight < 0.05`, remove `VolumetricFog` from camera. Re-add when gate flips. 2 s hysteresis to prevent flapping.
- Throttle `update_fog_from_atmosphere` to 10 Hz via `Local<f32>` accumulator. Adjust the smoothing lerp coefficient by actual elapsed-since-last-run, not `time.delta_secs()`.
- Reduce `indoor_density_boost` from 9 samples × 32 voxels to 5 samples × 16 voxels.
- Settings UI dropdown + F3 overlay row showing `Fog tier: <tier> (auto|user)` and `VolumetricFog: ON|OFF (<reason>)`.

Default `current_preset` in `assets/config/fog.yaml` changes from `god_rays` → `balanced`.

### 5.1 Phase C — Done means

- Bench `cargo run --release -- --bench bench/scenes/visual/fog-tiers.toml` runs to completion. The resulting `summary.json` shows monotonic `Volumetric Fog` cost decrease across `high → medium → low → off`. If it doesn't, the tier plumbing is broken — fix it, do not ship.
- Three screenshots (noon outdoors, sunset outdoors, indoors with sunbeams) at default tier `Medium` show fog still reads as fog.
- Forcing `GraphicsCapabilities::integrated_gpu = true` (temporary patch — revert before commit) auto-disables fog and the F3 overlay reflects this.

---

## 6. Phase D — Autonomous loop driver

This is the headline deliverable. A standalone tool at `tools/perf-loop/` that drives the build → bench → analyze → patch → re-bench → commit-or-revert cycle.

**Implementation language:** Rust, in its own Cargo workspace member, so the loop binary doesn't add deps to the game. Acceptable alternative: Python 3.11+ in `tools/perf-loop/main.py` — pick one and stick with it. Do not produce both.

### 6.1 Invocation

```
tools/perf-loop --budget 10 --scene bench/scenes/visual/default.toml --baseline-runs 3
```

Flags:

| Flag | Meaning | Default |
|---|---|---|
| `--budget N` | Max iterations before stopping | 5 |
| `--scene <path>` | Bench scene to drive each iteration | `bench/scenes/visual/default.toml` |
| `--baseline-runs N` | Run baseline this many times before iteration 1 to establish noise floor | 3 |
| `--target-area <name>` | If set, optimize only this area; otherwise pick hottest by avg cost rank | unset |
| `--min-improvement-ms <f>` | Minimum frame_ms median improvement to accept | 0.5 |
| `--branch <name>` | Branch to work on | `perf/auto-<utc>` |
| `--dry-run` | Skip git ops, print decisions | false |
| `--max-frame-ms-regression <f>` | Auto-revert if any non-target area regresses more than this | 0.3 |

### 6.2 Loop body

```
0. Verify clean working tree. If dirty, abort with "commit or stash first".
1. Create branch <branch>.
2. Run baseline: invoke `cargo run --release -- --bench <scene>` `baseline_runs` times.
   Record median_frame_ms per checkpoint, per area; this is the noise floor.
3. for i in 1..=budget:
     a. Pick target area:
          - if --target-area is set: that area
          - else: highest median_ms across all checkpoints whose value > 1.0 ms
            and which is not on the do-not-touch list (see 6.4)
     b. Look up the rule table (6.5) for that area. If no rule, log
        "no candidate fix for <area>; stopping." and exit 0.
     c. Apply the candidate patch (one of: edit a YAML/TOML file, flip a const,
        change a system schedule, toggle a config field). Each rule has a
        deterministic, idempotent patch function.
     d. `cargo build --release` — if it fails, revert the patch, mark this
        rule as exhausted for this area, retry step b.
     e. Run `cargo run --release -- --bench <scene>`.
     f. Compare new summary.json against the previous one (the rolling
        baseline, updated only on accepted commits):
          - target area median_ms decrease >= min-improvement-ms? else revert.
          - any other area median_ms increase > max-frame-ms-regression?
            then revert.
          - frame_ms median improvement net positive? else revert.
        On revert: `git checkout -- .` and mark this (rule, area) as exhausted.
     g. On accept: commit with a generated message
        "perf(<area>): <rule.short_name> (-X.XX ms median)".
        Update rolling baseline to the new summary.json.
4. Write loop-report.md (6.6).
5. Exit 0.
```

### 6.3 What the loop is **not**

It is not allowed to:

- Write new shaders or modify WGSL.
- Change render-graph topology.
- Add or remove crates.
- Touch any file under `src/bench/` or `src/performance/` (avoid measuring with a moving ruler).
- Run for more than 30 minutes wall-clock without `--budget` permission.
- Push, force-push, open PRs, or modify remotes. Local commits on a local branch only.

If a rule's patch would cross any of these lines, the rule is invalid — fix the rule table, don't extend the loop.

### 6.4 Do-not-touch area list

These areas are skipped by the auto-picker (still measured, never targeted):

- `__frame_total` — meta, not a system.
- `Fog Submit` — only the GPU-side `Volumetric Fog` cost is meaningful and the loop can't see that without Tracy, which is out of scope for D.
- `Reflection Render`, `God Rays` — touching these requires shader / render-graph work the loop is forbidden from doing. Phase D defers them to future humans.

### 6.5 Rule table

Encoded as a static table in the loop tool. Each rule:

```
Rule {
    area: "Volumetric Fog",
    short_name: "step_count_down",
    description: "Lower FogQuality tier by one step",
    patch: fn(workspace) -> Result<Patch>,
    revert: fn(workspace, patch) -> Result<()>,
    max_applications: 3,
}
```

Concrete starter rules (extend with care; every new rule must have a deterministic revert):

| Area | Rule short_name | Patch |
|---|---|---|
| `Volumetric Fog` | `step_count_down` | Lower `FogQuality` default tier by one (High→Medium→Low→Off). Stops when `Off`. |
| `Mesh Dirty` | `lower_meshing_throttle` | Reduce `MAX_CHUNKS_MESHED_PER_FRAME` const by 25% (floor 1). |
| `LOD Update` | `lengthen_throttle` | Increase the `update_chunk_lod_system` throttle interval by 50% (cap 1.0 s). |
| `Octree Rebuild` | `disable_when_culling_off` | If `OcclusionConfig::enabled == false`, ensure the system early-returns (verify it already does; if it does, mark exhausted). |
| `Grass Animate` | `halve_update_rate` | Throttle to every Nth frame; N starts at 2, doubles each application up to 8. |
| `Water Sim` | `lower_grid_size` | Halve `GRID_SIZE` (256→128→64). Stops at 64. |
| `Prop Spawn` | `lower_prop_density` | Reduce per-chunk prop density multiplier by 25% (floor 0.25). |

For each rule: write a unit test that applies and reverts the patch on a fixture file, verifying byte-for-byte equality. The loop must pass these tests in CI before being trusted with the live workspace.

### 6.6 loop-report.md

Generated at the end of the run, committed to the branch root:

```markdown
# Perf loop report

- Branch: perf/auto-2026-05-01T12-34-56Z
- Scene: bench/scenes/visual/default.toml
- Budget: 10, used: 4
- Baseline median frame ms: 16.40
- Final median frame ms:    11.20  (-5.20 ms, -31.7%)

## Iterations

| # | Area | Rule | Δ frame ms | Δ area ms | Decision | SHA |
|---|------|------|-----------|-----------|----------|-----|
| 1 | Volumetric Fog | step_count_down | -3.10 | -2.90 | accept | abc123 |
| 2 | Mesh Dirty     | lower_meshing_throttle | -0.10 | -1.20 | accept | def456 |
| 3 | Mesh Dirty     | lower_meshing_throttle | +0.20 | -0.30 | revert (other area regressed) | — |
| 4 | LOD Update     | lengthen_throttle | -2.00 | -1.80 | accept | ghi789 |

## Areas remaining > 1ms

- Reflection Render: 1.9 ms (skipped — do-not-touch)
- Grass Collect:     1.4 ms (no rule)

## Suggested next humans-only steps

(populated from area names without rules)
```

### 6.7 Phase D — Done means

- `cargo test -p perf-loop` (or `pytest tools/perf-loop/`) passes — every rule's patch+revert cycle is tested.
- A real invocation with `--budget 5 --dry-run` against the current `main` produces a plausible `loop-report.md` (no commits made).
- A real invocation without `--dry-run`, `--budget 3`, branches off main, makes 1–3 commits each with a measurable improvement, writes `loop-report.md`, and exits 0.
- Every commit message follows the format `perf(<area>): <rule.short_name> (-X.XX ms median)`.
- The loop never deletes or rewrites a measurement file (`bench-runs/`, `perf-dumps/`).

---

## 7. Cross-phase constraints

These apply to every phase. Violating any of them invalidates the work.

- **Bevy 0.18 only.** Don't paste from 0.13–0.17 examples; the rendering APIs churn between every minor version.
- **No emojis** in code, comments, output, files, commit messages, or PR text.
- **Minimal comments.** Only document the *why* for non-obvious choices (the 5/6 ray heuristic, the 30-frame settle, the 10 Hz throttle). Never narrate the *what*.
- **No backwards-compat shims.** No `_var` placeholders, no `// removed` breadcrumbs, no re-exports of deleted types, no feature flags for "old vs new" paths beyond what's explicitly required (`tracy`).
- **No new third-party rendering crates.** The project owns its render code.
- **No mocks for things that exist.** Tests hit real files, real cargo, real git. The loop's rule tests use real fixture copies.
- **Test by running.** `cargo check` is necessary, not sufficient. Every phase's "Done means" requires an actual run with output captured.
- **Don't fork bevy_water or Bevy's volumetric fog.** That's a separate, larger project explicitly out of scope here.
- **PowerShell-aware paths.** Output paths are written with forward slashes inside the binary; file existence checks must work on Windows. Don't hardcode `/tmp` or POSIX assumptions.
- **Do not push, do not open PRs, do not modify remotes.** All work is on local branches. The human reviews and pushes manually.
- **Atomic commits per phase.** Phase A is one PR (or one logical commit series). Phase B is the next. C, then D. Do not interleave.

---

## 8. What you do **not** do

Hard exclusions. If you find yourself drifting toward any of these, stop and re-read this brief.

- Do not implement GPU instancing for props (separate task).
- Do not modify `bevy_water` or fork it.
- Do not write a custom volumetric fog renderer.
- Do not add CI/GitHub Actions integration (no GPU runner story).
- Do not implement image-based visual regression — screenshots are captured for human review.
- Do not add Prometheus / OpenTelemetry / HTTP exporters; output is local files only.
- Do not add a "smart AI patch generator" to Phase D. The rule table is hand-written. The loop is dumb on purpose — that's what makes it auditable.
- Do not extend the loop to drive multiple machines, cloud runs, or parallel branches.
- Do not modify keybindings beyond F4 (and document if F4 was already taken).

---

## 9. Order of operations and stop conditions

1. Read this file and `docs/performance-analysis-research.md`. Read `src/performance/`, `src/atmosphere/fog.rs`, `src/voxel/plugin.rs`, `assets/config/fog.yaml`. Time budget: 30 min. If anything in this brief contradicts what you observe in the code (e.g. `area_timer` is structured differently than described), trust the code and adapt — flag the discrepancy in the PR.
2. Implement Phase A. Validate by running and inspecting CSV output. Commit. Stop here and surface the diff for review before continuing — the user may have feedback that changes B/C/D.
3. Implement Phase B. Validate two-runs-within-10%. Commit. Surface for review.
4. Implement Phase C. Validate against `bench/scenes/visual/fog-tiers.toml`. Commit. Surface for review.
5. Implement Phase D. Run `--dry-run` against `main`, then a real `--budget 3` run, attach `loop-report.md` to the PR.

**Stop and ask for guidance** if any of these happens:

- A required Bevy 0.18 API symbol can't be found (the API surface for screenshots, render graphs, or `RenderSystems` has churned and your understanding may be stale).
- The two-runs-within-10% determinism check fails by more than 25%. Don't paper over it.
- A rule table patch can't be written idempotently (e.g. the constant it would change has been moved to a settings file in flight).
- The bench harness can't establish a "chunks ready" signal cheaply — there may be no public API for it and you may need to add one.

---

## 10. Deliverables (final)

When all four phases are done, the workspace contains:

- `src/performance/…` — extended timing, with p99 percentile tracking.
- `src/interaction/debug.rs` — F3 overlay table, F4 dump, fog tier display.
- `src/bench/` — bench plugin, scene loader, screenshot, summary.json writer.
- `bench/scenes/visual/default.toml`, `bench/scenes/visual/fog-tiers.toml`.
- `src/atmosphere/fog.rs` + `src/atmosphere/config.rs` + `assets/config/fog.yaml` — `FogQuality`, gating, throttling.
- `src/menu/settings.rs` + `src/menu/settings_persistence.rs` — fog quality dropdown.
- `tools/perf-loop/` — the loop driver, with rule table, tests, and CLI.
- `Cargo.toml` — `tracy` feature, possibly `clap` dep.
- `README.md` — Profiling and Benchmarking sections.
- `docs/autonomous-perf-loop.md` — this file, untouched by the implementation.
- `loop-report.md` — at the root of the perf branch after a real Phase D run.
- `bench-runs/<timestamp>/summary.json` + CSVs + screenshots — at least one real run committed to demonstrate the harness works.

The user's only manual step in the long-term loop is: glance at the screenshots, accept or reject the visual change, push the branch.

