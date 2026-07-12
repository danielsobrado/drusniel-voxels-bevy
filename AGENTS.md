# Agent Instructions

Keep changes surgical, simple, and verified. This repo has an active rendering/performance workflow, so profiling is part of implementation whenever a change can affect frame timing or visuals.

Use `$godogen` to generate or update this Bevy game from a natural-language description.

## Documentation Dates

- New Markdown documentation files must include their creation date as a `-YYYY-MM-DD.md` filename suffix so age is visible from the filename alone.
- Exempt fixed-name convention and control files such as `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and generated reports whose names are defined by tooling.
- Do not rename existing undated documentation only to satisfy this rule. When replacing an old dated document, create a new file with the current creation date; do not change the date for minor edits.

## Shell Rules

- Always prefix shell commands with `rtk`.
- Byte-cap commands with unknown or potentially large output, for example:

```powershell
rtk cargo test 2>&1 | head -c 4000
```

- Useful wrappers:

```powershell
rtk --version
rtk gain
rtk gain --history
rtk proxy <cmd>
```

Do not invent project commands. If a new command is needed, add it to the Makefile via PR.

## Standard Commands

```powershell
rtk make dev          # Start local development environment
rtk make test         # Run full test suite
rtk make lint         # Run Go and TypeScript linters
rtk make reconcile    # Run reconciliation harness against Power BI
rtk make build        # Build production artifacts
```

## Profiling

Profile any change that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing.

Do not run visual benches from WSL. This includes visual-regression, screenshot, and startup visual-stability bench scenes. Use a native Windows shell for those runs, or report that visual benches were not run because the current environment is WSL.

Expected workflow:

1. Run a baseline bench for the relevant scene.
2. Make the change.
3. Re-run the same bench scene.
4. Compare `bench-runs/<run>/summary.json`, screenshots, counters, and timing rows.
5. Report measured wins and regressions plainly. Do not add broad timing rows together; some overlap.

Use release benches for performance claims:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
```

Common A/B scenes:

- `bench/scenes/visual/visual-regression-high.toml`
- `bench/scenes/visual/visual-regression-performance100.toml`
- `bench/scenes/visual/visual-regression-live-lod.toml`

Run the regression guard when touching known bottlenecks:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

If a visual change improves performance but regresses screenshots, document the intentional tradeoff. If a performance-sensitive change was not profiled, say so explicitly.

Outside bench mode, `VOXEL_RENDER_TIMING=1` enables equivalent render timing capture in the debug timing CSV.

## clod-poc QA

For `tools/clod-poc` web changes, run the Node/Vite checks plus the web QA harness when behavior, visuals, frame timing, CLOD selection, or WebGPU compute changes.

> ⚠️ **Do NOT run the Vite-based commands through `rtk`.** `rtk` breaks Vite tooling: `vitest` reports `TypeError: Cannot read properties of undefined (reading 'config')` (all suites collect 0 tests) and `vite build` fails with `[vite:html-inline-proxy] No matching HTML proxy module found`. The exact same commands pass when run directly. This is silent and looks like a code/dependency bug — it is not. Run `vitest`/`vite build` (and `qa`, which builds) **without** `rtk`. Plain `tsc` typecheck is fine either way. If the dev server is left running it locks `node_modules/@rollup/*.node` and `node_modules/.vite`; stop it before `npm ci`.

```powershell
# typecheck (tsc, no Vite) — rtk is fine:
rtk npm --prefix tools/clod-poc run typecheck
# Vite-based — run WITHOUT rtk:
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
```

The QA runner consumes a captured web summary JSON and writes `qa-report.json` / `qa-report.md` under `tools/clod-poc/qa-runs` by default. The sample summary is a smoke test only; for visual or performance claims, use a summary captured from the relevant browser scenario.

For infinite-islands browser acceptance, prefer the single-page reuse profile so the runner does not reboot the scene for every gate/pose:

```powershell
npm --prefix tools/clod-poc run accept:infinite-islands -- --reuse
```

The generated report records both `configured_world_pages` and `startup_world_pages`; full acceptance currently means the full scene/gate set, not necessarily a full-size startup world.

For the current high-load CLOD/WebGPU selection scenario, start clod-poc and verify:

```text
http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1
```

### clod-poc Deterministic Performance Process

For clod-poc frame-time, WebGPU compute, vegetation, terrain material, postprocess, water, shadow, or CLOD-selection changes, use the perf harness instead of manual FPS checks.

1. Start the dev server directly, not through `rtk`:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

2. Run a baseline and changed case with the same world, scene, warmup, and frame count. Use `rtk cmd /c` only to set `CLOD_POC_BASE_URL` for the Node tool:

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 120 --frames 300 --case current-textured --out perf-runs/baseline"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 120 --frames 300 --case current-textured --out perf-runs/after"
```

3. For tree/vegetation regressions, run a focused A/B scene:

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 120 --frames 300 --case current-textured --params scene=trees-perf,treeGpu=0 --out perf-runs/tree-cpu"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 600 --frames 300 --case tree-gpu-ring --params scene=trees-perf --out perf-runs/tree-gpu"
```

Use longer warmup such as `--warmup 600` when WebGPU compute pipelines, indirect draws, or debug readbacks are involved; first-run async pipeline compilation can otherwise pollute the sample window.

4. Compare `tools/clod-poc/perf-runs/<run>/summary.md` and `summary.json`. Report `frameMs` p50/p95, `renderMs` p95, the top phase/prop bucket, and relevant counters such as tree GPU status, visible count, LOD distribution, dispatch timing, triangles, and rendered count. Do not claim a performance fix from FPS alone.

### clod-poc Shot Harness, Hooks, And Deterministic Scenes

For deterministic clod-poc browser verification, use the Phase-0/Phase-1 shot harness instead of ad hoc screenshots.

Start the dev server first:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1
```

Then run shots with the configured Vite URL. Keep Vite-based commands direct, not through `rtk`; using `rtk cmd /c` only sets the environment for the Node tool:

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene sanity --seed 1 --freeze 1 --hud 1 --framealign 0 --out shots/phase-0/sanity.png --stats shots/phase-0/sanity-stats.json"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug final --freeze 1 --hud 1 --framealign 0 --out shots/phase-1/terrain-final.png --stats shots/phase-1/terrain-stats.json"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run battery"
```

The app exposes `window.__drusnielClod` for tooling:

- `ready` / `error`: shot harness waits for one of these before capture.
- `diag`: WebGPU adapter/features/limits from fail-loud boot diagnostics.
- `stats`: FPS, frame time, draw calls, triangles, counters, and GPU pass timing.
- `setPose(pose)` / `getPose()`: stable camera control. Pose shape is `{ p: [x, y, z], yaw, pitch, fov? }`.
- `settle(frames)`: wait deterministic frames before screenshots.
- `flyCamEnabled(on)`: disable interactive fly input when tooling drives the camera.

Gated WebGPU scenes must call the browser gate and diagnostics before renderer/world work. Unsupported browser/GPU paths must use `failLoud()` and set `window.__drusnielClod.error`; do not silently fall back to WebGL in `scene=sanity` or `scene=phase1-terrain`.

Use deterministic URLs for reproducible captures:

- Phase 0: `?scene=sanity&seed=1&freeze=1&hud=1`
- Phase 1: `?scene=phase1-terrain&seed=1&world=8&terrainGrid=2048&terrainDebug=lod&freeze=1&hud=1`

Always report the generated `shots/.../*.png` and `*-stats.json` counters when making visual, CLOD selection, WebGPU, or frame-timing claims.

## NAADF Benches

For NAADF preview or GI changes, measure startup visual stability:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

Inspect staged screenshots (`settle-120`, `settle-240`, `settle-360`, `settle-540`, `settle-720`, `settle-899`, `settle-1200`, `settle-1499`) and report the first `frame`/`elapsed_secs` where the image is fully textured, not the blue silhouette or early occupancy preview. Include `ready_wait_secs`, `render_ready_secs`, NAADF preview counters, and startup trace phase CSVs. Runtime readiness alone does not prove texture stability.

For NAADF-only preview performance, run:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
```

That scene disables legacy terrain, water, buildings, shadows, reflections, and prop queues.

## Collider And Runtime Lock

When changing spawn placement, player movement, terrain colliders, terrain readiness, or fall-through guards, run:

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/collider-walk-log.toml
```

