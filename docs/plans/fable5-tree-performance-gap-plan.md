# Fable5 Tree Performance Gap Plan

## Goal

Close the tree performance gap between `tools/clod-poc` and `Braffolk/fable5-world-demo` while keeping Drusniel's editable CLOD terrain workflow.

Trees are now the main performance cost. The next work should focus on tree instance count, active ring distance, GPU tree path defaults, debug readbacks, alpha-card overdraw, and shadow caster cost.

## Summary Verdict

Drusniel already has many of the right pieces:

- GPU tree ring compute.
- Indirect draw buffers.
- Per-LOD grouped rendering.
- Per-cascade tree shadow buffers.
- Octahedral impostors.
- Terrain ridge filtering.
- Quality presets for tree distance, density, spacing, GPU max visible count, and now shadow LOD policy.
- Crown proxy geometry for far/impostor GPU tree shadow casters.

Fable5 is still ahead because its vegetation pipeline is GPU-first. Fable5 scatters, culls, compacts, classifies LODs, and writes indirect draw counts on the GPU during normal rendering. Drusniel has a similar GPU ring path, but the CPU patch path still needs to remain as fallback/debug and some GPU-path work is still not as complete or consistently used as Fable5.

## Main Differences

### 1. Fable5 is GPU-first

Fable5 uses compute passes to clear counters, cull vegetation, compact visible instances, classify LOD rings, and write indirect draw arguments. Instance counts do not need CPU work every frame.

Drusniel has a GPU tree ring path with compute + indirect draws, but it still has a CPU patch fallback that selects patches, generates tree instances, updates LODs, and writes per-instance matrices from JavaScript.

Current status:

- Quality presets now enable GPU trees by default.
- CPU fallback/debug switches still exist.
- Remaining work: make the runtime status/overlay clearer and verify that WebGPU path is the actual path on target browsers.

### 2. Fable5 avoids normal-frame CPU readback

Fable5 reads stats only for debug/HUD. Drusniel exposes GPU readback/debug count options.

Current status:

- Normal presets disable GPU counts, readback visible lists, and CPU/GPU validation.
- `treeGpuCounts=1` and `treeGpuValidate=1` explicitly request readback.
- GUI exposes GPU debug controls.

### 3. Fable5 uses stronger far-tree shadow optimization

Earlier assumption: Drusniel needed crown proxy casters from scratch.

Updated finding: Drusniel already has crown proxy shadow support in the GPU ring resource path. Far and impostor GPU shadow draws use crown proxy geometry/materials instead of full far card geometry.

Remaining gap:

- Presets need stronger control over `lod.shadowsMaxLod`.
- CPU and GPU paths should both respect shadow LOD budgets.
- GPU compute should avoid writing shadow candidates for disabled shadow LODs. Otherwise the renderer skips them, but compute still spends atomics/counter work.

### 4. Fable5 uses integer hash scatter

Fable5 uses integer PCG-style hashing for stable large-coordinate scatter.

Current status:

- Drusniel already had `tree_pcg2d` in WGSL.
- The composed GPU tree ring shader now rewrites `tree_hash` and `tree_hash2` to use PCG instead of `fract(sin(dot(...)))`.
- Test coverage was added so the compiled tree ring shader should not regress to the old sin hash accidentally.

Remaining work:

- CPU validation/scatter helper should be checked for PCG parity too. Some CPU helper code still uses a sin hash path.

### 5. Fable5 has a more integrated impostor path

Both projects have octahedral impostors. Drusniel should ensure impostors are consistently part of the GPU tree ring path and not only a CPU fallback optimization.

Current status:

- GPU ring draw resources support impostor material handles.
- GPU far/impostor shadow path already uses crown proxy geometry.

Remaining work:

- Confirm baked impostor atlas is always used by GPU ring when ready.
- Add cheaper impostor quality modes later only if measurements show startup or memory pressure.

## Progress Log

### Done: quality presets for postprocess and trees

Presets added:

- `quality=ultra`
- `quality=balanced`
- `quality=perf`
- `quality=potato`

They control postprocess first, then tree cost.

Tree preset values before shadow policy:

| Preset | Ring | Max instances | Density | Spacing | GPU max visible |
|---|---:|---:|---:|---:|---:|
| ultra | 620 m | 9000 | 1.2 | 5.5 m | 50000 |
| balanced | 420 m | 6000 | 0.85 | 7.0 m | 30000 |
| perf | 300 m | 3500 | 0.55 | 9.0 m | 16000 |
| potato | 180 m | 1500 | 0.3 | 12.0 m | 8000 |

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

Shader composition now rewrites the GPU tree ring hash helpers to use `tree_pcg2d`.

