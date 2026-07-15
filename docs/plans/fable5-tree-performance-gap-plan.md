# Fable5 Tree Performance Gap Plan

Status: **status / progress log**, not a prescriptive spec like the six numbered parity plans. Most items below are already implemented; the remaining work is browser measurement. Its shipped foundations — GPU tree ring, the `tree_pcg2d` hash, octahedral impostors, and the shadow-LOD budget — are the base Plans 2 and 4 build on, and the captures it calls for should gate whether Plans 2–5's millisecond budgets are realistic on the reference machine. Cross-plan coordination lives in `fable5-parity-index-and-budget-2026-07-15.md`.

## Goal

Close the tree performance gap between `tools/clod-poc` and `Braffolk/fable5-world-demo` while keeping Drusniel's editable CLOD terrain workflow.

Trees are now the main performance cost. The active work is focused on tree count, active ring distance, GPU tree defaults, debug readbacks, alpha-card overdraw, impostors, and shadow caster cost.

## Summary Verdict

Drusniel is not missing all of Fable5's tree ideas. It already has many of the right building blocks:

- GPU tree ring compute.
- Indirect draw buffers.
- Per-LOD grouped rendering.
- Per-cascade tree shadow buffers.
- Octahedral impostors.
- Terrain ridge filtering.
- Tree density, spacing, ring-size, GPU-visible, and shadow-LOD quality presets.
- Crown proxy geometry for far/impostor GPU tree shadow casters.
- Runtime labels that expose whether trees are using `gpu-ring`, `cpu-patches`, `fallback-cpu`, `unsupported`, or `error`.
- A reusable local capture template at `docs/perf/tree-preset-capture-template.md`.

Fable5 is still ahead because its vegetation pipeline is GPU-first end to end. It scatters, culls, compacts, classifies LODs, and writes indirect draw counts on the GPU during normal rendering. Drusniel now requests the GPU tree ring from presets, but the CPU patch path still exists as fallback/debug, and the current work still needs local typecheck/build plus browser validation.

## Main Differences

### 1. Fable5 is GPU-first

Fable5 uses compute passes to clear counters, cull vegetation, compact visible instances, classify LOD rings, and write indirect draw arguments. Instance counts normally stay on GPU.

Drusniel has a GPU tree ring path with compute and indirect draws, but it also keeps a CPU patch path that selects patches, generates instances, updates LODs, and writes matrices from JavaScript.

Current status:

- Quality presets now enable GPU trees by default.
- CPU fallback/debug switches still exist.
- Runtime display now names the active path clearly.
- Remaining work: verify WebGPU path on target browsers and measure dense-forest captures.

### 2. Fable5 avoids normal-frame CPU readback

Fable5 reads stats only for debug/HUD. Drusniel exposes GPU count/readback options.

Current status:

- Normal presets disable GPU counts, readback visible lists, and CPU/GPU validation.
- `treeGpuCounts=1` and `treeGpuValidate=1` explicitly request readback.
- GUI exposes GPU debug controls.
- GUI/overlay summary now shows `counts=off` explicitly for GPU ring when readback is disabled.

### 3. Fable5 reduces distant tree shadow cost

Earlier assumption: Drusniel needed crown proxy casters from scratch.

Updated finding: Drusniel already has crown proxy shadow support in the GPU ring resource path. Far and impostor GPU shadow draws use crown proxy geometry/materials instead of full far card geometry.

Current status:

- Presets control `lod.shadowsMaxLod`.
- `treeShadowMaxLod=none` skips GPU shadow capacity/planes, so the WGSL shadow append path exits early.
- `near`, `mid`, and `far` are gated in composed WGSL using the packed max shadow LOD budget before shadow append atomics.
- CPU validation now applies the same shadow LOD budget.

### 4. Fable5 uses integer hash scatter

Fable5 uses integer PCG-style hashing for stable large-coordinate scatter.

Current status:

- Drusniel already had `tree_pcg2d` in WGSL.
- The composed GPU tree ring shader rewrites `tree_hash` and `tree_hash2` to use PCG instead of `fract(sin(dot(...)))`.
- CPU validation now uses `treePcg2d` for hash and jitter parity with the composed GPU shader.
- Tests cover the composed WGSL PCG rewrite and the CPU validation hash/jitter helpers.

