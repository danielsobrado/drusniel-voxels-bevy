# LOD Visual Artifact Fixes — Issue Tracker & Fix Plan

> Created: 2026-05-13 · Status: Planning
> Scope: `src/voxel/meshing.rs`, `src/voxel/plugin.rs`, `src/voxel/skirt.rs`, `src/voxel/world.rs`, `src/voxel/chunk.rs`

---

## Context

The engine uses Surface Nets + SDF-based LOD with skirts for seam hiding. Visual
artifacts — rectangular caps, dark walls, and horizontal seams — persist despite
several earlier fixes that are already in place:

| Prior Fix | Status | Location |
|---|---|---|
| Force empty boundary-cap chunks to Lod0 | ✅ Done | `plugin.rs:1551–1565` |
| Defer Surface Nets when halo is incomplete | ✅ Done | `plugin.rs:1547–1549` |
| Unknown neighbor LOD does not trigger skirt | ✅ Done | `skirt.rs:267–270` |
| Dirty vertical neighbors on LOD change | ✅ Done | `plugin.rs:3761–3763` |

The remaining artifacts are caused by four issues documented below.

---

## Issue 1 — Vertical neighbors excluded from NeighborLods and skirts

**Severity: HIGH**

### Problem Statement

`NeighborLods` only tracks horizontal neighbors (`neg_x`, `pos_x`, `neg_z`,
`pos_z`). When a LOD0 chunk sits above a LOD2 chunk, the horizontal surface at
their shared Y boundary has different vertex densities (18³ vs 6³) and **no
skirt** to hide the gap. There is also no SDF transition smoothing at the
boundary.

Three subsystems are affected:

1. **`NeighborLods` struct** (`skirt.rs:249–254`) — has no `neg_y`/`pos_y`
   fields. `lod_for_face()` returns `None` for `NegY` and `PosY`, so the skirt
   system never fires for vertical boundaries.

2. **`mesh_dirty_chunks_system`** (`plugin.rs:1786–1799`) — populates
   `NeighborLods` using only horizontal chunk offsets `(±1,0,0)` and `(0,0,±1)`.

3. **`lower_detail_transition_step`** (`meshing.rs:2209–2236`) — only checks
   NegX/PosX/NegZ/PosZ boundary sample rows for LOD transitions; Y boundary
   rows are never smoothed.

4. **`extract_boundary_edges`** (`skirt.rs:175–180`) — iterates only four
   horizontal faces. Edges on the NegY/PosY boundary plane are never collected.

5. **`generate_skirts`** (`skirt.rs:344–350`) — `NegY | PosY => continue` skips
   any vertical boundary edge that was somehow detected.

6. **`push_boundary_quad_indices`** (`skirt.rs:288–311`) — `NegY | PosY => {}`
   produces no geometry for vertical faces.

### Visible Symptom

Horizontal seam lines at vertical chunk boundaries where LOD levels differ.
Especially visible when the camera looks down from a height.

### Fix Plan

#### Step 1 — Add vertical fields to `NeighborLods`

**File:** `src/voxel/skirt.rs`

```rust
pub struct NeighborLods {
    pub neg_x: Option<LodLevel>,
    pub pos_x: Option<LodLevel>,
+   pub neg_y: Option<LodLevel>,
+   pub pos_y: Option<LodLevel>,
    pub neg_z: Option<LodLevel>,
    pub pos_z: Option<LodLevel>,
}
```

Update `lod_for_face`:

```rust
fn lod_for_face(&self, face: ChunkFace) -> Option<LodLevel> {
    match face {
        ChunkFace::NegX => self.neg_x,
        ChunkFace::PosX => self.pos_x,
+       ChunkFace::NegY => self.neg_y,
+       ChunkFace::PosY => self.pos_y,
        ChunkFace::NegZ => self.neg_z,
        ChunkFace::PosZ => self.pos_z,
-       ChunkFace::NegY | ChunkFace::PosY => None,
    }
}
```

#### Step 2 — Populate vertical LODs in the meshing system

**File:** `src/voxel/plugin.rs:1786–1799`

