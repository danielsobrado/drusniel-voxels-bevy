# Task: Re-enable BFS Occlusion Culling in Drusniel-Voxels

You are working on **Drusniel-Voxels**, a Rust + Bevy 0.17 voxel survival game using Surface Nets meshing, chunk-based world management (16³ voxel chunks), 4 LOD levels, an octree for frustum culling, and Avian physics. The repo is `danielsobrado/drusniel-voxels-bevy`.

## Coding Rules (mandatory)

- KISS, YAGNI, SOLID. Small files; split by responsibility if a file grows.
- Production quality. Proper `tracing`/Bevy logging (`info!`, `warn!`, `trace!`) and error handling. No `unwrap()` on fallible paths.
- Constants separated from logic. All tunables in a YAML config file (`assets/config/occlusion.yaml`), not hardcoded.
- Minimal, generic comments only. Mark incomplete work with `// TODO:`.
- Must run on Intel HD 620 (this is a CPU-side system — keep per-frame cost bounded and throttled).

---

## Current State (read these files first)

| File | Role |
|---|---|
| `src/voxel/visibility.rs` | Per-chunk face connectivity via flood-fill. Produces a 15-bit `FaceVisibility` mask (which of the 6 chunk faces can see each other through air). Has fast paths for `ChunkUniformity::Empty` (all connected) and `Solid` (none connected). |
| `src/voxel/occlusion.rs` | Runtime BFS (`bfs_visible_chunks`) from the camera chunk through the connectivity graph. `VisibleChunks` resource (HashSet + dirty flag), `OcclusionConfig` resource (`enabled`, `max_depth: 50`, `update_interval: 0.1`), `OcclusionUpdateTimer`. Missing chunks are treated as `all_connected()`. |
| `src/voxel/octree.rs` | `ChunkOctree` for O(log N) frustum culling, rebuilt when dirty via `update_octree_system`. |
| `src/voxel/plugin.rs` | `update_chunk_face_visibility_system` (recomputes masks for visibility-dirty chunks). `apply_visibility_culling_system` is **disabled** (`#[allow(dead_code)]`, body commented out). |
| `src/props/mod.rs` | Props have their own 2D distance-based chunk culling (`PROP_CHUNK_SIZE_CULL = 64.0`, `PropChunkCullState`, hysteresis, throttled updates). Props carry `PersistedProp { chunk_pos: IVec2 }`. |
| `src/voxel/chunk.rs` | `Chunk`, `FaceVisibility`, `ChunkUniformity`, dirty flags. |

## Why It Was Disabled (root causes — all three must be fixed)

The disabled system's TODO states:

1. **BFS ignores view direction and LOD/render distance** — it flood-fills omnidirectionally, so in open terrain it visits huge chunk counts and its `max_depth` cutoff culls terrain that is plainly visible at far LODs.
2. **Props are decoupled from terrain chunk visibility** — terrain chunks got culled while their props stayed visible, producing floating trees/rocks.
3. **No enclosure gating** — BFS occlusion only pays off in caves/enclosed areas; in open terrain it is pure overhead plus false culls.

---

## Implementation Plan

Work in the order below. Each phase must compile and run independently.

### Phase 1 — Directional, frustum-constrained BFS (fixes cause 1)

Modify `bfs_visible_chunks` in `src/voxel/occlusion.rs` (or add a new function and keep the old one for tests):