Tests confirm:

- PCG hash is present in the composed shader.
- Old `fract(sin(dot(...)))` hash is not present in the composed shader.

### In progress: shadow LOD preset policy

Started implementation:

- Added `TreeShadowMaxLod` type.
- Added `treeShadowMaxLod` to tree quality preset state.
- Preset targets:

| Preset | Shadow max LOD |
|---|---|
| ultra | far |
| balanced | mid |
| perf | near |
| potato | none |

- Added vegetation state field: `treeShadowMaxLod`.
- Wired tree controller settings so `state.treeShadowMaxLod` maps to `settings.lod.shadowsMaxLod`.
- Added URL override parsing for:
  - `treeShadowMaxLod=none|near|mid|far|impostor`
  - `treeShadowLod=...`
  - `treeShadows=...`
- Updated tree preset tests for shadow LOD validation and `perf` behavior.

Still pending:

- Add lil-gui dropdown for shadow max LOD under `trees (props)`.
- Add query override test coverage for `treeShadowMaxLod`.
- Add GPU compute-side shadow append gating so disabled shadow LODs do not spend atomic/counter work.
- Add composed WGSL/test coverage for the shadow LOD gate.

## Code Health Findings

### CPU validation/scatter helper may still use older ecology names

While reviewing CPU/GPU parity code, some helper files appeared to reference older ecology field names such as `ecology.terrain` and `ecology.clustering`, while the current tree config shape uses `ecology.density` and `ecology.clumping`.

This needs a local `npm run typecheck` confirmation. If typecheck fails there, fix the helper names before relying on GPU validation.

### CPU validation hash parity still needs cleanup

GPU tree ring scatter now uses PCG in the composed shader. Some CPU helper paths still use a sin/fract hash. If those helpers are used for CPU/GPU validation, validation may disagree with the GPU even if rendering is correct.

Next cleanup:

- Replace CPU helper `treeRingHash` with `treePcg2d(...)[0]` where parity matters.
- Add validation tests for CPU/GPU scatter parity.

## Implementation Plan

### Phase 1: Wire presets into the GPU tree path

Status: mostly done.

Implemented:

- GPU tree preset fields.
- GPU tree URL flags.
- GUI GPU controls.
- debug readback disabled by default.

Remaining:

- Verify in browser that WebGPU path is actually active for presets.
- Improve status overlay: `trees: gpu-ring`, `trees: cpu-patches`, `trees: fallback-cpu`, `trees: unsupported`.

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
- Add clear status line in overlay/menu.

### Phase 3: Remove debug readback from normal presets

Status: done.

Normal presets should not request GPU readback.

Current target defaults:

- `readbackVisibleLists=false`
- `debugShowGpuCounts=false`
- `debugValidateAgainstCpu=false`

Only enable them through URL or GUI.

### Phase 4: Replace GPU tree hash with PCG

Status: done for composed GPU shader.

Remaining:

- CPU parity helper cleanup.

### Phase 5: Reduce tree shadow cost

Status: in progress.

Updated finding: crown proxy casters already exist for GPU far/impostor shadows.

Immediate remaining work:

1. Finish `treeShadowMaxLod` GUI + tests.
2. Pack shadow max LOD into GPU ring params.
3. Gate WGSL shadow appends by max shadow LOD.
4. Keep CPU patch path using existing `treeLodCastsShadow` policy.

Future optional work:

- Add `treeShadowProxy=0/1` only if we need to compare proxy vs original far geometry.
- Add per-preset shadow caster capacity if max LOD is not enough.

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
```

Performance checks:

- `perf` must reduce tree count and active ring versus `ultra`.
- GPU ring must avoid CPU patch churn when active.
- Debug readbacks must be off unless requested.
- CPU fallback must still work.
- Shadow LOD policy must reduce far/impostor shadow caster work.
- No shader compile errors.
- No missing near-camera trees.

## Recommended Next Commit

Finish Phase 5 low-risk wiring before deeper shadow work.

Suggested commit title:

```text
Gate GPU tree shadow append by shadow LOD budget
```

Likely files:

- `tools/clod-poc/src/app/state/tree_quality_presets.ts`
- `tools/clod-poc/src/app/state/environment_query_overrides.ts`
- `tools/clod-poc/src/ui/gui/vegetation_gui.ts`
- `tools/clod-poc/src/runtime/vegetation/tree_controller.ts`
- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`
- `tools/clod-poc/src/gpu/wgsl_modules.test.ts`
- tests under `tools/clod-poc/src/app/state/`

Do not start with a new visual tree effect. The biggest remaining tree win is reducing work already being generated: active ring, density, debug readback, and shadow caster workload.
