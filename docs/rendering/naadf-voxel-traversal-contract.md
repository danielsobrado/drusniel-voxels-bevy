# NAADF Voxel Traversal Contract

Document status: 2026-06-07. Documentation-only runbook.

This document describes how Drusniel should use Amanatides/Woo-style grid DDA
for voxel ray traversal. The goal is one shared contract for CPU ray queries,
WGSL NAADF traversal, debug picking, backend parity checks, sun visibility,
terrain AO, contact shadows, and fog/god-ray occlusion.

This is not a mesh topology fix. DDA ray traversal does not close Surface Nets
LOD cracks, fix transition geometry, or replace MC+Transvoxel/stitch work. LOD
seams still need mesh-side transition geometry and shared scalar/boundary data.

## Why This Helps

- Reduces drift between CPU current-SDF rays, CPU NAADF rays, and WGSL NAADF
  rays.
- Makes `runtime.compareNaadfRay` failures easier to diagnose because all paths
  can be checked against the same stepping semantics.
- Prevents wrong early hits when a broadphase object or proxy is listed in one
  voxel but the actual intersection is farther along the ray.
- Gives preview, sun visibility, terrain AO, contact shadow, GI secondary, fog,
  god-ray, and debug rays one shared mental model.
- Keeps traversal work tied to measurable counters and fixed-scene visual
  evidence instead of subjective performance claims.

## Canonical Contract

Every Drusniel voxel ray walker should follow this contract unless a call site
documents a narrower reason to differ.

1. Normalize the ray direction. A zero or invalid direction is an immediate
   miss with zero steps.
2. Clamp traversal to the caller's `max_distance` and to loaded/resident world
   bounds. Missing chunks are not implicit solid terrain.
3. Convert world position to the starting voxel or chunk using floor semantics,
   including negative coordinates.
4. Compute per-axis `step`, `t_max`, and `t_delta`:
   - `step` is `1` or `-1` from the sign of the normalized direction.
   - `t_max` is the ray distance to the next voxel/chunk boundary on each axis.
   - `t_delta` is the ray distance needed to cross one voxel/chunk on each axis.
   - Axis-aligned directions must use infinity or an equivalent finite guard so
     a zero component never becomes a chosen crossing axis.
5. Visit cells in increasing ray-distance order. At each iteration:
   - resolve the current chunk;
   - resolve local voxel or NAADF block/mip state;
   - test for a hit;
   - choose the smallest `t_max` axis;
   - advance the cell/chunk coordinate by `step`;
   - add `t_delta` to the chosen `t_max`;
   - update the face normal from the crossed axis.
6. Stop on first valid hit, clean exit, distance clamp, or step budget.
7. Return hit/miss plus step count, hit voxel/chunk/local coordinate, material,
   normal, and miss reason where the call site supports it.

The shared shape is:

```text
ray origin
-> normalize direction
-> clamp to max distance and loaded bounds
-> chunk lookup
-> voxel/block/chunk DDA step
-> hit or miss
-> t_exit validation for delayed/proxy hits
```

## Existing Implementation Map

Current CPU SDF path:

- `src/rendering/voxel_ray_backend.rs`
- `trace_voxel_world_cpu`
- `CurrentSdfRayBackend`

CPU NAADF path:

- `src/rendering/naadf/cpu_trace.rs`
- `NaadfCpuRayBackend`
- `trace_with_skip`
- `trace_chunks_with_skip`

WGSL NAADF world path:

- `assets/shaders/naadf/world_trace.wgsl`
- `trace_naadf_world`
- `trace_naadf_world_lod`

WGSL NAADF chunk path:

- `assets/shaders/naadf/ray_trace.wgsl`
- `trace_naadf`
- `trace_naadf_lod`
- `trace_naadf_chunk`
- `trace_naadf_chunk_lod`

Consumers:

- `assets/shaders/naadf/first_hit.wgsl`
- `assets/shaders/naadf/lighting_queries.wgsl`
- `assets/shaders/naadf/gi_trace.wgsl`
- `assets/shaders/radiance_cascades.wgsl`
- `src/rendering/naadf/debug.rs`
- `src/rendering/naadf/entities.rs`

If a future ray query needs voxel traversal, prefer routing it through these
existing backend abstractions before adding a new walker.

## `t_exit` Hit Validation

The key Amanatides/Woo validation rule is:

```text
accept the candidate only when t_hit <= current_voxel_exit_t
```

`current_voxel_exit_t` is the smallest current `t_max` value before stepping out
of the current voxel or broadphase cell. This replaces six coordinate checks for
"is the hit point inside the current cell" with one distance comparison.

Use this when an object, proxy, or analytical volume is discovered through a
cell list but the true intersection may occur later than the current cell. If
`t_hit > current_voxel_exit_t`, keep the candidate as the current best delayed
hit and continue traversal. Accept it only when traversal reaches the cell whose
exit distance contains the candidate, or when no closer blocking hit appears.