1. **Frustum pruning during traversal.** Pass the camera frustum (extract from `PlayerCamera`'s `GlobalTransform` + `Projection`, or reuse the frustum logic already used by `ChunkOctree`). Before enqueueing a neighbor, test its chunk AABB against the frustum **dilated by one chunk** (to avoid edge popping). Skip neighbors fully outside. This is the Minecraft "Advanced Cave Culling" approach: connectivity test first, frustum test as the final gate, and it bounds BFS growth to the view cone.
2. **Directional back-propagation guard.** Never enqueue a neighbor whose direction opposes the accumulated travel direction: track per-entry a 6-bit "directions used" mask; once the BFS has moved `+X`, it may not later move `-X` on that path. This is the standard Minecraft optimization and eliminates most wraparound false-positives and wasted visits.
3. **Distance-aware depth.** Replace the flat `max_depth: 50` with `max_depth = ceil(active_render_distance / CHUNK_WORLD_SIZE) + margin`, computed from the same source of truth the LOD system uses for its furthest ring (find where LOD distances are defined — `LodSettings` or constants — and reuse it; do not duplicate the value). `margin` comes from config.
4. **Unloaded chunk policy.** Keep treating missing chunks as `all_connected()` (conservative, correct), but do **not** enqueue their neighbors beyond the frustum/depth limits.
5. **Budget.** Add a `max_visited_chunks` config cap. If the BFS hits the cap, log at `trace!` level and mark the result as "overflow": the system must then treat **all** chunks as visible this update (fail open, never fail closed).

### Phase 2 — Enclosure gating (fixes cause 3)

Occlusion culling must only activate when the camera is in an enclosed space. Add to `src/voxel/occlusion.rs`:

1. **Enclosure heuristic (keep it simple):** the camera chunk and its 6 face-neighbors are loaded, and the camera chunk's `FaceVisibility` is *not* `all_connected()` (i.e., it is a Mixed chunk with at least one blocked face pair), **and** a cheap sky test fails: sample upward through chunks above the camera for up to `sky_probe_chunks` (config, default ~8); if every column probe hits a `Solid` or Mixed-with-blocked-vertical chunk, the camera is "underground/indoors".
   - Implement as `fn is_camera_enclosed(world: &VoxelWorld, camera_chunk: IVec3, config: &OcclusionConfig) -> bool`.
   - This is a heuristic; bias toward returning `false` (open). A false "open" costs performance only; a false "enclosed" costs correctness.
2. **Hysteresis:** require the enclosure state to hold for `enclosure_hysteresis_secs` (config, default 0.5) before switching modes, to avoid flicker at cave entrances. Store state in a small resource (`EnclosureState { enclosed: bool, candidate_since: f32 }`).
3. When **not enclosed**: the culling system clears all force-cull flags / restores `Visibility::Inherited` on chunk meshes and does nothing else. Octree frustum culling remains the only active mechanism in the open world (it already runs; do not duplicate it).

### Phase 3 — Apply culling to chunk meshes (re-enable the system)

Rewrite `apply_visibility_culling_system` in `src/voxel/plugin.rs`:

1. Run only when: `OcclusionConfig.enabled && gen_state.is_complete && EnclosureState.enclosed`.
2. Throttle with `OcclusionUpdateTimer` at `update_interval` (config). Also trigger immediately when the camera crosses a chunk boundary (`VisibleChunks.camera_chunk` changed) or `VisibleChunks.dirty` is set by terrain edits.
3. Run BFS, store result in `VisibleChunks`.
4. Toggle rendering via the ECS, not via a custom force-cull flag if avoidable: query chunk mesh entities (`With<ChunkMesh>`) and set `Visibility::Hidden` / `Visibility::Inherited` based on membership in `VisibleChunks`. Map entity → chunk position using the existing chunk-entity association (check how `ChunkMesh` stores or links to `IVec3`; if it doesn't, add the chunk position to the `ChunkMesh` component rather than a parallel map).
5. **Crucial ordering:** this system must run after camera movement and before Bevy's visibility/extract stage. Register it in `PostUpdate` before `VisibilitySystems::VisibilityPropagate` (verify the exact system-set name in Bevy 0.17 — check `bevy::render::view::VisibilitySystems`), or in `Update` after the camera controller with an explicit `.after()` edge.
6. On transitions enclosed→open, on `OcclusionConfig.enabled` flips, and on system startup: restore `Visibility::Inherited` on **all** chunk meshes in one pass. Never leave stale `Hidden` states.

### Phase 4 — Tie props to terrain visibility (fixes cause 2)

Props use 64-unit 2D chunks (`IVec2`); terrain uses 16³ 3D chunks (`IVec3`). Do **not** restructure prop persistence. Instead:

1. In the prop visibility system (`update_prop_chunk_visibility` in `src/props/mod.rs`), after the existing distance/hysteresis logic, add an occlusion check **only when `EnclosureState.enclosed`**: a prop is hidden if the terrain chunk containing its position is not in `VisibleChunks`. Compute the terrain chunk as `IVec3::new(floor(p.x / chunk_world_size), floor(p.y / chunk_world_size), floor(p.z / chunk_world_size))` using the prop's `GlobalTransform` translation. Use existing world→chunk helper from `src/voxel/world.rs` if one exists — do not reimplement.
2. Grass patches (`ProceduralGrassPatch`) are children of chunk entities or carry chunk association — verify. If they are children of the chunk mesh entity, `Visibility::Inherited` handles them for free; if not, apply the same containment check.
3. Same restore rule: when leaving enclosed mode, props fall back to the existing distance-based culling only.

### Phase 5 — Config, debug, and validation

1. **`assets/config/occlusion.yaml`** (new), loaded the same way other YAML configs in `assets/config/` are loaded (find the existing loader pattern, e.g. for `gtao.yaml`, and follow it):

```yaml
occlusion:
  enabled: true
  update_interval_secs: 0.1
  depth_margin_chunks: 2
  max_visited_chunks: 8000
  frustum_dilation_chunks: 1
  enclosure:
    sky_probe_chunks: 8
    hysteresis_secs: 0.5
```

2. **Debug overlay** (`src/interaction/debug.rs`): add to the chunk-stats toggle section — enclosure state, BFS visited count, chunks hidden by occlusion, last BFS duration in µs. Follow the existing `DebugDetailToggles` pattern.
3. **Logging:** `info!` once on mode transitions (enclosed↔open); `trace!` for per-update BFS stats. No per-frame `info!` spam.

---

## Acceptance Criteria

1. Open terrain: zero chunks hidden by occlusion (only octree frustum culling active); no measurable frame-time regression (BFS not running, or early-out < 0.05 ms).
2. Inside a cave: chunks behind solid rock are `Visibility::Hidden`; debug overlay shows a nonzero hidden count; no visible terrain ever disappears while looking at it.
3. No floating props anywhere: any hidden terrain chunk hides the props inside it.
4. Digging through a wall reveals chunks behind it within one `update_interval` (terrain edit → `is_visibility_dirty` → mask recompute → `VisibleChunks.mark_dirty()` → BFS rerun; verify this chain is wired).
5. Walking out of a cave restores all chunks/props; toggling `enabled: false` at runtime restores everything.
6. BFS worst case respects `max_visited_chunks` and fails open.
7. `cargo clippy -- -D warnings` clean; `cargo test` passes; add unit tests for: directional mask logic, depth-from-render-distance computation, and `is_camera_enclosed` on synthetic worlds (fully open, fully buried, cave entrance).

## Constraints & Pitfalls

- **Never fail closed.** Any uncertainty (unloaded chunk, BFS overflow, missing camera) means "visible".
- Do not modify the Surface Nets meshing, LOD selection, or skirt systems.
- Do not rebuild the octree or add a second frustum-culling pass — reuse what exists.
- The flood-fill mask recompute on terrain edit already exists (`update_chunk_face_visibility_system`); verify terrain modification sets the visibility-dirty flag, fix the wiring if it doesn't, and ensure `VisibleChunks.mark_dirty()` is called on edits within the BFS radius.
- Watch Bevy 0.17 visibility semantics: setting `Visibility::Hidden` on the chunk mesh entity must propagate to children (grass, colliders are unaffected — Avian colliders must NOT be disabled by visual culling; physics stays active for hidden chunks).
- Keep the BFS allocation-free per update where practical (reuse `HashSet`/`VecDeque` buffers stored in a resource).

## Deliverables

- Modified: `src/voxel/occlusion.rs`, `src/voxel/plugin.rs`, `src/props/mod.rs`, `src/interaction/debug.rs`
- New: `assets/config/occlusion.yaml`, config struct + loader (follow existing pattern), unit tests
- Updated: `docs/terrain_rendering_modes.md` or a new `docs/occlusion_culling.md` describing the enclosure heuristic, config keys, and debug toggles
