# Terrain Collider Overhaul Status

Date: 2026-05-12

This document records what has been achieved so far for terrain collider correctness and performance. It covers the implemented changes, benchmark evidence, and remaining risks.

The intended reader is a future engineer investigating terrain collision, player fall-through, warm-up time, or collider bake performance. The document is intentionally detailed and includes pseudocode for the current implementation shape.

## Goals Addressed

The collider work was aimed at these production issues:

- Player fall-through during chunk load, terrain rebuild, or collider swap.
- Collider readiness races where gameplay started before nearby terrain colliders were available.
- Collider bake thrash from stale chunk mesh revisions.
- Expensive or unstable runtime collider updates.
- Bench readiness timeouts that hid whether terrain, render, or collider readiness was the real blocker.

## Implemented Architecture

### Collider Cache And Readiness

The physics path now has a terrain collision cache and explicit readiness tracking:

- `TerrainCollisionCache` stores conservative occupancy/source-query data for terrain chunks.
- Player/spawn readiness can use terrain source/cache data instead of trusting only the presence of ECS collider entities.
- Bench readiness now records collider-ready and collider-pending entity counts.
- Gameplay bench checkpoints require local gameplay collider readiness.
- Visual-only checkpoints still use visual/render readiness rules.

Key files:

- `src/physics/terrain_collision_cache.rs`
- `src/player/spawn.rs`
- `src/player/input.rs`
- `src/bench/mod.rs`

### Async Collider Baking And Double-Buffered Swaps

Terrain collider generation now uses an async bake path with old colliders kept live until replacement is ready.

Important behavior:

- `NeedsCollider` marks chunks that need collider generation.
- `TerrainColliderBakeTask` carries the async bake.
- `ChunkCollider` marks the active terrain collider.
- Collider bake dispatch and completed-collider swaps both use pressure-sensitive per-frame budgets.
- Old colliders are not removed during the bake window.
- Bake completion validates the terrain collision revision before publishing.
- Async bake payloads carry only collider-relevant mesh data where possible, not the full render `Mesh`.

Key file:

- `src/physics/terrain_collider.rs`

### Stale-Bake Thrash Fix

A major performance/correctness bug was fixed in the collider pipeline.

Root cause:

The previous `Changed<Mesh3d> + With<ChunkCollider>` watcher could mark newly-ready colliders stale from historical mesh insertion/change ticks. This created a loop:

1. Collider bake completed.
2. Chunk became `Ready`.
3. The mesh-change watcher immediately marked it `Stale`.
4. A new bake was queued.
5. The bench saw many pending/stale colliders and readiness could time out.

Fix:

- Removed the stale mesh-change watcher from the runtime physics system chain.
- The mesh update path remains the source of collider invalidation by inserting `NeedsCollider`.
- Each async collider bake now records the exact `Mesh` asset id it baked.
- On completion, the result is dropped only if the entity's current mesh asset id no longer matches the baked asset.

Key files:

- `src/physics/plugin.rs`
- `src/physics/terrain_collider.rs`

### Collider Dispatch Performance Updates

Several low-risk performance cleanups were applied after the stale-bake fix:

- The removed `Changed<Mesh3d> + With<ChunkCollider>` watcher was deleted from the codebase, not just left unregistered.
- `VOXEL_TERRAIN_COLLIDER` is read once when the physics plugin starts and stored as `TerrainColliderConfig`.
- Collider bake dispatch skips sorting pending chunks when the current frame budget can process all pending work.
- Collider swaps now use the same pressure-sensitive budget as bake dispatch:
  - startup catch-up: `MAX_STARTUP_COLLIDERS_PER_FRAME`
  - player-near catch-up: `MAX_PLAYER_NEAR_COLLIDERS_PER_FRAME`
  - normal churn: `MAX_COLLIDERS_PER_FRAME`
- The default mesh bake path extracts positions and triangle indices into a compact `TerrainColliderMeshData` payload before spawning the async task. This avoids cloning normals, UVs, materials, and other render-only mesh attributes into the bake task.
- Heightfield fallback still works from position-only data when triangle indices are unavailable.

These changes preserve the core correctness invariant: a completed bake still publishes only when the entity's current mesh asset id and terrain collision source revision match the bake task.

### Gameplay Bench Readiness Gate

The collider walk bench now separates gameplay readiness from visual readiness.

