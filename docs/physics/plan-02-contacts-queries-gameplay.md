# Contacts, Solver Behavior, and Gameplay Physics Implementation Plan

Plan 2 translates the standalone Physics3D "contacts and solver" plan into this repo's Bevy/Rust stack.

The JavaScript source plan builds a custom narrowphase, contact cache, warm-started sequential impulse solver, position solver, and ten shape-pair algorithms. In this project those systems already belong to Avian 3D. The implementation work is therefore to expose, configure, verify, and use Avian's contact/solver behavior through project-level APIs, tests, diagnostics, and gameplay systems.

## Goal

After this plan:

- Bouncing, resting, stacking, slope friction, and player-terrain contact behavior are verified in this repo.
- Gameplay systems receive stable contact start/stop and sensor enter/exit events.
- Collision filtering is applied consistently for player, terrain, entities, buildings, water, projectiles, and editor tools.
- Raycasts, shape casts, and overlap checks use the shared physics query facade.
- Dynamic props, building pieces, water volumes, and projectiles have predictable physics defaults.
- Terrain collider rebuild correctness is covered by tests, diagnostics, and the gameplay movement bench.

## Architecture Translation

| Source plan item | Bevy/Rust implementation in this repo |
| --- | --- |
| `src/manifold.js`, `ContactCacheEntry`, `pairKey` | Do not implement custom solver data. Avian owns contact manifolds, contact persistence, warm starting, and islands. Add project event DTOs only. |
| Collision dispatcher and shape-pair functions | Use Avian `Collider` primitives and Avian narrowphase. Add project authoring helpers and behavior tests for sphere, cuboid, capsule, plane/terrain, and common pair behavior. |
| Sequential impulse velocity solver | Use Avian solver. Expose solver-related settings only through supported Avian resources/components. Verify restitution and friction with integration tests. |
| Position solver and Baumgarte correction | Use Avian position correction. Verify resting and penetration recovery behavior with tests and benches. |
| World-tensor angular update | Use Avian rigid body integration. Avoid direct transform edits for dynamic bodies. Apply impulses/forces through Avian components or commands. |
| `World` narrowphase lifecycle | Keep Bevy schedules and Avian `PhysicsSchedule`. Add project systems before/after physics only where required. |
| JavaScript `node --test` | Use Rust unit/integration tests plus release bench scenes. |

## Solver Tuning Targets

These are behavior targets, not custom constants to paste into the code. If Avian exposes a matching setting, route it through `PhysicsSettings`; otherwise document the Avian default and validate with tests.

- Velocity solver should support stable resting contacts and bounce restitution.
- Position correction should keep resting bodies close to their expected support height.
- Restitution should not cause perpetual small bounces on resting contacts.
- Friction should keep a high-friction box on a 30 degree slope approximately stationary.
- CCD or shape casts should be used for fast projectiles.
- Sleeping/island behavior should be observed before adding any project-level sleep policy.

## Task 1: Contact And Solver Capability Audit

**Files:**

- Modify: `docs/physics/plan-02-contacts-queries-gameplay.md`
- Create or modify: `docs/physics/avian-contact-capabilities.md`
- Inspect only as needed: `Cargo.toml`, `src/physics/*`, `src/player/controller.rs`

- [ ] Record the exact Avian version from `Cargo.toml`.
- [ ] List the Avian collider primitives this project will support in gameplay: sphere, cuboid, capsule, static terrain collider, sensor volume, and optional infinite/debug plane substitute.
- [ ] Confirm which shape-pair behaviors are delegated to Avian rather than custom code.
- [ ] Identify Avian APIs for collision events, contact events, sensors, friction, restitution, damping, CCD, sleeping, and spatial queries.
- [ ] Note unsupported or deferred behavior explicitly, especially if a source-plan shape pair maps to terrain or a static test ground rather than an infinite plane.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 2: Contact Event Adapter

**Files:**

- Create: `src/physics/events.rs`
- Modify: `src/physics/plugin.rs`
- Modify: `src/physics/mod.rs`

