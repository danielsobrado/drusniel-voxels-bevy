# GPU Terrain Geomorph Plan (Surface Nets LOD)

> Created: 2026-06-03 · Status: Planning  
> Scope: `src/voxel/meshing_types.rs` (new), `src/voxel/meshing_lod.rs` (new),
> `src/voxel/meshing.rs`, `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
> `src/rendering/triplanar_material.rs`, `assets/shaders/triplanar_terrain.wgsl`,
> `assets/config/terrain_morph.yaml` (new)  
> Owner: terrain/rendering  
> Prerequisite: skirt boundary-band fix (2026-06-03) — `extract_boundary_edges`
> uses `my_lod.step_size()` band, aligned with snap.  
> Related spike (separate go/no-go): [MC + Transvoxel plan](mc-transvoxel-plan.md)

## Problem statement

LOD0–LOD3 Surface Nets meshes disagree at shared world edges because the mesher
uses a **blurred pseudo-SDF** (1-2-1 occupancy), not a true Euclidean distance
field. Linear edge interpolation (`t = d₁ / (d₁ − d₂)` in `fast_surface_nets`)
is correct, but corner samples differ when grid spacing differs, so adjacent
chunks compute different `t` and vertex positions diverge.

CPU mitigations today:

- Boundary SDF coarsening (`lower_detail_transition_step_*`)
- Y-snapping to coarse iso height (`snap_boundary_vertices_to_lower_detail_neighbor`)
- Transition aprons + vertical skirts (`skirt.rs`)

These are band-aids on field disagreement. **GPU geomorph** hides residual gaps
at display time by blending boundary vertices toward a coarse-aligned target,
without doubling geometry for whole chunks.

## Design fork (decision)

| Option | Verdict |
|--------|---------|
| **A — Full-chunk dual positions** | Reject. ~2× vertex bandwidth; interior verts never tear. |
| **B — Boundary-only morph targets** | **Adopt.** `ATTRIBUTE_MORPH_TARGET` on transition-band verts only; interior `w = 0`. |

## Decisions log (v1) — 2026-06-03

These resolve the open forks for the **first shippable version**. Each records the
chosen path *and* the alternatives rejected, so the trade is auditable later.

### D1 — v1 is a **static GPU weld**, not dynamic geomorph

**Chosen:** drop the per-frame distance factor for v1. `t` is the baked per-vertex
seam weight only (`{0, 1}`), so a boundary vertex renders at exactly its coarse
target — i.e. the same final geometry CPU snap produces.

**Why / honest consequence:** with the distance factor dropped, **v1 is visually
equivalent to the existing CPU snap** (and in v1 slightly *worse*, because normals /
material weights pass through unchanged while [snap refreshes weights at the new
height](../../src/voxel/meshing.rs)). The concrete wins are therefore narrow and
must be stated plainly:

1. **Fine-mesh colliders** — `POSITION` stays the true fine mesh, so physics reads
   fine geometry while only the display welds. CPU snap mutates the mesh both see.
2. **Infrastructure** for a future distance factor (real pop smoothing) without a
   second rewrite.

**Rejected — keep the distance factor in v1:** real visual win (pop smoothing) but
reintroduces the motion-vector/TAA work (see D2) and needs interior targets
(effectively Option A). Deferred to **v2**, not abandoned.

**Rejected — drop geomorph entirely, keep snap-only:** loses the collider win and
the v2 groundwork. If neither matters to the product, this is still the cheapest
option — flagged for the product owner, not blocking.

### D2 — prepass / shadows / TAA: weld in the depth passes, motion vectors fall out

Because D1 makes the weld **static for the lifespan of a mesh instance** (a
neighbor-LOD change re-meshes into a *new* asset), the morphed position is identical
every frame. Therefore:

- Apply the **same** weld in the forward vertex stage **and** the **depth prepass**
  **and** the **motion-vector prepass**. Motion vectors then fall out correctly with
  no per-frame math — but only because the same static position is used for current
  and previous frame. **Skipping the morph in the motion-vector prepass still breaks
  TAA reprojection**, so "motion vectors are trivial" ≠ "ignore the prepass".
- **Shadow-caster path (PR3 spike, must verify):** in Bevy 0.18 a `Material`'s
  custom vertex/prepass shader may **not** be picked up by the shadow depth pipeline.
  If it isn't, shadows are cast from the **fine** (un-welded) geometry. Given the
  displacement is small and only at seams, **accept fine-mesh shadows for v1** and
  note it; do not block on it. De-risk with a spike before writing PR3.

### D3 — config: keep a minimal **enable gate**, drop the distance uniforms

**Chosen:** no `morph_start` / `morph_end` uniforms and **no YAML loader** for v1
(consistent with D1). Keep `TerrainMorphConfig { enabled, cpu_snap_when_morph_enabled }`.
The v1 toggle is the **`VOXELS_TERRAIN_MORPH` env var**, read once and cached
(pattern: `terrain_collider_mode_from_env`); default **off**.

**Why not drop the config entirely:** success criterion #2 needs an A/B against a
**snap-on baseline**, and the feature must ship off by default — both require a gate.
Per-chunk YAML IO (as the MC path does in `generate_chunk_mesh_mc_transvoxel`) is
**not** acceptable on the SN path (every chunk), so the gate is an env-cached value,
not a file read. YAML can return in v2 alongside the distance fields.

**Hot-path guarantee:** with the gate **off**, the SN functions take the existing
snap branch unchanged and never touch `morph_targets`, so mesh output is
byte-identical and no bench is required (per `CLAUDE.md`). Benches are only needed
once the gate is turned on for seam sign-off.

> **Update 2026-06-04 — geomorph is not the terrace fix.** Investigation of the
> distant mountain "terraces" concluded the artifact is **coarse-LOD terrace
> geometry** in the SDF, which neither v1 (weld == snap, D1) nor v2 (distance pop
> smoothing) removes — at a fixed distance a coarse chunk still renders terraced.
> The terrace fix is **coarse-LOD anti-terrace SDF smoothing**, shipped separately;
> see [lod-terrace-investigation.md](lod-terrace-investigation.md). This plan stays
> valid as v2 infrastructure / the fine-mesh-collider win, **not** as a terrace fix.

## Implementation status — 2026-06-03

| PR | State | Notes |
|----|-------|-------|
| **PR1** | ✅ landed | `meshing_types` (attribute, `TerrainMorphConfig`, error), `meshing_lod::append_morph_targets` + 7 tests, `MeshData.morph_targets`. |
| **PR2** | ✅ landed | `into_mesh` guarded upload, `terrain_morph_config()` env gate, `apply_snap_or_morph` (snap-skip), `pad_morph_targets_identity` (skirt invariant), wired into all 4 SN LOD fns, +5 tests. |
| **PR3** | ✅ **runs in-game** (bench-validated 2026-06-03) | `triplanar_terrain_vertex.wgsl` (forward + prepass weld), `TriplanarMaterial::vertex_shader`/`prepass_vertex_shader`/`specialize` — all gated on `morph_gate_enabled()`. Renders without panic; seams closed; visually equivalent to the snap baseline (per D1). |

### PR3 validation results (2026-06-03, `visual-regression-live-lod`)

Ran the bench with `VOXELS_TERRAIN_MORPH=1` (MC off). Findings:

- **Two prepass mistakes found and fixed by actually running it** (the WGSL could not be
  CI-validated, so this was essential):
  1. `Material::specialize` **does** run for the prepass (`prepass/mod.rs:357`,
     contrary to an earlier note here) — so the buffer override leaked into the
     prepass.
  2. `prepass_io::Vertex` uses a **different `@location` scheme** than
     `forward_io::Vertex` (`uv@1, uv_b@2, normal@3, color@7` vs
     `normal@1, uv@2, uv_b@3, color@5`). `specialize` now branches the layout by the
     `prepass_pipeline` / `opaque_mesh_pipeline` label, and the prepass is morphed too
     (so reverse-z `GreaterEqual` depth doesn't re-open seams).
- **Result:** morph-on renders correctly, no validation panic, no shadow-pipeline
  error, screenshots captured (`bench-runs/2026-06-03T19-42-31Z/`). Output is
  pixel-comparable to the snap baseline (`bench-runs/2026-06-03T19-24-13Z/`),
  confirming D1 (v1 weld == snap). Because morph-on **skips CPU snap** yet seams stay
  closed, the GPU weld is provably doing the work (a no-op morph would crack).
- **Still open:** GTAO/TAA-motion correctness under morph not separately verified;
  a known **pre-existing** floating slab near the shoreline appears in *both* runs
  (not caused by morph). Bench `summary.json` not yet diffed for perf.

### Gate

`VOXELS_TERRAIN_MORPH=1` (or `true`) turns the whole path on, process-wide, read once.
**Requires `mc_transvoxel.enabled: false`** — MC chunks omit `ATTRIBUTE_MORPH_TARGET`,
and with the gate on `specialize` binds the morph layout for SN chunks; an MC chunk
reaching the SN material with the gate on will fail layout selection.

### PR3 validation checklist (must pass before trusting the gate)

The WGSL was written to the proven `water_vertex.wgsl` pattern but **cannot be GPU-
validated in CI**. Before relying on morph, with `VOXELS_TERRAIN_MORPH=1`:

1. **It runs at all** — terrain renders, no naga/pipeline panic. Confirms the
   `forward_io`/`prepass_io` field names, defs (`VERTEX_UVS_B`,
   `NORMAL_PREPASS_OR_DEFERRED_PREPASS`, `MOTION_VECTOR_PREPASS`,
   `VERTEX_OUTPUT_INSTANCE_INDEX`) and the `@location(8)` morph slot are correct on
   this Bevy build. **These are the most likely break points.**
2. **Seam closes** — Alt+F7 wireframe: boundary verts sit on the coarse neighbour;
   no holes where the morph moves verts away from camera (the depth-prepass weld
   reason — D2). If holes appear, the prepass weld is wrong.
3. **No TAA smear** — move the camera with TAA on; the morph band must not ghost
   (validates the `previous_world_position` motion-vector weld).
4. **Shadows** — confirm whether the shadow caster path picked up the weld (D2
   spike). If shadows detach at seams, accept as a documented v1 limitation.
5. **Bench** — only after the above, run `visual-regression-live-lod` with the gate
   on and compare `summary.json` (per `CLAUDE.md`).

## Morph semantics (critical)

### Two factors, not camera alone

| Factor | Source | Purpose |
|--------|--------|---------|
| **Seam weight** | Per-vertex `morph_target.w` (0 or 1) | Full blend on LOD-transition boundary verts (visible at any distance). |
| **Distance factor** | Uniform `smoothstep(morph_start, morph_end, dist)` | Same-chunk LOD **pop** smoothing when mesh swaps. |

```wgsl
let seam = vertex.morph_target.w;
let distance_t = smoothstep(morph_start, morph_end, dist_to_camera);
let t = select(distance_t, 1.0, seam > 0.5);
let final_local = mix(vertex.position, vertex.morph_target.xyz, t);
```

### Snap vs morph ordering (must pick a policy)

If morph runs **after** CPU snap and `morph_target.xyz` equals the snap
destination, then `position ≈ target` and the shader blend is a **no-op** on
snapped faces.

**Production policy (recommended):**

1. **`meshing_lod`** computes coarse targets using the **same math** as snap
   (`coarse_lod_iso_height_for_column`, `coarse_lattice_y_face_target`, shared
   `in_boundary_cell` band).
2. When GPU morph is **enabled** (config flag): **skip CPU snap** on verts that
   receive `w = 1.0`; keep fine `POSITION`, store coarse in `morph_target.xyz`.
3. When GPU morph is **disabled**: keep current snap + skirts path unchanged.

Alternative (smaller change, pop-only morph): keep snap for seams; use morph only
for same-chunk LOD swap with targets from the **next** LOD mesh — document that
this does not fix inter-chunk SDF divergence.

**Resolved policy (v1):** when `terrain_morph.enabled` is true,
`cpu_snap_when_morph_enabled` defaults to **false** — skip snap on verts with
`morph_target.w == 1.0`. When morph is disabled, keep full snap + skirts unchanged.

### Benefit vs. CPU snap (scope honesty)

This is the load-bearing caveat: with the v1 policy, a seam vert gets `t = 1` and
`morph_target.xyz` is computed from the **same** `coarse_*` math as snap. At `t = 1`
the vert lands on **exactly the snap destination**, so for inter-chunk seams **GPU
morph is functionally equivalent to the CPU snap it replaces** — it does *not* fix
field disagreement, it relocates the same weld to the GPU. The problem statement's
"snap is a band-aid" framing should not be read as "geomorph removes the band-aid."

What geomorph genuinely buys, and the only reasons to take on the pipeline work:

1. **Same-chunk LOD pop smoothing** (the distance factor) — there is no CPU-snap
   equivalent for this. This is the real new capability.
2. **Fine positions survive to physics** — POSITION stays the true fine mesh, so
   colliders read fine geometry while display morphs (snap mutates the mesh both see).

Consequence for sign-off: **success criterion #1 cannot be satisfied by snap
equivalence alone** — it must compare morph-on against a snap-on baseline and show
the *pop* is smoothed, not just that seams are closed (snap already closes them).

> **⚠ Unresolved design inconsistency — the distance factor is inert under Option B.**
> The "two factors" model promises distance-based same-chunk pop smoothing, but
> Option B writes morph targets on **boundary verts only** (interior `w = 0`). With
> the shader `t = select(distance_t, 1.0, seam > 0.5)`:
> - boundary verts (`w = 1`) are pinned at `t = 1` → distance ignored;
> - interior verts (`w = 0`) use `distance_t`, but have **no next-LOD target**
>   (their `morph_target.xyz` must be set to their own position to keep `mix` a
>   no-op, otherwise they drift toward the origin as distance grows).
>
> Net: the distance factor has nothing meaningful to act on. **Real pop smoothing
> needs per-vertex next-LOD targets on *all* verts (the rejected Option A, or the
> "alternative pop-only" path), not Option B.** Until this is resolved, the only
> concrete win over CPU snap is "fine positions survive to physics." Decide before
> PR3 whether to (i) ship Option B as a GPU-side snap (drop the pop-smoothing claim),
> or (ii) widen targets to interior verts for genuine pop smoothing.

### Remaining CPU gap (Y faces)

Geomorph targets can reuse `coarse_lattice_y_face_target` for PosY/NegY, but SN
SDF transition smoothing on **Y padded faces** is still not wired
(`lower_detail_transition_step` ignores `py`; see
[lod-seam-closure-plan.md](lod-seam-closure-plan.md)). Expect weaker Y/overhang
seams than X/Z even with morph; skirts remain required there.

## Coexistence with MC + Transvoxel (do not delete the spike)

Geomorph and Transvoxel both address LOD boundary cracks; they are **orthogonal
mechanisms** and must not be treated as drop-in substitutes on the same chunk.

| Path | Seam strategy | Snap / skirts | This plan |
|------|---------------|---------------|-----------|
| **Surface Nets** (`generate_chunk_mesh_surface_nets*`) | Field disagreement + CPU weld | Yes | **In scope** |
| **MC + Transvoxel** (`generate_mc_chunk_mesh`) | Transition-cell topology | No (`lod_transition_snap_stats` default; no `extract_boundary_edges`) | **Out of scope v1** |

Both paths sample the **same blurred pseudo-SDF** (`smoothed_terrain_sdf_at_world_pos`
/ `SdfGrid`). SN snap targets must **not** be applied to MC transition vertices —
topology differs from SN edge centroids.

### Config conflict (current tree)

`assets/config/mc_transvoxel.yaml` may set `enabled: true` and
`mode: replace_surface_nets`. With the `mc_transvoxel` feature built,
`resolve_terrain_mesh_mode` then routes eligible chunks to `MeshMode::McTransvoxel`
for all LODs (`McTransvoxelSettings::should_mesh_chunk` → always true in replace
mode). In that configuration:

- Visible terrain uses **MC + transition meshes**, not the SN pipeline.
- SN snap, skirts, and planned geomorph **do not run** on those chunks.
- Validating this plan requires MC **off** or **sandbox-only** during development.

**You do not need to remove `src/voxel/mc_transvoxel/`** to implement geomorph.
Keep the spike for A/B and [MTX-037](mc-transvoxel-plan.md) go/no-go. Production
should use **one primary mesher per chunk**, not both seam fixes at once.

| Development phase | `mc_transvoxel.enabled` | `terrain_morph.enabled` |
|-------------------|-------------------------|-------------------------|
| Geomorph PR1–PR3 | **false** (or `sandbox`) | false → true for seam sign-off |
| SN seam baseline bench | false | false |
| Transvoxel A/B | per spike doc | false |
| Post go/no-go | winner only | SN-only if geomorph + seam closure wins |

MC plan MTX-024 (`use_secondary_positions`, default **false**) is a separate
optional second position stream for MC transitions — not a replacement for SN
`ATTRIBUTE_MORPH_TARGET`.

### Code gating (required)

- Call `append_morph_targets` only from **`generate_chunk_mesh_surface_nets*`** (or
  when `MeshMode::SurfaceNets` at commit time).
- Do **not** run SN snap-target logic on `MeshMode::McTransvoxel` meshes.
- `into_mesh()` may omit `ATTRIBUTE_MORPH_TARGET` for MC chunks (all `w = 0`) or
  skip insertion entirely when morph attribute absent — shader must treat missing
  attribute as no morph (or always bind zero vec4 for MC).

## Coordinate space

- `MeshData.positions` are **chunk-local** after `scale_vertex_from_center`.
- Chunk entity `Transform` is chunk world origin (`plugin.rs`).
- `morph_target.xyz` must use the **same** local space and scaling as `POSITION`.

## Implementation phases

### Phase 0 — Types and config (no GPU)

**Files:** `src/voxel/meshing_types.rs`, `assets/config/terrain_morph.yaml`,
`src/voxel/mod.rs`, settings loader in `plugin.rs` or existing config path.

```rust
pub const ATTRIBUTE_MORPH_TARGET: MeshVertexAttribute =
    MeshVertexAttribute::new("Vertex_MorphTarget", 987654321, VertexFormat::Float32x4);
