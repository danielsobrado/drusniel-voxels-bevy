# NAADF Distance LOD + Texture Parity Plan

Status: **planned**, default-off, feature-gated (`naadf`), phased.
Last updated: 2026-05-18
Related: `naadf-implementation-status.md`, `naadf-port-plan.md`,
`naadf-local-lights-plan.md`, `docs/lod/lod-terrain-hole-investigation.md`
(why the legacy mesh renderer cannot do seamless LOD).

---

## Why distance LOD belongs on the NAADF side

NAADF is a **ray-marched, derived voxel field** (`VoxelWorld` → packed
`NaadfChunk`: 4³ blocks of 4³ voxels, traversed by DDA with per-block
directional skip bounds). It is **not a triangle mesh**.

Therefore the entire mesh-LOD-seam problem — skirts, transition cells, vertex
welding, the ledge artifact that consumed the legacy-renderer investigation —
**does not exist here.** A coarse far region and a fine near region compose
automatically: the ray simply changes step size at the boundary. LOD on NAADF
is *seam-free by construction*. That is the reason to do terrain LOD here and
do it well.

What NAADF lacks today is LOD at all: every resident chunk is full 16³
resolution, which is heavy in memory, upload bandwidth, and ray steps.

---

## Design principles (the "think twice" outcome)

1. **Continuous cone-footprint LOD, not discrete tiers.** An earlier sketch used
   Near/Mid/Far buckets. Discrete tiers *pop* at bucket boundaries and alias.
   The correct model: each ray, at each point along it, samples the hierarchy
   level whose node size ≈ the ray's **cone footprint** at that distance — i.e.
   mip-mapped DDA / voxel cone tracing. Continuous, anti-aliased, no pop.
2. **One footprint drives everything.** The same cone footprint that selects the
   geometry mip level *also* selects the **texture mip level**. Geometry LOD and
   texture LOD share one source of truth — elegant, and correct by construction.
3. **GPU-first.** The mip pyramid is **built on the GPU** by a compute
   downsample pass from the uploaded base level — never CPU-built-and-uploaded
   (that would multiply upload bandwidth). The CPU builder stays only as the
   parity reference. Traversal LOD lives in the ray-march shader.
4. **Extend the brickmap, don't rewrite to an octree.** NAADF is already a
   brickmap (chunk → block → voxel) — fixed-size, GPU-friendly, easy to index.
   Add explicit per-chunk mip levels + a coarse inter-chunk grid. A full sparse
   voxel octree / DAG rewrite is not warranted; DAG dedup is noted as an
   optional far-future memory optimisation only.
5. **Residency LOD is a memory decision derived from the same footprint.** Don't
   build/upload fine voxels for a chunk no camera ray will ever sample finely.
6. **Traversal touches occupancy only.** A marching ray reads occupancy + skip
   bounds — a small "hot" record. Material / albedo / normal live in a separate
   "cold" payload record fetched only at a confirmed hit, so empty-space steps
   never pollute the cache with shading data.

---

## Current state and hard prerequisite

Per `naadf-implementation-status.md`: NAADF is **CPU-built**, GPU buffers and
GPU build/traverse shaders are **scaffolded but not dispatched** (NAADF-FIX-002
disabled the GPU build queue; GPU dispatch/readback "still not run").

**Prerequisite NAADF-200 — GPU build/traverse dispatch online.** The mip
pyramid is GPU-built and the cone-LOD traversal lives in the ray-march shader,
so the GPU compute/traverse path NAADF already lists as remaining work must
actually dispatch first. Until then, only the CPU-side parity reference and the
residency/streaming logic can be exercised. This plan does not re-scope that
work — it depends on it.

---

## The design

### A. Per-chunk mip pyramid + inter-chunk coarse grid

Each `NaadfChunk` gains an explicit **5-level pyramid**:

| Level | Grid | Cells |
| --- | --- | --- |
| L0 — base voxels | 16³ | 4096 |
| L1 | 8³ | 512 |
| L2 — the existing 4³ block grid | 4³ | 64 |
| L3 | 2³ | 8 |
| L4 — root summary | 1³ | 1 |

That is **4681 cells per chunk** (585 summary cells above the base). NAADF's
current 4³-block grid *is* L2 — formalise it, add L1/L3/L4. Above the chunk, an
**inter-chunk coarse grid** (one occupancy bit + dominant material per chunk,
plus a level above it) makes very-distant terrain and sky-scale occlusion
near-free to trace.

**Split each cell into a hot traversal record and a cold payload record**, in
separate buffers:

- *Traversal record* — occupancy state (empty/solid/mixed), child-occupancy
  mask, directional AADF skip bounds, and a **thin-or-hole flag**. This is all
  a marching ray touches.
- *Payload record* — dominant material ID, albedo summary, normal summary.
  Fetched **only at a confirmed hit**, never during traversal.

Keeping shading attributes out of the traversal hot path avoids cache pollution
on every empty-space step.

**Build:** a GPU compute downsample pass (`build_blocks.wgsl` /
`build_bounds.wgsl` extended) — upload only the L0 base; the GPU derives L1–L4
and the inter-chunk grid, each level reducing the one below and taking the
**dominant material** (`NAADF-FIX-003` policy). **Whole-chunk rebuild on edit**
is the baseline — a 16³ chunk is cheap to rebuild fully and easy to benchmark;
keep a dirty AABB only to prioritise uploads, defer incremental partial
rebuilds until counters justify them.

**Buffer sizing:** use a fixed resident-slot model (slot → fixed buffer region,
no dynamic offsets) and keep each storage buffer under the portable wgpu limits
(128 MiB max storage-buffer *binding*, 256 MiB max buffer, 256-byte offset
alignment).

### B. Mipped directional bounds (AADF)

The per-block directional skip bounds are NAADF's empty-space accelerator. Each
mip level needs its **own** bounds so coarse traversal also skips empty space.
The bounds builder runs per level in the same compute pass.

### C. Continuous cone-footprint LOD in traversal

In the ray-march shader (`ray_trace.wgsl` / `world_trace.wgsl`):

- Carry a **cone**: origin footprint + spread (camera FOV / pixel size for
  primary rays; the GI/AO cone half-angle for secondary rays).
- At each step, compute the footprint radius `r(t)` and select the mip level
  whose node size ≈ `r(t)`. March that level (bigger steps, fewer cells), using
  that level's directional bounds for empty-skip.
- **Per-purpose bias.** The footprint is shared, but the level it selects is
  biased by ray purpose: **primary** rays bias *finer* (negative bias) and
  descend aggressively; **secondary** rays (AO / GI / fog occlusion) tolerate
  coarser levels (positive bias). One footprint, purpose-specific use.
- **Thin-or-hole preservation — the critical caveat.** A coarse cell that is
  merely "mixed" can still contain a narrow cave mouth, slit, arch or overhang
  that *disappears* if the ray stops at that level. Cells the mip builder flags
  `thin-or-hole` (from low/high-but-mixed child occupancy, or high normal
  variance) **force a finer descent regardless of the footprint**. Geometry LOD
  must be silhouette- and hole-preserving first; only then may the footprint
  coarsen it.
- **Inter-level blend:** optionally sample the two bracketing levels and blend
  by the fractional footprint, with a small blue-noise jitter at thresholds, so
  LOD transitions are temporally filterable rather than a visible pop.
- Result: near terrain at voxel resolution, far terrain at block/chunk
  resolution, continuous — **no tier boundary and no seam**.

### D. Footprint-derived residency / streaming

- `streaming.rs` already does radius-based residency. Extend: for each resident
  chunk, compute the **finest mip level any camera ray could need** from its
  distance (its minimum possible cone footprint). Build/upload only down to
  that level.
