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
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    config: &TerrainMorphConfig,
) -> Result<(), MorphTargetError>;
```

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

Today `TriplanarMaterial` only overrides **fragment**; terrain uses default PBR
vertex IO. Geomorph requires a custom vertex stage (see `GrassMaterial` pattern).

1. Add `vertex_shader()` → `shaders/triplanar_terrain.wgsl` (or split
   `triplanar_terrain_vertex.wgsl`).
2. `specialize()`: declare vertex layout — `POSITION`, `NORMAL`, `UV_0`, `UV_1`,
   `COLOR`, `ATTRIBUTE_MORPH_TARGET` at fixed `@location` values matching Rust
   `at_shader_location`.
3. Vertex stage:
   - Read `morph_target: vec4<f32>`.
   - Compute `t` from seam w + distance uniforms.
   - `final_local = mix(position, morph_target.xyz, t)`.
   - Build `VertexOutput` with **morphed** world position for triplanar fragment.
4. v1: pass through normals unchanged (normal morph = v2).
5. Prepass: confirm IO compatibility or disable prepass if specialization panics
   (same caution as grass).
6. **Horizon-proxy / cheap triplanar** quality tiers: either use the same vertex
   layout with morph attribute bound, or disable morph in shader when quality tier
   lacks the attribute (see open questions).

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
   checkpoints).
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
- [Wireframe debug guide](wireframe-debug-guide.md) — Alt+F7 section colours

## Open questions

1. ~~Snap vs morph policy~~ — **Resolved:** morph on ⇒ skip snap on `w == 1` unless
   `cpu_snap_when_morph_enabled: true` (default false).
2. Should `t = 1` always on `w = 1` seams, or allow a uniform `seam_blend` below 1
   for tuning? Default: full seam (`t = 1` when `w > 0.5`).
3. Horizon-proxy / cheap triplanar: inherit morph attribute on all
   `TriplanarMaterial` quality handles, or force `t = 0` in shader for proxy tiers?
4. After geomorph sign-off, does production stay SN-only and keep MC spike disabled,
   or run MTX-037 and pick one mesher? (Product decision, not blocking PR1.)
