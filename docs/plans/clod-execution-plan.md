# Drusniel CLOD Pages — Execution Plan

Maps the 5 borrowed techniques (meshoptimizer, zeux nanite.cpp parameters, jglrxavpok loop lessons, Bevy error propagation, restricted-quadtree discipline) into phased, executable tasks.

---

## 0. Invariants (do not violate in any phase)

```text
I1. VoxelWorld stays authoritative. Pages are derived caches.
I2. Lower page LODs are NEVER re-extracted from voxels. Always derived
    from the merged child meshes (decimation only).
I3. Page borders are locked during simplification. Internal borders are
    welded and freed when 4 children merge into a parent.
I4. Page LOD build never runs on the frame path. Stale page stays visible
    until replacement is ready. Missing page -> fallback to normal chunks.
I5. Near field (player bubble) stays live Surface Nets LOD0. Task A +
    skirts remain as safety fallback, untouched.
```

---

## 1. Configuration (single source of truth, used by PoC and production)

```yaml
# config/clod_pages.yaml
page:
  chunks_per_page: 4          # 4x4 chunks -> 64x64 cells footprint
  chunk_size: 16
  halo_chunks: 1              # generation halo for correct border normals
  quadtree_levels: 4          # LOD0..LOD3 (LOD3 page = 8x8 LOD0 pages footprint)

simplify:                     # zeux demo/nanite.cpp parameters — start here, tune later
  target_ratio_per_level: 0.5     # 50% index count reduction per level
  abandon_ratio: 0.85             # if result > 85% of input, stop this branch
  target_error: 0.01              # meshopt relative error cap per pass
  weld_epsilon_cells: 0.001       # quantization for internal-seam welding

selection:
  error_threshold_px: 1.0
  hysteresis_merge_factor: 1.5    # merge at 1.5px, split at 1.0px
  neighbor_level_delta_max: 1     # 2:1 restricted quadtree constraint
  crossfade_frames: 12

near_field:
  radius_chunks: 6            # live editable Surface Nets bubble, no pages inside
```

---

## 2. Phase 0 — API verification spike (timebox: half a day)

Goal: confirm the exact meshoptimizer entry points before writing any builder code. Everything downstream depends on these four facts.

