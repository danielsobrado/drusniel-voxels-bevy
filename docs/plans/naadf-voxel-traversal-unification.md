# NAADF Voxel Traversal Unification — Execution Plan

> Created: 2026-06-10 · Status: Planning  
> Scope: `src/rendering/lighting/voxel_ray_backend.rs`, `src/rendering/naadf/build/cpu_trace.rs`,
> `src/rendering/naadf/data/entities.rs`, `assets/shaders/naadf/ray_trace.wgsl`,
> `assets/shaders/naadf/world_trace.wgsl`, `assets/shaders/naadf/first_hit.wgsl`,
> `src/rendering/naadf/data/stats.rs`, `tests/naadf_cpu_layout.rs`, `tests/naadf_gpu_layout.rs`  
> Owner: rendering / NAADF  
> Contract (semantics, not sequencing): [`docs/rendering/naadf-voxel-traversal-contract.md`](../rendering/naadf-voxel-traversal-contract.md)  
> Source paper: Amanatides & Woo, *A Fast Voxel Traversal Algorithm for Ray Tracing* (1987)

Unify Drusniel voxel ray walking around one Amanatides/Woo-style grid DDA contract shared by
CPU current-SDF, CPU NAADF, entity-volume overlays, and WGSL NAADF paths. Harden parity tests,
`t_exit` delayed-hit validation, proxy dedupe, and traversal counters.

**This plan does not fix Surface Nets LOD seams, holes, or stitch topology.** Ray traversal
accelerates queries (sun visibility, AO, contact shadows, fog shafts, editor picking, NAADF
preview parity). Mesh seams still need transition/stitch geometry — see
[`docs/lod/seam-lip-fix-plan.md`](../lod/seam-lip-fix-plan.md).

**HDDA is a follow-on plan**, not in scope here. Land dense DDA parity first (Phase 0–1), then
see [`naadf-hdda-execution-plan.md`](naadf-hdda-execution-plan.md) for hierarchical NAADF stepping.
Do not start HDDA until dense DDA parity is proven.

---

## 0. Invariants (do not violate in any phase)

```text
I1. VoxelWorld stays authoritative for editable terrain. NAADF chunks are derived caches.
I2. Missing chunks are not implicit solid terrain in any ray path.
I3. One stepping contract: floor origin → step/t_max/t_delta → smallest-t_max axis advance.
I4. Axis-aligned directions use infinity (or equivalent finite guard), never divide-by-zero.
I5. Direct voxel occupancy hits may be immediate; proxy/analytical hits must use t_exit.
I6. GPU proxy dedupe is per-ray local only — no mutable object.last_ray_id on GPU.
I7. Skip traversal (NAADF chunk/block skips) must remain DDA-equivalent on dense fixtures.
I8. No claim that traversal changes fix LOD mesh cracks without separate mesh benchmarks.
```

---

## 1. Current state (code-verified, 2026-06-10)

| Area | Location | State |
|------|----------|-------|
| Current-SDF CPU DDA | `src/rendering/lighting/voxel_ray_backend.rs` → `trace_voxel_world_cpu` | **Landed** — full `t_max`/`t_delta` loop, immediate solid hits |
| NAADF CPU skip traversal | `src/rendering/naadf/build/cpu_trace.rs` → `trace_with_skip` | **Landed** — production path; dense DDA kept as `#[cfg(test)]` reference |
| NAADF CPU dense DDA | `cpu_trace.rs` → `trace_with_dda` | **Test-only** reference for equivalence |
| Entity-volume DDA | `src/rendering/naadf/data/entities.rs` | **Landed** — separate loop, same shape |
| WGSL DDA helpers | `assets/shaders/naadf/ray_trace.wgsl` → `naadf_initial_t_max`, `naadf_t_delta`, `naadf_step_axis` | **Landed** — duplicated per shader entry |
| CPU vs NAADF compare | `src/editor/runtime/mod.rs` → `runtime.compareNaadfRay` | **Landed** |
| Ray-step stats | `NaadfStats`, `VoxelRayBackendStats`, `bench_guard` `naadf.avg_ray_steps_last_frame` | **Partial** — steps exist; late-hit rejects / proxy dedupe counters missing |
| `t_exit` delayed hits | — | **Not implemented** |
| Shared `VoxelGridRayStepper` | — | **Not implemented** — three independent CPU loops + WGSL copies |
| `rayID` proxy dedupe (CPU) | — | **Not implemented** |

**Bottom line:** the algorithm is already in the tree in several copies. This plan is
**consolidation + parity hardening**, not a greenfield renderer feature.

---

## 2. Canonical traversal contract

Every walker follows this pipeline unless a call site documents a narrower reason to differ:

```text
normalize direction
→ clamp to max_distance and loaded/resident bounds
→ floor world position to starting voxel/chunk (negative coords included)
→ init step (+1/-1 per axis), t_max (distance to next boundary), t_delta (|inv_dir|)
→ loop:
    resolve chunk / NAADF block / voxel / proxy list
    test hit (immediate for direct occupancy; deferred for proxies)
    pick smallest t_max axis; advance voxel; add t_delta; set face normal
→ stop on first valid hit, clean exit, distance clamp, or step budget
```

**`t_exit` rule (Amanatides & Woo):** accept a candidate hit only when
`t_hit <= current_voxel_exit_t` (smallest `t_max` before stepping out). If the hit is farther
along the ray than the current cell allows, keep it as a delayed candidate and continue.

---

## 3. Phase 0 — Audit and equivalence fixtures (timebox: 1 day)

Goal: prove today's three CPU loops and WGSL helpers are already aligned before refactoring.

- [ ] **P0.1** Inventory every DDA loop: `trace_voxel_world_cpu`, `trace_with_dda`,
  `trace_with_skip` inner step, `NaadfEntityVolumeRegistry::trace`, WGSL `trace_naadf*`,
  `first_hit.wgsl` entity grid loop. Record file:line in a table at the bottom of this doc.
- [ ] **P0.2** Add focused equivalence tests (Rust) that fire the same ray through:
  - `trace_voxel_world_cpu` on a tiny `VoxelWorld` fixture
  - `NaadfCpuRayBackend::trace_with_dda` on a dense NAADF chunk built from the same occupancy
  - Assert matching `world_voxel`, `distance` (ε), `steps`, `normal` axis
- [ ] **P0.3** Extend `tests/naadf_cpu_layout.rs` / `tests/naadf_gpu_layout.rs` fixture list:
  - negative world coordinates
  - ray origin exactly on voxel boundary
  - axis-aligned rays (one `inv_dir` component → infinity)
  - zero / denormal direction → immediate miss, 0 steps
  - ray entering from outside loaded bounds
  - chunk-boundary crossing (world voxel steps across `CHUNK_SIZE` seam)
- [ ] **P0.4** Run `runtime.compareNaadfRay` on 3 fixed origins from
  `bench/scenes/naadf/visual-regression-naadf-preview-only.toml` camera; archive JSON results
  as the parity baseline.

Exit criteria: equivalence tests green; any intentional divergence documented with call-site
comment and a test that locks the difference.

---

## 4. Phase 1 — Shared CPU `VoxelGridRayStepper` (timebox: 2–3 days)

Goal: one Rust type owns init + step semantics; backends plug in per-cell hit tests.

### 4.1 New module

Add `src/rendering/voxel_grid_ray_stepper.rs` (re-export from `src/rendering/mod.rs`):

```rust
pub struct VoxelGridRayStepper {
    pub voxel: IVec3,
    pub step: IVec3,
    pub t_max: Vec3,
    pub t_delta: Vec3,
    pub distance: f32,
    pub normal: Vec3,
    pub steps: u32,
}

impl VoxelGridRayStepper {
    pub fn new(origin: Vec3, dir: Vec3) -> Option<Self>;
    pub fn current_exit_t(&self) -> f32;
    pub fn advance(&mut self);
    pub fn at_step_limit(&self, limit: u32) -> bool;
}
```

- [ ] **P1.1** Implement `new` with the same math as `trace_voxel_world_cpu` today
  (`axis_t_max`, `reciprocal_or_infinity`).
- [ ] **P1.2** `advance` picks smallest `t_max` axis, updates `distance` and `normal` identically
  to current code (tie-break: X before Y before Z, matching WGSL `naadf_step_axis`).
- [ ] **P1.3** Unit tests on the stepper alone (no world): boundary starts, negative coords,
  axis-aligned rays, 100 random rays vs inline reference implementation.

### 4.2 Rewire callers (behavior-preserving)

- [ ] **P1.4** Refactor `trace_voxel_world_cpu` to use `VoxelGridRayStepper` + occupancy callback.
- [ ] **P1.5** Refactor `NaadfCpuRayBackend::trace_with_dda` to use the same stepper (delete
  duplicated init/step code).
- [ ] **P1.6** Refactor `NaadfEntityVolumeRegistry::trace` grid loop to use the stepper.
- [ ] **P1.7** Keep `trace_with_skip` structure; only replace any inner dense-step fallback
  (if present) with the shared stepper. Skip jumps remain NAADF-specific.

Exit criteria: `rtk cargo test --lib rendering::` and `rtk cargo test --features naadf --lib`
green; Phase 0 equivalence tests unchanged.

---