```rust
let neighbor_lods = NeighborLods {
    neg_x: world.get_chunk(chunk_pos + IVec3::new(-1, 0, 0)).map(|c| c.lod_level()),
    pos_x: world.get_chunk(chunk_pos + IVec3::new(1, 0, 0)).map(|c| c.lod_level()),
+   neg_y: world.get_chunk(chunk_pos + IVec3::new(0, -1, 0)).map(|c| c.lod_level()),
+   pos_y: world.get_chunk(chunk_pos + IVec3::new(0, 1, 0)).map(|c| c.lod_level()),
    neg_z: world.get_chunk(chunk_pos + IVec3::new(0, 0, -1)).map(|c| c.lod_level()),
    pos_z: world.get_chunk(chunk_pos + IVec3::new(0, 0, 1)).map(|c| c.lod_level()),
};
```

#### Step 3 — Include NegY/PosY in boundary edge extraction

**File:** `src/voxel/skirt.rs:175–180`

```diff
-for face in [ChunkFace::NegX, ChunkFace::PosX, ChunkFace::NegZ, ChunkFace::PosZ] {
+for face in ChunkFace::ALL {
```

#### Step 4 — Enable vertical skirt geometry generation

**File:** `src/voxel/skirt.rs:344–350`

Remove the `NegY | PosY => continue` arm from `skirt_normal` and add proper
direction vectors:

```rust
let skirt_normal = match edge.face {
    ChunkFace::NegX => Vec3::NEG_X,
    ChunkFace::PosX => Vec3::X,
+   ChunkFace::NegY => Vec3::NEG_Y,
+   ChunkFace::PosY => Vec3::Y,
    ChunkFace::NegZ => Vec3::NEG_Z,
    ChunkFace::PosZ => Vec3::Z,
-   ChunkFace::NegY | ChunkFace::PosY => continue,
};
```

**File:** `src/voxel/skirt.rs:288–311`

Add NegY/PosY to the quad index winding:

```rust
fn push_boundary_quad_indices(indices: &mut Vec<u32>, face: ChunkFace, base_idx: u32) {
    match face {
-       ChunkFace::NegX | ChunkFace::PosZ => { /* CCW */ }
-       ChunkFace::PosX | ChunkFace::NegZ => { /* CW */ }
-       ChunkFace::NegY | ChunkFace::PosY => {}
+       ChunkFace::NegX | ChunkFace::PosZ | ChunkFace::NegY => { /* CCW */ }
+       ChunkFace::PosX | ChunkFace::NegZ | ChunkFace::PosY => { /* CW */ }
    }
}
```

#### Step 5 — Include Y in `BoundaryFlags::is_boundary`

**File:** `src/voxel/skirt.rs:17–20`

```diff
 pub fn is_boundary(&self) -> bool {
-    self.neg_x || self.pos_x || self.neg_z || self.pos_z
+    self.neg_x || self.pos_x || self.neg_y || self.pos_y || self.neg_z || self.pos_z
 }
```

#### Step 6 — Fix all call sites that construct `NeighborLods` without vertical fields

Every test and function that constructs `NeighborLods { neg_x, pos_x, neg_z,
pos_z }` must add `neg_y: None, pos_y: None`. Affected locations:

- `meshing.rs` tests: `surface_nets_mesh`, `lod0_transition_boundary_sdf_matches_lower_lod_neighbor_sample`
- `plugin.rs` tests: LOD halo dirty test, `empty_surface_nets_cap_forces_lod0_sampling`

#### Verification

- Existing skirt tests in `skirt.rs` must pass with the new fields.
- Add a test for vertical skirt generation (LOD0 chunk above LOD2 chunk).
- Visual inspection: horizontal seams at Y chunk boundaries should have skirt
  geometry hiding them.

---

## Issue 2 — `empty_chunk_has_surface_nets_boundary_surface` only checks NegY

**Severity: MEDIUM**

### Problem Statement

The function that decides whether an empty chunk should still be meshed (because
Surface Nets assigns it a boundary surface from the neighbor halo) only scans the
**bottom face** (y−1 plane). It does not check the **top face** (PosY — solid
above, air below = overhang).

