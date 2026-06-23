# Per-Cascade Shadow Caster Culling (Bevy) — Plan

> Created: 2026-06-17 · Status: Complete (Phases 0-4 implemented; Phase 4 debug view deferred)
> Scope: `src/props/instanced_render.rs` (`rebuild_visible_and_shadow_instances`,
> `queue_instanced_prop_shadows`), `src/rendering/lighting/`, `assets/config/props.yaml`,
> `bench/scenes/forest/`
> Related: [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md) Phase 4
> (the GPU version of this), [`clod-poc-per-cascade-shadow-caster-culling-plan.md`](clod-poc-per-cascade-shadow-caster-culling-plan.md)
> (sibling — mostly N/A there).

Separate **visible-instance culling** from **shadow-caster culling, per cascade**, for
instanced props. View-frustum culling can drop off-screen props that should still cast
shadows; conversely the current caster list is keyed on *camera* distance, so a cascade
can lose casters it still needs. Keep the existing budget/shadow-LOD; add per-cascade
compact caster lists.

## What this is / is not

- **Is:** splitting the single per-group `shadow_instances` list into **per-cascade**
  compact caster lists, each culled against that cascade's own frustum + distance band,
  independent of the main camera. CPU-first (extends the existing custom pipeline).
- **Is not:** a new shadow system, removing the shadow budget / shadow-LOD, or touching
  grass (grass is `NotShadowCaster` — out of scope).

## Repo reality (audit)