- Far chunks keep only coarse levels — dropping the 4096 raw voxel records is
  ~64× smaller per chunk. The `max_gpu_memory_mb` budget then covers a far
  larger radius for the same memory.
- Hysteresis on the level threshold (reuse the existing `hysteresis_chunks`
  pattern) so a chunk doesn't rebuild every time the camera nudges.

### E. Textured first-hit — parity with the legacy renderer

NAADF preview currently shades hits with a flat per-material colour palette
(`NAADF-121`). For visual parity with the legacy terrain renderer it must
sample the **same textures**:

- Bind the **shared terrain texture atlas / array** (`atlas.rs`,
  `array_loader.rs`, the mipmapped atlas from `mipmaps.rs`) into the NAADF
  preview pipeline.
- At a hit, map the NAADF stable **material ID → atlas index** (the same
  mapping the legacy mesher uses, e.g. `get_blocky_material_index` /
  `get_face_atlas_index`).
- **Triplanar sampling** in `first_hit.wgsl` from world position + hit normal
  (matching `triplanar_terrain.wgsl`); a blocky-mode path matching
  `blocky_terrain.wgsl` as a follow-up.
- **Texture mip = the cone footprint** from section C. One footprint feeds both
  selections — but geometry LOD applies the conservative thin-or-hole bias,
  while texture sampling uses the footprint directly (a slightly finer mip for
  primary-hit normal maps is fine). Anti-aliased terrain at any distance for
  no extra footprint work.
- At coarse geometry LOD the node's dominant material drives the texture; the
  coarse footprint naturally selects a coarse texture mip — consistent.

Texturing (E) only needs the first-hit shader + the atlas binding + the cone
footprint; it does **not** depend on the mip pyramid (A–D) and can land in
parallel. Water and props parity stay out of scope for this plan.

---

## Performance levers (all GPU-side)

- **Cone-LOD itself** — far rays take block/chunk-sized steps; the dominant win.
- **Mipped directional bounds** — empty-space skipping at every level.
- **Coarse beam pre-pass (optional)** — trace a low-res first-hit/depth pass,
  use it to bound full-res ray `t` ranges (a classic SVO speed-up).
- **DAG dedup of coarse subtrees (optional, future)** — far chunks downsample
  to many identical coarse nodes (uniform ground/sky); deduplicating them makes
  far-LOD memory nearly free and lets far more terrain stay resident.
- Keep CPU build only as the parity oracle; production build/trace is GPU.

---

## Phased plan (`NAADF-200..210` — shared foundation)

`NAADF-200..210` is the **canonical foundation roadmap**, shared with
`naadf-lighting-plan.md` (which owns the lighting-specific `NAADF-211..230`).
The rows below are that scheme; the distance-LOD and texture-parity detail this
doc contributes is noted per ticket and in design sections A–E above.