**File:** `src/voxel/meshing.rs:2103–2120`

```rust
pub(crate) fn empty_chunk_has_surface_nets_boundary_surface(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> bool {
    let origin = VoxelWorld::chunk_to_world(chunk_pos);
    // Only checks y-1 plane (NegY face)
    let plane_origin = IVec3::new(origin.x, origin.y - 1, origin.z);
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            let pos = plane_origin + IVec3::new(x, 0, z);
            if terrain_meshing_voxel_at(world, pos).is_solid() {
                return true;
            }
        }
    }
    false
}
```

When an empty chunk sits **below** terrain (an overhang scenario), the Lod0
override does not activate. At LOD2/LOD3, the coarse 6³ or 4³ SDF produces a
rectangular slab instead of the correct overhang geometry.

Side-neighbor boundary surfaces are intentionally excluded (test
`surface_nets_empty_side_neighbor_does_not_need_terrain_mesh` explicitly enforces
this) because they create spurious standalone slabs.

### Visible Symptom

Coarse rectangular slabs visible under overhangs at LOD2/LOD3 distances.

### Fix Plan

**File:** `src/voxel/meshing.rs:2103–2120`

Add a PosY face check:

```rust
pub(crate) fn empty_chunk_has_surface_nets_boundary_surface(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> bool {
    let origin = VoxelWorld::chunk_to_world(chunk_pos);

    // Check NegY face (solid below → surface cap above)
    let below_y = origin.y - 1;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if terrain_meshing_voxel_at(
                world,
                IVec3::new(origin.x + x, below_y, origin.z + z),
            )
            .is_solid()
            {
                return true;
            }
        }
    }

    // Check PosY face (solid above → overhang surface below)
    let above_y = origin.y + CHUNK_SIZE_I32;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if terrain_meshing_voxel_at(
                world,
                IVec3::new(origin.x + x, above_y, origin.z + z),
            )
            .is_solid()
            {
                return true;
            }
        }
    }

    false
}
```

#### Verification

- Existing test `surface_nets_empty_side_neighbor_does_not_need_terrain_mesh`
  must still pass (side neighbors remain excluded).
- Add a test for the overhang case: empty chunk below solid terrain should return
  `true` from the boundary check and get the Lod0 override.

---

## Issue 3 — Low-LOD SDF has no boundary transition smoothing

**Severity: MEDIUM**

### Problem Statement

LOD0's `generate_sdf()` (`meshing.rs:2304–2331`) has explicit boundary
transition logic: when a LOD0 chunk borders a lower-LOD neighbor, the boundary
SDF samples use multi-sample density averaging aligned to the neighbor's step
size (via `lower_detail_transition_step`). This ensures the LOD0 mesh's edge
vertices match the lower-LOD neighbor's mesh.

But `generate_low_lod_sdf()` (`meshing.rs:2257–2283`), used by LOD1/2/3, has
**no equivalent transition logic**. It does not receive `NeighborLods` and does
not adjust boundary SDF values.

When a LOD1 chunk (step=2) borders a LOD3 chunk (step=8):
- LOD1 boundary cell samples a 2×2×2 region → density value D₁
- LOD3 boundary cell samples an 8×8×8 region from the overlapping world position
  → density value D₃
- D₁ ≠ D₃ → different isosurface positions → **visible seam**

The skirt system partially hides this, but gaps can remain visible at certain
viewing angles.

### Fix Plan

#### Option A — Pass neighbor LODs into `generate_low_lod_sdf` (recommended)

**File:** `src/voxel/meshing.rs`

1. Add `my_lod` and `neighbor_lods` parameters to `generate_low_lod_sdf`.

