# Physics Foundation Implementation Plan

Plan 1 translates the JavaScript Physics3D foundation into this repo's Bevy/Rust architecture.

## Goal

Create a stable foundation for gameplay physics using Avian 3D instead of implementing a custom physics engine. After this plan:

- Terrain chunks consistently receive static colliders.
- Player and dynamic body bundles use explicit layers, masks, mass, damping, and locked-axis defaults.
- Gravity, fixed-step physics, Tnua integration, and render interpolation policy are documented and verified.
- A physics query facade exists for raycasts, shape casts, and overlap checks.
- Bench output reports collider build/update counters and movement smoke checks.

Contacts and gameplay callbacks are expanded in Plan 2.

## Architecture Translation

The original standalone engine concepts map to this repo as follows:

| Original concept | Bevy/Rust translation |
| --- | --- |
| `Vec3`, `Quat`, `Mat3` | Use `bevy::prelude::{Vec3, Quat, Mat3}`. Do not add duplicate math types. |
| `Shape` classes | Use Avian `Collider` components plus small project helper constructors where needed. |
| `Body` class | Use ECS bundles/components: `RigidBody`, `Collider`, `Transform`, velocities, damping, layers, and gameplay markers. |
| `World` class | Use `PhysicsPlugin`, Avian resources, Bevy schedules, and project resources. |
| Sweep-and-prune broadphase | Use Avian's broadphase and `SpatialQuery`; expose only gameplay-level query helpers. |
| Render interpolation | Use Avian/Bevy fixed physics scheduling and documented transform sync policy. Add project bridging only if Avian interpolation is insufficient. |

## Task 1: Document Current Physics Surface

**Files:**

- Modify: `docs/physics/README.md`
- Modify: `src/physics/mod.rs` docs if code comments are stale

- [ ] List the active physics entry points: `PhysicsPlugin`, `PhysicsLayer`, and terrain collider generation.
- [ ] Note that Avian owns integration, broadphase, narrowphase, and solving.
- [ ] Document environment flags already used by physics, including `VOXEL_PHYSICS_DEBUG` and `VOXEL_TERRAIN_COLLIDER`.
- [ ] Verify docs mention the current Bevy and Avian versions from `Cargo.toml`.

**Verification:**

```powershell
rtk cargo test
```

## Task 2: Add Physics Settings And Diagnostics Resources

**Files:**

- Modify: `src/physics/plugin.rs`
- Create or modify: `src/physics/settings.rs`
- Create or modify: `src/physics/diagnostics.rs`
- Modify: `src/physics/mod.rs`

- [ ] Add a `PhysicsSettings` resource for gravity, length unit, terrain collider mode, terrain collider voxel size, terrain collider margin, and per-frame collider generation limit.
- [ ] Keep existing environment variable overrides, but parse them into the settings resource once.
- [ ] Add a `PhysicsDiagnostics` resource or event stream for collider builds, rebuilds, failed builds, terrain collider kind, and query counts.
- [ ] Keep `VOXEL_PHYSICS_DEBUG` behavior behind debug assertions.
- [ ] Ensure defaults match current behavior: gravity `(0, -20, 0)`, length unit `1.0`, terrain collider auto mode, voxel size `1.0`, margin `0.05`, and max generated colliders per frame `2`.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 3: Stabilize Collision Layers

**Files:**

- Modify: `src/physics/layers.rs`
- Add tests in the closest existing test module or create a unit test module in `layers.rs`

- [ ] Keep layers explicit: `Default`, `Terrain`, `Player`, `Entity`, `Water`, `Building`, `Projectile`.
- [ ] Add masks for each gameplay role: player, terrain, entity, water sensor, building, projectile, and editor query.
- [ ] Add tests that assert expected mask membership and exclusions.
- [ ] Update player, terrain, building, and future query code to use named mask helpers instead of ad hoc masks.

**Verification:**

```powershell
rtk cargo test physics::layers
```

## Task 4: Add Body Authoring Helpers

**Files:**

- Create: `src/physics/body_authoring.rs`
- Modify: `src/physics/mod.rs`
- Modify: `src/player/controller.rs` only if the player bundle should reuse helpers