Before:

- Gameplay checkpoints could wait on global visual mesh stability.
- Optional collider count growth reset the 90-frame stability window.
- Warm-up could be much longer than the actual local gameplay readiness requirement.

After:

- Gameplay checkpoints use the gameplay start position for readiness.
- Gameplay readiness requires:
  - no local missing chunks,
  - no local dirty chunks,
  - no local pending colliders,
  - at least one local ready collider.
- Gameplay stability treats collider readiness as a boolean condition instead of requiring the exact number of ready collider entities to stop changing.
- Visual checkpoints still require global mesh quiescence.

Key file:

- `src/bench/mod.rs`

## Detailed System Model

### Current Collision Products

The game currently has multiple terrain-related products derived from the voxel world:

| Product | Primary consumer | Readiness risk | Notes |
| --- | --- | --- | --- |
| Terrain mesh | Rendering | visual holes, LOD churn | Built by the voxel meshing systems. |
| Water mesh | Rendering | visual readiness | Tracked separately from terrain mesh entities. |
| Terrain collision cache | Player/spawn fallback and readiness | stale source query data | Conservative cache derived from terrain source data. |
| Avian terrain collider | Physics world | bake/swap latency, stale bakes | Built asynchronously from chunk meshes or optional voxel payloads. |
| World floor/crust collider | Safety fallback | should never be unloaded | Spawned independently of chunk rebuilds. |

The main architectural rule is that gameplay and physics readiness are no longer inferred from the render mesh alone. The render mesh can exist while the collider is stale, and the collider can be valid while visual LOD churn continues elsewhere.

### Current Runtime Components

Important terrain collider components:

| Component/resource | Role |
| --- | --- |
| `NeedsCollider` | Marker on a chunk mesh entity saying a collider bake is required. |
| `TerrainColliderBakeTask` | Async bake task plus the chunk position, source revision, and baked mesh asset id. |
| `ChunkCollider` | Marker on a chunk mesh entity with an active collider. |
| `TerrainCollisionChunk` | Component recording the chunk coordinate associated with collision state. |
| `TerrainCollisionState` | ECS-visible state: `Missing`, `Queued`, `Baking`, `Ready`, `Stale`, `Failed`. |
| `TerrainCollisionRevision` | Revision component for source/baked/collider revision diagnostics. |
| `TerrainCollisionRegistry` | Resource that tracks per-chunk collision state and revision metadata. |
| `TerrainCollisionCache` | Resource holding conservative occupancy/source-query data. |
| `TerrainColliderConfig` | Startup-loaded collider mode configuration derived from `VOXEL_TERRAIN_COLLIDER`. |

The important distinction is that `NeedsCollider` is the authoritative ECS marker for collider work. The removed `Changed<Mesh3d> + With<ChunkCollider>` watcher is no longer part of the runtime invalidation path because it caused false stale marking.

### Collider Accuracy Notes

The default `auto` mode prefers a triangle mesh collider built from the terrain mesh positions and indices with `TrimeshFlags::FIX_INTERNAL_EDGES`.

Accuracy properties:

- Trimesh collision matches the mesh asset baked for the chunk. If rendering uses an LOD or simplified mesh for that entity, collision follows that mesh representation, not the raw voxel source.
- The stale-bake guard prevents a collider built for an older mesh asset or source revision from replacing a newer collider.
- During a rebuild, a chunk may be stale but still physically covered because the old `ChunkCollider` remains live until the replacement bake is validated.
- The collision cache is conservative for source queries: missing chunks and below-floor samples are treated as solid for collision support, while above-world samples are air.
- Heightfield mode is intentionally rough. It uses a fixed 9x9 max-height projection, so it cannot represent caves, overhangs, vertical walls, or concave voxel structures accurately.
- Empty or invalid bake payloads currently produce `Failed`. This is operationally safe, but future diagnostics may benefit from distinguishing "no geometry needed" from "collider build failed".

### Performance Hotspots And Status

Performance claims should be validated with the collider walk bench before being treated as wins. The current state of the known hotspots is:

| Area | Status | Notes |
| --- | --- | --- |
| Full render `Mesh` clone during bake dispatch | Improved | The dispatch path now extracts collider-relevant positions and indices before spawning the async bake, avoiding render-only attributes. |
| Fixed swap budget of 4 | Improved | Swap budget now follows startup/player-near/normal pressure, matching bake dispatch. |
| Unconditional pending sort in `generate_chunk_colliders` | Improved | Sort is skipped when `pending_count <= collider_budget`. |
| Collision cache scans/sorts all chunk mesh entities | Still open | `update_terrain_collision_cache` still builds a candidate list and sorts by player distance every frame. A dirty set or priority queue would reduce steady-state work. |
| `filled_core_coords` per-cell checks | Still open | Only relevant for `VOXEL_TERRAIN_COLLIDER=voxels`; default trimesh mode does not use this path. |
| Diagnostics full scan | Still open | `record_terrain_collision_diagnostics` still observes all chunk mesh entities and recomputes counts each frame. |

Do not interpret the estimated allocation and branch-count reductions as measured performance results. Use the timing rows and counters in `summary.json` for before/after claims.

### Current System Order

The physics plugin currently runs these systems in a chained `Update` tuple:

```text
update_terrain_collision_cache
generate_chunk_colliders
poll_chunk_collider_bakes
record_terrain_collision_diagnostics
```

This order matters:

1. The cache updates before collider generation can need it.
2. New bake tasks are spawned before completed bake tasks are polled.
3. Completed bakes are swapped before diagnostics record the final observed state for the frame.
4. Diagnostics should observe ECS truth, not drive invalidation.

### Chunk Collider State Meaning

The practical meaning of each terrain collision state is:

| State | Meaning | Gameplay policy |
| --- | --- | --- |
| `Missing` | No known collider state for the chunk. | Treat as unknown; avoid trusting physics there. |
| `Queued` | Collider work is needed but no task is currently active. | Current/old collider may be absent. |
| `Baking` | Async task is building a collider. | Keep old collider if one exists. |
| `Ready` | Active collider matches current known source revision. | Safe for prop physics and normal gameplay collision. |
| `Stale` | Old collider exists but source/mesh changed. | Better than missing, but not authoritative for edits. |
| `Failed` | Collider bake failed. | Treat as unsafe for readiness; investigate geometry/collider build path. |

The current validated path relies on old colliders staying live during `Baking` and `Stale` where possible.

## Pseudocode

The pseudocode below describes the implemented behavior and intended invariants. It is not a line-for-line copy of the Rust code.

### Mesh Update To Collider Dirtying

Chunk meshing remains the source of terrain collider invalidation.

```text
fn apply_chunk_mesh_result(entity, chunk_pos, mesh_handle, chunk_mesh_metadata) {
    if chunk_has_solid_mesh {
        entity.insert((
            Mesh3d(mesh_handle),
            material_for_chunk_lod,
            ChunkMesh {
                chunk_position: chunk_pos,
                vertex_count,
                triangle_count,
                mesh_mode,
                material_quality,
            },
            NeedsCollider,
        ));

        // Important:
        // Do not remove the existing ChunkCollider here.
        // The existing collider remains live until the new bake is ready.
    } else {
        despawn_chunk_mesh_entity_if_present();
        clear_world_mesh_entity_handle();
    }
}
```

Invariant:

```text
If a mesh entity has NeedsCollider and an old ChunkCollider,
the chunk is stale but still physically represented.
```

### Collider Bake Scheduling

`generate_chunk_colliders` finds chunk mesh entities that need collider work and are not already baking.

```text
fn generate_chunk_colliders(world) {
    mode = terrain_collider_mode_from_env_or_default();
    priority_pos = player_position_or_camera_position();

    pending = query_entities_with(NeedsCollider)
        .without(TerrainColliderBakeTask)
        .with(Mesh3d, Transform, ChunkMesh);

    budget = if initial_spawn_pending {
        MAX_STARTUP_COLLIDERS_PER_FRAME
    } else if any_pending_near_player(pending) {
        MAX_PLAYER_NEAR_COLLIDERS_PER_FRAME
    } else {
        MAX_COLLIDERS_PER_FRAME
    };

    if pending.len() > budget {
        pending.sort_by(distance_to(priority_pos));
    }

    for chunk_entity in pending.take(budget) {
        queued_revision = registry.mark_queued(chunk_pos, Initial);

        if mode == Voxels {
            cached = collision_cache.get(chunk_pos);
            if cached is missing or cached.source_revision != queued_revision.source_revision {
                entity.insert(TerrainCollisionState::Queued);
                continue;
            }

            payload = cached.occupancy.filled_core_coords();
        } else {
            mesh = assets.meshes.get(mesh_handle);
            if mesh is missing {
                entity.insert(TerrainCollisionState::Queued);
                continue;
            }

            payload = extract positions and triangle indices from mesh;
        }

        baking_revision = registry.mark_baking(chunk_pos);

        task = AsyncComputeTaskPool.spawn(async move {
            build_terrain_collider(payload, chunk_mesh_metadata, mode)
        });

        entity.insert((
            TerrainColliderBakeTask {
                task,
                chunk_position: chunk_pos,
                source_revision: baking_revision.source_revision,
                mesh_asset_id: mesh_handle.id(),
            },
            TerrainCollisionState::Baking,
            baking_revision,
        ));
    }
}
```

