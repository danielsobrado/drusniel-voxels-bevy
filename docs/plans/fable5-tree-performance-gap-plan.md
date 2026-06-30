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
- Quality presets for tree distance, density, spacing, and max visible count.

But Fable5 is still ahead because its vegetation pipeline is GPU-first. Fable5 scatters, culls, compacts, classifies LODs, and writes indirect draw counts on the GPU during normal rendering. Drusniel has a similar GPU ring path, but it is not the normal default path yet, and the CPU patch path can still dominate runtime cost.

## Main Differences

### 1. Fable5 is GPU-first

Fable5 uses compute passes to clear counters, cull vegetation, compact visible instances, classify LOD rings, and write indirect draw arguments. Instance counts do not need CPU work every frame.

Drusniel has a GPU tree ring, but default tree settings still keep GPU trees disabled. The CPU fallback path selects patches, generates tree instances, updates LODs, and writes per-instance matrices from JavaScript.

### 2. Fable5 avoids normal-frame CPU readback

Fable5 reads stats only for debug/HUD. Drusniel currently exposes GPU readback/debug count options and should make sure they are off in normal quality presets.

### 3. Fable5 uses stronger far-tree shadow optimization

Fable5 uses cheap crown proxy casters for distant tree shadows instead of rendering expensive far card geometry into every cascade.

Drusniel has per-cascade shadow groups already, but should add proxy caster geometry for mid/far/impostor tree shadows.

### 4. Fable5 uses integer hash scatter

Fable5 uses integer PCG-style hashing for stable large-coordinate scatter. Drusniel's WGSL file already has `tree_pcg2d`, but the active `tree_hash` path still uses a sin/fract hash. This should be replaced with PCG.

### 5. Fable5 has a more integrated impostor path

Both projects have octahedral impostors. Drusniel should make sure impostors are always part of the GPU tree ring path and not only a CPU fallback optimization.

## Implementation Plan

### Phase 1: Wire presets into the GPU tree path

This is the highest-value next step.

Implement URL flags:

- `treeGpu=0/1`
- `treeGpuCounts=0/1`
- `treeGpuValidate=0/1`
- `treeGpuForceCpu=0/1`

Add lil-gui controls under `trees (props)`:

- GPU ring enabled
- force CPU
- show GPU counts
- validate GPU against CPU
- readback visible lists

Update quality presets so they control:

- `treeGpuEnabled`
- `treeGpuForceCpu`
- `treeGpuShowCounts`
- `treeGpuMaxVisible`
- `treeDistance`
- `treeMaxInstances`
- `treeDensity`
- `treeSpacing`

Preset target:

| Preset | GPU trees | Ring | Density | Spacing | GPU max visible | Debug counts |
|---|---:|---:|---:|---:|---:|---:|
| ultra | on when WebGPU | 620 m | 1.2 | 5.5 m | 50000 | off |
| balanced | on when WebGPU | 420 m | 0.85 | 7.0 m | 30000 | off |
| perf | on when WebGPU | 300 m | 0.55 | 9.0 m | 16000 | off |
| potato | on when WebGPU | 180 m | 0.3 | 12.0 m | 8000 | off |

Manual URL overrides must still win after preset application.

### Phase 2: Make GPU ring the normal WebGPU tree path

When WebGPU is available and `treeGpuForceCpu=false`, use GPU tree ring by default.

Keep CPU patches as fallback for:

- unsupported devices
- explicit `treeGpu=0`
- explicit `treeGpuForceCpu=1`
- temporary debug validation

Add a clear status line:

- `trees: gpu-ring`
- `trees: cpu-patches`
- `trees: fallback-cpu`
- `trees: unsupported`

### Phase 3: Remove debug readback from normal presets

Normal presets should not request GPU readback.

Target defaults:

- `readbackVisibleLists=false`
- `debugShowGpuCounts=false`
- `debugValidateAgainstCpu=false`

Only enable them through URL or GUI.

### Phase 4: Replace GPU tree hash with PCG

In `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`:

- change `tree_hash` to return `tree_pcg2d(cell, salt).x`
- change `tree_hash2` to return `tree_pcg2d(cell, salt)`

Then update validation tests and compare scatter visually.

### Phase 5: Add far tree shadow proxy casters

Add cheap species-level crown proxy geometry.

Use:

- real tree geometry for near shadows
- proxy crown/trunk geometry for mid/far/impostor shadows
- preset-specific shadow budgets
- fade at the far shadow boundary

Add URL switches:

- `treeShadowProxy=0/1`
- `treeShadowMaxLod=near|mid|far|impostor|none`

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
```

Performance checks:

- `perf` must reduce tree count and active ring versus `ultra`.
- GPU ring must avoid CPU patch churn when active.
- Debug readbacks must be off unless requested.
- CPU fallback must still work.
- No shader compile errors.
- No missing near-camera trees.

## Recommended Next Commit

Start with Phase 1.

Suggested commit title:

```text
Wire tree GPU path into quality presets
```

Likely files:

- `tools/clod-poc/src/app/state/tree_quality_presets.ts`
- `tools/clod-poc/src/app/state/environment_query_overrides.ts`
- `tools/clod-poc/src/ui/gui/vegetation_gui.ts`
- `tools/clod-poc/src/runtime/vegetation/tree_controller.ts`
- `tools/clod-poc/src/trees/tree_config.ts`
- tests under `tools/clod-poc/src/app/state/`

Do not start with shadow proxies or prepass. The biggest win is making the existing GPU tree ring the normal WebGPU path and removing debug/readback overhead from presets.
