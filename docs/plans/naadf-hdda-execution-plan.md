# NAADF HDDA — Execution Plan

> Created: 2026-06-10 · Status: Planning  
> Scope: `src/rendering/naadf/hdda.rs` (new), `src/rendering/naadf/build/cpu_trace.rs`,
> `assets/shaders/naadf/hdda_trace.wgsl` (new), `assets/shaders/naadf/debug_trace_rays.wgsl`,
> `assets/shaders/naadf/ray_trace.wgsl`, `src/rendering/naadf/config.rs`,
> `src/rendering/naadf/data/stats.rs`, `src/rendering/naadf/render/debug.rs`,
> `src/rendering/lighting/radiance_cascades.rs`, `tests/naadf_hdda_cpu.rs` (new)  
> Owner: rendering / NAADF  
> Prerequisite (**required**): [`naadf-voxel-traversal-unification.md`](naadf-voxel-traversal-unification.md) Plan A Phase 0–1 — dense Amanatides DDA CPU/GPU parity + `VoxelGridRayStepper`  
> Contract (shared with Plan A): [`docs/rendering/naadf-voxel-traversal-contract.md`](../rendering/naadf-voxel-traversal-contract.md)  
> References: NanoVDB `math/HDDA.h` (span-stepping model), OpenVDB sparse-tree layout (concept only — **do not import OpenVDB runtime**)  
> **Plan B** (acceleration) — paired with Plan A; **do not merge into one doc**

## Plan pairing (keep separate)

```text
Plan A: NAADF Voxel Traversal Unification
  Purpose: correctness contract
  Scope:   dense Amanatides DDA, tMax/tDelta semantics, tie rules, CPU/GPU parity

Plan B: NAADF HDDA Execution Plan  (this doc)
  Purpose: acceleration
  Scope:   chunk/block/voxel span stepping, conservative skips, HDDA compare mode
  Depends: Plan A Phase 0–1
```

**Gates (non-negotiable):**

```text
Do not implement HDDA until dense Amanatides CPU/GPU parity passes.
Dense DDA remains the oracle forever, even after HDDA ships.
```

Amanatides = foundation / oracle. HDDA = optimization built on that foundation.

---

## Verdict

Implement HDDA **inside the existing NAADF path**, not as a new renderer. Drusniel already has NAADF feature flags, CPU cache, GPU buffers, WGSL production traversal (`trace_naadf` — a per-voxel loop with directional-bound skip jumps, **not** formal HDDA yet), a debug ray harness (`debug_trace_rays.wgsl`, today wired only to `trace_naadf`), sun/AO/contact-shadow query helpers, and Radiance Cascades backend routing.

HDDA upgrades this:

```text
current production: per-voxel stepping with directional-bound jumps (CPU trace_with_skip, WGSL trace_naadf)
oracle baseline:    dense voxel DDA (CPU trace_with_dda, test-only today)
target:             explicit chunk → block → voxel hierarchical DDA with span_dim reinit,
                      conservative empty/full fast paths, and dense-oracle parity gates
```

**HDDA helps:** GI rays, sun visibility, terrain AO, contact shadows, fog/cave shafts, debug ray heatmaps.

**HDDA does not fix:** Surface Nets LOD holes, stitch topology, T-junctions, skirts, morph lips. Those remain mesh problems — see [`docs/legacy/seam-lip-fix-plan.md`](../legacy/seam-lip-fix-plan.md).

**Do not port OpenVDB wholesale.** Borrow the NanoVDB idea: same DDA state machine, variable stride from hierarchy (`getDim` / `span_dim_at`), read-only GPU snapshot. Drusniel's mutable `VoxelWorld` stays authoritative; NAADF chunks are the traversal cache.

---

## 0. Invariants

```text
I1.  VoxelWorld stays authoritative. NAADF is a derived read-only traversal cache.
I2.  Dense Amanatides DDA is the correctness oracle forever — HDDA must match it per query type before earning production.
I3.  HDDA hit/material/world_voxel must match dense DDA; distance within ε; steps ≤ dense on sparse scenes.
I4.  Directional-bound skips are conservative — never jump over a known solid voxel.
I5.  Per-ray traversal state only. No mutable proxy.last_ray_id on GPU.
I6.  WGSL reads immutable uploaded buffers — never half-updated live chunk memory.
I7.  Do not replace dense trace_naadf until GPU parity harness passes.
I8.  No claim that HDDA fixes LOD mesh cracks.
```