```

YAML (example):

```yaml
terrain_morph:
  enabled: false
  morph_start_distance: 50.0
  morph_end_distance: 60.0
  # When true, run CPU snap even if morph is enabled (usually wrong for seams).
  cpu_snap_when_morph_enabled: false
```

Extend `TriplanarUniforms` (or add `TerrainMorphUniforms`) with the same fields
for the shader.

**Verify:** config loads; no render change while `enabled: false`. Document in
PR description that local validation sets `mc_transvoxel.enabled: false` in
`assets/config/mc_transvoxel.yaml` so benches hit the SN path.

---

### Phase 1 — CPU morph metadata (`meshing_lod.rs`)

**New module:** `src/voxel/meshing_lod.rs`

Responsibilities (SRP):

- Boundary detection: reuse snap band — `local.x <= step_size` on NegX, etc.
  (same as `in_boundary_cell` in `meshing.rs`; **not** skirt’s old 0.01 ε).
- Transition participation: `NeighborLods` + `lod.is_lower_detail_than(my_lod)`
  per face.
- Target computation: coarse-aligned local position from existing snap helpers
  (extract shared functions to avoid duplication).
- Determinism: hash quantized local corner + face mask; one target per geometric
  corner; write all per-triangle duplicate indices.

Output per vertex:

| Case | `morph_target` |
|------|----------------|
| Interior | `[0, 0, 0, 0]` or `[pos, 0]` (w=0 ignores xyz) |
| LOD transition boundary | `[target.x, target.y, target.z, 1.0]` |

```rust
pub fn append_morph_targets(
    mesh: &mut MeshData,
    local_positions: &[Vec3],
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    config: &TerrainMorphConfig,
) -> Result<(), MorphTargetError>;
```

> **Signature note:** X/Z seam targets require sampling the coarse iso height
> (`coarse_lod_iso_height_for_column`), which reads the SDF — so `world: &VoxelWorld`
> is **required**, exactly as `snap_boundary_vertices_to_lower_detail_neighbor` takes
> it. Only Y-face targets (`coarse_lattice_y_face_target`) are purely geometric. An
> earlier draft omitting `world` could not compute seam targets. `&Chunk` is **not**
> needed unless morph also refreshes material weights (it does not in v1; snap takes
> `&Chunk` only for that weight refresh).

**Tests (unit, no visuals):**

- Corner determinism: three triangle verts at same local corner → identical vec4.
- Interior verts → `w == 0`.
- NegX band at `x = 0.5` with Lod0 → `w == 1` when `pos_x` neighbor is Lod1.
- Target matches snap destination for a fixture column (compare to
  `coarse_lod_iso_height_for_column`).

**Verify:** `rtk cargo test --lib meshing_lod::`

---

### Phase 2 — Mesh pipeline integration (`meshing.rs`)

**Scope:** `generate_chunk_mesh_surface_nets` / `_lod1` / `_lod2` / `_lod3` only —
not `generate_mc_chunk_mesh`.

1. Add `morph_targets: Vec<[f32; 4]>` to `MeshData`.
2. Call `append_morph_targets` after Surface Nets + **policy-dependent snap**:
   - morph off: snap then morph fill (w=0 everywhere) OR skip morph pass;
   - morph on: morph targets from coarse math, **skip snap** when
     `!cpu_snap_when_morph_enabled` on `w == 1` verts.
3. Run **after** main surface, **extend** after skirts so
   `morph_targets.len() == positions.len()`:
   - Skirt/apron verts on transition faces: `w = 1`, targets from edge coarse
     curve (reuse apron anchor logic where possible).
   - **This is where the length invariant actually breaks.** Skirts/aprons append
     their own vertices in `skirt.rs` after the main surface; every append path must
     also push a matching `morph_target` row, or `into_mesh` silently drops the
     attribute (the `warn!` branch). Do **not** rely on the warn guard as the only
     safety net — add a unit test asserting `morph_targets.len() == positions.len()`
     after a full main-surface + apron + vertical-skirt build on a transition chunk.
4. `into_mesh()`:

```rust
if mesh.morph_targets.len() == mesh.positions.len() {
    mesh.insert_attribute(ATTRIBUTE_MORPH_TARGET, mesh.morph_targets);
} else {
    warn!(...);
}
```

**Verify:** hole-probe / mesh stats unchanged when morph disabled; no Bevy panic
on length mismatch.

---

### Phase 3 — Shader and material (`triplanar_material.rs`, WGSL)

Today `TriplanarMaterial` only overrides **fragment**
([`triplanar_material.rs:182`](../../src/rendering/triplanar_material.rs); no
`vertex_shader()`); terrain rides Bevy's default PBR vertex IO. Geomorph requires a
custom vertex stage. **This is the largest and riskiest phase — treat it as its own
PR with the sub-steps below, not a paragraph.**

**Pattern sources (two different things — the plan previously conflated them):**

- `GrassMaterial` ([`grass_material.rs:152`](../../src/vegetation/grass_material.rs))
  shows how to attach a custom `vertex_shader()` on a `Material`. It does **not**
  show a custom vertex attribute — its `specialize()` only sets `cull_mode`.
- Pulling a **custom vertex attribute** into the layout is done via
  `layout.0.get_layout(&[ … .at_shader_location(n)])` →
  `descriptor.vertex.buffers[0]`, as in
  [`instanced_render.rs:2125`](../../src/props/instanced_render.rs#L2125). Adapt that
  into `TriplanarMaterial::specialize` using the currently-unused `_layout` arg.

1. Add `vertex_shader()` → split `triplanar_terrain_vertex.wgsl` (keep the 25 KB
   fragment file fragment-only).
2. `specialize()`: set `descriptor.vertex.buffers[0]` from `_layout.0.get_layout`
   with `POSITION`, `NORMAL`, `UV_0`, `UV_1`, `COLOR`, `ATTRIBUTE_MORPH_TARGET` at
   fixed `@location`s matching the WGSL `@location` decls.
3. Vertex stage must **faithfully rebuild the full PBR `VertexOutput`** via Bevy's
   `mesh_functions` (clip pos, world pos, world normal, UV0/UV1, color,
   instance_index, visibility range). Anything dropped here silently breaks the
   fragment shader's lighting / GI / wireframe / iso-band paths. Then:
   - Read `morph_target: vec4<f32>`; compute `t` from seam w + distance uniforms;
   - `final_local = mix(position, morph_target.xyz, t)`; emit **morphed** world pos.
4. v1: pass through normals unchanged (normal morph = v2).
5. **Prepass / shadows / TAA — decision required, not a footnote.**
   `TriplanarMaterial::enable_prepass()` is `true` and TAA is user-selectable
   ([`camera/controller.rs:391`](../../src/camera/controller.rs#L391)), which turns
   on the **motion-vector prepass**. The prepass + shadow + motion-vector passes use
   their **own** default vertex shaders and will render **un-morphed** positions
   while the forward pass shows morphed ones:
   - The static seam (`t = 1`) is constant per camera pose → minor depth/shadow/GTAO
     mismatch only.
   - The **distance** morph moves geometry every frame as the camera dollies, with
     zero/incorrect motion vectors → **TAA ghosting** along the morph band.
   - "Disable prepass" is **not** an acceptable fallback for terrain (GTAO/SSAO and
     forward depth depend on it — unlike grass). So pick one, explicitly:
     - **(a)** apply the same morph in the prepass + motion-vector vertex shaders
       (larger scope, correct), or
     - **(b)** force the **distance** factor to 0 whenever the motion-vector prepass
       is active (seam `t = 1` still allowed, since it is static), accepting that
       pop-smoothing is off under TAA.
   v1 recommendation: **(b)**, and note it as a known limitation.
6. **Horizon-proxy / cheap triplanar** quality tiers: either bind the morph
   attribute on all `TriplanarMaterial` quality handles, or `#define`-gate morph off
   in the vertex shader for proxy tiers (see open questions).

