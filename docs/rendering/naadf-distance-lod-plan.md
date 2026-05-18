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

- Each `NaadfChunk` gains downsampled levels: `16³ → 8³ → 4³ → 2³ → 1³`
  occupancy + **dominant material** per node (reuse the `NAADF-FIX-003`
  dominant-material policy). The existing 4³-block grid is already the 4× level
  — formalise it as mip 2 and fill in the rest.
- An **inter-chunk coarse grid**: one occupancy bit (and dominant material) per
  chunk, and a level above that, so very-distant terrain and sky-scale
  occlusion are near-free to trace.
- Built by a **GPU compute downsample pass** (`build_blocks.wgsl` /
  `build_bounds.wgsl` extended): each level reduces the one below. Upload only
  the base; the GPU derives the pyramid.

### B. Mipped directional bounds (AADF)

The per-block directional skip bounds are NAADF's empty-space accelerator. Each
mip level needs its **own** bounds so coarse traversal also skips empty space.
The bounds builder runs per level in the same compute pass.

### C. Continuous cone-footprint LOD in traversal

In the ray-march shader (`ray_trace.wgsl` / `world_trace.wgsl`):

- Carry a **cone**: origin footprint + spread (from camera FOV / pixel size for
  primary rays; from the GI/AO cone half-angle for secondary rays).
- At each step, compute the footprint radius `r(t)` and select the mip level
  whose node size ≈ `r(t)`. March that level (bigger steps, fewer cells), using
  that level's directional bounds for empty-skip.
- **Inter-level blend:** optionally sample the two bracketing levels and blend
  by the fractional footprint, to remove residual popping (trilinear-in-LOD).
- Result: near terrain traced at voxel resolution, far terrain at block /
  chunk / super-chunk resolution, with **no tier boundary and no seam** — the
  step size varies continuously.

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
- **Texture mip = the cone footprint** from section C. The geometry-LOD
  footprint *is* the texture-LOD footprint — one value, both selections,
  anti-aliased terrain at any distance with no extra work.
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

## Phased plan (`NAADF-200` series)

| Phase | What | Files (primary) |
| --- | --- | --- |
| **NAADF-200** | GPU build/traverse **dispatch online** (prerequisite — base level). | `prepare.rs`, `pipeline.rs`, `gpu_buffers.rs`, build/trace shaders |
| **NAADF-201** | GPU compute **mip pyramid** build (16³→1³ + inter-chunk grid), dominant material per node. | `build_blocks.wgsl`, `layout.rs`, `cpu_builder.rs` (parity ref) |
| **NAADF-202** | **Mipped directional bounds** per level. | `build_bounds.wgsl`, `layout.rs` |
| **NAADF-203** | **Cone-footprint LOD** in the ray-march + inter-level blend. | `ray_trace.wgsl`, `world_trace.wgsl`, `gi_trace.wgsl` |
| **NAADF-204** | **Footprint-derived residency**: build/upload only needed levels. | `streaming.rs`, `cache.rs`, `gpu_buffers.rs` |
| **NAADF-205** | **Textured first-hit** — shared atlas, triplanar, cone-footprint texture mip (parity). *Independent of 201–204.* | `first_hit.wgsl`, `pipeline.rs`, `preview.rs` |
| **NAADF-206** | Tuning, `bench_guard` thresholds, NAADF bench runs. | `bench_guard.rs`, `bench_guard.toml`, bench scenes |
| NAADF-2xx | *(optional, future)* DAG dedup of coarse subtrees; beam pre-pass. | — |

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

- Water and prop texturing/rendering parity (separate follow-up).
- Full sparse-voxel-octree / DAG rewrite (brickmap + mips is the chosen
  structure; DAG dedup is an optional future memory phase only).
- Replacing the production renderer — NAADF stays the experimental preview path
  until its own release gate says otherwise.
