# Avian vs bevy_rapier3d Physics Backend Record

Document status (2026-05-17): historical Bevy 0.17-era comparison. The current repo baseline is Bevy 0.18.1 with `avian3d = 0.5`; keep this document for rationale, not current dependency selection instructions.

Current code note: the decision recorded here has already been applied. The active physics backend is Avian 3D 0.5 on Bevy 0.18.1, with terrain collider code under `src/physics/`.

Historically, Avian was the clear choice for the Bevy 0.17 voxel game with Surface Nets terrain. The decisive factor at the time: bevy_rapier3d 0.32.0 only supported Bevy 0.16--there was no Bevy 0.17 support yet. Avian 0.4 fully supported Bevy 0.17 and introduced native voxel colliders specifically designed for Minecraft-style worlds, eliminating the ghost collision problems that plague trimesh terrain. Combined with a 3x performance improvement in version 0.4 and superior ECS integration, Avian addressed every critical requirement for this use case.

## Historical Bevy 0.17 compatibility context

The compatibility situation is stark and decisive for immediate development:

| Engine | Current Version | Bevy Support | Maintenance Status |
|--------|----------------|--------------|-------------------|
| Avian | 0.4.1 (Nov 2025) | 0.17 | Active, tracks Bevy releases closely |
| bevy_rapier3d | 0.32.0 (Dec 2024) | 0.16 only | Active, but lags behind Bevy releases |

Avian maintains a 1:1 version mapping with Bevy releases (0.4 -> Bevy 0.17, 0.3 -> 0.16, etc.), making version tracking predictable. The bevy_rapier3d plugin historically takes weeks to months to support new Bevy versions--documented issues show delays occurred with Bevy 0.14 compatibility as well.

Avian is maintained by Joona Aalto with 76 contributors and 2,600+ GitHub stars, surpassing bevy_rapier3d's 1,500 stars despite being younger. Documentation coverage sits at 99.66% on docs.rs, with comprehensive migration guides for each version.

## Trimesh performance for Surface Nets terrain

Both engines face the same fundamental challenge with trimesh colliders: they're hollow, prone to tunneling, and suffer from ghost collisions at triangle edges. However, Avian 0.4 introduces a critical advantage.

Avian's native voxel colliders (new in 0.4) solve the ghost collision problem entirely for voxel terrain:

```rust
// Create voxels directly from points or mesh data
Collider::voxels_from_trimesh(voxel_size, &vertices, &indices)
Collider::voxels(voxel_size, &grid_coordinates)
```

This approach eliminates internal edge issues that cause bouncing and jittering when characters walk across trimesh terrain. For Surface Nets specifically, you could render the smooth mesh while using voxel colliders for physics--trading visual fidelity in collision for stability.

For traditional trimesh handling, both engines offer similar capabilities:

| Feature | Avian | bevy_rapier3d |
|---------|-------|---------------|
| Trimesh from mesh | `Collider::trimesh_from_mesh(&mesh)` | `Collider::from_bevy_mesh(&mesh, TriMesh)` |
| Edge fixing | `TrimeshFlags::FIX_INTERNAL_EDGES` | `TrimeshFlags::FIX_INTERNAL_EDGES` |
| Collision margin | `CollisionMargin` component | `ContactSkin` component |
| Async generation | `ColliderConstructorHierarchy` | `AsyncSceneCollider` |

Dynamic mesh updates require the same despawn/respawn pattern in both engines--neither supports in-place collider modification. For chunked voxel terrain, you'll rebuild the collider when a chunk changes:

```rust
// Both engines use this pattern
commands.entity(chunk_entity).despawn();
commands.spawn((
    RigidBody::Static,
    Collider::trimesh_from_mesh(&new_chunk_mesh).unwrap(),
));
```

## Benchmark data reveals performance parity with advantages at scale

Concrete benchmark data from physics-engine-benchmarks shows performance characteristics up to high body counts:

| Body Count | Avian 0.3 FPS | Notes |
|------------|---------------|-------|
| 100-2,500 | ~179 FPS | Parity with optimized engines |
| 5,000 | 81 FPS | Performance degrades |
| 7,500 | 34 FPS | 5x slower than Jolt |

Critical context: Avian 0.4 is approximately 3x faster than 0.3 due to three architectural improvements: solver bodies with cache-optimized data layout, graph coloring for parallel constraint solving, and reworked simulation islands for sleeping bodies.

For voxel games with many static terrain chunks, simulation islands in Avian 0.4 provide significant optimization--static colliders in dormant areas have near-zero computational overhead. This matters enormously for large voxel worlds where most chunks are static environment.