Remaining work:

- CPU validation species selection and hydrology logic may still be approximate compared with the full GPU shader path. Treat validation as a debug guard, not a perfect oracle, until local measurements confirm parity.

### 5. Fable5 has a more integrated impostor path

Both projects have octahedral impostors. Drusniel should ensure impostors are consistently part of the GPU tree ring path and not only a CPU fallback optimization.

Current status:

- GPU ring draw resources support impostor material handles.
- GPU far/impostor shadow path already uses crown proxy geometry.

Remaining work:

- Confirm baked impostor atlas is always used by GPU ring when ready.
- Add cheaper impostor quality modes only if measurements show startup or memory pressure.

## Progress Log

### Done: quality presets for postprocess and trees

Presets added:

- `quality=ultra`
- `quality=balanced`
- `quality=perf`
- `quality=potato`

Tree preset values:

| Preset | Ring | Max instances | Density | Spacing | GPU max visible | Shadow max LOD |
|---|---:|---:|---:|---:|---:|---|
| ultra | 620 m | 9000 | 1.2 | 5.5 m | 50000 | far |
| balanced | 420 m | 6000 | 0.85 | 7.0 m | 30000 | mid |
| perf | 300 m | 3500 | 0.55 | 9.0 m | 16000 | near |
| potato | 180 m | 1500 | 0.3 | 12.0 m | 8000 | none |

### Done: tree density and active ring controlled by presets

Added tree state fields:

- `treeDensity`
- `treeSpacing`

The tree controller passes them into:

- `ecology.density.baseDensity`
- `placement.spacingM`

Manual URL overrides still win after preset application:

- `treeRing`
- `treeDistance`
- `treeMax`
- `treeMaxInstances`
- `treeDensity`
- `treeSpacing`
- `treeGpuMax`

### Done: GPU tree path controlled by presets and URL

Presets now control:

- `treeGpuEnabled`
- `treeGpuForceCpu`
- `treeGpuShowCounts`
- `treeGpuReadbackVisibleLists`
- `treeGpuValidateAgainstCpu`
- `treeGpuMaxVisible`

URL controls:

- `treeGpu=0/1`
- `treeGPU=0/1`
- `gpuTrees=0/1`
- `treeGpuForceCpu=0/1`
- `treeForceCpu=0/1`
- `treeCpu=0/1`
- `treeGpuCounts=0/1`
- `treeCounts=0/1`
- `treeGpuReadback=0/1`
- `treeReadback=0/1`
- `treeGpuValidate=0/1`
- `treeValidate=0/1`

GUI controls under `trees (props)`:

- GPU ring
- force CPU
- show GPU counts
- GPU readback lists
- validate GPU vs CPU
- GPU max visible

### Done: debug readbacks disabled by default

Defaults now avoid normal-frame debug overhead:

- `readbackVisibleLists=false`
- `debugShowGpuCounts=false`
- `debugValidateAgainstCpu=false`

Explicit debug flags can still enable them.

### Done: GPU tree scatter hash moved to PCG

Shader composition rewrites the GPU tree ring hash helpers to use `tree_pcg2d`.

Tests confirm:

- PCG hash is present in the composed shader.
- Old `fract(sin(dot(...)))` hash is not present in the composed shader.

### Done: shadow max LOD preset policy and controls

Implemented:

- Added `TreeShadowMaxLod` type.
- Added `treeShadowMaxLod` to tree quality preset state.
- Added vegetation state field: `treeShadowMaxLod`.
- Wired tree controller settings so `state.treeShadowMaxLod` maps to `settings.lod.shadowsMaxLod`.
- Added URL override parsing for:
  - `treeShadowMaxLod=none|near|mid|far|impostor`
  - `treeShadowLod=...`
  - `treeShadows=...`
- Added lil-gui dropdown under `trees (props)`:
  - `shadow max LOD`
- Updated tests for preset behavior, query override precedence, and invalid value ignore behavior.

### Done: GPU tree shadow work gated by LOD budget

Implemented:

- When `settings.lod.shadowsMaxLod === "none"`, GPU tree ring dispatch passes zero shadow capacity.
- Shadow cascade planes are not sent to compute in `none` mode.
- Packed max shadow LOD into `settings_e.z` in the tree ring uniform block.
- Composed WGSL checks `max_shadow_lod` before shadow append atomics.
- `near`, `mid`, and `far` skip shadow appends for LODs above the budget.
- `treeGpuRingKey` includes `settings.lod.shadowsMaxLod`, so changing the budget rebuilds the relevant GPU ring resources.
- Tests cover WGSL gate insertion and TypeScript param packing.

This directly benefits:

```text
?quality=potato
?quality=potato&treeShadowMaxLod=none
?quality=perf&treeShadowMaxLod=none
?quality=perf&treeShadowMaxLod=near
?quality=balanced&treeShadowMaxLod=mid
```

### Done: CPU validation hash and shadow parity cleanup

Implemented:

- Replaced the CPU validation helper's old sin/fract hash with `treePcg2d`.
- Matched CPU validation jitter to the GPU shape:
  - GPU: `tree_hash2(wc, 1103u)` returns both jitter components from one PCG call.
  - CPU validation now does the same via `treeRingValidationJitter`.
- CPU validation shadow counts now respect `treeLodCastsShadow(settings, lod)`.
- Tests cover PCG hash/jitter parity and shadow LOD filtering in CPU validation counts.

### Done: explicit tree runtime status labels

Implemented:

- Added user-facing runtime path labels:
  - `gpu-ring`
  - `cpu-patches`
  - `fallback-cpu`
  - `unsupported`
  - `error`
  - `disabled`
- Updated tree overlay formatting to show the active path first.
- Updated the lil-gui tree GPU summary to use the same labels.
- Added GPU dispatch time, shadow caster count, and shadow overflow marker when GPU counts are enabled.
- Updated frame stats sync so tree GPU summary refreshes when dispatch time, shadow caster count, overflow, or count-visibility changes.
- Added tests for tree overlay formatting and vegetation GUI summary formatting.

Useful display examples:

```text
trees: gpu-ring counts=off
trees: gpu-ring 421 trees ... path=gpu-ring candidates=900 accepted=421 visible=421 shadow=82 dispatch=1.2ms
trees: cpu-patches 1,250 trees ... path=cpu-patches
```

### Done: tree preset performance capture checklist

Implemented this checklist so the next step is measured, not guessed.

Authoritative capture rules:

- Use the deterministic perf harness, not a manual FPS/overlay sample.
- Use the Plan 6 Lane B machine profile, fixed `scene=trees-perf`, world, camera route,
  600-frame warmup, 300 measured frames, viewport, DPR, and browser state.
- Run at least three harness samples per preset and report the median of run-level p95s.
- Keep GPU counts, validation, debug overlays, and readback off during measured windows.
- Record `frameMs` p50/p95, `renderMs` p95, top phase/prop bucket, GPU-tree status,
  LOD distribution, dispatch timing when timestamp queries are available, triangles,
  rendered count, and the exact `summary.json` path.
- Run the debug-count pass only after timing completes; it explains counts but is not
  performance evidence.

