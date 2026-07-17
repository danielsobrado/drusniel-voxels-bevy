# GPU ring observability — Phase 0

Status: implemented on `main` on 2026-07-17.

## Scope

This phase adds observability only. It does not add stone or understory geometric LODs and does not split the currently fused understory world/view kernel.

Covered systems:

- GPU stone scatter ring;
- GPU understory ring;
- accepted class colouring;
- candidate-grid and recenter visualisation;
- compute-pass timestamps;
- isolated render-pass timestamps;
- truthful count telemetry when gameplay readbacks are disabled.

## URL flags

```text
ringDebug=1
stoneRingDebug=1
understoryRingDebug=1
gpuTiming=1
ringGpuTiming=1
gpuReadbacks=debug
stoneGpuCounts=1
understoryGpuCounts=1
```

Use `ringDebug=1` to enable both ring overlays. The per-system flags enable one overlay only.

`gpuTiming=1` enables the existing Three.js GPU profiler and the isolated timing targets. It also enables the new asynchronous compute timestamp recorder.

`ringGpuTiming=1` enables only the new compute timestamp recorder. It does not enable the isolated render timing targets.

Gameplay count readbacks remain disabled unless a debug, profile, acceptance, or explicit per-kind override allows them.

## Ring overlay

Each enabled overlay shows:

- outer ring boundary;
- optional inner boundary;
- snapped current centre;
- last recenter centre;
- bounded candidate-grid preview;
- accepted class colours where the material supports them.

Candidate points are capped and subsampled for debug rendering. The overlay does not read GPU instance buffers.

Published counters:

```text
stones.ringDebug.enabled
stones.ringDebug.centerX
stones.ringDebug.centerZ
stones.ringDebug.snappedCenterX
stones.ringDebug.snappedCenterZ
stones.ringDebug.lastRecenterX
stones.ringDebug.lastRecenterZ
stones.ringDebug.staleAgeMs
stones.ringDebug.candidateSlots
stones.ringDebug.candidatePointsShown
stones.ringDebug.acceptedCount
stones.ringDebug.telemetryKnown
stones.ringDebug.telemetryFresh
stones.ringDebug.classColoring
stones.ringDebug.lodSingle

understory.ringDebug.*
```

## Compute timings

The timestamp recorder uses WebGPU timestamp queries when supported. Results are copied into rotating readback buffers and mapped asynchronously at a low cadence.

Stone labels:

```text
stones.gpuTiming.clearMs
stones.gpuTiming.worldMs
stones.gpuTiming.indirectMs
stones.gpuTiming.worldViewFused
stones.gpuTiming.hasSeparateViewPass
stones.gpuTiming.pending
stones.gpuTiming.skippedReadbacks
stones.gpuTiming.counterReadbacksSkipped
```

Understory labels:

```text
understory.gpuTiming.clearMs
understory.gpuTiming.world_viewMs
understory.gpuTiming.indirectMs
understory.gpuTiming.worldViewFused
understory.gpuTiming.hasSeparateViewPass
understory.gpuTiming.pending
understory.gpuTiming.skippedReadbacks
```

The current architecture is reported honestly:

- stones: world generation and acceptance are one compute pass; no separate view pass;
- understory: world generation, acceptance, frustum rejection and class selection are fused in `world_view`;
- indirect-argument generation is separate for both systems.

## Render timings

Under `gpuTiming=1`, the existing isolated tree timing pass also renders the named `stones` and `understory` roots into tagged offscreen targets.

Expected GPU profiler rows:

```text
r.treeMain
r.stoneMain
r.understoryMain
```

These extra renders are debug/profile-only. Normal gameplay creates no extra render targets and performs no isolated timing renders.

## Telemetry semantics

Stone count telemetry has three states:

```text
unknown
last-known
fresh
```

When gameplay readbacks are off, CPU-visible counts are `unknown`; zero is not presented as an authoritative GPU result. A later scatter submission preserves the last valid count as `last-known` until a new asynchronous readback completes.

The indirect draw buffers remain authoritative for rendering. Telemetry readbacks never gate draw readiness or the next ring submission.

Understory count readbacks remain low-frequency and asynchronous. CPU parity validation still requires an explicit debug setting.

## Acceptance checklist

Run on native Chrome/WebGPU:

```powershell
npm run typecheck
npm run test -- src/diagnostics/ring_debug_overlay.test.ts src/diagnostics/gpu_timestamp_recorder.test.ts src/app/frame_loop/stats_sync_stone_telemetry.test.ts src/stones/stone_instances.test.ts src/gpu/understory_ring_compute.test.ts
npm run build
```

Visual/debug checks:

1. Open a gameplay scene with `ringDebug=1`.
2. Confirm both outer rings follow the gameplay ring centre.
3. Move less than the configured refresh distance and confirm the last-recenter marker remains fixed.
4. Cross the refresh threshold and confirm the marker and candidate preview move without holes.
5. Confirm stones use large/medium/small debug colours.
6. Confirm understory uses class debug colours.
7. Open with `gpuTiming=1` and confirm `r.stoneMain` and `r.understoryMain` appear.
8. Confirm compute timing counters populate when timestamp queries are supported.
9. Open without readback flags and confirm stone UI reports counts as unknown rather than zero.
10. Confirm normal gameplay has no `mapAsync` count dependency and no extra timing renders.
