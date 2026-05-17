# Physics Features, Editor, and Performance Polish Implementation Plan

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Plan 3 translates the standalone Physics3D "features and polish" plan into this repo's Bevy/Rust stack.

Status note (2026-05-17): this is a roadmap artifact. Some referenced files (for example, `physics-stacking-smoke.toml` and several planned physics modules) are not yet present in this codebase and should be read as pending targets.

The JavaScript source plan finishes a custom engine with multi-point box-box manifolds, raycasting, sensors, filtering, auto-sleep, spawn-overlap resolution, deferred-removal cache eviction, a three.js debug helper, demos, and README docs. In this repo those features map to Avian 3D, Bevy ECS, runtime/editor diagnostics, bench scenes, and project authoring documentation.

## Goal

After this plan:

- Physics state is inspectable in the running game and editor.
- Resting, stacking, sleep, wake, filtering, sensors, raycasts, and terrain-collider rebuild behavior are verified against Avian integration.
- Bench summaries include enough physics counters to catch collider, contact, query, and movement regressions.
- Terrain collider generation has a cache or explicit no-cache policy.
- Large-world physics cost is bounded by sleeping, activation, culling, and throttling rules.
- Documentation explains how to add physics to new gameplay and editor systems.

## Architecture Translation

| Source plan item | Bevy/Rust implementation in this repo |
| --- | --- |
| `Body.applyImpulse` world tensor fix | Use Avian impulse/force components or commands. Add project helpers only if gameplay needs a wrapper. Verify off-center impulse behavior with Avian bodies. |
| Auto-sleep | Configure and test Avian sleeping. Add project diagnostics, not a parallel sleep system, unless Avian behavior is insufficient. |
| Spawn-overlap resolution | Use project query facade and Avian spatial queries to preflight or nudge spawns. Keep this as a gameplay authoring helper. |
| Deferred-removal cache eviction | Avian owns contact caches. Project cleanup should remove ECS state, wake affected project bodies where needed, and clear project-level event/query state. |
| Collision filtering | Harden `PhysicsLayer` masks and editor/query masks. |
| Sensors | Harden project sensor bundles and event adapter from Plan 2. |
| Raycasting | Use Avian `SpatialQuery` through `src/physics/query.rs`, not custom ray-shape functions. |
| Box-box Sutherland-Hodgman clipping | Avian owns manifolds. Verify stable cuboid stacking with tests/bench; do not implement custom clipping unless Avian fails a measured requirement. |
| three.js debug helper | Use Avian debug plugin, Bevy gizmos/debug UI, and editor viewport overlays. No three.js module in this Rust repo. |
| HTML demos | Use bench scenes, in-game debug scenarios, screenshots, and editor smoke workflows. |
| README | Add project physics authoring guide and update docs index; only touch root `README.md` if the project overview needs a short pointer. |

## Task 1: Final Capability Audit

**Files:**

- Create or modify: `docs/physics/avian-contact-capabilities.md`
- Modify: `docs/physics/README.md`
- Inspect as needed: `Cargo.toml`, `src/physics/*`, `src/player/controller.rs`

- [ ] Record current Bevy, Avian, Tnua, and Tnua-Avian versions from `Cargo.toml`.
- [ ] Document which original Plan 3 features are Avian-owned and which are project-owned.
- [ ] Document the supported gameplay collider set: terrain, cuboid, sphere, capsule, sensor volumes, buildings, projectiles, and props.
- [ ] Document the explicit no-custom-engine rule for manifolds, warm-start caches, broadphase, and solver internals.
- [ ] List the verification scenes/tests that prove feature parity for this project.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 2: Impulse And Force Authoring Helpers

**Files:**

- Create or modify: `src/physics/impulses.rs`
- Modify: `src/physics/mod.rs`
- Modify gameplay callers only if they currently edit transforms or velocities directly

- [ ] Add project helpers for applying impulses, forces, and off-center impulses through Avian-supported components or commands.
- [ ] Make helper names explicit about coordinate space: world point, world impulse, world force.
- [ ] Avoid direct `Transform` edits for dynamic bodies except teleport-style operations that intentionally reset physics state.
- [ ] Add tests or a physics smoke scenario for off-center impulse behavior on a rotated cuboid.
- [ ] Document when callers should use impulse, force, velocity, or teleport.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 3: Sleep And Wake Policy