Important implementation details:

- The bake task stores the mesh asset id present at scheduling time.
- The collider is not inserted immediately after task spawn.
- `NeedsCollider` remains on the entity until a bake succeeds or fails.
- A chunk may still have an old `ChunkCollider` while `NeedsCollider` and `TerrainColliderBakeTask` are present.
- The default mesh payload excludes normals, UVs, materials, and other render-only attributes.
- A position-only mesh can still produce a heightfield fallback, but trimesh and voxelized-trimesh require triangle indices.

### Collider Bake Completion And Swap

`poll_chunk_collider_bakes` checks completed tasks and swaps only valid results.

```text
fn poll_chunk_collider_bakes(world) {
    applied = 0;
    budget = if initial_spawn_pending {
        MAX_STARTUP_COLLIDERS_PER_FRAME
    } else if any_active_bake_near_player {
        MAX_PLAYER_NEAR_COLLIDERS_PER_FRAME
    } else {
        MAX_COLLIDERS_PER_FRAME
    };

    for (entity, bake_task, current_mesh_handle) in active_bake_tasks {
        if applied >= budget {
            continue;
        }

        result = poll_once(bake_task.task);
        if result is Pending {
            continue;
        }

        mesh_changed =
            current_mesh_handle is missing
            or current_mesh_handle.id != bake_task.mesh_asset_id;

        revision_changed =
            registry.source_revision(bake_task.chunk_position)
            != bake_task.source_revision;

        if mesh_changed or revision_changed {
            revision = registry.mark_stale_bake_drop(bake_task.chunk_position);

            entity.insert((
                TerrainCollisionState::Stale,
                revision,
            ));
            entity.remove(TerrainColliderBakeTask);

            // NeedsCollider stays on the entity, so a new bake can be queued.
            continue;
        }

        if result contains collider {
            revision = registry.mark_ready(chunk_pos, collider_kind);

            entity.insert((
                TerrainCollisionState::Ready,
                revision,
                RigidBody::Static,
                collider,
                CollisionMargin(TERRAIN_COLLIDER_MARGIN),
                CollisionLayers::terrain,
                ChunkCollider,
            ));

            entity.remove(NeedsCollider);
            entity.remove(TerrainColliderBakeTask);
            applied += 1;
            continue;
        }

        revision = registry.mark_failed(chunk_pos);
        entity.insert((
            TerrainCollisionState::Failed,
            revision,
        ));
        entity.remove(NeedsCollider);
        entity.remove(TerrainColliderBakeTask);
    }
}
```

Critical invariant:

```text
A completed bake may publish only if both of these are true:

1. The registry source revision still matches the bake's source revision.
2. The entity still has the same Mesh asset id that was baked.
```

This prevents a collider built for an old mesh from being published over a newer mesh.

### Registry State Observation

Diagnostics observe entity state after bake/swap work.

```text
fn record_terrain_collision_diagnostics(registry, chunk_entities) {
    for chunk_entity in chunk_entities {
        observed = match (
            has(ChunkCollider),
            has(NeedsCollider),
            explicit TerrainCollisionState,
        ) {
            (_, _, Failed) => Failed,
            (_, _, Baking) => Baking,
            (true, true, _) => Stale,
            (false, true, _) => Queued,
            (true, false, _) => Ready,
            (false, false, Some(state)) => state,
            (false, false, None) => Missing,
        };

        registry.observe_chunk(chunk_pos, observed);
    }

    record_counts(
        missing,
        queued,
        baking,
        ready,
        stale,
        failed,
        stale_bake_drops,
        failed_bakes,
    );
}
```

