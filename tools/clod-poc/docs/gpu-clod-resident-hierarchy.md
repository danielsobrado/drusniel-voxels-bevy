# GPU CLOD Resident Hierarchy

## Purpose

This path adds the foundations required to stop treating every streamed CLOD page as a CPU-only
`THREE.BufferGeometry` artifact. It preserves the existing CLOD invariants: voxel terrain remains
authoritative, parent levels are derived from child meshes, page borders remain locked, and the CPU
worker/render path remains the fallback until GPU parity gates pass.

## Current rollout state

| Capability | State | Notes |
| --- | --- | --- |
| Persistent GPU page buffers | Implemented, opt-in | L0 by default; byte-budgeted LRU; current Three.js render path still uses CPU geometry |
| Deterministic meshlet hierarchy | Implemented, opt-in | Fixed vertex/triangle limits plus bounds hierarchy; indirect draw integration is pending |
| GPU weld kernel | Implemented, disabled | Quantized-position hash weld with normal/material conflict preservation |
| GPU parent simplifier kernel | Implemented, disabled | Border-locked cluster simplifier; must pass CPU topology/border validation before activation |
| Selective readback | Pending renderer integration | Existing renderer requires CPU arrays; do not claim readback elimination yet |
| Readback-free L0 rendering | Pending custom WebGPU draw path | Three.js `BufferGeometry` is still the active renderer contract |
| Hardware performance evidence | Automated capture path implemented | Evidence is accepted only from a named non-software adapter with equivalent work and zero fallbacks |

## Runtime flags

The entire hierarchy path is disabled by default.

```text
liveClodGpuHierarchy=1
liveClodGpuResidentMaxLevel=0
liveClodGpuResidentBytes=268435456
liveClodGpuMeshlets=1
liveClodGpuMeshletVertices=64
liveClodGpuMeshletTriangles=64
```

Experimental kernels remain separately disabled:

```text
liveClodGpuWeld=1
liveClodGpuSimplify=1
```

Those two flags only express operator intent in this milestone. The production builder must not use
the kernels until dispatch/readback parity, border-chain validation, and visual acceptance are wired.

## Counters

```text
live_clod_gpu_hierarchy_enabled
live_clod_gpu_resident_pages
live_clod_gpu_resident_bytes
live_clod_gpu_resident_uploads_total
live_clod_gpu_resident_upload_bytes_total
live_clod_gpu_resident_evictions_total
live_clod_gpu_meshlets_resident
live_clod_gpu_hierarchy_nodes_resident
```

## Verification

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/terrain/streaming/gpu_clod_hierarchy.test.ts src/terrain/streaming/gpu_clod_root_mesher_pool.test.ts
npm --prefix tools/clod-poc run acceptance:clod:fast
```

Hardware evidence must run on a self-hosted runner labelled `gpu`:

```text
Actions -> CLOD GPU Hardware Evidence -> Run workflow
```

The workflow runs the deterministic single-pool/dual-pool benchmark, rejects software adapters,
rejects fallbacks or unequal work, uploads the raw JSON and Markdown report, and can optionally
commit the validated report.

## Activation gates

1. The existing CPU path remains the visual authority.
2. GPU weld output must be read back in tests and pass the existing welded-intermediate validator.
3. GPU simplification output must pass border locks, no-internal-border checks, degenerate removal,
   and accumulated-error parity against the CPU hierarchy.
4. The custom WebGPU page renderer must reproduce terrain material, depth, fog, shadow, transition,
   and debug behaviour before CPU arrays may be omitted for active L0 pages.
5. Only pages promoted to persistent parent CLOD construction may be read back after the custom L0
   renderer is accepted.
6. Hardware evidence must show zero fallback pages and equivalent requested/applied work.

## Why this is staged

The compute mesher and the Three.js renderer currently use different GPU ownership domains. Keeping a
page resident in compute buffers is safe, but rendering those buffers without a CPU copy requires a
custom WebGPU draw integration. Skipping that boundary would either duplicate memory silently or
remove the validated terrain material and transition path. The flags keep this milestone measurable
without changing shipping visuals.