This logs player coordinates, validity, collider readiness, stall/fall-through events, dig/crust rejection counters, and route behavior.

Runtime, editor viewport, and bench launches share one runtime lock by default. Use `DRUSNIEL_BENCH_RUNTIME_LOCK` only when an isolated bench lock is intentional.

## Compile-Time Notes

- Keep `.cargo/config.toml` `sccache` unless diagnosing compiler-wrapper issues.
- Keep Bevy `dynamic_linking` and dev profile optimizations for normal local iteration.
- Do not add nightly-only compile accelerators by default.
- If changing linker, debug-info, or profile settings, verify the exact Windows command and document the tradeoff. Do not make shipping/release claims from dynamic-linking dev builds.

## Editor Verification

Rebuild the editor runtime sidecar and restart the desktop editor only for editor-facing changes: editor UI, Tauri integration, bridge/protocol, native viewport behavior, sidecar packaging, or tasks explicitly requiring desktop-editor verification.

Main runtime, rendering, meshing, benchmark, and gameplay diagnostics should be verified with the relevant game binary, bench scene, or targeted runtime probe unless the user asks for editor verification.

When editor verification is relevant, use existing scripts under `editor/frontend`. Rust changes are not visible in the editor until the sidecar is rebuilt and the editor is restarted.

## Editor Diagnostics

Use `DRUSNIEL_EDITOR_DIAGNOSTICS=1` only for focused debugging of viewport input, targeting, selection, native viewport focus/attach, or bridge behavior. Include relevant log excerpts when reporting findings.

With diagnostics enabled, the Tauri shell exposes a local-only automation endpoint at `http://127.0.0.1:17778`. It must bind only to loopback and requires a non-trivial `DRUSNIEL_EDITOR_AUTOMATION_TOKEN` for every non-health request:

```powershell
$env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN = "replace-with-local-random-token"
rtk curl http://127.0.0.1:17778/health
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" http://127.0.0.1:17778/focus
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/screenshot?label=viewport-check"
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/move?space=viewport&x=100&y=100"
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/click?space=viewport&x=100&y=100&button=left"
```

Use `space=viewport` for native Bevy viewport-relative coordinates, `space=window` for editor-window-relative coordinates, and `space=screen` for absolute screen coordinates. Mouse actions fail if the editor cannot become the foreground window; screenshots can still verify layout through the Tauri capture path.

## Terrain Debug Views

Implementation: `src/voxel/terrain_debug.rs`. Plan and interpretation recipe: `docs/lod/wireframe-debug-plan.md`.

Hotkeys:

- `Alt+F7`: toggle wireframe overlay.
- `Alt+F8`: toggle normals-as-colour mode.
- `Alt+Shift+F7`: capture `debug/wireframe-<ts>.png` and `.json`. Known bug: also toggles `Alt+F7`.
- `Shift+F9`: dump `debug/terrain-hole-probe-<ts>.json`.
- `F5`: keep terrain on Surface Nets.
- `Alt+F5`: toggle MC+Transvoxel spike; F3 shows `MC+TVX: ON/OFF`.

Debug interpretation:

- Stepped wireframe geometry: DC/QEF/SDF placement issue.
- Smooth geometry but stepped `Alt+F8` colour: normals issue.
- Holes: missing chunk, failed mesh, or wrong dirty flag. Check `missing_boundary_neighbors_at_mesh`.
- Non-white edges at an altitude band: skirt hiding a real gap.

## Coding Conduct

- State assumptions when ambiguity matters; ask when guessing would be risky.
- Prefer the minimum code that solves the request. Avoid speculative options, abstractions, and configurability.
- Touch only files and lines needed for the task. Match existing style.
- Clean up unused imports, variables, or functions created by your own change.
- Turn work into verifiable goals. For bug fixes, prefer a reproducing test before the fix; for refactors, verify before and after behavior when practical.

Understand first if you are under Windows or WSL and use the command accordingly and the paths


Do not mention the name of the refernece in the code comments like Fable 5 for example.

## Agent skills

### Issue tracker

Issues and PRDs are local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-state triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.