- [ ] Read Avian collision/contact events in one physics-facing system.
- [ ] Emit project events with stable names such as `PhysicsContactStarted`, `PhysicsContactEnded`, `SensorEntered`, and `SensorExited`.
- [ ] Include both entities, collision layers, hit point/normal if cheaply available, and whether either collider is a sensor.
- [ ] Keep raw Avian event types private to the physics module unless a caller truly needs them.
- [ ] Add tests for event classification helpers and sensor/contact separation.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 3: Project Contact Data Types

**Files:**

- Create: `src/physics/contact.rs`
- Modify: `src/physics/events.rs`
- Modify: `src/physics/mod.rs`

- [ ] Add small project-facing contact structs for gameplay events.
- [ ] Include entities, layer information, sensor flag, optional contact normal, optional world point, and optional impulse/force only if Avian exposes it reliably.
- [ ] Do not add custom `Manifold`, warm-start cache, or solver impulse storage.
- [ ] Add conversion helpers from Avian event payloads into project structs.
- [ ] Unit-test conversion logic with synthetic payloads where practical.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 4: Collision Materials And Solver Defaults

**Files:**

- Create or modify: `src/physics/materials.rs`
- Modify: `src/physics/body_authoring.rs`
- Modify: `src/physics/settings.rs`
- Modify: `src/physics/mod.rs`

- [ ] Define named material presets: player, terrain, prop, building, projectile, slippery, wet, and bouncy.
- [ ] Apply friction, restitution, damping, CCD, sleeping, and lock-axis defaults through body authoring helpers.
- [ ] Route supported global solver settings through `PhysicsSettings`.
- [ ] Document Avian defaults for settings that are not exposed or should not be changed.
- [ ] Verify that player movement still feels correct after material changes.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 5: Primitive Body Authoring Coverage

**Files:**

- Modify: `src/physics/body_authoring.rs`
- Modify: `src/player/controller.rs` only if player setup should reuse shared helpers
- Add tests in the closest physics test module

- [ ] Add helpers or bundles for dynamic sphere, dynamic cuboid, dynamic capsule, static cuboid, static terrain chunk, and sensor volume.
- [ ] Include `RigidBody`, `Collider`, `Transform`, `GlobalTransform`, `CollisionLayers`, material preset, damping, CCD, and gameplay marker hooks as appropriate.
- [ ] Keep helpers thin and transparent; callers should still understand which Avian components are spawned.
- [ ] Add tests that verify collider type, layer/mask, rigid body type, and material preset for each helper.
- [ ] Avoid dynamic trimesh colliders for props and gameplay bodies.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 6: Shape-Pair Behavior Tests

**Files:**

- Create: `tests/physics_contacts.rs` or the repo's preferred Rust integration-test location
- Modify test utilities as needed

- [ ] Add a sphere-sphere overlap/rest separation test.
- [ ] Add sphere-ground restitution and rest tests.
- [ ] Add cuboid-ground rest and penetration recovery tests.
- [ ] Add capsule-ground contact tests for the player-sized capsule.
- [ ] Add cuboid-cuboid contact behavior test for a simple face-to-face overlap.
- [ ] Add capsule-cuboid or capsule-terrain behavior test if Tnua/player contact coverage does not already cover it.
- [ ] Keep assertions behavior-level: positions, velocities, event emission, and no exploding angular velocity. Do not assert Avian internal manifold counts.

**Verification:**

```powershell
rtk cargo test physics_contacts
```

## Task 7: Restitution And Resting Contact Tests

**Files:**

- Create or modify: `tests/physics_solver_behavior.rs`
- Modify material presets only if tests expose bad defaults

- [ ] Spawn a bouncy sphere above a static ground collider and assert it rebounds to a plausible lower height.
- [ ] Spawn a non-bouncy sphere above ground and assert it settles near its support height.
- [ ] Assert resting vertical velocity remains near zero after settling.
- [ ] Assert small restitution is not applied repeatedly to a resting contact.
- [ ] Use tolerances appropriate for Avian's fixed timestep and solver settings.

**Verification:**

```powershell
rtk cargo test physics_solver_behavior
```

## Task 8: Friction And Slope Tests

**Files:**