- [ ] Add helper functions or bundles for common project bodies: dynamic sphere, dynamic cuboid, dynamic capsule, static cuboid, static terrain chunk, and sensor volume.
- [ ] Include `RigidBody`, `Collider`, `Transform`, `GlobalTransform`, `CollisionLayers`, damping, friction/restitution material components if supported by Avian, and clear gameplay marker hooks.
- [ ] Keep helpers thin. They should make project defaults consistent, not hide Avian.
- [ ] Migrate the player capsule to shared defaults only if that does not obscure Tnua-specific components.
- [ ] Add unit tests for helper defaults where possible.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 5: Harden Terrain Collider Generation

**Files:**

- Modify: `src/physics/terrain_collider.rs`
- Modify: `src/physics/settings.rs`
- Modify or add tests around collider mode parsing and generation policy

- [ ] Replace hard-coded terrain collider constants with `PhysicsSettings`.
- [ ] Keep nearest-to-camera prioritization and per-frame throttling.
- [ ] Keep `Collider::voxelized_trimesh_from_mesh` as the default path, with trimesh fallback.
- [ ] Preserve `TrimeshFlags::FIX_INTERNAL_EDGES` for explicit trimesh mode and fallback.
- [ ] Record counters for pending colliders, generated colliders, generated trimesh, generated voxelized, failed builds, and selected mode.
- [ ] Add a small regression test for mode parsing: `auto`, `trimesh`, `voxelized`, and unknown values.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

Read `bench-runs/<run>/summary.json` and report collider build/update rows plus movement smoke status.

## Task 6: Define Fixed-Step And Render Interpolation Policy

**Files:**

- Modify: `src/physics/plugin.rs`
- Create or modify: `docs/physics/fixed-step-and-interpolation.md` if extra detail is needed

- [ ] Document which schedule Avian runs in and how Tnua is connected to that schedule.
- [ ] Set or document the intended fixed physics timestep. If the default is used, say so explicitly.
- [ ] Verify transform sync behavior for dynamic bodies and the player camera path.
- [ ] If visible jitter remains, add a small interpolation bridge component rather than a separate physics world.
- [ ] Add a movement smoke assertion or bench checkpoint before changing interpolation behavior.

**Verification:**

```powershell
rtk cargo test
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 7: Add Physics Query Facade

**Files:**

- Create: `src/physics/query.rs`
- Modify: `src/physics/mod.rs`
- Update callers in interaction/building code only after the facade is in place

- [ ] Wrap Avian `SpatialQuery` in project-level helpers for raycast, shape cast, point/shape overlap, and ground probe.
- [ ] Require callers to pass a query purpose or layer mask helper.
- [ ] Return project-friendly hit data: entity, point, normal, distance, layer, and optional voxel/building metadata.
- [ ] Count queries in diagnostics so expensive tools can be profiled.
- [ ] Add tests for filter construction and facade output mapping where direct world queries are practical.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 8: Baseline Dynamic Body Smoke Scene

**Files:**

- Create or modify: `bench/scenes/collider/gameplay-movement-smoke.toml`
- Modify bench harness only if it needs a physics assertion hook

- [ ] Keep the existing player sprint/jump stall assertions.
- [ ] Add a simple dynamic-body checkpoint if the bench harness can spawn physics props without broad harness changes.
- [ ] Record physics-relevant counters in summary output.
- [ ] Keep screenshot disabled unless a visual regression is being checked.

**Verification:**

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Plan 1 Completion Checklist

- [ ] `rtk cargo test` passes.
- [ ] `gameplay-movement-smoke` passes in release.
- [ ] `PhysicsSettings` owns tunable defaults.
- [ ] Collision layer masks have tests.
- [ ] Terrain collider counters appear in bench summaries.
- [ ] Query facade exists and new gameplay code can avoid direct ad hoc `SpatialQuery` use.
- [ ] The docs clearly state that Avian owns integration, broadphase, contacts, and solving.

## What Works After Plan 1

- Player physics and terrain colliders are configured through project defaults.
- Collider generation is throttled, prioritized, and measured.
- Collision layers and masks are test-covered.
- Physics queries have a stable project API.
- Fixed-step and interpolation policy is explicit.

## What Is Deferred

- Contact event gameplay mapping.
- Sensor volumes and water triggers.
- Material tuning for friction, restitution, and slopes.
- Dynamic props and projectile behavior.
- Editor diagnostics and runtime physics panels.