Start the server directly:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Then run one same-shape command per preset (shown for balanced):

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 600 --frames 300 --case tree-gpu-ring --params scene=trees-perf,quality=balanced --out perf-runs/tree-balanced"
```

Repeat with `quality=ultra`, `perf`, and `potato`, changing only the quality and output
directory. A run is authoritative only when `summary.json` records the Lane B profile
and all debug/readback flags false.

Fallback/control and debug URLs below remain useful for correctness captures, not timing proof:

```text
?quality=perf&treeGpu=0
?quality=perf&treeGpuForceCpu=1
?quality=perf&treeGpu=1&treeGpuCounts=1
?quality=perf&treeGpu=1&treeGpuValidate=1
```

Shadow-budget URLs:

```text
?quality=perf&treeShadowMaxLod=none
?quality=perf&treeShadowMaxLod=near
?quality=balanced&treeShadowMaxLod=mid
?quality=ultra&treeShadowMaxLod=far
```

The reusable output template is now in:

```text
docs/perf/tree-preset-capture-template.md
```

### Done: local tree perf capture output format

Added `docs/perf/tree-preset-capture-template.md`.

The template includes:

- capture metadata
- scene setup
- preflight checks
- authoritative harness commands and `summary.json` results
- debug-count results
- CPU fallback control results
- shadow-budget results
- CPU/GPU validation run
- visual artifact notes
- decision summary
- follow-up actions

## Code Health Findings

### CPU validation is closer, but not guaranteed perfect

The CPU helper now matches the GPU hash/jitter and shadow LOD budget. It may still differ from the full GPU shader in species ecology, hydrology, or material weighting details. Keep validation as a debug tool until local tests and real captures prove acceptable tolerance.

### Local validation still required

Run the repository's native Windows typecheck/test/build workflow and the deterministic
perf commands above. Manual overlay FPS is diagnostic only.

## Implementation Plan

### Phase 1: Wire presets into the GPU tree path

Status: mostly done.

Remaining:

- Verify in browser that WebGPU path is actually active for presets.
- Capture before/after performance numbers for `ultra`, `balanced`, `perf`, and `potato`.

### Phase 2: Make GPU ring the normal WebGPU tree path

Status: partially done through preset behavior.

When WebGPU is available and `treeGpuForceCpu=false`, presets now request GPU trees.

Keep CPU patches as fallback for:

- unsupported devices
- explicit `treeGpu=0`
- explicit `treeGpuForceCpu=1`
- temporary debug validation

Remaining:

- Confirm startup defaults without an explicit preset.
- Confirm overlay shows `gpu-ring` for WebGPU preset paths.

### Phase 3: Remove debug readback from normal presets

Status: done.

### Phase 4: Replace GPU tree hash with PCG

Status: done for composed GPU shader and CPU validation helper.

Remaining:

- Verify tolerance with `treeGpuValidate=1` in real captures.

### Phase 5: Reduce tree shadow cost

Status: done for preset/LOD budget gating.

Remaining:

- Local typecheck/build validation.
- Performance measurement on dense forest captures.
- Optional per-preset shadow caster capacity if max LOD is not enough.

### Phase 6: Measure card prepass before copying Fable5

Fable5 uses a card-only depth prepass. Drusniel already found that a CPU tree prepass can regress, so do not enable this blindly.

Add only a GPU-tree card prepass experiment first.

Accept it only if dense forest captures show a clear tree-frame-time reduction.

### Phase 7: Long-term persistent scatter

Fable5 scatters large world vegetation into persistent GPU buffers. Drusniel's editable CLOD workflow may still need ring-based generation near edits.

Long-term target:

- persistent GPU scatter for stable terrain
- ring-based refresh for edited/dirty terrain
- compacted GPU visible lists for normal rendering

## Acceptance Checks

Run locally:

```bash
cd tools/clod-poc
npm run typecheck
npm test
npm run build
```

Manual checks:

```text
?quality=ultra&treeGpu=1
?quality=balanced&treeGpu=1
?quality=perf&treeGpu=1
?quality=potato&treeGpu=1
?quality=perf&treeGpu=0
?quality=perf&treeGpu=1&treeGpuCounts=1
?quality=perf&treeGpu=1&treeGpuValidate=1
?quality=perf&treeGpuForceCpu=1
?quality=perf&treeShadowMaxLod=near
?quality=perf&treeShadowMaxLod=none
?quality=ultra&treeShadowMaxLod=far
?quality=potato&treeShadowMaxLod=none
```

Performance checks:

- `perf` must reduce tree count and active ring versus `ultra`.
- GPU ring must avoid CPU patch churn when active.
- Debug readbacks must be off unless requested.
- CPU fallback must still work.
- `treeShadowMaxLod=none` must skip GPU shadow work.
- `treeShadowMaxLod=near` must skip mid/far/impostor GPU shadow append work.
- `treeGpuValidate=1` should not produce obvious false positives caused only by hash/jitter or shadow LOD mismatch.
- Overlay or GUI must show `gpu-ring` when GPU path is active.
- Overlay or GUI must show `cpu-patches` / `fallback-cpu` when GPU path is not active.
- No shader compile errors.
- No missing near-camera trees.

## Recommended Next Commit

Suggested commit title:

```text
Measure tree preset GPU path locally
```

Likely files:

- `docs/perf/tree-preset-capture-template.md` copied to a dated measured result file
- optional preset tuning files if the measured data shows clear issues

Do not start with a new visual tree effect. The biggest remaining tree win is proving that the GPU path is actually active and measuring the preset impact in the running app.