**Do not** overload `UV_1` (wireframe section/LOD) or `COLOR` (material weights).

**Verify:** manual in-game only after unit tests green; wireframe Alt+F7 to confirm
boundary verts move on **SN chunks** (MC off). Bench only when claiming perf
(`visual-regression-live-lod.toml` with `mc_transvoxel.enabled: false`).

---

### Phase 4 — Policy flag and fallback

- `terrain_morph.enabled` gates the full path.
- Default **off** until seam benches + wireframe sign-off.
- Colliders: unchanged — still read standard `Mesh` positions (post-upload); do
  not morph physics meshes unless explicitly designed later.

## PR slicing (bisectable)

| PR | Contents | Risk |
|----|----------|------|
| **PR1** | `meshing_types` + `meshing_lod` + `MeshData` field + tests, morph disabled | Low |
| **PR2** | Pipeline hook + skirt morph rows + `into_mesh` insert + config YAML | Medium |
| **PR3** | `TriplanarMaterial` vertex shader + uniforms + `enabled` default off | Medium |

Do not merge PR3 before PR1 tests prove target determinism.

## Success criteria

Measured with **`mc_transvoxel.enabled: false`** (SN path active) unless a row
explicitly says otherwise.

1. With `terrain_morph.enabled: true`, no visible cracks at Lod0/Lod1 **X/Z**
   boundaries in `visual-regression-live-lod` screenshots (fixed camera
   checkpoints) **and** the same-chunk LOD-swap pop is visibly smoothed vs. a
   **snap-on baseline** (not just vs. morph-off) — see "Benefit vs. CPU snap".
   Seam closure alone is satisfied by snap and does not validate the morph.