### Out of scope (do not touch)

```text
Surface Nets meshing · LOD seam stitching · skirts · colliders · water meshing · CLOD pages
```

Visible terrain stays mesh-rendered. NAADF is the voxel acceleration structure for visibility, occlusion, and GI.

---

## 1. Current state (code-verified, 2026-06-10)

| Layer | Location | Today |
|-------|----------|-------|
| Chunk size | `CHUNK_SIZE` = **16³** voxels | One NAADF chunk = one gameplay chunk |
| Block grid | `VOXELS_PER_BLOCK_AXIS` = **4** → 4³ blocks × 4³ voxels/block | 64 blocks per chunk |
| Node states | `NaadfNodeState`: `UniformEmpty`, `UniformFull`, `Children` | WGSL fast-path for uniform-full chunk entry |
| Directional bounds | `PackedDirectionalBounds2Bit` (block/voxel), `PackedDirectionalBounds5Bit` (chunk) | Built on CPU/GPU (`build_bounds.wgsl`, `build_blocks.wgsl`) |
| CPU production trace | `src/rendering/naadf/build/cpu_trace.rs` → `trace_with_skip` | SafeBox exit + chunk/block/voxel skip |
| CPU dense oracle | `src/rendering/naadf/build/cpu_trace.rs` → `trace_with_dda` (`#[cfg(test)]`) | Equivalence tests vs skip already exist; **keep both** — HDDA is added beside them |
| WGSL production trace | `assets/shaders/naadf/ray_trace.wgsl` → `trace_naadf` | Per-voxel loop + directional-bound skip jumps (not formal HDDA) |
| Debug harness | `assets/shaders/naadf/debug_trace_rays.wgsl` + `NAADF_DEBUG_TRACE_RAYS_SHADER_PATH` | Imports/calls `trace_naadf` only today — compare mode must add Dense/HDDA/Compare dispatch |
| Sun visibility | `config.use_for_sun_visibility` (default **off**), `naadf_sun_visibility_world` in WGSL | Ready for gated HDDA swap |
| Fixtures | `tests/fixtures/naadf/*.ron` | empty, full, single voxel, wall_x/y/z, tunnel, staircase, bedrock_floor, boundary |
| Ray-step stats | `NaadfStats.gpu_avg_ray_steps_last_frame`, heatmap in `debug.rs` | Extend, do not duplicate |

**Gap:** skip traversal is ad hoc (SafeBox / bound jumps) rather than a formal `span_dim` HDDA stepper with explicit reinit on level change, empty/full block fast paths, and a dense-vs-HDDA compare mode on GPU.

---

## 2. OpenVDB / NanoVDB → Drusniel mapping

| NanoVDB / OpenVDB | Drusniel (do not mirror 32/16/8/1 blindly) |
|-------------------|-------------------------------------------|
| `Grid` + `Transform` | `VoxelWorld` + chunk world origin |
| `RootNode` / upper internal | loaded-chunk slot table (`naadf_lookup_chunk_slot`) |
| lower internal | **16³ chunk** (already one internal level) |
| `LeafNode` 8³ | **4³ block** (microbrick) |
| voxel | 1³ occupancy + material |
| `ReadAccessor::getDim(ijk, ray)` | `span_dim_at(cell) → {16, 4, 1}` chunk units |
| `HDDA::step()` | `HddaSpanStepper::step_span()` |
| `GridHandle` / device upload | existing `gpu_buffers.rs` slot upload + version stamp |

Recommended hierarchy for v1 — **three levels only**:

```text
chunk (16³)  →  block (4³)  →  voxel (1³)
```

No superchunk directory in v1 unless profiling shows chunk-slot lookup dominates.

---

## 3. Phase 0 — Lock scope (timebox: half day)

Goal: HDDA for **NAADF ray queries only**.

- [ ] **P0.1** Add `docs/plans/naadf-hdda-execution-plan.md` to PR template / agent context (this doc).
- [ ] **P0.2** Add `NaadfTraversalConfig` to `src/rendering/naadf/config.rs` (`NaadfConfig` has no `traversal` section today); default `mode: dense` and mark experimental until Phase 9 bench gate passes.
- [ ] **P0.3** **Blocker:** Plan A Phase 0–1 complete — dense Amanatides CPU/GPU parity green, `VoxelGridRayStepper` landed. Do not open HDDA PRs until this passes.