On lower-end hardware, physics is entirely CPU-bound, so Intel integrated graphics won't directly impact physics performance. The limiting factors are single-thread CPU performance for the solver and memory bandwidth for large collision structures. Both engines benefit enormously from release builds--debug builds are orders of magnitude slower.

## ECS integration quality differs fundamentally

This architectural difference affects daily development experience:

Avian stores all physics state directly in ECS components--no separate physics world exists. This means standard Bevy queries work directly on physics data, observers and hooks integrate naturally, and debugging through Bevy's inspector tools is straightforward.

bevy_rapier3d maintains a separate `RapierContext` world that synchronizes with Bevy's ECS. This adds overhead and complexity--you access physics data through `ReadRapierContext`/`WriteRapierContext` system parameters rather than direct component queries.

The collision query APIs are comparable in capability:

```rust
// Avian spatial queries
fn raycast(spatial_query: SpatialQuery) {
    let hit = spatial_query.cast_ray(origin, direction, 100.0, true, &filter);
    let shape_hit = spatial_query.cast_shape(&collider, pos, rot, dir, options, &filter);
    let overlaps = spatial_query.shape_intersections(&shape, pos, rot, &filter);
}

// Rapier spatial queries
fn raycast(rapier_context: Query<&RapierContext>) {
    let hit = rapier_context.cast_ray(origin, direction, max_toi, solid, filter);
    let shape_hit = rapier_context.cast_shape(pos, rot, vel, &shape, options, filter);
    let overlaps = rapier_context.intersections_with_shape(pos, rot, &shape, filter);
}
```

Both support raycasts, shape casts, point projections, and overlap queries using BVH acceleration. Performance is equivalent for building system snap detection and placement validation.

## Feature comparison for voxel game requirements

| Feature | Avian 0.4 | bevy_rapier3d 0.32 |
|---------|-----------|-------------------|
| Voxel colliders | Native support | Manual trimesh only |
| Collision layers | Enum-based `PhysicsLayer` | Bitmask `CollisionGroups` |
| CCD | Speculative + sweep-based | Nonlinear motion-clamping |
| Determinism | `enhanced-determinism` feature | `enhanced-determinism` feature |
| Character controller | Third-party (bevy_tnua) | Built-in `KinematicCharacterController` |
| Heightfield terrain | Supported | Supported |
| Convex decomposition | VHACD via `VhacdParameters` | VHACD via parameters |

Determinism for multiplayer works similarly in both--enable the `enhanced-determinism` feature, which uses `libm` for cross-platform consistent floating-point math. The critical caveat: this feature cannot be combined with SIMD or parallel features in either engine.

bevy_rapier3d's built-in character controller offers autostep, slope limits, and ground snapping out of the box. However, bevy_tnua provides a superior floating character controller that works with both engines and handles smooth terrain better through shape casting for ground detection.

## Practical recommendations for your voxel game

For terrain collision, consider a hybrid approach: render Surface Nets meshes for visual smoothness while using Avian's voxel colliders for physics. This eliminates ghost collision issues at the cost of some collision precision--acceptable for most voxel games.

For character movement, use bevy_tnua with a capsule collider:

```rust
commands.spawn((
    RigidBody::Dynamic,
    Collider::capsule(0.3, 1.8),
    LockedAxes::ROTATION_LOCKED,
    TnuaAvian3dIOBundle::default(),
    TnuaController::default(),
));
```

Capsules handle terrain edges more gracefully than cuboids, reducing catching and bouncing on irregular surfaces.

For building systems, both engines provide equivalent raycast and overlap query performance. Use collision layers to filter queries efficiently--Avian's enum-based `PhysicsLayer` trait is slightly more ergonomic than raw bitmasks.

For chunk updates, process mesh generation asynchronously using `AsyncComputeTaskPool`, then create colliders and swap entities on the main thread. Neither engine supports incremental collider updates, so optimize your chunk size to balance rebuild frequency against collider complexity.

## Conclusion

Historical conclusion: choose Avian 0.4 for the Bevy 0.17 voxel game. The current codebase has carried that decision forward as Avian 3D 0.5 on Bevy 0.18.1.

At the time, bevy_rapier3d remained a solid engine with corporate backing and proven maturity, but the lack of Bevy 0.17 support and absence of native voxel colliders made it the inferior choice for this specific use case. For current work, treat `Cargo.toml` and `docs/physics/README.md` as the source of truth.

The community has increasingly converged on Avian as the "de-facto ECS native physics solution for Bevy." For a voxel game specifically, the native voxel collider support alone justifies the choice.
