# Physics Implementation Plans

This folder tracks the physics roadmap for this Bevy/Rust voxel project.

The source plan was written for a standalone JavaScript physics engine. In this repo the translation is not a custom math/body/world engine. The project already uses:

- Bevy 0.18.1 math, transforms, schedules, and ECS.
- Avian 3D 0.5 for rigid bodies, colliders, collision detection, solving, broadphase, and spatial queries.
- bevy-tnua and bevy-tnua-avian3d for the player controller.
- Existing terrain collider generation in `src/physics/terrain_collider.rs`.

## Plan Set

- [Plan 1: Foundation](plan-01-foundation.md) - stabilize the Bevy/Avian physics foundation, authoring helpers, collider generation, diagnostics, fixed-step policy, and query facade.
- [Plan 2: Contacts, Solver Behavior, and Gameplay Physics](plan-02-contacts-queries-gameplay.md) - wire contact events, solver behavior tests, sensors, spatial queries, materials, collision filtering, and gameplay behaviors.
- [Plan 3: Physics Features, Editor, and Performance Polish](plan-03-runtime-editor-performance.md) - harden sleep/wake, spawn validation, filtering, sensors, queries, debug overlays, performance budgets, collider caching, smoke scenes, and documentation.
- [Plan 4: Terrain Collider Overhaul](plan-04-terrain-collider-overhaul.md) - replace render-mesh-derived terrain collision with authoritative occupancy-derived collision, async double-buffered swaps, player readiness/fallback logic, and collider route benchmarks.

Plan 4 supersedes the terrain-collider portions of Plans 1 and 3 where they conflict. The earlier plans still apply to general physics authoring, contacts, queries, sensors, and editor-facing polish.

## Rules For Implementation

- Prefer Avian and Bevy APIs over custom physics internals.
- Keep physics data in ECS components and resources.
- Keep terrain collider work throttled and measurable.
- Use collision layers for all gameplay queries and colliders.
- Any change that can affect frame timing must be profiled with a release bench.
- Commands in this repo must be prefixed with `rtk`.

## Standard Verification

Use the narrowest verification that covers the change, then run the gameplay bench before claiming a physics performance result.

```powershell
rtk cargo test
rtk cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

For editor-visible physics changes, rebuild the editor runtime sidecar and restart the desktop editor from `editor/frontend` before reporting that the editor path was verified.

