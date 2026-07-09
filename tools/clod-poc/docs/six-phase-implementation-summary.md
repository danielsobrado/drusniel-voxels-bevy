# Six-phase CLOD implementation summary

Last updated: 2026-07-09

## Final status

| Phase | Status | Notes |
| --- | --- | --- |
| 1 Bounds guard | Done | Validates existing streamed page node mesh data against the existing page footprint/bounds. The missing query-param coercion bug is fixed by treating absent/blank values as fallback defaults. |
| 2 Center debug | Done | Center ownership counters are scoped through the existing world-center debug path for CLOD, far shell, vegetation ring/grass/trees, canopy, and ocean. |
| 3 GPU far-summary | Partial | GPU scheduling, dirty request capture, dispatch, readback decode, strict parity, optional cache commit, and counters exist. CPU remains authoritative by default. `farSummaryGpuAuthoritative=1` does not exist yet. |
| 4 GPU vegetation reject + stones | Done | Stone reject accounting is unified into the existing GPU vegetation early-reject counter family. The real WebGPU gate is expected to fail under headless/SwiftShader if `stoneGpuClustersTotal=0`. |
| 5 Far clipmap grid | Done for shader-displacement path | Far clipmap shader displacement uses source texture data and refreshes on snap/source revision/interval. CPU-baked fallback remains a fallback/debug path, not the acceptance path. |
| 6 GPU canopy | Done / accepted | Far canopy is now GPU impostor based, using the existing canopy path. The visual guard prevents bright square-card regressions. |

## Accepted Phase 6 coverage result

`coverage/phase6-canopy` has been run and passed with 0 failures.

Validated counters:

| Counter | Actual | Expected | Result |
| --- | ---: | ---: | --- |
| `canopy_gpu_impostor_enabled` | 1 | 1 | Pass |
| `canopy_gpu_impostor_instances` | 8192 | > 0 | Pass |
| `canopy_shell_tris` | 16384 | `instances * 2` | Pass |
| `canopy_gpu_impostor_max_color_channel` | 0.084 | <= 0.42 | Pass |
| `canopy_gpu_impostor_opacity` | 0.58 | < 0.7 | Pass |
| `far_clipmap_shader_displacement_enabled` | 1 | 1 | Pass |
| `far_clipmap_pending_tiles` | 0 | 0 | Pass |

Run command:

```powershell
node tools/run-infinite-islands-acceptance.mjs --reuse --gate coverage --scene coverage/phase6-canopy
```

## Current Phase 3 truth

`farSummaryGpuAuthoritative=1` is not implemented in `main`.

Current supported GPU far-summary flags:

```text
farSummaryGpu=1
farSummaryGpuDebugReadback=1
farSummaryGpuStrictParity=1
farSummaryGpuCommit=1
```

Meaning:

- `farSummaryGpu=1` enables the GPU far-summary path.
- `farSummaryGpuDebugReadback=1` enables readback inspection.
- `farSummaryGpuStrictParity=1` enables strict CPU/GPU parity checking.
- `farSummaryGpuCommit=1` lets successful GPU readbacks commit into `FarSummaryCache`.

This is still not the same as GPU authority. CPU tile building still remains active by default unless a future authoritative mode suppresses CPU builds and makes GPU commit/fallback ownership explicit.

## Future work to finish Phase 3 completely

Add a guarded opt-in mode, probably:

```text
farSummaryGpuAuthoritative=1
```

Expected behavior for that future mode:

1. GPU readback commits are the primary source for far-summary tiles.
2. CPU `buildSomeTiles` is skipped or used only as explicit fallback.
3. GPU failure/fallback is counted clearly.
4. Acceptance proves:
   - `far_summary_gpu_authoritative = 1`
   - `far_summary_gpu_committed_tiles > 0`
   - `far_summary_cpu_builds_suppressed = 1`
   - `far_summary_gpu_fallback_tiles = 0`
   - no GPU runtime error

## Recommended validation commands

```powershell
npm run typecheck
npm test -- src/canopy/canopy_gpu_impostors.test.ts
npm test -- src/canopy
npm test -- src/terrain/far_clipmap
npm test -- src/far-summary
npm run build
node tools/run-infinite-islands-acceptance.mjs --reuse --gate coverage --scene coverage/phase6-canopy
```