## 5. Phase 2 — `t_exit` delayed-hit validation (timebox: 2 days)

Goal: correct proxy / broadphase hits when the intersection lies past the current cell exit.

- [ ] **P2.1** Extend `VoxelRayHit` (or a side struct) with `miss_reason` / `delayed_rejects`
  counter hook for stats only — avoid breaking existing consumers.
- [ ] **P2.2** Add `DelayedHitCandidate { t_hit, ... }` to the stepper loop for proxy overlays:
  - if `t_hit > stepper.current_exit_t()`, store candidate and continue
  - accept when traversal reaches the cell whose exit contains `t_hit`, or a closer blocker appears
- [ ] **P2.3** Wire CPU proxy paths first:
  - `NaadfEntityVolumeRegistry` analytical hits
  - editor selection volumes (when routed through voxel backend)
  - static proxy volumes listed in NAADF stats (`static_proxy_volumes`)
- [ ] **P2.4** Add counter `hit_after_exit_rejects` to `VoxelRayBackendStats` and `NaadfStats`;
  expose in F3 / debug overlay when `DRUSNIEL_EDITOR_DIAGNOSTICS=1`.
- [ ] **P2.5** Tests: object listed in voxel A but geometric hit in voxel C along the ray —
  must not return early at A.

Exit criteria: new tests green; `hit_after_exit_rejects` stays 0 on direct-occupancy fixtures.

---

## 6. Phase 3 — WGSL contract mirror (timebox: 2–3 days)

Goal: one WGSL include for DDA init/step; all NAADF shaders include it.

- [ ] **P3.1** Add `assets/shaders/naadf/voxel_grid_dda.wgsl` with:
  - `voxel_dda_init(origin, direction) -> VoxelDdaState`
  - `voxel_dda_advance(state) -> crossed_axis`
  - `voxel_dda_exit_t(state) -> f32`
  Matching Rust `VoxelGridRayStepper` tie-break and epsilon (`TRACE_EPSILON` / `0.000001`).
- [ ] **P3.2** Replace duplicated helpers in `ray_trace.wgsl` with imports from the include.
- [ ] **P3.3** Update `world_trace.wgsl`, `first_hit.wgsl` entity loop, any other copies found
  in P0.1 audit.
- [ ] **P3.4** Extend `tests/naadf_gpu_layout.rs` to compile the include and assert struct
  sizes / constant alignment unchanged.
- [ ] **P3.5** CPU↔GPU stepping parity: for N fixed rays, compare step count and final voxel
  from CPU `trace_with_dda` vs GPU debug trace shader output (existing `debug_trace_rays.wgsl`
  path).

Exit criteria: `rtk cargo test --features naadf --test naadf_gpu_layout` green; no WGSL compile
regression in NAADF preview bench startup.

---

## 7. Phase 4 — CPU `rayID` proxy dedupe (timebox: 1–2 days)

Goal: skip re-testing the same proxy object when it spans multiple voxels (paper §3).

- [ ] **P4.1** Add per-ray `ray_id: u64` (monotonic atomic at ray dispatch; 0 reserved).
- [ ] **P4.2** For CPU proxy types (buildings, props, water bounds, editor volumes), store
  `last_tested_ray_id: u64` on the proxy instance during traversal only (clear between frames
  or use generation stamp — do not persist across frames without reset).
- [ ] **P4.3** Before expensive proxy intersection, skip if `proxy.last_tested_ray_id == ray_id`.
- [ ] **P4.4** Counters: `proxy_tests`, `duplicate_proxy_skips` on `NaadfStats`.
- [ ] **P4.5** **Do not** port mutable `last_ray_id` to GPU in this phase. Document GPU approach
  (per-ray small local dedupe list) as Phase 6 optional.

Exit criteria: duplicate skip counter rises on multi-voxel proxy fixtures; no change to hit
positions on single-voxel proxies.

---

## 8. Phase 5 — Observability and benches (timebox: 1–2 days)

Goal: measure traversal like the paper — subdivision helps until stepping dominates.

### 8.1 Counters to add (summary.json + debug)

| Counter | Purpose |
|---------|---------|
| `naadf.ray_steps_p50` / `p95` | Distribution, not just last-frame avg |
| `naadf.empty_voxel_steps` | Steps with no occupancy hit before advance |
| `naadf.chunk_lookup_misses` | Rays stepping through unloaded chunks |
| `naadf.proxy_tests` | Proxy intersection attempts |
| `naadf.duplicate_proxy_skips` | rayID dedupe savings |
| `naadf.hit_after_exit_rejects` | Late hits deferred by t_exit rule |