Exit criteria: no meshing/LOD files in HDDA PR diffs; Plan A prerequisite verified in PR description.

---

## 4. Phase 1 — CPU HDDA reference (timebox: 4–6 days)

Goal: explicit hierarchical marcher **beside** existing `trace_with_skip` and test-only `trace_with_dda` (add HDDA; do not replace either), proven against the dense oracle.

### 4.1 New files

```text
src/rendering/naadf/hdda.rs
tests/naadf_hdda_cpu.rs
```

### 4.2 Algorithm

```text
clip ray to loaded world bounds
chunk DDA across resident chunk slots
  → enter chunk
  → if UniformEmpty: span-step entire chunk (16) when safe
  → if UniformFull: accept hit per purpose (sun = blocked, first-hit = surface)
  → else block DDA inside chunk (4³ grid)
      → if block UniformEmpty: jump to next block boundary
      → if block UniformFull: hit/accept per purpose
      → if mixed: voxel DDA inside 4³ block
```

Implement `HddaSpanStepper` (NanoVDB-style):

```rust
pub struct HddaSpanStepper {
    pub cell: IVec3,       // aligned origin: cell & !(span_dim - 1)
    pub step: IVec3,
    pub t: f32,
    pub t_max: f32,
    pub next_t: Vec3,
    pub delta_t: Vec3,
    pub span_dim: i32,     // 16, 4, or 1 in world voxels
}
```

- [ ] **P1.1** `init_span(ray, t0, t1, span_dim)` — align cell with `floor(pos) & !(span_dim - 1)`.
- [ ] **P1.2** `step_span()` — advance `next_t[axis] += span_dim * delta_t[axis]`, `cell[axis] += span_dim * step[axis]`.
- [ ] **P1.3** `reinit_at_t(ray, t, new_span_dim)` on level transitions (monotonic `t` only).
- [ ] **P1.4** `trace_hdda(&NaadfChunk, ...)` public API returning `VoxelRayHit`.
- [ ] **P1.5** Wire `NaadfCpuRayBackend::trace_hdda` — do **not** replace `trace_with_skip` yet.

### 4.3 Acceptance tests (reuse `tests/fixtures/naadf/*.ron`)

| Fixture | Expect |
|---------|--------|
| empty chunk | miss |
| full chunk | hit |
| single voxel | hit at exact voxel |
| wall_x / wall_y / wall_z | face hit + normal axis |
| tunnel | miss through cavity |
| staircase | hit on step |
| chunk boundary | correct chunk handoff |
| negative direction | same hit as mirrored ray |
| axis-aligned | no NaN / stall |
| origin inside solid | deterministic first hit |
| origin on voxel face | deterministic tie rule (document epsilon) |

**Hard rule (every test):**

```text
HDDA hit        == dense DDA hit
HDDA material   == dense DDA material
HDDA world_voxel == dense DDA world_voxel
HDDA distance   within 1e-4 (or document larger ε at skip boundaries)
HDDA steps      <= dense DDA steps on sparse fixtures
```

Run:

```bash
rtk cargo test --features naadf --test naadf_hdda_cpu
rtk cargo test --features naadf --lib naadf::build::cpu_trace  # existing skip vs dda
```

Exit criteria: all fixture parity tests green; `trace_with_skip` behavior unchanged.

---

## 5. Phase 2 — Conservative directional-bound skip (timebox: 3–4 days)

Goal: use bounds already computed in `NaadfChunk` / blocks / voxels — **conservative only**.

Bounds today: `chunk_skip`, `directional_skip_blocks`, per-voxel skip in `layout.rs`. CPU builder + `build_bounds.wgsl` already propagate them.

```text
if block UniformEmpty:
    jump to next block boundary (span_dim = 4)

if block mixed:
    directional_skip = bounds_for_ray_direction(block, step)
    safe_t = min(directional_skip_t, next_block_boundary_t)
    if safe_t > epsilon:
        advance by safe_t
    else:
        descend to voxel DDA (span_dim = 1)
```

