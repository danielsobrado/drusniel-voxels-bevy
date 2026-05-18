# NAADF Lighting Plan (Path A)

Status: **planned**, default-off, feature-gated (`naadf`), phased.
Last updated: 2026-05-18
Related: `naadf-implementation-status.md`, `naadf-distance-lod-plan.md`,
`naadf-port-plan.md`, `naadf-local-lights-plan.md`.

This plan is the lighting half of the NAADF roadmap. The geometry / distance
LOD / texture half lives in `naadf-distance-lod-plan.md`; the two share the
foundation tickets `NAADF-200..210`.

---

## Strategy — Path A first

Per `naadf-port-plan.md`, NAADF is a **derived voxel ray-query / GI cache, not
a renderer replacement.** This plan keeps that discipline:

- **Path A (this plan): NAADF as a voxel terrain lighting / ray-query backend.**
  The current renderer keeps drawing the game; NAADF answers visibility / GI /
  occlusion ray queries against edited voxel terrain.
- **Path B (deferred): an optional NAADF preview / far-terrain renderer.** Only
  after the foundation (GPU traversal, mips, AADF skips, CPU/GPU parity) is
  proven — see `NAADF-230`.
- **The current renderer remains the default.** Water, props, vegetation,
  NPCs, buildings, PBR, and the terrain meshes all stay. NAADF never panics or
  takes over; it augments lighting and falls back cleanly.

This is the cautious reading of the SOTA research: adopt its technical
primitives, **do not** adopt its "terrain rendered fully via NAADF" framing as
a first target.

---

## Shared foundation (`NAADF-200..210`)

Both this plan and `naadf-distance-lod-plan.md` build on the same base. It is
specified in detail in the distance-LOD doc; summarised here:

- Sequential **GPU build pipeline** — pass 1 base payload + occupancy, pass 2
  mip-pyramid reduction, pass 3 directional AADF sweeps. Separate sequential
  compute passes, **not** cross-workgroup global barriers in one shader.
- **Split records** — a hot *traversal* buffer (occupancy, AADF skip bounds,
  variance / thin-or-hole flags) and a cold *payload* buffer (material ID,
  albedo/roughness summary, normal summary) fetched only at a confirmed hit.
- The **5-level mip pyramid** (16³→8³→4³→2³→1³, 4681 cells/chunk).
- **Continuous cone-footprint LOD**; primary rays refine partial nodes, GI rays
  accept coarser partial nodes, sun/fog rays stay conservative.
- **Texture parity via explicit `textureSampleLevel`** — compute/ray shaders
  have no implicit screen derivatives, so the NAADF cone footprint must drive
  the texture LOD explicitly:
  `texture_lod = geometry_footprint_lod + material_lod_bias`.

> **Numbering note:** `NAADF-200..210` below is the canonical, finer-grained
> roadmap. It supersedes the coarser `NAADF-200..206` table in
> `naadf-distance-lod-plan.md`; that table should be re-aligned to this scheme.

---

## Lighting roadmap

### Phase 1 — direct visibility (ship-first)

The first real win, and the proof traversal is correct. Builds on the existing
`NAADF-080`/`NAADF-081` query-shader scaffolding.

- **`NAADF-211` NAADF sun visibility.** Drive direct sun shadowing from NAADF
  binary visibility rays. **Sun rays must not force mip 0 everywhere** — near
  cave mouths / openings refine to mip 0, far / long-distance segments use a
  coarse conservative mip, partial nodes count as blocked unless a step budget
  refines them.
- **`NAADF-212` NAADF AO / contact shadow.** Short-range occlusion from NAADF.

### Phase 2 — GI through Radiance Cascades

- **`NAADF-213` Radiance Cascades NAADF traversal backend.** The engine already
  has Radiance Cascades GI with backend selection, a shader-side `trace_gi_backend`
  abstraction, and timing counters (`NAADF-090/091/092`); `NAADF-FIX-005` left
  the real NAADF GI path gated off (`naadf_gi_shader_backend_available()` =
  false). This ticket **wires the real NAADF GI pipeline + bind group** and
  flips that gate — i.e. it replaces the current-SDF lookup *inside* Radiance
  Cascades with NAADF traversal. No new GI algorithm.