- [ ] **P5.1** Implement counters in CPU backends; mirror GPU atomics where cheap.
- [ ] **P5.2** Wire into `bench-runs/<run>/summary.json` export (same pattern as
  `naadf.avg_ray_steps_last_frame`).
- [ ] **P5.3** Add optional thresholds to `assets/config/bench_guard.toml` (warning only for
  first landing — tune per machine).
- [ ] **P5.4** Enable `debug.visualize_ray_steps` heatmap validation on preview-only scene.

### 8.2 Bench scenes (run before/after every phase that touches hot path)

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-live-lod.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Exit criteria: before/after `summary.json` compared; ray-step counters reported; no frame-time
regression claim without measured rows (do not sum overlapping timing brackets).

---

## 9. Phase 6 — Query routing (ship order)

Use unified DDA as the boring first path for cheap visibility queries. **Do not** jump to full
indirect GI on this work alone.

| Query | Purpose string | Priority |
|-------|----------------|----------|
| Sun visibility | `sun_visibility` | P6.1 |
| Terrain AO | `terrain_ao` | P6.2 |
| Contact shadow | `contact_shadow` | P6.3 |
| Fog / god-ray occlusion | (existing froxel path) | P6.4 |
| Debug / editor pick | `debug` | P6.5 |
| GI secondary | `gi_secondary` | After P6.1–4 stable |

- [ ] **P6.1** Audit each query shader in `assets/shaders/naadf/lighting_queries.wgsl` and
  `radiance_cascades.wgsl`; route through shared DDA include where not already.
- [ ] **P6.2** Per-purpose `runtime.compareNaadfRay` fixtures checked into `tests/fixtures/`
  (origin, direction, max_distance, expected hit/miss).

---

## 10. Phase 7 — Deferred (explicit non-goals for v1)

| Item | When | Notes |
|------|------|-------|
| Fixed-point / integer DDA | Editor/server determinism needed | CI golden rays, authoritative picking |
| GPU per-ray proxy dedupe bitset | Profiling shows `proxy_tests` dominate | After P4 CPU proof |
| HDDA / NanoVDB-style hierarchy | Empty-voxel stepping dominates after skips | [`naadf-hdda-execution-plan.md`](naadf-hdda-execution-plan.md) |
| LOD seam / stitch changes | Never in this plan | `docs/lod/` track |

---

## 11. Acceptance criteria (definition of done)

All must pass before calling this plan complete:

1. One CPU `VoxelGridRayStepper` used by current-SDF, NAADF dense DDA, and entity-volume paths.
2. One WGSL `voxel_grid_dda.wgsl` include used by `ray_trace.wgsl` and audited dependents.
3. Same `step` / `t_max` / `t_delta` / axis tie-break / boundary epsilon on CPU and GPU.
4. Tests cover: negative coords, boundary starts, axis-aligned rays, zero direction, chunk
   crossings, exact voxel exits, step-budget exhaustion, delayed proxy hits.
5. `runtime.compareNaadfRay` passes on fixed fixtures for `debug`, `sun_visibility`,
   `terrain_ao`, `contact_shadow`, `preview_primary`.
6. `summary.json` exports new traversal counters; preview-only bench run before/after documented.
7. No documentation claims this work fixes LOD seams without separate mesh evidence.

---

## 12. PR slicing (bisectable)

| PR | Contents | Risk |
|----|----------|------|
| **PR1** | Phase 0 tests + audit table | Low |
| **PR2** | `VoxelGridRayStepper` + rewire `trace_voxel_world_cpu` | Low |
| **PR3** | Rewire NAADF dense DDA + entity volumes | Medium |
| **PR4** | `t_exit` + delayed-hit tests + counters | Medium |
| **PR5** | WGSL include + shader dedupe | Medium |
| **PR6** | CPU rayID dedupe + proxy counters | Low |
| **PR7** | Bench/guard wiring + query routing audit | Low |

Do not merge PR5 before PR2 equivalence tests are green.

---

## 13. Related docs

- [`docs/rendering/naadf-voxel-traversal-contract.md`](../rendering/naadf-voxel-traversal-contract.md) — semantics and runbook
- [`docs/rendering/naadf-completion-jira-plan.md`](../rendering/naadf-completion-jira-plan.md) — broader NAADF roadmap
- [`docs/rendering/naadf-implementation-status.md`](../rendering/naadf-implementation-status.md) — landed milestones
- [`docs/lod/seam-lip-fix-plan.md`](../lod/seam-lip-fix-plan.md) — mesh seam work (orthogonal)
- [`docs/plans/clod-execution-plan.md`](clod-execution-plan.md) — CLOD pages (orthogonal)

---

## 14. Status log

| date | change |
|------|--------|
| 2026-06-10 | Plan created. Split from contract doc; execution phases defined. |
