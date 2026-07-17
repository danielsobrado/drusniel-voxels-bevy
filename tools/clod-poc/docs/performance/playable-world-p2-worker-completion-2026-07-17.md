# Playable-world P2 collider worker completion

Created 2026-07-17.

## Scope closed

The remaining P2 caveat in `playable-world-contract-2026-07-16.md` was that collider page replacements ran outside the frame callback but still built `MeshBVH` on the JavaScript main thread.

The runtime replacement path now:

1. snapshots positions and indices at enqueue time;
2. transfers a copy to a module worker;
3. builds and serializes `MeshBVH` in the worker;
4. validates the expected live entry after completion;
5. discards superseded results;
6. deserializes and atomically installs the replacement;
7. keeps the old collider serving throughout.

Floating-origin translation now translates loaded geometry and calls `MeshBVH.refit()` instead of discarding every BVH and forcing a later lazy synchronous rebuild. In-flight worker results are requeued when the origin epoch changes.

## Diagnostics

Added counters:

- `collider_worker_build_count`
- `collider_worker_build_total_ms`
- `collider_worker_failures`
- `collider_worker_fallback_builds`
- `collider_jobs_requeued_origin_shift`

Worker failure falls back to the existing pipeline build for collision safety and records the fallback explicitly. It does not count as a frame-path lazy build.

## Automated coverage

`src/terrain/terrain_collider_worker_pipeline.test.ts` covers:

- worker-backed atomic replacement;
- stale in-flight result rejection;
- worker-failure fallback accounting;
- floating-origin BVH refit without a rebuild.

## Native verification required

Run from a native Windows PowerShell shell:

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/terrain/terrain_collider_pipeline.test.ts src/terrain/terrain_collider_worker_pipeline.test.ts src/player/cell_readiness.test.ts src/player/frontier_barrier.test.ts src/terrain/terrain_collider_certification.test.ts
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
npm --prefix tools/clod-poc run baseline:playable
```

For live timing evidence, run the playable route and record the new worker counters together with `collider_queue_latency_max_ms`, `collider_sync_frame_builds`, and frame p95. The P2 gate requires zero runtime lazy frame builds and bounded stale-collider duration.