- **DDGI / ReSTIR GI / neural radiance cache are deferred to research.** The
  engine already owns Radiance Cascades; the first integration improves what
  exists, it does not swap the GI algorithm.

### Phase 3 — volumetrics

- **`NAADF-214` froxel sun-visibility mask.** A low-resolution froxel grid
  (e.g. 160×90×64), one binary sun-visibility ray per froxel, conservative-mip
  per the `NAADF-211` policy.
- **`NAADF-215` god-ray / fog integration.** Feed the froxel mask into the
  existing screen-space god-ray / volumetric fog path so shafts work for
  **off-screen occluders — caves, tunnels, cliff cuts, carved shafts** — which
  screen-space-only god rays cannot do.

### Supporting

- **`NAADF-216` static-proxy voxelization policy.** Large, persistent static
  actors (buildings, big rock formations, large trees) get a coarse voxel proxy
  so they occlude / contribute to NAADF lighting. Small props, NPCs, water, and
  vegetation detail do **not** — they only consume NAADF lighting.
- **`NAADF-217` temporal invalidation for dirty chunks.** Reject / down-weight
  lighting history when a traversed chunk's revision changed (edits, digging).
- **`NAADF-218` `bench_guard` NAADF lighting thresholds.** Extend the `[naadf]`
  guard block with sun/AO/GI ray-cost and frame-regression limits.

### Path B (deferred)

- **`NAADF-230` optional hybrid primary / far-terrain compositor.** Bind the
  raster depth buffer; abort NAADF primary traversal behind rasterised geometry
  so water / foliage / props / NPCs stay in front. For an *optional* preview /
  far-terrain renderer only — Path A lighting does not need NAADF to own
  primary visibility.

---

## Ticket table

| ID | Title | Notes |
| --- | --- | --- |
| `NAADF-200` | Render-graph GPU dispatch online | Prerequisite — currently scaffolded, not dispatched. |
| `NAADF-201` | Split traversal / payload buffers | Hot occupancy vs cold shading payload. |
| `NAADF-202` | GPU base chunk builder | Pass 1: base payload + occupancy. |
| `NAADF-203` | GPU mip pyramid builder | Pass 2: 16³→1³ reduction. |
| `NAADF-204` | GPU directional AADF sweeps | Pass 3: ±X/±Y/±Z skip distances. |
| `NAADF-205` | CPU/GPU parity harness | Golden chunks + tiered random-ray tests. |
| `NAADF-206` | Dense near-chunk lookup table | + optional hash fallback for the far field. |
| `NAADF-207` | Multi-chunk world traversal | Chunk lookup, boundary crossing. |
| `NAADF-208` | AADF skip traversal | Empty-run leaps using the directional bounds. |
| `NAADF-209` | Continuous cone-footprint LOD | Footprint drives geometry + texture mip. |
| `NAADF-210` | Texture parity (`textureSampleLevel`) | Explicit LOD; shared triplanar/atlas. |
| `NAADF-211` | NAADF sun visibility | Conservative-mip sun rays (not forced mip 0). |
| `NAADF-212` | NAADF AO / contact shadow | Short-range occlusion. |
| `NAADF-213` | Radiance Cascades NAADF backend | Real GI pipeline; flips `naadf_gi_shader_backend_available()`. |
| `NAADF-214` | Froxel sun-visibility mask | Low-res froxel grid, one sun ray each. |
| `NAADF-215` | God-ray / fog integration | Off-screen-occluder shafts. |
| `NAADF-216` | Static-proxy voxelization policy | Large static actors only. |
| `NAADF-217` | Temporal invalidation for dirty chunks | Revision-based history rejection. |
| `NAADF-218` | `bench_guard` NAADF lighting thresholds | Extend the `[naadf]` guard block. |
| `NAADF-230` | Optional hybrid primary / far-terrain compositor | Path B; depth-buffer handshake. |

`NAADF-200..210` are the shared foundation (also in `naadf-distance-lod-plan.md`);
`NAADF-211..230` are lighting-specific.

---

## Design decisions — adopted vs rejected

**Adopted from the SOTA research:** split traversal/payload records; GPU-built
16³→1³ mips; sequential build passes; continuous cone-footprint LOD; explicit
`textureSampleLevel` texture parity; froxel sun visibility for god rays;
tiered CPU/GPU parity gates.