Drusniel is **partway there already**:
- The instanced-prop pipeline builds a **separate** caster list per group:
  `rebuild_visible_and_shadow_instances` ([instanced_render.rs:944](../../src/props/instanced_render.rs#L944))
  produces `visible_instances` **and** `shadow_instances`.
- A dedicated **`queue_instanced_prop_shadows`** system ([:541](../../src/props/instanced_render.rs#L541))
  queues casters into the `Shadow` phase, hooked to Bevy's `RenderCascadesVisibleEntities`.
- The **budget** is the shadow-LOD cutoff: a prop casts only when
  `!shadow_culled && (disable_shadow_lod || lod == Full)` ([:964](../../src/props/instanced_render.rs#L964)),
  with `IMPORTANT_PROP_SHADOW_LOD_DISTANCE` and the `forest-disable-prop-shadow-lod.toml`
  bench scene. `shadow_culled` comes from `NotShadowCaster` + `lod_state.shadows_disabled`.
- **Grass / rocks / particles are `NotShadowCaster`** ([vegetation/mod.rs:409,1121](../../src/world/environment/vegetation/mod.rs)),
  so they never cast — this plan is **props (trees) only**.

### The precise gap

1. **One caster list, shared across all cascades.** `shadow_instances` is a single list
   per group; cascade 0 (near) and cascade N (far) draw the same set. No per-cascade
   distance/frustum tightening of the *instance* set — only Bevy's group-level cascade
   visibility (all-or-nothing per group, since a group is one entity with one Aabb).
2. **Caster selection keyed on the MAIN-CAMERA distance LOD.** A prop drops out of
   shadows when its *camera*-distance LOD falls below `Full` — not when it's irrelevant
   to a cascade. A prop far from the camera but still inside a near-ish cascade's shadow
   volume can be dropped (shadow pops/disappears), which is exactly the failure the
   request describes.
3. **Group-level main-frustum coupling (to verify, not assume).** Because a group is one
   entity, if Bevy frustum-culls the group from a *light* view correctly this is fine —
   but if any path ties caster submission to *main-view* visibility, off-screen casters
   vanish. Phase 1 instruments this rather than guessing.

## The LAAS principle

Visible-instance culling and shadow-caster culling are **different queries**: the first
uses the camera frustum; the second uses **each cascade's** frustum/volume and distance
range. They must not share a list. (Same idea the
[GPU-veg plan](bevy-gpu-vegetation-port-plan.md) Phase 4 implements on GPU — this is the
CPU-first version on the existing pipeline.)

## Design

- Replace the single `shadow_instances` with **N per-cascade lists** (N = cascade count).
- For each cascade, accept a prop instance if its bounds intersect that cascade's
  **shadow frustum/volume** and it's within the cascade's **distance band**, gated by the
  existing budget (shadow-LOD) applied **per cascade** (far cascades may use a coarser
  LOD / higher cutoff).
- Selection uses **cascade-relative** distance, not main-camera LOD, so off-screen-yet-
  shadow-relevant casters survive.
- **Hysteresis** at cascade/budget boundaries (the pipeline already uses
  `PROP_LOD_HYSTERESIS`) so casters don't flicker in/out at the edges.
- Keep everything else: `NotShadowCaster`, `shadows_disabled`, `disable_prop_shadow_lod`,
  `IMPORTANT_PROP_SHADOW_LOD_DISTANCE`.

## Phased plan (CPU-first; perf-sensitive — bench every phase per CLAUDE.md)

### Phase 0 — Baseline + repro
- On `forest-*` scenes, capture shadow-pass timing + a **repro**: a prop just off the
  main-camera frustum whose shadow should be visible; confirm whether it pops/disappears
  (rotate camera so a known shadow-casting tree leaves the frustum but its shadow stays
  on-screen).
- **Verify:** baseline `summary.json`; repro documented (or shown absent).

### Phase 1 — Instrument the caster query
- Add counters: casters submitted per cascade, casters dropped by main-frustum vs by
  shadow-LOD. Determine whether main-view visibility ever gates caster submission (gap #3).
- **Verify:** the numbers show exactly where casters are lost; confirms/denies the
  off-screen-caster bug with evidence.

### Phase 2 — Per-cascade caster lists
- Extend `rebuild_visible_and_shadow_instances` to emit **N** caster lists, each culled
  against the cascade frustum + distance band (read the cascade volumes the shadow pass
  already computes). Extend `queue_instanced_prop_shadows` to submit the matching list per
  cascade view.
- Apply the budget/shadow-LOD **per cascade**.
- **Verify (bench):** off-screen-but-shadow-relevant casters retained (Phase 0 repro
  fixed); near cascades no longer carry far casters and vice-versa; shadow-pass time
  holds or improves; no visual regression on the forest scenes.

### Phase 3 — Hysteresis + budget enforcement
- Cascade/budget-edge hysteresis so casters don't flicker; per-cascade caster cap with
  nearest-first priority when a cascade's budget is exceeded (clamp, count overflow).
- **Verify:** no popping at cascade boundaries beyond existing tolerance; caster counts ≤
  budget; benched.

### Phase 4 — Metrics + debug view
- Per-cascade caster counts + overflow into the existing diagnostics/bench output; a debug
  view colouring casters by cascade.
- **Verify:** metrics readable; debug view toggles cleanly.

## Reconciliation

- **GPU-veg Phase 4** is the same separation done in a compute pass writing per-cascade
  compacted lists + indirect args. This CPU plan is the lower-risk first step and defines
  the per-cascade selection rules that the GPU version will reuse. Land the rules here;
  port to GPU there.
- **Budget system stays** — this refines *which* casters fill the budget per cascade, not
  the budget itself.

## Acceptance

- Off-screen props that should cast on-screen shadows are retained (Phase 0 repro fixed).
- Each cascade carries only its relevant casters; per-cascade caster count ≤ budget.
- No shadow popping at cascade edges beyond current tolerance.
- Shadow-pass time does not regress on `forest-*` scenes (ideally improves — far cascades
  shed near casters).

## Open questions

1. Does any path tie **caster submission to main-view visibility** (gap #3)? Phase 1
   answers with counters.
2. Are the per-cascade **shadow frustum/volume bounds** cheaply readable at the point
   `rebuild_*` runs, or must they be extracted into the render world first?
3. Group granularity: with one Aabb per group, is per-**instance** cascade culling worth
   it, or is per-**group** cascade assignment enough until the GPU path? (Measure in
   Phase 2.)

## Reference index

- Caster list build: [`rebuild_visible_and_shadow_instances`](../../src/props/instanced_render.rs#L944)
- Shadow queue: [`queue_instanced_prop_shadows`](../../src/props/instanced_render.rs#L541)
- Shadow-LOD / budget constants: [`instanced_render.rs`](../../src/props/instanced_render.rs) (`IMPORTANT_PROP_SHADOW_LOD_DISTANCE`, `PROP_LOD_HYSTERESIS`)
- Grass (NotShadowCaster, out of scope): [`src/world/environment/vegetation/mod.rs`](../../src/world/environment/vegetation/mod.rs)
- Shadow bench scene: [`bench/scenes/forest/forest-disable-prop-shadow-lod.toml`](../../bench/scenes/forest/forest-disable-prop-shadow-lod.toml)
- GPU version: [`bevy-gpu-vegetation-port-plan.md`](bevy-gpu-vegetation-port-plan.md) Phase 4