**Files:**

- Modify: `src/physics/settings.rs`
- Modify: `src/physics/diagnostics.rs`
- Modify: `src/physics/plugin.rs`
- Add tests in a physics integration test module if practical

- [ ] Audit Avian sleeping defaults and expose project settings only where useful.
- [ ] Verify a settled dynamic body sleeps or becomes inactive according to Avian behavior.
- [ ] Verify moving bodies do not sleep prematurely.
- [ ] Verify contact, impulse, spawn, terrain edit, or support removal wakes affected bodies where gameplay requires it.
- [ ] Add diagnostics for sleeping dynamic bodies and active dynamic bodies if cheap to collect.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 4: Spawn-Overlap Preflight And Resolution

**Files:**

- Create or modify: `src/physics/spawn.rs`
- Modify: `src/physics/query.rs`
- Modify prop/building/projectile spawning systems that need overlap checks

- [ ] Add a spawn preflight helper that checks shape overlap through the query facade before spawning a dynamic body.
- [ ] Add an optional nudge-out helper for simple cases like sphere/capsule/cuboid against static terrain/building colliders.
- [ ] Keep static-static overlaps legal unless a caller asks for validation.
- [ ] For editor placement, return structured validation errors rather than silently moving authored objects.
- [ ] Add tests for filter use and basic blocked/free placement results.

**Verification:**

```powershell
rtk cargo test physics
```

## Task 5: Safe Body Removal And Neighbor Wake

**Files:**

- Create or modify: `src/physics/lifecycle.rs`
- Modify systems that despawn terrain, props, buildings, or projectiles
- Modify: `src/physics/events.rs` if project event state needs cleanup

- [ ] Add helper systems or commands for safe despawn of physics entities.
- [ ] Clear any project-level contact/sensor bookkeeping involving removed entities.
- [ ] Wake nearby sleeping dynamic bodies when a supporting static collider or physical neighbor is removed.
- [ ] Ensure terrain chunk collider replacement does not leave stale project state.
- [ ] Add tests for project-level cleanup helpers where practical.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 6: Collision Filtering Hardening

**Files:**

- Modify: `src/physics/layers.rs`
- Modify: `src/physics/body_authoring.rs`
- Modify: `src/physics/query.rs`
- Modify gameplay callers with ad hoc masks

- [ ] Ensure every physics body authoring path uses explicit `CollisionLayers`.
- [ ] Add named masks for player, terrain, entity, water sensor, building, projectile, prop, editor picking, editor placement, and terrain-only queries.
- [ ] Add tests for important inclusions and exclusions.
- [ ] Verify sensors do not physically collide unless intentionally configured.
- [ ] Verify editor queries can include/exclude hidden or diagnostic-only physics layers.

**Verification:**

```powershell
rtk cargo test physics::layers
rtk cargo test physics
```

## Task 7: Sensor Polish

**Files:**

- Modify: `src/physics/sensors.rs`
- Modify: `src/physics/events.rs`
- Modify water, building, or editor placement systems as needed

- [ ] Ensure sensor bundles have explicit layers, masks, and material/rigid-body defaults.
- [ ] Emit stable enter/exit events through the project event adapter.
- [ ] Add water sensor behavior if water gameplay needs enter/exit state.
- [ ] Add building/editor placement sensors only where they improve workflows.
- [ ] Add diagnostics for sensor enter/exit counts.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 8: Raycast And Shape Query Polish

**Files:**

- Modify: `src/physics/query.rs`
- Modify: `src/interaction/targeting.rs`
- Modify building placement and editor picking systems

- [ ] Ensure raycasts, shape casts, point checks, and overlap queries all route through the query facade.
- [ ] Return project-friendly hit records with entity, point, normal, distance, layer, and optional terrain/building metadata.
- [ ] Sort multi-hit query results deterministically by distance and stable entity key where needed.
- [ ] Add query-purpose counters for interaction, building, editor, projectile, and diagnostics.
- [ ] Add tests for mask filtering, sorted hits, and no-hit behavior.

**Verification:**

```powershell
rtk cargo test
```

## Task 9: Stacking And Solver Confidence

**Files:**