| ID | Title | This doc's detail | Files (primary) |
| --- | --- | --- | --- |
| `NAADF-200` | Render-graph GPU dispatch online | Hard prerequisite — currently scaffolded, not dispatched. | `prepare.rs`, `pipeline.rs`, `gpu_buffers.rs` |
| `NAADF-201` | Split traversal / payload buffers | Hot occupancy + AADF bounds vs cold material / albedo / normal (§A). | `layout.rs`, `gpu_buffers.rs` |
| `NAADF-202` | GPU base chunk builder | Pass 1 — base payload + occupancy. | `build_blocks.wgsl`, `cpu_builder.rs` (parity ref) |
| `NAADF-203` | GPU mip pyramid builder | Pass 2 — L0→L4 pyramid (§A) + inter-chunk grid; whole-chunk rebuild baseline. | `build_blocks.wgsl`, `layout.rs` |
| `NAADF-204` | GPU directional AADF sweeps | Pass 3 — per-level bounds (§B); sets the **thin-or-hole flag**. | `build_bounds.wgsl`, `layout.rs` |
| `NAADF-205` | CPU/GPU parity harness | Mip / bounds / cone-LOD trace vs the full-res CPU reference. | `gpu_tests.rs`, `naadf_cpu_layout` |
| `NAADF-206` | Dense near-chunk lookup table | + **footprint-derived residency** (§D) — build/upload only the mip levels a chunk needs. | `streaming.rs`, `cache.rs` |
| `NAADF-207` | Multi-chunk world traversal | Chunk lookup + boundary crossing. | `world_trace.wgsl` |
| `NAADF-208` | AADF skip traversal | Empty-run leaps using the mipped directional bounds. | `ray_trace.wgsl`, `world_trace.wgsl` |
| `NAADF-209` | Continuous cone-footprint LOD | Per-purpose bias, thin-or-hole forced descent, inter-level blend (§C). | `ray_trace.wgsl`, `world_trace.wgsl`, `gi_trace.wgsl` |
| `NAADF-210` | Texture parity (`textureSampleLevel`) | Shared atlas, triplanar, cone-footprint texture mip (§E). *Independent of 202–209.* | `first_hit.wgsl`, `pipeline.rs`, `preview.rs` |

`NAADF-211..230` (lighting, volumetrics, the optional Path-B compositor) live in
`naadf-lighting-plan.md`; tuning and `bench_guard` thresholds are tracked there
as `NAADF-218`. This doc's bench requirement is in *Tests and gates* below.
Optional future memory/speed work (DAG dedup of coarse subtrees, a coarse beam
pre-pass) is noted under *Performance levers*.

---

## Tests and gates (NAADF's existing model)

- **CPU parity first.** Every GPU pass has a CPU reference: mip downsample,
  mipped bounds, and cone-LOD trace all compared against the full-resolution
  CPU trace within a documented tolerance, via the `naadf_cpu_layout` fixture
  harness and `compare_backend_ray`.
- **GPU parity next.** The `gpu_tests.rs` harness — coarse-level GPU hits vs CPU
  hits; textured-hit material/atlas-index parity.
- **No-pop check.** A camera dolly test: cone-LOD output must not show LOD
  discontinuities frame-to-frame (the inter-level blend exists for this).
- **Bench (required by `CLAUDE.md`).** Run the NAADF benches
  (`visual-regression-naadf-preview.toml`, `…-gi.toml`, `…-live-lod.toml`);
  capture `bench-runs/<run>/summary.json`; run `bench_guard`. Resident memory,
  avg/max ray steps, and frame time must improve with no near-field visual
  regression. No perf claim without before/after numbers.
- All `naadf`-feature-gated; `cargo check` (no feature) stays green.

---

## Constraints

- `VoxelWorld` stays authoritative; NAADF remains a derived cache.
- Everything behind the `naadf` feature, **default-off**, integrated-GPU policy
  unchanged.
- Production renderer behaviour unchanged unless the user opts into the NAADF
  preview path.
- Match existing NAADF module/shader style and the `NAADF-NNN` Jira scheme.

## Out of scope

- **NAADF-backed lighting** — sun visibility, AO, DDGI / GI, volumetric fog and
  god rays, and the temporal / SVGF-style denoising stack. These are valuable
  and a separate, *larger* plan; this doc is **geometry LOD + texture parity
  only**. The traversal core, mip pyramid, and split records here are the
  foundation that lighting plan would build on. (Note: NAADF's stated role per
  `naadf-port-plan.md` is a ray-query / GI cache, not a renderer replacement —
  a lighting plan must reconcile with the engine's existing Radiance Cascades
  GI rather than assume a greenfield GI choice.)
- Water and prop texturing / rendering parity (separate follow-up).
- Full sparse-voxel-octree / DAG rewrite (brickmap + mips is the chosen
  structure; DAG dedup is an optional future memory phase only).
- Replacing the production renderer — NAADF stays the experimental preview path
  until its own release gate says otherwise.
