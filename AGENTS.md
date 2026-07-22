# Agent Instructions

Keep changes surgical, simple, and verified. This repo has an active rendering/performance workflow, so profiling is part of implementation whenever a change can affect frame timing or visuals.

## Documentation Dates

- New Markdown documentation files must include their creation date as a `-YYYY-MM-DD.md` filename suffix so age is visible from the filename alone.
- Exempt fixed-name convention and control files such as `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and generated reports whose names are defined by tooling.
- Do not rename existing undated documentation only to satisfy this rule. When replacing an old dated document, create a new file with the current creation date; do not change the date for minor edits.

## Profiling

Profile any change that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing.

Do not run visual benches from WSL. This includes visual-regression, screenshot, and startup visual-stability bench scenes. Use a native Windows shell for those runs, or report that visual benches were not run because the current environment is WSL.

Expected workflow:

1. Run a baseline bench for the relevant scene.
2. Make the change.
3. Re-run the same bench scene.
4. Compare `bench-runs/<run>/summary.json`, screenshots, counters, and timing rows.
5. Report measured wins and regressions plainly. Do not add broad timing rows together; some overlap.

## clod-poc QA

For `tools/clod-poc` web changes, run the Node/Vite checks plus the web QA harness when behavior, visuals, frame timing, CLOD selection, or WebGPU compute changes.

```powershell
# typecheck (tsc, no Vite) — rtk is fine:
npm --prefix tools/clod-poc run typecheck
# Vite-based — run WITHOUT rtk:
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
```

The QA runner consumes a captured web summary JSON and writes `qa-report.json` / `qa-report.md` under `tools/clod-poc/qa-runs` by default. The sample summary is a smoke test only; for visual or performance claims, use a summary captured from the relevant browser scenario.

**Read [`docs/qa/visual-qa.md`](docs/qa/visual-qa.md) before trusting any visual or perf metric.** It covers how to validate that a discriminator actually separates known-good from known-bad, and the confounds that silently invalidate browser measurements (flag mismatch between probe and repro URL, world layout moving between commits, throttled/stale counters, broken builds that render nothing). A metric never checked against a known-good build is not evidence — that mistake cost a full investigation's worth of false conclusions and had to be withdrawn.

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

### Visual QA

Validating a visual/perf measurement before trusting it, and running the clod-poc QA, shot, and perf harnesses. See `.claude/skills/visual-qa/SKILL.md` and `docs/qa/visual-qa.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.
