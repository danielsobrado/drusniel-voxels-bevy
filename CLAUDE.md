# Claude Instructions

Keep profiling in the loop as features are added. Rendering work in this repo is performance-sensitive, and unmeasured changes are not enough.

## Documentation Dates

- New Markdown documentation files must include their creation date as a `-YYYY-MM-DD.md` filename suffix so age is visible from the filename alone.
- Exempt fixed-name convention and control files such as `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and generated reports whose names are defined by tooling.
- Do not rename existing undated documentation only to satisfy this rule. When replacing an old dated document, create a new file with the current creation date; do not change the date for minor edits.

## clod-poc Web QA

For `tools/clod-poc` changes, especially CLOD selection, WebGPU compute, browser visuals, or frame timing, run the clod-poc checks and QA harness:

```powershell
npm --prefix tools/clod-poc run typecheck   # tsc only — rtk OK
npm --prefix tools/clod-poc test                # vitest — NO rtk
npm --prefix tools/clod-poc run build           # vite build — NO rtk
npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json   # builds — NO rtk
```

The QA runner reads a web summary JSON, validates configured screenshots, probes, and timing thresholds, then writes `qa-report.json` and `qa-report.md` under `tools/clod-poc/qa-runs` unless `--output` is provided. The sample summary is only a harness smoke test; use a captured summary for real browser visual/perf conclusions.

For infinite-islands browser acceptance, prefer the single-page reuse profile so the runner does not reboot the scene for every gate/pose:

```powershell
npm --prefix tools/clod-poc run accept:infinite-islands -- --reuse
```

The generated report records both `configured_world_pages` and `startup_world_pages`; full acceptance currently means the full scene/gate set, not necessarily a full-size startup world.

The opt-in CLOD WebGPU selection scenario is:

```text
http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1
```

### Deterministic clod-poc Performance Process

For clod-poc frame-time, WebGPU compute, vegetation, terrain material, postprocess, water, shadow, or CLOD-selection changes, use the perf harness rather than manual FPS checks.

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

### Shot Harness, Hooks, Fail-Loud Boot

For deterministic clod-poc visual checks, use the Playwright shot harness and `window.__drusnielClod` hooks rather than manual screenshots.

Start the local server:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1
```

Run deterministic shots and batteries with the Vite URL in `CLOD_POC_BASE_URL`:

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene sanity --seed 1 --freeze 1 --hud 1 --framealign 0 --out shots/phase-0/sanity.png --stats shots/phase-0/sanity-stats.json"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug final --freeze 1 --hud 1 --framealign 0 --out shots/phase-1/terrain-final.png --stats shots/phase-1/terrain-stats.json"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run battery"
```

`window.__drusnielClod` is the automation contract:

- `ready` / `error`: readiness or fail-loud boot failure.
- `diag`: WebGPU diagnostics; required for gated WebGPU scenes.
- `stats`: FPS, frame ms, draw calls, triangles, counters, and GPU pass timings.
- `setPose()` / `getPose()`: deterministic camera pose control.
- `settle(frames)`: wait frame-stable captures.
- `flyCamEnabled(on)`: let tooling disable interactive input.

Gated scenes such as `scene=sanity` and `scene=phase1-terrain` must run browser gate + WebGPU diagnostics before renderer/world work. If WebGPU is unavailable or the GPU pipeline breaks, call `failLoud()` and set `window.__drusnielClod.error`; never silently fall back to WebGL in these paths.

Deterministic scene URLs:

- Phase 0 sanity: `?scene=sanity&seed=1&freeze=1&hud=1`
- Phase 1 terrain: `?scene=phase1-terrain&seed=1&world=8&terrainGrid=2048&terrainDebug=lod&freeze=1&hud=1`

When reporting visual or runtime changes, include the shot path, stats JSON path, and relevant counters such as `phase1.heightSignature`, `phase1.nodesRendered`, `phase1.trianglesRendered`, and GPU timestamp support.

## Reporting

When you claim a perf improvement, include:

1. The bench scene used.
2. The before/after numbers from `summary.json`.
3. The main counters or timing rows that moved.
4. Any visual tradeoff or ready-state issue discovered during the run.

If a change was not benchmarked, say so directly.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

Understand first if you are under Windows or WSL and use the command accordingly and the paths

Do not mention the name of the refernece in the code comments like Fable 5 for example.