Current direct voxel occupancy hits can remain immediate because the occupied
voxel itself is the surface being tested. Future proxy/broadphase overlays
should use the `t_exit` rule.

## Proxy Dedupe Guidance

The paper's `rayID` idea is useful for CPU-side broadphase overlays: give each
ray a unique ID and skip re-testing an object whose last-tested ray ID matches.
Use that only for CPU structures where mutation is controlled, such as:

- editor selection volumes;
- prop/building/tree proxy occluders;
- water-body bounds;
- NPC/body hit proxies;
- debug-only analytical volumes.

Do not copy mutable `object.last_ray_id` directly into GPU tracing. GPU rays run
in parallel, so shared mutable per-object ray IDs are unsafe and nondeterministic
without synchronization. On GPU, accept duplicate tests first, or use a per-ray
small local dedupe list/bitset only after profiling shows duplicate proxy tests
are a real bottleneck.

## Executable Usage

Run focused CPU/backend checks:

```bash
rtk cargo test --lib rendering::voxel_ray_backend
rtk cargo test --features naadf --test naadf_cpu_layout
```

Run focused GPU/layout checks:

```bash
rtk cargo test --features naadf --test naadf_gpu_layout
```

Compare a current-SDF ray against a CPU NAADF ray through the runtime command:

```json
{
  "type": "runtime.compareNaadfRay",
  "origin": [256.0, 82.0, 220.0],
  "direction": [1.0, -0.2, 0.0],
  "maxDistance": 96.0,
  "purpose": "debug"
}
```

Use purpose-specific comparisons when debugging a rendering query:

```json
{
  "type": "runtime.compareNaadfRay",
  "origin": [256.0, 82.0, 220.0],
  "direction": [0.4, 0.8, -0.1],
  "maxDistance": 128.0,
  "purpose": "sun_visibility"
}
```

Supported purpose strings are parsed by `VoxelRayPurpose` and include:

- `debug`
- `sun_visibility`
- `gi_secondary`
- `terrain_ao`
- `contact_shadow`
- `preview_primary`

Enable ray-step visualization only for focused debugging:

```yaml
debug:
  visualize_chunks: false
  visualize_ray_steps: true
  visualize_aadf_bounds: false
  compare_cpu_gpu: false
  force_cpu_builder: false
  force_gpu_builder: false
```

Use the debug UI to inspect:

- selected/effective voxel ray backend;
- experimental render mode;
- cache residency and dirty/in-flight work;
- last-frame average ray steps;
- max ray steps where available;
- fallback reason.

## Benchmark Workflow

Any traversal change can affect rendering, frame timing, NAADF preview, lighting
queries, fog/god-ray queries, or debug ray cost. Measure before and after.

Run the preview-only scene for NAADF traversal cost without legacy terrain,
water, buildings, shadows, reflections, or prop queues:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
```

For broader NAADF A/B work, use the matching current and NAADF scenes:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-current.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-gi.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-live-lod.toml
```

After each bench, inspect:

- `bench-runs/<run>/summary.json`;
- fixed checkpoint screenshots in the same run directory;
- `naadf.avg_ray_steps_last_frame`;
- `naadf.max_ray_steps_last_frame`;
- miss-reason counters if the run records them;
- frame-time rows relevant to the changed query path.

Run the guard:

```bash
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

For A/B comparisons where the guard accepts multiple summaries:

```bash
rtk cargo run --bin bench_guard -- bench-runs/<before-run>/summary.json bench-runs/<after-run>/summary.json
```

Do not add broad timing rows together. Some rows are parent/child or overlapping
brackets. Report the specific rows and counters that changed.

## Acceptance Checklist For Future Traversal Changes

Before accepting a traversal implementation change:

- CPU and WGSL paths use the same `step`, `t_max`, `t_delta`, axis tie, boundary,
  and distance-clamp semantics, or the difference is documented at the call site.
- Tests cover negative coordinates, starts on voxel/chunk boundaries,
  axis-aligned rays, zero direction components, chunk crossings, exact voxel
  exits, misses, and step-budget exhaustion.
- Current-SDF and NAADF CPU parity is checked with `runtime.compareNaadfRay` or
  focused fixtures.
- GPU-facing behavior is covered by `naadf_gpu_layout` or an equivalent focused
  shader test.
- Bench evidence includes before/after `summary.json`, screenshot inspection,
  ray-step counters, and `bench_guard`.
- The result does not claim to fix mesh LOD seams unless a separate mesh/topology
  benchmark and visual investigation proves that path.

## Future Work

These are implementation targets, not current requirements for this doc:

- Extract a single CPU `VoxelGridRayStepper` helper if the current-SDF, CPU
  NAADF, and entity-volume DDA loops begin drifting.
- Add explicit delayed-hit bookkeeping for CPU proxy overlays using
  `t_hit <= current_voxel_exit_t`.
- Add GPU proxy dedupe only after counters show duplicate proxy tests dominate
  traversal cost.
- Add fixed-point or integer DDA only for deterministic editor/server tools
  where float parity is proven insufficient.
