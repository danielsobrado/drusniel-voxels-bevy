# Six-phase CLOD implementation summary

Last updated: 2026-07-09

## Final status

| Phase | Status | Notes |
| --- | --- | --- |
| 1 Bounds guard | Done | Validates existing streamed page node mesh data against the existing page footprint/bounds. The missing query-param coercion bug is fixed by treating absent/blank values as fallback defaults. |
| 2 Center debug | Done | Center ownership counters are scoped through the existing world-center debug path for CLOD, far shell, vegetation ring/grass/trees, canopy, and ocean. |
| 3 GPU far-summary | Opt-in authoritative mode added and hardened | GPU scheduling, dirty request capture, dispatch, readback decode, strict parity, optional cache commit, counters, guarded `farSummaryGpuAuthoritative=1`, fallback-to-CPU re-enable, late-dispose protection, and a dedicated coverage scene exist. CPU remains authoritative by default unless the authoritative flag is enabled. |
| 4 GPU vegetation reject + stones | Done | Stone reject accounting is unified into the existing GPU vegetation early-reject counter family. The real WebGPU gate is expected to fail under headless/SwiftShader if `stoneGpuClustersTotal=0`. |
| 5 Far clipmap grid | Done for shader-displacement path | Far clipmap shader displacement uses source texture data and refreshes on snap/source revision/interval. CPU-baked fallback remains a fallback/debug path, not the acceptance path. |
| 6 GPU canopy | Done / accepted | Far canopy is now GPU impostor based, using the existing canopy path. The visual guard prevents bright square-card regressions. |

## Acceptance harness cleanup

The phase acceptance scenes now live directly in `tools/infinite-islands-acceptance.ts` as typed `SceneSpec` entries with typed validation handlers. The `.mjs` wrapper now only starts/reuses Vite and launches the TypeScript runner with the original CLI args. It no longer rewrites the TypeScript source or creates `infinite-islands-acceptance.filtered.tmp.ts`.

Supported scene aliases:

```text
coverage/phase3-far-summary-gpu-authoritative -> phase3-far-summary-gpu-authoritative
coverage/phase4-stones -> phase4-stones
coverage/phase6-canopy -> phase6-canopy
```

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

`farSummaryGpuAuthoritative=1` is now implemented as an opt-in mode in `main`.

Supported GPU far-summary flags:

```text
farSummaryGpu=1
farSummaryGpuDebugReadback=1
farSummaryGpuStrictParity=1
farSummaryGpuCommit=1
farSummaryGpuAuthoritative=1
```

Meaning:

- `farSummaryGpu=1` enables the GPU far-summary path.
- `farSummaryGpuDebugReadback=1` enables readback inspection.
- `farSummaryGpuStrictParity=1` enables strict CPU/GPU parity checking.
- `farSummaryGpuCommit=1` lets successful GPU readbacks commit into `FarSummaryCache`.
- `farSummaryGpuAuthoritative=1` implies GPU enabled, debug readback, and cache commit, then suppresses CPU `buildSomeTiles` so GPU commits are the primary source for far-summary tiles.
- If the authoritative GPU dispatch fails, the integration re-enables CPU tile building for a short fallback window so `far_summary_gpu_fallback_tiles > 0` has a real CPU recovery path instead of being only a counter.

CPU tile building remains active by default. The authoritative mode must be enabled explicitly and should be validated on a real WebGPU browser, not only headless/SwiftShader.

Expected authoritative-mode counters:

```text
far_summary_gpu_authoritative = 1
far_summary_gpu_last_committed_tiles > 0
far_summary_gpu_total_committed_tiles >= far_summary_gpu_last_committed_tiles
far_summary_cpu_builds_suppressed = 1
far_summary_gpu_fallback_tiles = 0
far_summary_gpu_runtime_error = 0
```

Dedicated acceptance scene:

```powershell
node tools/run-infinite-islands-acceptance.mjs --reuse --gate coverage --scene coverage/phase3-far-summary-gpu-authoritative
```

## Recommended validation commands

```powershell
npm run typecheck
npm test -- src/far-summary/gpu-config.test.ts
npm test -- src/far-summary/gpu-runtime.test.ts
npm test -- src/far-summary
npm test -- src/canopy/canopy_gpu_impostors.test.ts
npm test -- src/canopy
npm test -- src/terrain/far_clipmap
npm run build
node tools/run-infinite-islands-acceptance.mjs --reuse --gate coverage --scene coverage/phase3-far-summary-gpu-authoritative
node tools/run-infinite-islands-acceptance.mjs --reuse --gate coverage --scene coverage/phase6-canopy
```