Important rule:

```text
Diagnostics observe; they should not create collider invalidations.
```

That rule is why the old mesh-change invalidation watcher was removed from the chained runtime path.

### Terrain Collision Cache Update

The collision cache provides conservative source-query data. The exact implementation lives in `src/physics/terrain_collision_cache.rs`, but the expected shape is:

```text
fn update_terrain_collision_cache(world, chunk_mesh_entities) {
    for chunk in visible_or_meshed_chunks {
        if cache entry is missing or source revision changed {
            occupancy = build_conservative_occupancy_from_terrain_source(chunk);

            cache.insert(chunk, CachedCollisionChunk {
                source_revision,
                occupancy,
                support_summary,
            });
        }
    }
}
```

Intended invariant:

```text
Source-query fallback should be available before the player depends solely
on baked static colliders.
```

This is not yet the final custom character-controller architecture, but it is the current bridge toward it.

### Spawn And Player Readiness

Spawn and movement use collider readiness plus the terrain cache.

```text
fn build_spawn_collider_readiness(chunk_meshes, terrain_collision_cache) -> SpawnColliderReadiness {
    readiness = SpawnColliderReadiness::default();

    for (chunk_mesh, chunk_collider, needs_collider) in chunk_meshes {
        if chunk_collider exists and needs_collider does not exist {
            readiness.ready_chunks.insert(chunk_mesh.chunk_position);
        }

        if needs_collider exists {
            readiness.pending_chunks.insert(chunk_mesh.chunk_position);
        }

        if terrain_collision_cache has chunk_mesh.chunk_position {
            readiness.source_query_chunks.insert(chunk_mesh.chunk_position);
        }
    }

    return readiness;
}
```

Player/spawn policy:

```text
fn can_enter_or_spawn_at(surface, readiness) -> bool {
    if terrain source data is missing {
        return false;
    }

    if collider for surface chunk is ready {
        return true;
    }

    if conservative source query can prove support exists {
        return true for fallback/controller purposes;
    }

    return false;
}
```

The current validated implementation still uses Avian/Tnua for normal player movement, with guardrails around spawn, fallback, and unknown terrain.

### Ground Guard Recovery

The ground guard prevents a bad player state from becoming an uncontrolled fall-through.

```text
fn recover_player_from_invalid_ground(player, world, readiness, state) {
    if initial_spawn_pending {
        return;
    }

    validity = classify_player_world_validity(world, player.position);
    surface_without_collider =
        validate_existing_spawn_position(world, player.position, readiness, require_collider=false);

    if validity is valid {
        if current surface has pending collider and player is near support {
            clamp_player_to_source_support(player, surface_without_collider.position);
            state.source_query_ground_fallbacks += 1;
            state.last_safe_grounded_position = player.position;
        }
        return;
    }

    recovery = find_collider_ready_recovery_target(
        world,
        player.position.xz,
        readiness,
        state.last_safe_grounded_position,
    );

    if recovery exists {
        teleport_player(recovery.position);
        zero_player_velocity();
        state.ground_guard_recoveries += 1;
        state.last_safe_grounded_position = recovery.position;
    } else {
        state.last_safe_ground_valid = false;
        log_guard_failure();
    }
}
```

This is intentionally conservative. It is a recovery/guard layer, not the final ideal movement controller.

### Bench Gameplay Readiness

Gameplay readiness was changed so collider route tests no longer wait for unrelated global visual stability.

```text
fn bench_ready_snapshot(world, chunk_stats, readiness_position, radius, collider_stats, require_collider_ready) {
    (missing_chunks, dirty_chunks) =
        chunks_pending_counts(world, readiness_position, radius);

    return BenchReadySnapshot {
        signature: BenchReadySignature {
            missing_chunks,
            dirty_chunks,
            mesh_entities: chunk_stats.mesh_entities,
            water_mesh_entities: chunk_stats.water_mesh_entities,
            collider_ready_entities: collider_stats.ready_entities,
            collider_pending_entities: collider_stats.pending_entities,
            high_lod_chunks: chunk_stats.high_lod_chunks,
            low_lod_chunks: chunk_stats.low_lod_chunks,
            culled_chunks: chunk_stats.culled_chunks,
        },
        chunks_meshed_this_frame: chunk_stats.chunks_meshed_this_frame,
        chunks_skipped_this_frame: chunk_stats.chunks_skipped_this_frame,
        require_collider_ready,
    };
}
```