- Create or modify: `bench/scenes/collider/gameplay-movement-smoke.toml` for stacking/solver assertions until a dedicated `physics-stacking-smoke.toml` scene is introduced (not present in current tree)
- Create or modify physics integration tests where practical
- Modify: `src/physics/materials.rs` or settings only if tests reveal bad defaults

- [ ] Add a stable cuboid stacking smoke scenario using Avian cuboid colliders.
- [ ] Add a bouncy sphere scenario for restitution.
- [ ] Add a high-friction slope scenario and a low-friction sliding scenario if deterministic enough.
- [ ] Add pass/fail assertions in the bench harness only if they can be made robust.
- [ ] Document that Avian owns multi-point box manifolds; the project verifies behavior rather than implementing Sutherland-Hodgman clipping.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

If a new bench is too broad, extend `bench/scenes/collider/gameplay-movement-smoke.toml` and document the reason.

## Task 10: Runtime Physics Debug Overlay

**Files:**

- Modify: `src/debug_ui.rs`
- Modify: `src/physics/diagnostics.rs`
- Modify: `src/physics/plugin.rs`

- [ ] Add a debug panel section for physics settings, active dynamic bodies, sleeping bodies, collider build queue, generated collider kinds, failed builds, query counts, sensor counts, and contact counts.
- [ ] Add toggles for Avian debug rendering where supported.
- [ ] Keep heavy diagnostics disabled by default.
- [ ] Gate verbose physics logs behind `VOXEL_PHYSICS_DIAGNOSTICS=1`.
- [ ] Include selected-entity layer/mask display if the inspector already exposes entity details.

**Verification:**

```powershell
rtk cargo test
```

For editor-visible diagnostics, rebuild the editor runtime sidecar and restart the desktop editor from `editor/frontend`.

## Task 11: Editor Runtime Integration

**Files:**

- Modify editor bridge/runtime files only where physics state is surfaced
- Modify: `docs/editor/*` if workflows change

- [ ] Expose selected entity physics data to the editor: rigid body type, collider type, layer, mask, sensor flag, velocities, material preset, and diagnostics state.
- [ ] Add editor actions for toggling physics debug draw and heavy physics diagnostics.
- [ ] Ensure editor commands that modify terrain trigger collider rebuilds in the runtime.
- [ ] Ensure editor placement tools use the physics query/spawn validation helpers.
- [ ] Restart the editor after sidecar rebuild for validation.

**Verification:**

```powershell
rtk cargo test
```

Then rebuild the editor runtime sidecar and restart the desktop editor from `editor/frontend`.

## Task 12: Terrain Collider Cache Policy

**Files:**

- Create or modify: `src/physics/collider_cache.rs`
- Modify: `src/physics/terrain_collider.rs`
- Modify persistence code only if collider cache metadata is stored with world data

- [ ] Define a cache key from chunk coordinate, mesh revision, collider mode, voxel size, margin, and relevant generation settings.
- [ ] Cache successful generated colliders if Avian collider cloning or serialization makes this practical.
- [ ] If collider serialization is not practical, cache only generation metadata and rebuild prioritization hints.
- [ ] Invalidate cache entries when terrain edits change the chunk mesh revision.
- [ ] Add diagnostics for cache hit/miss counts and rebuild latency.

**Verification:**