- [ ] **P2.1** `bounds_for_ray_direction` helper shared by CPU HDDA and tests.
- [ ] **P2.2** Invariant test: for every fixture voxel marked solid in source occupancy, no skip path advances past it.
- [ ] **P2.3** Benchmark micro-fixture: empty/mostly-empty chunk → `hdda_steps < dense_steps`; checkerboard → `hdda_steps ≤ dense_steps * 1.1` (graceful dense degradation).

Exit criteria: zero hit parity regressions; step count improves on empty/mostly-empty chunks.

---

## 6. Phase 3 — WGSL HDDA mirror (timebox: 5–7 days)

Goal: parallel shader path; **keep dense path**.

Add:

```text
assets/shaders/naadf/hdda_trace.wgsl
```

```wgsl
// beside existing trace_naadf in ray_trace.wgsl
fn trace_naadf_dense_debug(...) -> NaadfHit { ... }  // freeze current logic
fn trace_naadf_hdda(...) -> NaadfHit { ... }
```

Structure:

```text
trace world bounds
lookup chunk slot
DDA across chunks
DDA across 4×4×4 blocks
skip empty/full/mixed blocks safely
descend to 4×4×4 voxel DDA for mixed blocks
return same NaadfHit payload as dense traversal
```

- [ ] **P3.1** Extract shared `voxel_grid_dda.wgsl` from traversal-unification plan if landed; else duplicate init/step with explicit TODO.
- [ ] **P3.2** Port `HddaSpanStepper` semantics to WGSL `RaySpanState` struct (per-ray, not global).
- [ ] **P3.3** `ENFORCE_FORWARD_STEPPING` guard: if `next_t` fails to advance, nudge by `epsilon` (NanoVDB pattern).
- [ ] **P3.4** Point-tree convention: document whether ray uses cell-centre (`+0.5`) or node-centre; match CPU tests before optimising.
- [ ] **P3.5** `rtk cargo test --features naadf --test naadf_gpu_layout` — compile `hdda_trace.wgsl`.

Exit criteria: WGSL builds; no change to default `trace_naadf` call sites.

---

## 7. Phase 4 — GPU parity harness (timebox: 3–4 days)

Extend existing debug compute path — **do not build a new test system**. `debug_trace_rays.wgsl` currently imports and calls only `trace_naadf`; this phase must branch on mode.

```text
DebugTraceMode::Dense
DebugTraceMode::Hdda
DebugTraceMode::DenseAndHddaCompare
```

Per ray output:

```text
dense_hit, hdda_hit, dense_steps, hdda_steps, first_mismatch_reason
```

```rust
pub enum HddaMismatchReason {
    None,
    HitMissMismatch,
    VoxelMismatch,
    MaterialMismatch,
    DistanceMismatch,
    NormalMismatch,
    ExceededMaxSteps,
    MissingChunk,
    InvalidBlockSkip,
}
```

Wire in `debug_trace_rays.wgsl` + Rust dispatch in `render/debug.rs` / `build/gpu_tests.rs`.

- [ ] **P4.1** 10k deterministic rays: CPU dense vs CPU HDDA — 0 mismatches.
- [ ] **P4.2** 10k deterministic rays: CPU HDDA vs GPU HDDA — 0 mismatches.
- [ ] **P4.3** GPU HDDA never returns a farther hit than dense for the same ray.

Exit criteria: compare mode green in CI (`--features naadf`).

---

## 8. Phase 5 — Debug UI, config, heatmap (timebox: 2 days)

Add a real config struct — `NaadfConfig` has no traversal section today:

```rust
// src/rendering/naadf/config.rs
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NaadfTraversalConfig {
    #[serde(default = "default_traversal_dense")]
    pub mode: NaadfTraversalMode, // dense | hdda | compare
    #[serde(default)]
    pub hdda_use_directional_bounds: bool,
    #[serde(default = "default_hdda_max_chunk_steps")]
    pub hdda_max_chunk_steps: u32,
    // ...
}

// NaadfConfig: #[serde(default)] pub traversal: NaadfTraversalConfig,
```

Wire YAML (`assets/config/naadf.yaml` or equivalent):

```yaml
naadf:
  traversal:
    mode: dense              # dense | hdda | compare
    hdda_use_directional_bounds: false
    hdda_max_chunk_steps: 512
    hdda_max_block_steps: 2048
    hdda_max_voxel_steps: 4096
```

F3 / stats (extend existing `NaadfStats` ray-step fields in `src/rendering/naadf/data/stats.rs`; do not duplicate heatmap):