- Modify: `tests/physics_solver_behavior.rs`
- Modify: `src/physics/materials.rs` if presets need adjustment

- [ ] Spawn a high-friction cuboid on a 30 degree static ramp and assert it stays approximately in place after settling.
- [ ] Spawn a low-friction cuboid on the same ramp and assert it slides.
- [ ] Add a flat-ground lateral velocity test that confirms friction reduces horizontal velocity.
- [ ] Verify the player movement bench still passes with chosen friction defaults.

**Verification:**

```powershell
rtk cargo test physics_solver_behavior
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 9: Collision Filtering

**Files:**

- Modify: `src/physics/layers.rs`
- Modify physics authoring helpers and query facade callers
- Add tests in `layers.rs` or a physics test module

- [ ] Add named masks for player, terrain, entity, water sensor, building, projectile, prop, and editor query.
- [ ] Ensure each spawned collider uses an explicit layer and mask.
- [ ] Verify sensors do not physically collide unless intentionally configured.
- [ ] Add tests for mask membership and important exclusions.
- [ ] Replace ad hoc layer construction in gameplay systems with named helpers.

**Verification:**

```powershell
rtk cargo test physics::layers
```

## Task 10: Sensor Volumes

**Files:**

- Create: `src/physics/sensors.rs`
- Modify: `src/physics/layers.rs`
- Modify water, building, or interaction systems as needed

- [ ] Add a standard sensor bundle using Avian sensor components and project collision layers.
- [ ] Add water volume sensors for entering/exiting water.
- [ ] Add editor/building validation sensors only where placement workflows require them.
- [ ] Ensure sensors produce project sensor events and no physical impulses.
- [ ] Add tests or a small runtime smoke path for sensor enter/exit behavior.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 11: Physics Query Facade Integration

**Files:**

- Modify: `src/physics/query.rs`
- Modify: `src/interaction/targeting.rs`
- Modify building placement systems that perform hit tests

- [ ] Wrap Avian `SpatialQuery` for raycasts, shape casts, point checks, shape overlaps, and ground probes.
- [ ] Require callers to choose a query purpose or named layer mask.
- [ ] Return project-friendly hit data: entity, point, normal, distance, layer, and optional voxel/building metadata.
- [ ] Replace duplicated direct raycast logic in interaction and building systems.
- [ ] Count query calls in diagnostics.

**Verification:**

```powershell
rtk cargo test
```

## Task 12: Projectile And CCD Behavior

**Files:**

- Create or modify projectile systems when they exist
- Modify: `src/physics/body_authoring.rs`
- Modify: `src/physics/events.rs`
- Modify: `src/physics/query.rs` if shape casts are used for projectile sweeps

- [ ] Add projectile layer/mask helpers.
- [ ] Use Avian CCD or explicit shape casts for fast projectiles.
- [ ] Route projectile impacts through the contact event adapter.
- [ ] Apply impulses through Avian components or commands rather than direct transform edits.
- [ ] Add tests for projectile filter setup and at least one fast-hit smoke case if projectile gameplay exists.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 13: Dynamic Props And Building Pieces

**Files:**

- Modify: `src/props/*` only where physics is introduced
- Modify: `src/building/*` only where physics is introduced
- Modify: `src/physics/body_authoring.rs`

- [ ] Add static colliders for placed building pieces.
- [ ] Add optional dynamic rigid bodies for selected props only.
- [ ] Keep decorative foliage non-physical unless gameplay needs collision.
- [ ] Use simplified colliders for props: sphere, capsule, cuboid, convex hull, or low-cost compound shapes.
- [ ] Add layer/mask coverage so props collide with terrain/buildings/player only when intended.
- [ ] Profile any scene-scale prop physics change.

**Verification:**

```powershell
rtk cargo test
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression-performance100.toml
```

Report relevant frame timing, prop, and physics rows if prop physics changes affect scene scale.

## Task 14: Terrain Collider Rebuild Correctness

**Files:**

- Modify: `src/physics/terrain_collider.rs`
- Modify voxel editing systems only if collider invalidation is incomplete

- [ ] Ensure terrain mesh changes mark the matching chunk for collider rebuild exactly once.
- [ ] Remove or replace stale collider components when a chunk mesh changes.
- [ ] Keep rebuild work throttled by `PhysicsSettings`.
- [ ] Add diagnostics for rebuild latency from mesh change to collider ready.
- [ ] Verify no player stalls in known terrain boundary and old-hole bench checkpoints.
- [ ] Compare voxelized and trimesh modes if contact behavior changes.

**Verification:**

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

Read `bench-runs/<run>/summary.json` and report collider rows plus movement smoke status.

## Task 15: Solver Confidence Bench Scene

**Files:**

- Create or modify: `bench/scenes/physics-solver-smoke.toml`
- Modify bench harness only if it needs controlled dynamic body assertions

- [ ] Add a checkpoint for bouncy sphere behavior if the bench harness can spawn scripted physics bodies.
- [ ] Add a checkpoint for resting cuboid or player capsule support.
- [ ] Add a slope/friction checkpoint if deterministic enough for automation.
- [ ] Keep assertions numerical and tolerant.
- [ ] Keep screenshots disabled unless a visible regression is part of the test.

**Verification:**

```powershell
rtk cargo run --release -- --bench bench/scenes/physics-solver-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

If adding a new bench scene is too broad, extend `bench/scenes/collider/gameplay-movement-smoke.toml` instead and document the choice.

## Task 16: Contact Diagnostics

**Files:**

- Modify: `src/physics/diagnostics.rs`
- Modify: `src/performance.rs` or bench reporting only if needed
- Modify: `src/debug_ui.rs` only if runtime UI is included in this plan

- [ ] Count contact starts, contact ends, sensor enters, and sensor exits.
- [ ] Count active dynamic bodies, sleeping bodies, and terrain collider rebuild queue length if cheaply available.
- [ ] Count query calls by purpose.
- [ ] Record enough bench rows to diagnose physics regressions without dumping raw per-contact data.
- [ ] Keep heavy diagnostics disabled by default.

**Verification:**

```powershell
rtk cargo test
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 17: Regression And Performance Review

**Files:**

- Modify docs only unless fixes are needed

- [ ] Run the full relevant test suite.
- [ ] Run `gameplay-movement-smoke` in release.
- [ ] If props/building physics changed scene scale, run `visual-regression-performance100`.
- [ ] Compare `summary.json` before/after for collider build/update rows, frame timing rows, movement stall counts, and physics diagnostics rows.
- [ ] Run `bench_guard` on the final bench output.
- [ ] Inspect fixed checkpoint screenshots only if the task changed visible behavior.

**Verification:**

```powershell
rtk cargo test
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Plan 2 Completion Checklist

- [ ] `rtk cargo test` passes.
- [ ] Contact and sensor events use project event types.
- [ ] Material presets are centralized and used by body authoring helpers.
- [ ] Collision layer masks are explicit and test-covered.
- [ ] Physics query facade is used by interaction/building code touched in this plan.
- [ ] Restitution, resting contact, friction, and slope behavior have Rust tests or bench assertions.
- [ ] `gameplay-movement-smoke` passes with no stall events.
- [ ] Bench summary includes enough physics/contact/query counters to diagnose regressions.
- [ ] No custom narrowphase, manifold cache, or solver is introduced.

## What Works After Plan 2

- Physics contacts can drive gameplay through stable project events.
- Sensors can support water, building validation, and editor workflows.
- Raycasts and overlap checks use one filtered API.
- Dynamic objects can be introduced with consistent physics defaults.
- Bouncing, resting, friction, and player-terrain contact behavior are verified against this repo's actual Avian integration.

## What Is Deferred

- Editor-facing physics inspection and authoring panels.
- Collider persistence/cache strategy.
- Large-scene physics activation budgets.
- Network determinism policy.
- User-facing physics authoring guide.
- Any custom contact manifold or solver work; only revisit this if Avian cannot meet a measured project requirement.

## Plan 3 Preview

Plan 3 adds runtime/editor diagnostics, collider cache policy, large-world physics budgets, editor-side physics inspection, and a physics authoring guide. It may also add deeper solver/contact visualization if debugging shows a concrete need.