Gameplay candidate check:

```text
fn is_ready_candidate(snapshot) -> bool {
    if snapshot.missing_chunks != 0 or snapshot.dirty_chunks != 0 {
        return false;
    }

    if snapshot.require_collider_ready {
        return snapshot.collider_pending_entities == 0
            and snapshot.collider_ready_entities > 0;
    }

    return snapshot.chunks_meshed_this_frame == 0
        and snapshot.chunks_skipped_this_frame == 0
        and snapshot.mesh_entities + snapshot.water_mesh_entities > 0;
}
```

Gameplay stability signature:

```text
fn stability_signature(snapshot) -> BenchReadySignature {
    if snapshot is visual checkpoint {
        return full visual signature;
    }

    return BenchReadySignature {
        missing_chunks: snapshot.missing_chunks,
        dirty_chunks: snapshot.dirty_chunks,
        collider_ready_entities: bool_to_int(snapshot.collider_ready_entities > 0),
        collider_pending_entities: bool_to_int(snapshot.collider_pending_entities > 0),
    };
}
```

Reason:

```text
The exact number of ready colliders can keep increasing after gameplay is safe.
Gameplay needs the readiness condition to be stable, not the incidental count.
```

### Bench Collider Readiness Query

The bench now counts local collider readiness around the gameplay start/checkpoint area.

```text
fn bench_collider_ready_stats(colliders, center, radius) -> BenchColliderReadyStats {
    center_chunk = world_to_chunk(floor(center));
    stats = default;

    for (chunk_mesh, chunk_collider, needs_collider) in colliders {
        delta = chunk_mesh.chunk_position - center_chunk;

        if abs(delta.x) > radius or abs(delta.z) > radius {
            continue;
        }

        if chunk_collider exists and needs_collider does not exist {
            stats.ready_entities += 1;
        }

        if needs_collider exists {
            stats.pending_entities += 1;
        }
    }

    return stats;
}
```

Current limitation:

```text
The radius is still the bench chunk radius, not a tight player support prism.
That is conservative and measurable, but probably larger than true gameplay need.
```

## State Transition Diagrams

### Healthy First Build

```text
Missing
  -> Queued        mesh entity exists with NeedsCollider
  -> Baking        TerrainColliderBakeTask inserted
  -> Ready         collider inserted, NeedsCollider removed
```

### Healthy Rebuild With Old Collider Live

```text
Ready
  -> Stale         mesh update inserts NeedsCollider while ChunkCollider still exists
  -> Baking        async bake starts, old collider remains live
  -> Ready         new collider inserted, NeedsCollider removed
```

### Stale Bake Drop

```text
Baking
  -> Stale         completed bake rejected because mesh asset id or source revision changed
  -> Queued/Baking next generate pass sees NeedsCollider and starts another bake
  -> Ready         later bake matches current mesh/revision and publishes
```

### Failed Bake

```text
Baking
  -> Failed        collider builder returns None
```

Failed bakes should be rare. They are a signal to inspect mesh geometry, collider mode, and triangle data.

## Important Invariants For Future Work

These are the invariants that should remain true while optimizing further:

1. Never remove an old terrain collider before a replacement has been baked and validated.
2. A completed async bake must not publish over a newer mesh.
3. `NeedsCollider` should mean "work remains"; `ChunkCollider` should mean "there is an active collider".
4. A chunk can validly have both `NeedsCollider` and `ChunkCollider`; that means stale-but-covered.
5. Runtime diagnostics should not trigger collider invalidation.
6. Gameplay readiness should be local and conservative.
7. Visual readiness and gameplay readiness should remain separate.
8. Bench results should report readiness state explicitly: pending colliders, ready colliders, stale drops, fall-throughs, stalls, and ground guard recoveries.
9. The world floor/crust safety layer should not depend on chunk collider scheduling.
10. Optional collider representations such as `voxels` should be benchmarked before becoming default.

## Implementation Map