2. With `terrain_morph.enabled: false`, behavior matches pre-geomorph baseline
   (snap + skirts + boundary-band edge extraction).
3. `rtk cargo test --lib meshing_lod::` and `skirt::` pass.
4. No frame-time regression claim without `summary.json` from the live-LOD bench
   scene (per `CLAUDE.md` / `AGENTS.md`).
5. Wireframe (Alt+F7): on SN chunks, boundary verts move when morph toggles;
   interior main surface stays white; aprons/skirts still tint cyan/magenta.
6. **MC A/B (optional, separate run):** Transvoxel seam closure remains evaluated
   under [mc-transvoxel-plan.md](mc-transvoxel-plan.md) MTX-037 — not a blocker
   for merging geomorph PRs if MC is disabled in config.

## Non-goals (v1)

- MC+Transvoxel morph targets or reusing SN snap math on transition cells.
- Deleting or disabling the `mc_transvoxel` feature crate — config gating only.
- Morphing normals or material weights.
- Full-chunk dual meshes or morph targets on every vertex.
- Replacing skirts entirely (Y seams and overhangs still need apron/skirt path).
- Fixing Y-face padded SDF transition in `lower_detail_transition_step` (separate
  seam-closure ticket).

## Related docs

- [LOD seam closure plan](lod-seam-closure-plan.md) — CPU snap/skirt context
- [MC + Transvoxel plan](mc-transvoxel-plan.md) — parallel seam spike; go/no-go
- [LOD terrain hole investigation](lod-terrain-hole-investigation.md) — SDF divergence
- [Wireframe debug guide](../lod/wireframe-debug-guide.md) — Alt+F7 section colours

## Open questions

1. ~~Snap vs morph policy~~ — **Resolved:** morph on ⇒ skip snap on `w == 1` unless
   `cpu_snap_when_morph_enabled: true` (default false).
2. Should `t = 1` always on `w = 1` seams, or allow a uniform `seam_blend` below 1
   for tuning? Default: full seam (`t = 1` when `w > 0.5`).
3. Horizon-proxy / cheap triplanar: inherit morph attribute on all
   `TriplanarMaterial` quality handles, or force `t = 0` in shader for proxy tiers?
4. After geomorph sign-off, does production stay SN-only and keep MC spike disabled,
   or run MTX-037 and pick one mesher? (Product decision, not blocking PR1.)