- [ ] **JS/WASM:** confirm `MeshoptSimplifier.simplifyWithAttributes(...)` in the npm `meshoptimizer` package accepts a per-vertex `vertex_lock` array, and that `simplify(..., flags: ['LockBorder'])` locks topological borders. Record the package version in the config.
  - TODO: if `vertex_lock` is unavailable in the published WASM build, fall back to `LockBorder` only (acceptable: a page mesh's open boundary IS its outer border after internal welding).
- [ ] **Rust:** confirm which `meshopt` crate version exposes vertex locks / attribute-aware simplification (`simplify_with_attributes_and_locks` or equivalent). 
  - TODO: if the safe wrapper lags, call `meshopt_simplifyWithAttributes` directly via `meshopt-sys` FFI. Decide now, not in Phase 4.
- [ ] **Error scale:** confirm `simplify` returns relative `result_error` and that `meshopt_simplifyScale` converts it to world units. Write the one formula used everywhere:
  ```text
  error_world  = result_error * simplifyScale(mesh)
  error_px     = error_world * viewport_h / (2 * distance * tan(fov_y / 2))
  ```
- [ ] **Attributes:** confirm attribute weights signature for carrying `normal (3)` + `material_weights (N)` through simplification. Decide attribute weight values (start: normals 0.5, materials 1.0 — materials matter more for triplanar splat seams).

Exit criteria: a 30-line script in each language that simplifies a test grid mesh with a locked border and prints world-space error. No engine code yet.

---

## 3. Phase 1 — PoC builder (Three.js + TypeScript, Vite, YAML config)

Borrowed here: **meshoptimizer WASM**, **zeux parameters**, **jglrxavpok merge→weld→lock→simplify loop** (at page granularity, no METIS, no kd-tree).

### 3.1 Source mesh generation
- [ ] Build the LOD0 page source by **welding existing same-resolution chunk meshes** (4x4 chunks -> concatenate + position-weld), NOT by re-extracting at page level. Same-resolution chunk borders are already watertight in the engine; this removes clipping determinism as a seam source and makes the near-bubble edge exact by construction (see 4.4 / Phase 5). Normals come from the chunks' existing gradient computation (neighbor-aware), so they match across page borders by construction.
- [ ] **Input purity (hard rule):** consume ONLY the main Surface Nets terrain surface at base positions. Excluded: skirts, aprons, stitch fallback geometry, morph-deformed positions (use base `ATTRIBUTE_POSITION`, never morph targets), water surfaces, collider-only and debug geometry. Implementation: the chunk mesher must emit main-surface and skirt geometry in separable index ranges (or a per-vertex section flag) at generation time — do NOT strip skirts by post-hoc geometric filtering. Baking old seam hacks into the page cache defeats the entire pivot.
- [ ] Builder assertion (pre-simplification): adjacent same-level source pages have matching border chains — position <= 1e-6, normal dot >= 0.9999, material weight delta <= 1e-4. **Assertion failure is a hard stop — never simplify dirty input.** If this fails, the chunk extraction is the bug, not the page builder.
- [ ] World: 8x8 LOD0 pages for the real PoC (the minimum that contains one complete LOD3 node). 4x4 only as a smoke test. LOD3 adjacency is not tested and does not need to be — the merge/lock/select path is level-agnostic, so LOD1/LOD2 adjacency passing proves it by induction.

### 3.2 Quadtree build loop (the core deliverable)
Per level L from 0 to `quadtree_levels - 1`:

- [ ] **Merge:** concatenate 4 child meshes of level L into one buffer.
- [ ] **Weld:** weld vertices across the old internal borders by quantized position (`weld_epsilon_cells`). Use a spatial hash, not a kd-tree (jglrxavpok's perf failure mode #1). Assert: post-weld, no topological border edges exist except on the parent's outer footprint.
- [ ] **Lock:** build `vertex_lock` for vertices on the parent's outer footprint border. Detection by position quantization against footprint planes, not by float equality.
- [ ] **Simplify:** `simplifyWithAttributes` with `target = indices * target_ratio_per_level`, `target_error`, locks, attribute weights from config.
- [ ] **Low-benefit check:** if `result_indices > abandon_ratio * input_indices`, log it and mark the node `low_benefit` — but still build the full hierarchy in the PoC. Terminal branches complicate cut traversal (missing-parent fallback) and hide data the PoC exists to gather. Frequent low-benefit nodes mean locked-border density is dominating and page size must grow.
  - TODO (Phase 4): decide whether production enforces terminal branches, based on PoC low-benefit statistics.
- [ ] **Error accumulation (Bevy meshlet idea):**
  ```text
  node.error_world = simplification_error_world + max(child.error_world for children)
  ```
  This makes error monotonic up the tree, relative to LOD0 — required for stable DAG-cut selection. Store per node.
- [ ] Persist per node: positions, normals, material weights, indices, `error_world`, bounding sphere.

### 3.3 Degenerate handling (jglrxavpok failure modes)
- [ ] Strip zero-area triangles post-simplify.
- [ ] Detect T-vertices introduced by bad welds: assert every border vertex of a parent exists in the border chain of the adjacent node at the same level. Fail loudly in the builder, not silently at runtime.

---

## 4. Phase 2 — PoC runtime + debug

Borrowed here: **error propagation for selection**, **2:1 restricted quadtree discipline**, **crossfade**.

### 4.1 Selection
- [ ] Traverse quadtree from root each frame: if `error_px(node) <= error_threshold_px` render node, else recurse. Monotonic errors from 3.2 guarantee a clean cut.
- [ ] Hysteresis: a rendered node only merges back to its parent when parent `error_px <= threshold / hysteresis_merge_factor`.
- [ ] **2:1 constraint pass:** after the cut, force-split any node whose rendered neighbor is more than 1 level apart. Note: locked outer borders make seams watertight by construction even at larger deltas — the constraint exists to bound the visual density gradient and locked-border cost, not for crack correctness. Add a toggle to disable it and observe the difference.
- [ ] Freeze-selection toggle (camera moves, cut frozen) — primary debugging tool.

### 4.2 Crossfade
- [ ] Dithered (screen-door) crossfade over `crossfade_frames` when the cut changes. No geomorph in the PoC — geomorph is a Phase 7 polish item, crossfade is the safe default for topology-changing decimation.

### 4.3 Debug overlays (all toggleable, lil-gui)
- [ ] Wireframe per LOD color; page boundaries; locked border vertices highlighted; per-node `error_world`/`error_px` labels; stats panel (tris rendered, nodes per level, build ms per node).

### 4.4 Stress cases (acceptance inputs)
- [ ] Ridge crossing a page border; steep cliff crossing a page corner (4-page junction); cave mouth intersecting a page border (open boundary correctness); forced neighbor LOD deltas of 1, 2, 3.
- [ ] Thin terrain bridge (2-3 cells wide) spanning a page border; cave lip / overhang edge viewed at LOD2-LOD3 distance -> degradation must be gradual and screen-error-bounded, never sudden disappearance. Rule: never substitute `simplify_sloppy` for `simplify`, even if low-benefit rates look bad — fix with page size, not topology-breaking simplification.
- [ ] Fake near-field bubble mask: hide pages inside a movable radius and render the raw chunk meshes there instead -> verify the bubble edge is invisible (it must be, since page LOD0 source = welded chunk meshes; any visible edge is a weld/ownership bug).

---

## 5. Phase 3 — Acceptance gate (go/no-go for Rust port)

```text
A1. Watertight: no holes/lips at any tested neighbor LOD delta, verified
    by border-chain assertion AND visual sweep at grazing angles.
A2. No dark seams — measurable: for every matched border vertex pair at
    every level: position <= 1e-6, normal dot >= 0.9999, material weight
    delta <= 1e-4. Locked vertices survive simplification verbatim, so
    looser thresholds (e.g. 0.98) only mask builder bugs.
A3. Density scars acceptable: locked outer borders at far LODs do not
    produce objectionable wireframe scars at gameplay camera distances.
    If they do -> increase page size to 8x8 chunks and re-test before
    rejecting the approach.
A4. Triangle reduction: LOD3 <= ~15% of LOD0 triangles per covered area
    (i.e. 50%^3 with locked-border overhead).
A5. Build cost: full 8x8 world hierarchy builds in seconds, single node
    rebuild in tens of ms — plausible as async background work.
A6. Low-benefit rate: < 10% of nodes marked low_benefit at levels 1-2.
```

Fail A3/A6 → larger pages. Fail A1 → bug, fix. Fail A4 with everything else passing → tune attribute weights / target_error before concluding.

---

## 6. Phase 4 — Rust offline page builder

- [ ] Port the Phase 1 builder 1:1 using the `meshopt` crate path validated in Phase 0. Same YAML config, same parameters — the PoC validated *these* numbers, do not "improve" them during the port.
- [ ] Crate layout (SOLID, small files):
  ```text
  src/terrain/pages/
    config.rs        # serde load of clod_pages.yaml
    source_mesh.rs   # collect clean LOD0 chunk main-surface exports, build LOD0 page source (NO re-extraction)
    weld.rs          # spatial-hash position weld with attribute-conflict hard-fail
    lock.rs          # parent outer-border lock detection by quantized footprint position
    simplify.rs      # meshopt wrapper (sole FFI boundary), error accumulation
    quadtree.rs      # node hierarchy, build orchestration
    validate.rs      # border-chain + degenerate hard-fail validation (release builds included — builder is off the frame path)
  ```
- [ ] Golden tests: serialize PoC outputs (positions/indices/errors) for 2-3 stress pages; Rust builder must match within epsilon. This catches FFI/stride/winding mistakes immediately.
- [ ] Builder runs in a background task pool (existing async infra), never on the frame path (I4).

---

## 7. Phase 5 — Bevy runtime integration

Runtime rollout: CLOD pages are default-off. Set `CLOD_PAGES=1` (or `true`/`on`/`yes`) for
pages-on A/B runs; `CLOD_PAGES=0` (or `false`/`off`/`no`) explicitly keeps the live path.

- [ ] Plain `Mesh` asset per quadtree node, one entity per rendered node. Existing triplanar material. **No meshlets, no indirect draws, no custom render path** — revisit only if profiling demands it.
- [ ] Port selection + hysteresis + 2:1 pass from Phase 2 as a Bevy system; cut changes swap entity visibility, crossfade via material alpha-hash param.
- [ ] Near-field exclusion: no page rendering inside `near_field.radius_chunks`; live Surface Nets chunks own that region. Transition strategy: **page LOD0 = welded chunk meshes (3.1) makes the bubble edge exact** — so the transition is a **binary ownership switch per chunk footprint**: exactly one owner (live chunk or page) draws at any time, no overlap band. Crossfading identical co-planar geometry means both draw simultaneously -> z-fighting; do NOT add a fade band here.
  - Fade is only meaningful when geometry actually differs (stale page after an edit). If post-edit staleness at the bubble edge proves visible, use a dither fade with **complementary masks** (one surface per pixel, never additive). Fog/hard-distance-switch are crutches; do not reach for them first.
- [ ] Fallbacks (I4/I5): page missing or stale → render the chunks it covers via the existing chunk path.
- [ ] Colliders: pages get none. Collider radius stays inside the near-field bubble.

---

## 8. Phase 6 — Edit invalidation

- [ ] Voxel edit dirties: owning LOD0 page + all ancestors (max `quadtree_levels` nodes).
- [ ] Rebuild LOD0 page first (visible soonest), ancestors lazily — only if the camera could currently select them (`error_px` check before queueing).
- [ ] Edits inside the near-field bubble (the common case): chunks update instantly as today; page rebuilds are pure background, latency invisible.
- [ ] Debounce: coalesce edits per page over a short window before queueing rebuild.

---

## 9. Deferred (explicitly not now)

```text
- Geomorph / fat vertices: collapse-destination correspondence exists in
  edge-collapse decimation; revisit only if crossfade pops are visible.
- Cluster/meshlet rendering of pages, indirect draws.
- Bevy virtual geometry: track jms55's progress; do not depend on it.
- METIS, per-cluster DAG: not needed for grid-aligned terrain.
- Page streaming/compression to disk.
```

---

## 10. Order of execution

```text
Phase 0 (0.5d) -> Phase 1 -> Phase 2 -> Phase 3 GATE -> Phase 4 -> Phase 5 -> Phase 6
```

Hard rule: nothing in Phases 4-6 starts before the Phase 3 gate passes. The cheapest place to discover that locked-border density or abandon rates kill the approach is the Three.js sandbox, not the Bevy codebase.

---

## 11. Code Integration Appendix (Rust, Phases 4-6)

Placement rule: this appendix lives in `docs/rendering/clod-pages-implementation.md` plus short module-level doc comments and strict TODOs in target source files. Do NOT paste the full design into source files — source carries only durable invariants, data contracts, and failure rules.

### 11.1 Chunk mesher export (current Surface Nets meshing module)

- TODO(verify): confirm the exact symbols in the current mesher — expected: main surface generated first, then snap/morph application, then section stats, then skirts appended, then morph-target padding (candidates: `apply_snap_or_morph`, `TerrainMeshSectionStats`, `TERRAIN_MESH_SECTION_MAIN` / `_HORIZONTAL_SKIRT` / `_VERTICAL_SKIRT`). Adapt names below to reality; do not trust this appendix's guesses.
- [ ] Capture a clean export **before skirts/aprons/stitches are appended and before morph-deformed positions exist**. Never derive it from the final Bevy `Mesh`.

```rust
pub struct TerrainMainSurfaceExport {
    pub local_positions: Vec<Vec3>,     // chunk-local; world = local + chunk_origin (one representation only)
    pub normals: Vec<[f32; 3]>,
    pub material_weights: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
    pub chunk_origin: IVec3,
    pub lod: LodLevel,                  // must be LOD0 for page input
    pub revision: u64,                  // staleness tracking for Phase 6
}
```

- [ ] Make section ranges explicit so exclusion is structural, not heuristic:

```rust
#[derive(Clone, Debug, Default)]
pub struct TerrainMeshSectionRanges {
    pub main: Range<u32>,
    pub horizontal_skirt: Range<u32>,
    pub vertical_skirt: Range<u32>,
    pub transition_apron: Range<u32>,
}

pub fn extract_main_surface_for_clod(result: &ChunkMeshResult)
    -> Result<TerrainMainSurfaceExport, ClodBuildError>;
```

Hard-fail conditions: main range empty while non-main geometry exists; morph-target data used as source geometry; water or collider-only mesh passed as terrain page input.

### 11.2 source_mesh.rs — LOD0 page source (no re-extraction)

```rust
pub struct PageSourceMesh {
    pub page_id: PageId,
    pub positions: Vec<[f32; 3]>,       // world space after origin application
    pub normals: Vec<[f32; 3]>,
    pub material_weights: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
    pub source_chunk_revisions: Vec<(IVec3, u64)>,
}

pub fn build_lod0_page_source(
    page_id: PageId,
    chunk_exports: &[TerrainMainSurfaceExport],
    config: &ClodPagesConfig,
) -> Result<PageSourceMesh, ClodBuildError>;
```

```text
1. Require exactly 4x4 LOD0 chunk exports, else PageIncomplete.
2. Reject any export with lod != LOD0.
3. Concatenate, applying chunk origins.
4. Weld internal chunk borders by quantized position (11.3).
5. Preserve outer page border vertices verbatim.
6. Assert: no internal topological borders remain.
7. Assert: outer border chains match neighbors (gate A2 tolerances).
```

### 11.3 weld.rs — spatial hash, conflict = hard fail

```rust
pub fn weld_vertices(mesh: &mut PageSourceMesh, epsilon: f32, mode: WeldMode)
    -> Result<WeldReport, ClodBuildError>;

pub struct WeldReport {
    pub input_vertices: usize,
    pub output_vertices: usize,
    pub merged_vertices: usize,
}
```

Conflict rule: positions within epsilon but normal dot < 0.9999 or material delta > 1e-4 is **DirtyInput — fail with the offending vertex pair**, do not count-and-continue. A "rejected conflict" would survive as an unwelded internal border and fail later with a worse error message. Spatial hash, not kd-tree.

### 11.4 lock.rs

```rust
pub fn build_outer_border_locks(mesh: &PageMesh, footprint: PageFootprint, epsilon: f32) -> Vec<bool>;
```

Rule: only the **current parent's** outer footprint border is locked; old child borders must already be welded and free. Detection by quantized position against footprint planes.

### 11.5 simplify.rs — sole meshoptimizer boundary

```rust
pub struct SimplifyInput<'a> {
    pub positions: &'a [[f32; 3]],
    pub normals: &'a [[f32; 3]],
    pub material_weights: &'a [[f32; 4]],
    pub indices: &'a [u32],
    pub vertex_locks: &'a [bool],       // convert to &[u8] at the FFI edge
}

pub struct SimplifyOutput {
    pub mesh: PageMesh,
    pub result_error: f32,              // meshopt relative
    pub error_world: f32,               // result_error * simplifyScale
    pub low_benefit: bool,
}
```

No other module calls meshoptimizer. `quadtree.rs` sees only this API. Never expose or use `simplify_sloppy`.

### 11.6 quadtree.rs

```rust
pub struct ClodPageNode {
    pub id: PageNodeId,
    pub level: u8,
    pub children: [Option<PageNodeId>; 4],
    pub mesh: PageMesh,
    pub bounds: BoundingSphere,
    pub error_world: f32,               // = simplification_error_world + max(child.error_world)
    pub low_benefit: bool,
    pub revision: u64,
}
```

Build rule: LOD0 node from 11.2; LOD1+ node = merge 2x2 children -> weld old internal page borders -> lock new outer border -> simplify -> accumulate error.

### 11.7 validate.rs — errors, never warnings

```rust
pub fn validate_border_match(a: &PageMesh, b: &PageMesh, edge: SharedPageEdge,
    tolerances: BorderTolerances) -> Result<(), ClodBuildError>;

pub enum ClodBuildError {
    MissingChunkExport(IVec3),
    PageIncomplete(PageId),
    DirtyInput(String),
    BorderPositionMismatch,
    BorderNormalMismatch,
    BorderMaterialMismatch,
    InternalBorderNotWelded,
    SimplifierApiUnavailable,
    MeshoptFailed(String),
}
```

### 11.8 Runtime ownership doc comment (Bevy integration)

```rust
/// CLOD pages and live chunks are mutually exclusive owners of a terrain footprint.
/// Fresh LOD0 pages are built from the same main-surface chunk meshes as the live
/// chunks, so drawing both causes coplanar z-fighting. Binary ownership switch per
/// chunk footprint; complementary dither fade ONLY for stale (post-edit) geometry.
```

### 11.9 What this appendix exists to prevent

```text
1. Building pages from final Bevy meshes (bakes skirts/morph hacks into the cache).
2. Heuristic skirt stripping instead of structural section ranges.
3. Re-extraction creeping back into source_mesh.rs.
4. Weld conflicts silently counted instead of failing.
5. meshoptimizer calls scattered outside simplify.rs.
6. Overlap-fading identical geometry at the bubble edge.
```