```powershell
rtk cargo test physics
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

Compare collider build rows before and after cache work.

## Task 13: Large-World Physics Budgets

**Files:**

- Modify: `src/physics/settings.rs`
- Modify: `src/physics/plugin.rs`
- Modify terrain/player/prop systems as needed

- [ ] Define a physics activation radius around the player or active editor camera for optional dynamic props.
- [ ] Keep terrain colliders available near gameplay and editor focus points.
- [ ] Use Avian sleeping and project culling rules for dynamic bodies outside active areas.
- [ ] Avoid despawning terrain colliders that the player can reach before rebuild completes.
- [ ] Add diagnostics for active dynamic bodies, sleeping bodies, deferred collider work, and skipped far-field bodies.

**Verification:**

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression-performance100.toml
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

## Task 14: Bench Counters And Guardrails

**Files:**

- Modify bench summary/report code if physics counters are not emitted
- Modify: `docs/autonomous-perf-loop.md` if the perf loop needs physics rows
- Modify: `src/physics/diagnostics.rs`

- [ ] Ensure bench summaries report collider pending/generated/failed counts.
- [ ] Add collider cache hit/miss rows if a cache exists.
- [ ] Add query count rows for interaction-heavy checkpoints.
- [ ] Add dynamic body, sleeping body, and active island/body counts if Avian exposes them cheaply.
- [ ] Add guard thresholds only after collecting a stable baseline.

**Verification:**

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Task 15: Demo And Smoke Scenarios

**Files:**

- Create or modify bench scenes under `bench/scenes/`
- Modify demo/runtime scenario code only if the project has a supported in-game demo path
- Add screenshots only when visual verification is useful

- [ ] Add or update a physics stacking smoke scene.
- [ ] Add or update a projectile/query smoke scene if projectile gameplay exists.
- [ ] Add or update a sensor/water smoke scene if water sensors are implemented.
- [ ] Keep demos aligned with the actual Bevy app rather than adding standalone HTML demos.
- [ ] Document the commands to run each smoke scene.

**Verification:**

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

Run any new smoke scene added by this task.

## Task 16: Physics Authoring Guide

**Files:**

- Create: `docs/physics/authoring-guide.md`
- Modify: `docs/physics/README.md`
- Modify root `README.md` only if adding a short pointer to physics docs is appropriate

- [ ] Document how to add a static collider.
- [ ] Document how to add a dynamic prop.
- [ ] Document how to add a sensor.
- [ ] Document how to perform a filtered raycast, shape cast, or overlap query.
- [ ] Document how to apply impulses/forces safely.
- [ ] Document how to validate spawns and editor placement.
- [ ] Document which bench to run for terrain, player, prop, projectile, sensor, and editor physics changes.
- [ ] Include troubleshooting for player stalls, missing colliders, layer mask mistakes, expensive collider generation, sleeping bodies, and stale terrain colliders.

**Verification:**

```powershell
rtk cargo test
```

## Task 17: Final Regression And Performance Review

**Files:**

- Modify docs only unless fixes are needed

- [ ] Run the full relevant test suite.
- [ ] Run `gameplay-movement-smoke` in release.
- [ ] Run physics stacking/query/sensor smoke scenes added by this plan.
- [ ] If prop/building physics changed scene scale, run `visual-regression-performance100`.
- [ ] Compare `summary.json` before/after for collider rows, query rows, physics diagnostics rows, movement stall counts, and frame timing rows.
- [ ] Run `bench_guard` on final bench outputs.
- [ ] If editor-visible state changed, rebuild the editor runtime sidecar and restart the desktop editor.

**Verification:**

```powershell
rtk cargo test
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Plan 3 Completion Checklist

- [ ] Runtime diagnostics expose key physics counters.
- [ ] Editor-visible physics state is tested after sidecar rebuild and editor restart.
- [ ] Bench summaries include collider, query, contact/sensor, and body-state rows where practical.
- [ ] Terrain collider cache or explicit no-cache policy is documented.
- [ ] Large-world physics activation rules are implemented or explicitly deferred.
- [ ] Stacking, bouncing, resting, filtering, sensors, raycasts, and spawn validation are covered by tests or smoke scenes.
- [ ] `docs/physics/authoring-guide.md` exists.
- [ ] No custom narrowphase, manifold cache, or solver is introduced without a measured Avian blocker.

## What Works After Plan 3

- Physics can be debugged from runtime and editor workflows.
- Collider generation regressions are visible in bench summaries.
- Large-world scenes have bounded physics cost.
- Contacts, sensors, collision filtering, raycasts, and spawn validation have project-level APIs and verification.
- New gameplay physics can follow documented authoring patterns.

## What Is Not In Scope

- Replacing Avian with a custom solver.
- Custom GJK/EPA or Sutherland-Hodgman manifold generation.
- General triangle-mesh dynamic collision.
- Vehicle, ragdoll, character, or joint frameworks beyond the existing Tnua player path.
- Cross-platform bit-deterministic multiplayer physics.
- Standalone JavaScript or three.js demos.

## Engine Status After Plan 3

The project has a production-oriented Bevy/Avian physics workflow: documented authoring, verified contact behavior, filtered queries, sensors, debug visibility, and performance guardrails.