| Concern | File | Notes |
| --- | --- | --- |
| Physics plugin ordering | `src/physics/plugin.rs` | Chained systems update cache, generate bakes, poll swaps, then record diagnostics. |
| Collider bake/swap | `src/physics/terrain_collider.rs` | Async bake task, mesh asset id validation, registry state, diagnostics. |
| Conservative cache | `src/physics/terrain_collision_cache.rs` | Occupancy/source-query cache for terrain collision fallback and readiness. |
| Initial spawn | `src/player/spawn.rs` | Spawn waits/recovery uses collider readiness and terrain cache. |
| Player movement guard | `src/player/input.rs` | Movement avoids unknown/pending ground columns. |
| Collider walk bench | `src/bench/mod.rs` | Gameplay readiness gate, collider counters, route/fall-through metrics. |
| Collider route scene | `bench/scenes/collider/collider-walk-log.toml` | Main regression scene for spawn, old-hole route, and dig crust. |

## Failure Mode Playbook

### If Readiness Times Out

Check these rows in `summary.json` first:

```text
Counter Bench Ready Missing Chunks
Counter Bench Ready Dirty Chunks
Counter Bench Ready Collider Ready Entities
Counter Bench Ready Collider Pending Entities
Counter Terrain Colliders Pending
Counter Terrain Collider Bakes Spawned
Counter Terrain Collider Bakes In Flight
Counter Terrain Collider Swaps Applied
Counter Terrain Collider Stale Bake Drops Frame
Counter Terrain Collision State Stale
```

Interpretation:

| Symptom | Likely cause |
| --- | --- |
| Missing chunks nonzero | terrain streaming/generation readiness, not collider bake cost. |
| Dirty chunks nonzero | meshing queue or chunk dirty propagation. |
| Collider pending high, bakes spawned low | scheduling budget or missing mesh/cache dependency. |
| Bakes in flight high, swaps low | bake tasks slow or swap budget too low. |
| Stale bake drops high | mesh/revision churn invalidating bakes. |
| Ready entities zero, pending zero | bench query may be looking at wrong radius/position, or mesh entities absent. |

### If Stale Bake Drops Return

Likely causes:

- Mesh asset id changes repeatedly for the same chunk.
- Source revision is being bumped without real source changes.
- A new invalidation path was added outside the mesh update path.
- Diagnostics started mutating state instead of observing it.

First code paths to inspect:

```text
src/voxel/plugin.rs              mesh updates inserting NeedsCollider
src/physics/terrain_collider.rs  mark_queued, mark_baking, mark_ready, stale drop check
src/physics/plugin.rs            physics system order
```

### If Player Falls Through

Check:

```text
Counter Bench Gameplay Fall Events
Counter Bench Gameplay Fall Through Frames
Counter Player Collision Readiness Ready
Counter Player Collision Readiness Degraded
Counter Player Collision Readiness Blocked
Counter Ground Guard Recoveries
Counter Void Recoveries
```

Then inspect the gameplay path CSV for the failing checkpoint:

```text
bench-runs/<run>/collider-walk-log-<checkpoint>-gameplay-path-run0.csv
```

Useful columns:

```text
frame
position_x
position_y
position_z
velocity_x
velocity_y
velocity_z
horizontal_speed
expected_surface_y
surface_delta
validity
falling_through
collider_ready
collider_pending
```

Interpretation:

| Symptom | Likely cause |
| --- | --- |
| `falling_through=1`, `collider_pending=1` | readiness gate or movement guard allowed entry too early. |
| `falling_through=1`, `collider_ready=1` | collider shape/geometric mismatch or controller issue. |
| invalid world state followed by guard recovery | guard is working, but route/controller may need improvement. |
| high stall frames after recovery | player controller or route steering issue, not necessarily collider bake. |

### If Frame Time Regresses

Do not add timing rows together. Some rows are parent/child or overlapping. Compare specific rows before/after:

```text
Collider Build
Collider Swap
Mesh Dirty
Mesh Dirty Generate CPU
Mesh Dirty Apply CPU
Render Prepare CPU
Render Graph CPU
__frame_total
```

Use the required release bench and guard:

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/collider-walk-log.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Measured Results

Required bench command:

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/collider-walk-log.toml
```

Latest measured run:

```text
bench-runs/2026-05-12T02-55-57Z/summary.json
```

This run predates the later collider dispatch cleanups listed above. Re-run the collider walk bench before claiming measured gains from:

- compact `TerrainColliderMeshData` bake payloads,
- dynamic collider swap budgets,
- sort skipping when pending work fits within the current frame budget,
- startup collider mode caching.

Bench guard:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/2026-05-12T02-55-57Z/summary.json
```