```text
naadf.hdda_rays
naadf.hdda_avg_steps
naadf.hdda_max_steps
naadf.hdda_block_skips
naadf.hdda_voxel_steps
naadf.hdda_dense_mismatches
naadf.hdda_fallback_to_dense
```

- [ ] **P5.1** Extend existing `visualize_ray_steps` heatmap to colour by HDDA step count when mode = hdda.
- [ ] **P5.2** `runtime.compareNaadfRay` optional `traversal: "hdda"` field for editor parity checks.

Exit criteria: toggles work; default remains `dense`.

---

## 9. Phase 6 — First production use: sun visibility (timebox: 3–4 days)

Binary query: **blocked / not blocked**. Lowest risk first integration.

Policy:

```text
if HDDA ready && NAADF cache ready && config.traversal.mode == hdda:
    use HDDA sun path
else:
    use current SDF / dense NAADF fallback
```

`use_for_sun_visibility` stays **off** by default until bench passes.

- [ ] **P6.1** Route `naadf_sun_visibility_world` through `trace_naadf_hdda` behind config flag.
- [ ] **P6.2** Froxel sun mask (`froxel.rs`) respects same flag.

Acceptance:

```text
no visible shadow popping
no missing cave occlusion vs dense baseline screenshots
HDDA sun rays: avg steps ≥30% lower than dense in sparse scenes (visual-regression-naadf-gi-sun or froxel scene)
```

---

## 10. Phase 7 — AO and contact shadows (timebox: 4–5 days)

**After** sun visibility passes. **Do not start with GI** — temporal accumulation hides bugs.

Order:

```text
terrain AO  →  contact shadows
```

Shaders: `lighting_queries.wgsl`, `visual-regression-naadf-terrain-ao.toml`.

Acceptance:

```text
no black leaks in AO
no floating dark dots in contact shadows
step count improvement in bench summary.json timing rows / naadf counters
```

---

## 11. Phase 8 — Radiance Cascades / GI (timebox: 5–7 days)

Only after Phases 6–7 stable.

`RadianceCascadesConfig` already routes `voxel_backend: Naadf` and resets temporal history on backend switch (`radiance_cascades.rs`).

- [ ] **P8.1** `CurrentWithNaadfGi` trace path uses HDDA when `traversal.mode == hdda`.
- [ ] **P8.2** `gi_trace.wgsl` / secondary rays gated separately after primary GI stable.

Acceptance:

```text
current SDF GI vs NAADF HDDA GI screenshots stable (visual-regression-naadf-gi.toml)
no temporal ghosting after backend switch
GI ray step count lower than dense NAADF on sparse scenes
```

---

## 12. Phase 9 — Benchmark gate (timebox: 2 days)

Run before merging any production default flip:

```bash
rtk cargo test --features naadf
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-current.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-gi.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-live-lod.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/dig-edit-naadf-stability.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

| Criterion | Pass |
|-----------|------|
| Dense vs HDDA parity | 0 mismatches (CPU + GPU compare mode) |
| Fallback rate | no increase in `fallback_reason` / `fallback_count` |
| Performance | `naadf.hdda_avg_steps` < dense avg on sparse scenes |
| Visual | no regression in sun/AO/GI checkpoint screenshots |
| Dense worst case | checkerboard / dense volume ≤10% step overhead vs dense oracle |

Add optional `bench_guard.toml` warnings for `naadf.hdda_avg_steps` after baseline captured.

---

## 13. Correctness test matrix

| Test case | Setup | Expected |
|-----------|-------|----------|
| Starts outside world | ray outside bbox, points in | clipped entry hit |
| Starts on voxel face | origin on boundary | deterministic first step, no stall |
| Edge/corner tie | two/three `next_t` equal | documented tie-break, no skipped solid |
| Zero direction axis | one component = 0 | axis disabled, no NaN |
| Negative direction | high → low indices | same hit as mirrored case |
| Empty chunk | `UniformEmpty` | span skip, 0 voxel tests inside |
| Uniform solid tile | `UniformFull` | purpose-correct early accept |
| Checkerboard leaf | alternating occupancy | matches dense; perf may degrade |
| Chunk boundary | ray crosses chunk seam | no double-step, no missed leaf |
| Leaf transition | span 16 → 4 → 1 | `t` monotonic through reinit |
| Proxy duplicate | same proxy in adjacent cells | one test per ray (Phase 4+) |
| Snapshot swap | upload mid-frame | renderer sees old OR new buffer only |

---

## 14. Benchmark scenes

| Scene | Why | Metrics |
|-------|-----|---------|
| Long empty rays / sparse terrain | best-case HDDA | steps/ray, rays/s |
| `visual-regression-naadf-live-lod` | production terrain | frame time, avg steps |
| Dense filled volume | worst case | overhead vs dense ≤10% |
| Checkerboard micronoise | descent churn | span changes/ray |
| `dig-edit-naadf-stability` | dirty rebuild | rebuild ms, upload bytes |
| Dynamic proxy stress (future) | dedupe | proxy_tests, duplicate_skips |

---

## 15. WGSL and proxy dedupe notes

| Strategy | Verdict |
|----------|---------|
| Global mutable `lastRayId` on proxies | **Avoid** — GPU race / nondeterminism |
| No dedupe | OK for prototype only |
| Per-ray small linear set | **First production GPU dedupe** |
| Per-ray bitset over bucket local IDs | When proxy density warrants |
| CPU unique lists per cell | Static/semi-static proxies |

Terrain HDDA and dynamic proxy overlay stay **separate buffers and traversal passes**.

---

## 16. Risks and fallbacks

| Risk | Mitigation |
|------|------------|
| Dense scenes: HDDA ≈ dense + metadata overhead | Benchmark checkerboard; regression budget ≤10% |
| Skip jumps over solid | Conservative bounds only; `InvalidBlockSkip` in compare mode |
| OpenVDB dependency creep | No OpenVDB link; copy algorithms only (Apache-2.0, preserve notices if copying snippets) |
| Half-updated GPU buffer | Versioned snapshot; double-buffer uploads |
| Seam confusion | This plan never touches `lod_seam.rs` |

**Fallback:** ship **chunk + block HDDA only** (three levels above) without superchunk or NanoVDB serialisation. Enough for game-scale sparse terrain.

**Future (not v1):** immutable serialised grid buffer (PNanoVDB-style offsets), fixed-point DDA for deterministic editor picks, superchunk directory for world-scale skip.

---

## 17. PR slicing (recommended Codex order)

| PR | Phase | Contents | Risk |
|----|-------|----------|------|
| PR1 | 1 | `hdda.rs` + `naadf_hdda_cpu.rs` + fixture parity | Low |
| PR2 | 2 | Directional-bound conservative skip + invariants | Medium |
| PR3 | 3 | `hdda_trace.wgsl` beside dense | Medium |
| PR4 | 4 | GPU compare mode | Medium |
| PR5 | 5 | Config + stats + heatmap | Low |
| PR6 | 6 | Sun visibility gate | Medium |
| PR7 | 7 | AO + contact shadows | Medium |
| PR8 | 8 | Radiance Cascades GI | High |
| PR9 | 9 | Bench guard thresholds | Low |

**Do not replace dense Amanatides DDA. Dense is the oracle forever. HDDA earns each query type by proving parity.**

---

## 18. Related docs

- [`naadf-voxel-traversal-unification.md`](naadf-voxel-traversal-unification.md) — Plan A (correctness); **required prerequisite** — dense Amanatides CPU/GPU parity before any HDDA work
- [`docs/rendering/naadf-voxel-traversal-contract.md`](../rendering/naadf-voxel-traversal-contract.md) — shared traversal contract (both plans)
- [`docs/rendering/naadf-completion-jira-plan.md`](../rendering/naadf-completion-jira-plan.md) — broader NAADF roadmap
- [`docs/legacy/seam-lip-fix-plan.md`](../legacy/seam-lip-fix-plan.md) — mesh seams (orthogonal)

---

## 19. Status log

| date | change |
|------|--------|
| 2026-06-10 | Plan created. Scoped to NAADF HDDA inside existing path; 9 phases + bench gate. |
| 2026-06-10 | Review edits: fixed `cpu_trace.rs` paths, clarified `trace_naadf` ≠ formal HDDA, `NaadfTraversalConfig` in Phase 5, compare-mode prerequisite on `debug_trace_rays.wgsl`. |
| 2026-06-10 | Plan A/B pairing: separate docs, Amanatides oracle gate; dense DDA oracle forever. |
