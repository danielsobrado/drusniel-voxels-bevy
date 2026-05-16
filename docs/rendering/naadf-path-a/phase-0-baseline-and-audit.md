# Phase 0 — Baseline and Audit

Status: complete
Depends on: none
Produces code: no

## Goal

Establish the "before" measurement that every later phase compares against,
and confirm two integration facts that, if wrong, silently break every later
phase.

## Why

Path A is a change to the GI path. Per `CLAUDE.md`, no GI change can claim a
result without a before/after `summary.json` comparison. Phase 0 captures the
before. It also verifies the coordinate-space assumption the NAADF traversal
shaders depend on.

## Work

### 0.1 Archive the SDF GI baseline

- Run the GI bench scene:

  ```powershell
  rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
  ```

- Copy the resulting `bench-runs/<run>/summary.json` and fixed-checkpoint
  screenshots into a stable location referenced by this plan, e.g.
  `docs/rendering/naadf-path-a/baseline/`.
- Record: median frame time, p99, the GI-related timing rows, and the
  `voxel_backend` value used (must be `CurrentSdf`).

### 0.2 Confirm world-unit / voxel scale

- The NAADF world traces (`naadf_gi_trace_world` in `gi_trace.wgsl`,
  `preview_naadf_first_hit_world` in `first_hit.wgsl`) assume chunk coords are
  `floor(world_pos / 16)` and 1 voxel = 1 world unit.
- The radiance cascades work in world space (`sdf_volume_min/max`,
  `world_to_sdf_uvw`).
- Confirm `VoxelWorld` world space and the radiance-cascade world space use
  the same units, and that 1 unit = 1 NAADF voxel.
- If any scale or offset exists, document the exact conversion. Every later
  phase must apply it when constructing NAADF rays.

### 0.3 Audit the cascade bind groups

- Read `src/rendering/radiance_cascades.rs` bind group layout construction.
- Identify which `@group` the cascade compute pass uses and which binding
  indices are free, so Phase 2 knows where to attach the NAADF buffers.
- Note whether the cascade pass already has access to the render-world
  `NaadfGpuBuffers` resource, or whether an extract step is needed.

### 0.4 Map the live GI query points

- In `radiance_cascades.wgsl`, list every call site of `trace_gi_backend`,
  `soft_shadow_backend`, and `terrain_ao_backend`, and which query mask each
  uses (`NAADF_QUERY_GI_SECONDARY`, `NAADF_QUERY_SUN_VISIBILITY`,
  `NAADF_QUERY_TERRAIN_AO`, `NAADF_QUERY_CONTACT_SHADOW`).
- This is the work surface for Phases 3, 5, and 6.

## Acceptance criteria

- [x] SDF GI baseline `summary.json` and screenshots archived and linked.
- [x] World-unit / voxel scale confirmed and written down (with the
      conversion, if any).
- [x] Free cascade bind group slots identified for Phase 2.
- [x] All GI backend query call sites enumerated with their query masks.

## Results

Completed: 2026-05-16

### 0.1 Archived SDF GI baseline

Baseline run:

- Source run: `bench-runs/2026-05-16T11-30-42Z/summary.json`
- Archived summary: [baseline/visual-regression-naadf-gi-summary.json](baseline/visual-regression-naadf-gi-summary.json)
- Archived screenshot: [baseline/visual-regression-naadf-gi-settled.png](baseline/visual-regression-naadf-gi-settled.png)
- Scene: `visual-regression-naadf-gi.toml`
- Checkpoint: `naadf-gi-experimental`
- Median frame time: `12.3097 ms`
- P99 frame time: `42.701 ms`
- Ready wait: `10.0063 s`
- Render-ready wait: `1.1570 s`

Backend note: the bench scene requests `voxel_ray_backend = "naadf"` and
`experimental_render_mode = "current_with_naadf_gi"` so the fallback gate is
exercised. `naadf_gi_shader_backend_available()` currently returns `false`, so
`apply_radiance_backend_selection_with_shader_support()` resolves the radiance
cascade backend to `CurrentSdf`. The archived run is therefore the SDF GI
baseline. The counters agree: `naadf.gi_rays_last_frame = 0`, GPU slots used
`0 / 384`, and NAADF preview dispatch counters are all zero.

GI/NAADF-related timing rows from the archived run:

| Row | Median | P99 | Unit |
| --- | ---: | ---: | --- |
| `GPU main_opaque_pass_3d` | `0.0248` | `0.032` | ms |
| `RenderGraph CPU main_opaque_pass_3d` | `0.0126` | `0.019` | ms |
| `NAADF Cache Rebuild` | `0.0002` | `0.001` | ms |
| `NAADF Chunk Table Sync` | `0.0001` | `0.001` | ms |
| `NAADF Dirty Queue` | `0.0` | `0.0` | ms |
| `NAADF Entity Sync` | `0.0000` | `0.001` | ms |
| `NAADF GPU Upload CPU` | `0.0` | `0.0` | ms |
| `NAADF Streaming` | `0.0` | `0.0` | ms |
| `NAADF Upload Queue` | `0.0` | `0.0` | ms |

### 0.2 World-unit / voxel scale

Confirmed: no scale or offset conversion is needed for Path A.

- `src/constants.rs` defines `CHUNK_SIZE = 16` and `VOXEL_SIZE = 1.0`.
- `VoxelWorld` samples integer world voxel positions directly and derives
  chunk/local positions from those integer coordinates.
- `src/rendering/naadf/layout.rs::chunk_world_origin()` returns
  `chunk_pos * CHUNK_SIZE`.
- `assets/shaders/naadf/layout.wgsl::naadf_chunk_world_origin()` returns
  `chunk_pos * vec3<i32>(16i)`.
- Radiance-cascade SDF generation samples
  `world_pos = sdf_world_min + uvw * volume_size`, then
  `voxel_pos = world_pos.as_ivec3()`.
- `assets/shaders/radiance_cascades.wgsl::world_to_sdf_uvw()` uses the same
  world-space position directly against `params.sdf_volume_min/max`.

Conversion for later phases:

```text
naadf_chunk = floor(world_pos / 16)
naadf_voxel = floor(world_pos)
world units per voxel = 1.0
extra offset = none
```

### 0.3 Cascade bind-group audit

`assets/shaders/radiance_cascades.wgsl` currently uses only `@group(0)`:

| Binding | Resource |
| ---: | --- |
| 0 | `params` uniform |
| 1 | `sdf_volume` |
| 2 | `sdf_sampler` |
| 3 | `gbuffer_depth` |
| 4 | `gbuffer_normal` |
| 5 | `gbuffer_albedo` |
| 6 | `radiance_cascade_0` |
| 7 | `radiance_cascade_1` |
| 8 | `radiance_cascade_2` |
| 9 | `radiance_cascade_3` |
| 10 | `history_texture` |
| 11 | `blue_noise` |
| 12 | `linear_sampler` |

Bindings `13+` in `@group(0)` are currently free in the shader. A cleaner
Phase 2 option is to add a dedicated `@group(1)` NAADF bind group, because the
NAADF record set is larger than the current SDF/G-buffer group and mirrors the
preview pipeline's ownership.

There is no real render-app cascade pipeline or bind group layout construction
in `src/rendering/radiance_cascades.rs` yet; the plugin currently updates main
world resources and notes that render-app systems would be added later.

`NaadfGpuBuffers` is already initialized in the render world by
`src/rendering/naadf/mod.rs`, and the NAADF prepare/upload systems populate it
there. Radiance cascades does not currently access that render-world resource.
Phase 2 should add render-app cascade pipeline code that reads
`Res<NaadfGpuBuffers>` directly in the render world; an extra main-world
extract step is not needed for the buffers themselves.

### 0.4 Live GI query points

Call sites in `assets/shaders/radiance_cascades.wgsl`:

| Function / line | Backend call | Query mask |
| --- | --- | --- |
| `compute_direct_lighting` / line 313 | `soft_shadow_backend(...)` | `NAADF_QUERY_SUN_VISIBILITY` inside `soft_shadow_backend` |
| `trace_probe_ray` / line 369 | `trace_gi_backend(origin, direction, max_dist, NAADF_QUERY_GI_SECONDARY)` | `NAADF_QUERY_GI_SECONDARY` |
| `composite_gi` / line 480 | `terrain_ao_backend(world_pos)` | `NAADF_QUERY_TERRAIN_AO` inside `terrain_ao_backend` |

`NAADF_QUERY_CONTACT_SHADOW` exists in `src/rendering/radiance_cascades.rs`
but has no live shader call site in `radiance_cascades.wgsl` yet. Phase 5
must add the contact-shadow query site before it can route that mask.

## Verification

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
```

## Risks

- A hidden scale between `VoxelWorld` and cascade world space is the single
  most dangerous unknown. If it exists and is missed, NAADF rays trace the
  wrong place and every phase looks broken for the wrong reason.

## Exit gate

Baseline archived, coordinate space confirmed, integration surface mapped. No
code shipped.