Result:

```text
PASS: 73 check(s), 0 warning(s)
```

Unit tests:

```powershell
rtk cargo test --lib
```

Result:

```text
211 passed
```

### Collider Runtime Cost

The collider runtime path is no longer a meaningful frame-time cost after local readiness.

Latest observed collider behavior:

- Local gameplay collider pending count reaches `0` at all collider walk checkpoints.
- Terrain collider stale bake drops are `0`.
- Collider build/swap p99 values remain very low in the passing runs.
- No collider readiness timeouts in the latest passing bench.
- No fall-through events in the latest passing bench.

### Warm-Up Improvement

Readiness wait times improved after making gameplay readiness local and collider-specific:

| Checkpoint | Previous Passing Run | Latest Run |
| --- | ---: | ---: |
| `spawn-north-walk` | `32.51s` | `28.14s` |
| `spawn-east-walk` | `32.17s` | `26.97s` |
| `old-hole-route` | `32.82s` | `11.64s` |
| `spawn-dig-crust` | `10.00s` | `10.00s` |

The `spawn-dig-crust` checkpoint is already at the bench minimum wait floor.

### Earlier Thrash Elimination

Before the stale-bake fix, the collider-aware bench timed out at 75 seconds with hundreds of local pending colliders. Example symptoms from the failing run:

- `collider_ready=0`
- `collider_pending` around `390-444`
- stale bake drops around `20` per frame
- registry dominated by `Stale`

After the fix:

- `collider_pending=0` locally at readiness.
- stale bake drops are `0`.
- registry stale state is `0`.
- bench guard passes.

## Current Interpretation

Collider steady-state performance is good.

The remaining startup cost is mostly not collider swap/cooking cost. The first checkpoint still spends time getting the local gameplay area generated, meshed, and collidable enough for the readiness gate. Later checkpoints benefit more from the new local gameplay readiness gate because their needed chunks/colliders are already mostly available.

## Known Remaining Issues

### Old-Hole Route Stall

The latest collider walk bench still logs one allowed stall on `old-hole-route`.

Current evidence:

- No fall-through event.
- No collider pending at readiness.
- Bench guard passes.
- Ground guard recoveries occur on this route.

This looks like residual route/controller/terrain-surface behavior rather than collider bake thrash.

### Initial Warm-Up Still Costs About 28 Seconds

The first gameplay checkpoint still waits about `28s`.

Likely next targets:

- Prioritize initial local gameplay chunks and colliders more aggressively.
- Reduce startup LOD churn before gameplay readiness.
- Add a smaller explicit player support-prism readiness radius instead of using the full bench chunk radius.
- Consider separating "minimum safe gameplay collider ring" from "full local collider bubble".

### Parry Voxel Colliders Are Still Opt-In

The architecture supports the dedicated voxel collider path via `VOXEL_TERRAIN_COLLIDER=voxels`, but the validated default path remains the current async terrain collider pipeline.

Future work should benchmark:

- default trimesh/auto collider mode,
- `voxels`,
- `voxelized`,
- heightfield fallback,

against the same route tests before changing the default representation.

## Success Criteria Met

The following criteria are currently met by the latest bench run:

- No collider readiness timeouts.
- No local collider pending at gameplay readiness.
- No terrain collider stale-bake thrash.
- No fall-through events in the collider walk bench.
- Bench guard passes.
- Unit tests pass.
- Editor runtime sidecar was rebuilt and desktop editor restarted after runtime changes.

## Follow-Up Recommendations

1. Keep the current double-buffered async swap path as the default.
2. Add a focused startup-readiness benchmark that records first local support collider ready time, not just checkpoint ready time.
3. Investigate the `old-hole-route` stall separately as a player controller or route steering issue.
4. Benchmark `VOXEL_TERRAIN_COLLIDER=voxels` against the same collider walk scene before choosing it as the default.
5. Consider reducing the gameplay readiness radius to the player support prism plus movement lookahead once that query is available.
6. Consider a dirty-chunk set for `TerrainCollisionCache` so steady-state cache updates do not allocate and sort all chunk mesh positions.
7. Optimize `filled_core_coords` only if the voxel collider mode becomes a validated target; it is not on the default trimesh path.
8. Consider an explicit `Empty` or `NoGeometry` state if failed-bake counters include valid air-only chunks.