2. At boundary grid cells (grid position 1 or `padded_size - 1` in x/z), check
   if the facing neighbor has a different LOD. If the neighbor has a larger step
   size, align the SDF sample to the neighbor's step grid:

   ```rust
   fn generate_low_lod_sdf<const N: usize>(
       chunk: &Chunk,
       world: &VoxelWorld,
       padded_size: u32,
       step: i32,
       linearize: impl Fn([u32; 3]) -> u32,
   +   my_lod: LodLevel,
   +   neighbor_lods: &NeighborLods,
   ) -> [f32; N] {
       // ... existing loop ...
       for x in 0..padded_size {
           // If x == 1 and neg_x neighbor has larger step, use that step
           // If x == padded_size - 1 and pos_x neighbor has larger step, use that step
           let effective_step = boundary_transition_step(
               my_lod, neighbor_lods, x, z, padded_size, step
           );
           sdf[idx] = sample_lod_density_at_world_pos(world, base_world_pos, effective_step);
       }
   }
   ```

3. Update callers: `generate_sdf_lod1`, `generate_sdf_lod2`, `generate_sdf_lod3`
   to pass through `my_lod` and `neighbor_lods`.

4. Update `generate_chunk_mesh_surface_nets_lod1/2/3` to forward `neighbor_lods`
   to the SDF generation functions.

#### Option B — Rely on skirts only (current approach, less work)

If Issue 1 (vertical skirts) is fixed, the horizontal skirts plus newly added
vertical skirts may be sufficient to cover LOD-to-LOD boundary mismatches. This
avoids SDF changes but accepts some vertex mismatch at boundaries.

#### Verification

- Add a test that generates SDF for a LOD1 chunk bordering a LOD3 chunk and
  verifies the boundary cell SDF value matches what the LOD3 neighbor would
  compute for the same world position.
- Visual inspection: fewer visible seams at LOD-LOD boundaries.

---

## Issue 4 — `lower_detail_transition_step` ignores Y boundaries

**Severity: LOW (becomes relevant after Issue 1 is fixed)**

### Problem Statement

The LOD0 SDF transition smoothing (`lower_detail_transition_step`,
`meshing.rs:2209–2236`) only checks `px`/`pz` against NegX/PosX/NegZ/PosZ
boundaries. It does not check `py` against NegY/PosY boundaries.

Once Issue 1 adds vertical LODs to `NeighborLods`, this function should be
extended to apply transition smoothing at Y boundaries too.

```rust
fn lower_detail_transition_step(
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    px: u32,
-   pz: u32,
+   py: u32,
+   pz: u32,
) -> Option<i32> {
    // ...existing NegX/PosX/NegZ/PosZ checks...
+   // Add NegY/PosY:
+   (ChunkFace::NegY, py == 1),
+   (ChunkFace::PosY, py == LOD0_PADDED_SIZE - 1),
}
```

### Fix Plan

After Issue 1 is implemented:

1. Add `py` parameter to `lower_detail_transition_step`.
2. Add `(ChunkFace::NegY, py == 1)` and `(ChunkFace::PosY, py == LOD0_PADDED_SIZE - 1)` to the boundary check array.
3. Update the single call site in `generate_sdf` to pass `py`.

#### Verification

- Existing test `lod0_transition_boundary_sdf_matches_lower_lod_neighbor_sample`
  must still pass.
- Add a vertical variant of that test (LOD0 chunk above LOD1 chunk, check
  boundary SDF values match).

---

## Implementation Order

| Priority | Issue | Effort | Expected Impact |
|---|---|---|---|
| 1 | Issue 1 — Vertical NeighborLods + skirts | Medium | Fixes horizontal seam lines at Y chunk boundaries |
| 2 | Issue 2 — PosY boundary surface check | Small | Fixes coarse slabs under overhangs |
| 3 | Issue 3 — Low-LOD SDF boundary transition | Medium | Reduces vertex mismatch at LOD-LOD boundaries |
| 4 | Issue 4 — Y boundary transition step | Small | Improves LOD0 SDF at vertical boundaries |

Issues 1 and 2 should be done first since they target the most visible artifacts
with the least risk of regression.

---

## Files Changed (Planned)

| File | Issues |
|---|---|
| `src/voxel/skirt.rs` | 1 |
| `src/voxel/plugin.rs` | 1 |
| `src/voxel/meshing.rs` | 2, 3, 4 |
| `src/constants.rs` | — (no changes expected) |
| `src/voxel/chunk.rs` | — (no changes expected) |
| `src/voxel/world.rs` | — (no changes expected) |
