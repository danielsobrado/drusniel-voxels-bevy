# GPU Terrain Geomorph Plan (Surface Nets LOD)

> Created: 2026-06-03 · Status: Planning  
> Scope: `src/voxel/meshing_types.rs` (new), `src/voxel/meshing_lod.rs` (new),
> `src/voxel/meshing.rs`, `src/voxel/skirt.rs`, `src/voxel/plugin.rs`,
> `src/rendering/triplanar_material.rs`, `assets/shaders/triplanar_terrain.wgsl`,
> `assets/config/terrain_morph.yaml` (new)  
> Owner: terrain/rendering  
> Prerequisite: skirt boundary-band fix (2026-06-03) — `extract_boundary_edges`
> uses `my_lod.step_size()` band, aligned with snap.

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
enabled: false
morph_start_distance: 50.0
morph_end_distance: 60.0
cpu_snap_when_morph_enabled: false
```

Extend `TriplanarUniforms` (or add `TerrainMorphUniforms`) with the same fields
for the shader.

**Verify:** config loads; no render change while `enabled: false`.

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

1. Add `morph_targets: Vec<[f32; 4]>` to `MeshData`.
2. Call `append_morph_targets` after Surface Nets + **policy-dependent snap**:
   - morph off: snap then morph fill (w=0 everywhere) OR skip morph pass;
   - morph on: morph targets from coarse math, **conditional snap**.
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

**Do not** overload `UV_1` (wireframe section/LOD) or `COLOR` (material weights).

**Verify:** manual in-game only after unit tests green; wireframe Alt+F7 to confirm
boundary verts move. Bench only when claiming perf (`visual-regression-live-lod.toml`).

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

1. With `enabled: true`, no visible cracks at Lod0/Lod1 X/Z boundaries in
   `visual-regression-live-lod` screenshots (fixed camera checkpoints).
2. With `enabled: false`, behavior matches pre-geomorph baseline (snap + skirts).
3. `rtk cargo test --lib meshing_lod::` and `skirt::` pass.
4. No frame-time regression claim without `summary.json` from the live-LOD bench
   scene (per `CLAUDE.md` / `AGENTS.md`).
5. Wireframe: boundary verts show morph motion; interior stays white (main surface).

## Non-goals (v1)

- MC+Transvoxel morph (Surface Nets only).
- Morphing normals or material weights.
- Full-chunk dual meshes or morph targets on every vertex.
- Replacing skirts entirely (Y seams and overhangs still need apron/skirt path).

## Related docs

- [LOD seam closure plan](lod-seam-closure-plan.md) — CPU snap/skirt context
- [LOD terrain hole investigation](lod-terrain-hole-investigation.md) — SDF divergence
- [Wireframe debug guide](wireframe-debug-guide.md) — Alt+F7 section colours

## Open questions

1. Confirm default policy: morph replaces snap vs morph + reduced snap?
2. Should `t = 1` always on `w = 1` seams, or allow partial seam blend for tuning?
3. Horizon-proxy / cheap triplanar quality tiers: inherit morph attribute or
   skip morph on proxy materials?
