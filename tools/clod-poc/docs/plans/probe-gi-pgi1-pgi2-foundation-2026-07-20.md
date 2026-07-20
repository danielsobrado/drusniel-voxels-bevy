# Probe GI PGI-1/PGI-2 foundation — 2026-07-20

## Scope

This slice implements the terrain-relative probe-GI data and positioning foundation for `tools/clod-poc`.
It does not claim radiance tracing, SH projection, history scheduling, edit invalidation, material integration,
or the final default flip.

## Implemented

- Strict `config/probe_gi.yaml` parsing with the fixed three-cascade architecture.
- Three 32 × 8 × 32 camera-centred cascades with whole-cell origin snapping.
- Toroidal world-cell-to-record mapping and newly exposed column detection.
- Correct 96-byte `ProbeGiRecord` packing with a 24-word stride.
- CPU diagnostics/oracle records plus matching WebGPU storage buffers when a device is available.
- Canonical terrain-height sampling through `EnvironmentQuery`, with finite-world terrain fallback when no query exists.
- Voxel-overlay and voxel-edit density participation in solid tests.
- Terrain-relative layer placement and six-axis relocation with the fixed 45% movement cap.
- Fail-closed invalid records for unknown terrain or enclosed probes.
- Deadline-bounded incremental positioning. Startup does not synchronously position all 24,576 probes.
- Eight record uploads per completed column; no GPU-to-CPU gameplay readback.
- Three double-buffered `rgba16float` SH publication textures per cascade. Empty publication swaps only at a later frame boundary.
- Optional probe debug point visualization.
- Runtime wiring on WebGPU behind `?probeGi=1`. The unfinished system remains default-off until PGI-8.
- Diagnostics for storage, queue depth, positioned columns, positioning time, validity, relocation, unknown terrain, recenter slabs, and publication generation.

## Invariants

- Moving less than one cascade cell does not change that cascade origin.
- A one-cell X or Z move schedules exactly one 32-column slab for that cascade.
- Existing toroidal records remain available until replacement columns are positioned.
- Unknown terrain never becomes a valid bright probe.
- GPU record buffers are storage/copy resources only; this slice performs no readback.
- Published SH textures remain N-1 double-buffered even though their contents are still empty before PGI-5.
- Total CPU records, GPU records, and double-buffered SH textures remain below 16 MiB.

## Deliberate PGI-2 boundary

The current relocation implementation is the deterministic CPU authority/oracle and uploads positioned records to the GPU.
The final compute relocation shader and exact GPU visibility-provider bindings remain part of the next PGI-2/PGI-3 closure.
This document therefore calls the combined work a foundation rather than claiming the complete probe-GI renderer.

## Verification

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- `
  src/lighting/probe_gi/config.test.ts `
  src/lighting/probe_gi/clipmap_origin.test.ts `
  src/lighting/probe_gi/record_packing.test.ts `
  src/lighting/probe_gi/relocation.test.ts `
  src/lighting/probe_gi/publication.test.ts `
  src/lighting/probe_gi/gpu/resources.test.ts `
  src/lighting/probe_gi/runtime.test.ts `
  src/lighting/probe_gi/integration.test.ts
npm --prefix tools/clod-poc run build
```

Headed check:

```text
?scene=cave-test&probeGi=1&probeGiDebug=validity&hud=1
```

Confirm:

- `probe_gi_enabled == 1`;
- `probe_gi_storage_bytes < 16777216`;
- positioning progresses over frames without a startup long task;
- probe origins change only on exact cascade-cell crossings;
- cave/overhang probes relocate or remain invalid rather than appearing valid inside solids;
- `probe_gi_publish_generation >= 1` after the first frame boundary;
- normal gameplay readback counters remain zero.