**Rejected / re-scoped:**

| Research proposal | Decision | Reason |
| --- | --- | --- |
| 64×16×64 full-fidelity clipmap (~65k chunks, ~4.9 GB) | **Reject** | Far too large; contradicts its own ≤2.5 GB target. Use a near dense table + far summary + optional hash. |
| Terrain rendered fully via NAADF as the first target | **Reject** | NAADF answers ray queries; the current renderer draws the game. NAADF primary = debug/editor/far experiment (Path B). |
| "Panic gracefully" on VRAM allocation failure | **Reject** | Optional NAADF must never panic — see *Fallback policy*. |
| 10M rays / 100 consecutive CI runs before release | **Reject** | Unrealistic for the workflow — see *Testing tiers*. |
| 32-frame TAA + 8×8 spatial resampling as default | **Re-scope** | Ghosting risk while digging / moving. Configurable; conservative for gameplay, long only for photo/editor preview. |
| Sun rays forced to mip 0 everywhere | **Re-scope** | Too expensive over long rays — conservative-mip policy in `NAADF-211`. |
| Full ReSTIR GI / DDGI / neural radiance cache | **Defer** | Engine already has Radiance Cascades; improve it first (`NAADF-213`). |
| Transform-aware DAG / SVO / NanoVDB compression | **Defer** | Brickmap + mips is the chosen structure; revisit only if benchmarks demand it. |
| Full vegetation / NPC voxelization | **Defer** | Only large static actors get proxies (`NAADF-216`). |

---

## Memory & residency

Reject the giant clipmap. Use a camera-centred **dense near table** plus an
optional far summary / hash fallback, with a hard per-quality memory cap:

```yaml
naadf:
  residency:
    near_table_chunks: [32, 8, 32]
    far_summary_enabled: true
    max_gpu_memory_mb: 512
    max_gpu_memory_mb_high: 1024
    max_gpu_memory_mb_ultra: 1536
```

Each storage buffer stays under the portable wgpu limits (128 MiB max
storage-buffer binding, 256 MiB max buffer, 256-byte offset alignment).

## Fallback policy

NAADF is optional — it **never panics**. On VRAM allocation failure or any
unrecoverable NAADF error:

```rust
warn!("NAADF allocation failed: {reason}; falling back to current renderer");
settings.resolved_voxel_backend = VoxelRayBackendMode::CurrentSdf;
naadf_state.disabled_reason = Some(reason);
```

The current renderer continues, the bench records the fallback reason, and the
debug UI shows it. This extends NAADF's existing `fallback_reason` /
stale-cache fallback (`NAADF-111`).

## Temporal policy

Configurable history depth — conservative for gameplay (digging / camera
motion would ghost under aggressive accumulation), long only for static
preview:

```yaml
naadf:
  temporal:
    enabled: true
    max_history_frames: 8
    preview_max_history_frames: 32
    spatial_window: 3
    preview_spatial_window: 8
```

History is rejected per `NAADF-217` when a traversed chunk's revision changed.

## Testing tiers

| Tier | Coverage |
| --- | --- |
| Unit | 1k deterministic rays; CPU/GPU parity on golden chunks. |
| CI smoke | 10k rays. |
| Nightly / manual | 1M rays. |
| Release candidate | visual benches + `bench_guard` + selected edit-stress scenes. |

CPU/GPU parity (`NAADF-205`) is the hard gate: hit/miss agreement, hit-distance
within ≤ 0.5 base voxel, material parity on refined primary hits.

---

## Deferred / out of scope

- Full NAADF primary renderer (Path B beyond `NAADF-230`).
- Full ReSTIR GI, DDGI, neural radiance cache.
- DAG / SVO / NanoVDB far-field compression.
- Full vegetation / NPC voxelization.
- The 64×16×64 full-fidelity clipmap (rejected outright).

## Constraints

- `VoxelWorld` stays authoritative; NAADF remains a derived cache.
- Behind the `naadf` feature, **default-off**; integrated-GPU policy unchanged.
- The current renderer's behaviour is unchanged unless the user opts in.
- Match the existing NAADF module/shader style and the `NAADF-NNN` scheme.
