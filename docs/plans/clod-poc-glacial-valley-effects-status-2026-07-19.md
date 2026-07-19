# CLOD-POC Glacial Valley Effects — Implementation Status

> Updated: 2026-07-19  
> Target: `tools/clod-poc` on `main`  
> Execution plan: `docs/plans/clod-poc-glacial-valley-effects-performance-execution-plan-2026-07-18.md`  
> Status: **IN PROGRESS — foundations and first visual slices landed; completion and headed acceptance pending**

## Purpose

This document is the live status companion for the Glacial Valley effects and performance execution plan.

The execution plan remains the design and acceptance contract. This file records current implementation state so future work does not:

- rebuild features already present on `main`;
- confuse unit-tested plumbing with headed acceptance;
- create overlapping pull requests;
- default-enable experimental effects without performance evidence;
- lose the ordered dependency chain between shared environmental data, masks, effects, and acceptance.

Every future Glacial Valley implementation PR must update this file in the same PR or in its immediately following documentation PR.

## Status definitions

| Status | Meaning |
|---|---|
| `implemented` | Production code is on `main` and focused tests exist. |
| `acceptance_pending` | Code is on `main`, but headed visual/performance evidence or default-enablement decision is still missing. |
| `partial` | Some contract or rendering work exists, but the execution-plan result is incomplete. |
| `open_pr` | Work exists in an open PR and is not part of `main`. |
| `pending` | No production implementation found. |
| `deferred` | Explicitly postponed until profiling or a prerequisite justifies it. |

## Executive status

Estimated completion against the full execution plan:

- implementation code: approximately **45–55%**;
- integrated and acceptance-ready: approximately **30–40%**;
- final headed acceptance: **not complete**;
- normal-gameplay readback policy: preserved for landed slices;
- original water W1–W4 baseline: already complete and remains the regression foundation.

The strongest completed areas are:

- shared query contracts and hydrology adapter;
- biome visual state;
- deterministic environmental-mask formulas;
- glacial water optical controls;
- clipmap-distance SSR reduction;
- GPU underwater river cobbles;
- deterministic gravel-bar dressing;
- camera-local river mist;
- deterministic glacial-water capture tooling.

The largest remaining areas are:

- complete EnvironmentQuery authority composition;
- real carved-bed gravel bars and visibly braided reaches;
- full glacial suspended-particle scattering and glitter;
- large-prop occlusion overlay;
- remaining GPU ambience effects;
- GPU ground-debris ring;
- complete biome-state consumer routing;
- consolidated headed performance and visual acceptance.

## Workstream status

| Workstream | Status | Current state | Completion requirement |
|---|---|---|---|
| GV-CLOD-00 Baseline/status | `partial` | Consolidated plan exists. This companion status file now tracks delivery. Reference pin and deterministic before-state inventory still need confirmation. | Pin reference revision and record canonical before/after poses and metrics. |
| GV-CLOD-01 EnvironmentQuery | `partial` | Typed scalar contracts, caller-owned batch buffers, field masks, hint propagation, hydrology adapter, diagnostics, and focused tests exist. Hydrology provides surface/water/river values. | Compose real terrain normals, material weights, and sun visibility; route production mask and dressing consumers through batch APIs. |
| GV-CLOD-02 Far sun visibility | `partial` | Existing budgeted CPU/worker tile builder, atlas, far terrain, fog, and god-ray consumers are production foundations. Worker failover is hardened. | Profile current builder; add remaining consumers; add GPU builder only if measurements justify it; integrate prop overlay when available. |
| GV-CLOD-03 Gravel bars/cobbles | `acceptance_pending` | Deterministic visual gravel-bar field, GPU hydrology packing, GPU gravel-bar stones, and underwater river cobbles exist behind controls. | Add safe bed elevation integration and one real braided reach; prove 100% continuity, non-zero accepted cobbles, no floating instances, and cost gates. |
| GV-CLOD-04 Glacial water | `partial` | Biome-driven absorption/turbidity/reflection damping, rock-flour colour response, reflection clipmap tiers, live GUI controls, and deterministic capture tooling exist. | Add explicit thickness-based suspended scattering, two-lobe glitter, intended mid-distance terrain reflection approximation, and measured A/B evidence. |
| GV-CLOD-05 Prop occlusion overlay | `pending` | No shared large-prop height/occupancy overlay is on `main`. | Add dirty-region, stale-safe overlay; integrate with far sun visibility, mid-water reflection, and mist clipping. |
| GV-CLOD-06 Environmental masks | `partial` | CPU formulas and typed outputs exist for river cobble, river mist, rapid splash, sunbeam mote, calm pool, frost, dew, and shore debris. | Use complete authoritative query inputs, switch batch evaluation away from repeated scalar queries, and add debug visualizations/probes. |
| GV-CLOD-07 Ambient effects | `partial` | Camera-local river mist is on `main`. Sunbeam motes are currently in PR #186. | Finish and accept motes; add GPU/procedural rapid droplets, calm-water rings, dew, and frost; keep combined budget within gate. |
| GV-CLOD-08 Ground debris | `pending` | No shared GPU debris ring found. | Implement grouped compute/indirect debris ring for pebbles, twigs, bark, litter, and gravel with no CPU transforms or visible seams. |
| GV-CLOD-09 Biome visual state | `partial` | Shared state, YAML parsing, season interpolation, sun-elevation morning mist, weather wetness, runtime binding, and water/mist consumers exist. | Route terrain, grass, understory, trees, motes, dew/frost, bloom, and look-development controls through the shared state. |
| GV-CLOD-10 QA/rollout | `partial` | Glacial water capture tooling and existing water W4 gates exist. Focused unit tests exist for landed slices. | Add river-detail, atmosphere, debris, time-of-day, movement, and cumulative performance acceptance; make final default-enable decisions. |

## Open pull requests

### PR #186 — Sunbeam motes

Status: `open_pr`

Current scope:

- reuses the existing meadow particle draw;
- adds YAML tuning and lil-gui controls;
- gates motes using sun visibility, view alignment, mist, pollen, and frost state;
- adds focused config/runtime/GUI/GPU-error tests.

Required before merge:

- typecheck;
- focused tests;
- build;
- headed WebGPU capture confirming shaft-local appearance;
- no particle leakage outside the visibility/mist gate;
- zero WebGPU validation errors;
- measured cumulative ambience cost.

Do not create another sunbeam-mote implementation while PR #186 is open.

## Detailed remaining backlog

### P0 — Finish shared environmental authority

This is the highest-priority architecture work.

- [ ] Add a composed EnvironmentQuery implementation that delegates each field to its canonical owner.
- [ ] Surface height: live terrain/tile/CLOD/far-summary hierarchy with source metadata.
- [ ] Surface normal: authoritative terrain normal, not `(0, 1, 0)` fallback.
- [ ] Material weights: canonical terrain material/splat weights.
- [ ] Water and river: existing hydrology authority.
- [ ] Visibility: existing far sun-visibility cache/atlas CPU query.
- [ ] Preserve real cell-size hints through every adapter.
- [ ] Keep scalar APIs for diagnostics and sparse probes only.
- [ ] Convert environmental-mask batch evaluation to one batch query plus vectorized mask evaluation.
- [ ] Route river dressing and CPU stone fallback through the facade.
- [ ] Add source/validity/revision debug overlay.
- [ ] Prove no fine hydrology tile construction from far consumers.

Exit gate:

- all mask inputs can be valid in normal gameplay;
- scalar and batch parity passes;
- environment-query management remains within plan budget;
- no new per-frame allocation hot path.

### P1 — Complete gravel bars and underwater cobbles

- [ ] Add bounded bar `elevationOffsetM` to the carved-bed stage.
- [ ] Preserve minimum wet channel width and downstream continuity.
- [ ] Prevent bars from affecting lakes unless a separate delta/sandbar mode is enabled.
- [ ] Publish the same deterministic mask to terrain material, vegetation suppression, cobbles, and water breakup.
- [ ] Add dedicated river-detail counters for candidates, acceptance, rejection reasons, visible and underwater counts.
- [ ] Add a deterministic braided-reach acceptance scene.
- [ ] Gate acceptance on non-zero river cobbles after convergence.
- [ ] Prove no floating stones and correct carved-bed seating.
- [ ] Decide default enablement from headed and performance evidence.

Exit gate:

- 100% river continuity retained;
- at least one real split/braided reach;
- non-zero underwater cobbles;
- render and update cost within plan limits.

### P2 — Complete glacial water shader behavior

- [ ] Add path-thickness-dependent suspended rock-flour in-scattering.
- [ ] Use existing path thickness and per-body optical state; add no duplicate body shader fork.
- [ ] Add tight glint and broad sheen lobes using existing normal, sun, and view vectors.
- [ ] Add low-sun gain control in YAML.
- [ ] Implement the intended middle reflection approximation using far terrain/visibility summaries.
- [ ] Keep near SSR and far analytic sky behavior.
- [ ] Add reflection-tier debug output.
- [ ] Capture clear/glacial A/B, shallow river, deep lake, rapid and low-sun poses.
- [ ] Measure render delta for scatter, glitter, and tier policy separately.

Exit gate:

- glacial look is body/state-driven rather than a global shader fork;
- high-quality water remains inside W4 budgets;
- middle tier is cheaper than near SSR at its activation distance.

### P3 — Large-prop occlusion overlay

- [ ] Define compact height/occupancy/validity layout.
- [ ] Include only large and hero boulders initially.
- [ ] Build conservative footprints from stable transforms and bounds.
- [ ] Update dirty regions only.
- [ ] Keep old valid overlay live until replacement is ready.
- [ ] Integrate with far sun-visibility march.
- [ ] Integrate with middle water reflection.
- [ ] Integrate as soft mist density clipping.
- [ ] Add terrain-versus-prop debug colors and stale validity display.

Exit gate:

- large boulders influence far lighting/reflection without terrain edits;
- no full per-frame rebuild;
- update and upload costs remain within plan limits.

### P4 — Finish ambience effects

After PR #186 is resolved:

- [ ] Rapid splash droplets: deterministic sources, procedural lifetime/ballistic arc, no CPU particle simulation.
- [ ] Optional rapid-rock spray using large-prop proximity.
- [ ] Calm-water fish-rise rings: hydrology-placed, sparse, shader-expanded, excluded from rapids and shore shallows.
- [ ] Dew: shader-only grass/leaf sparkle first.
- [ ] Frost: shared mask/state-driven tint first.
- [ ] Refactor river mist toward shared mask input and shader-driven motion if profiling shows CPU upload cost or architectural duplication is material.
- [ ] Enforce off/low/high policies and integrated-GPU defaults.
- [ ] Measure all ambience enabled together, not only each effect in isolation.

Exit gate:

- combined ambience render delta and CPU update meet the plan;
- no gameplay readbacks;
- no effect leaks outside its deterministic mask.

### P5 — GPU ground debris

- [ ] One toroidal compute ring, not one ring per debris class.
- [ ] Group append buffers and indirect draw arguments.
- [ ] Tiny cobbles, flat pebbles, twigs, bark chips, litter clusters, and gravel patches.
- [ ] Material/biome/hydrology/construction exclusion in compute.
- [ ] Wet response near water.
- [ ] No individual shadows.
- [ ] Dithered distance fade before aliasing.
- [ ] Debug counts by class and rejection reason.
- [ ] Walking seam acceptance.

Exit gate:

- forest and meadow floors no longer read unnaturally clean;
- no visible ring boundaries;
- CPU update remains near zero after initialization.

### P6 — Complete shared biome visual-state routing

- [ ] Terrain seasonal tint and snowline.
- [ ] Grass, understory and tree seasonal color.
- [ ] Mote pollen/frost mode.
- [ ] Dew/frost strength.
- [ ] Flower bloom.
- [ ] Compact look-development GUI with reset/export.
- [ ] Verify consumers read state rather than recomputing season curves.
- [ ] Audit tone mapping, color conversion, exposure, vignette, grain, and grade before adding any post term.

Exit gate:

- fixed seasonal checkpoints change participating systems coherently;
- default values preserve non-glacial scenes.

### P7 — Final acceptance and default enablement

- [ ] Update the existing infinite-islands acceptance battery rather than creating isolated toy scenes.
- [ ] River detail: close/aerial braid, underwater cobbles, shore/bar transition, rapid effects.
- [ ] Atmosphere: shaded/sunlit mist, shaft/mote alignment, time-of-day transition.
- [ ] Ground detail: forest, river bar, meadow, movement seam.
- [ ] Water: clear/glacial A/B, deep lake, shallow river, rapid, glitter.
- [ ] Feature-off/feature-on matrix.
- [ ] Static/moving matrix.
- [ ] High/performance/integrated policy matrix.
- [ ] Fresh/reuse acceptance matrix.
- [ ] Zero uncaptured WebGPU errors.
- [ ] Zero normal-gameplay GPU readbacks.
- [ ] Existing W4 water acceptance remains green.
- [ ] Record exact commands, URLs, poses, reports, screenshots, and measured deltas in this document.

Exit gate:

- every definition-of-done item in the execution plan is evidenced;
- features are either enabled by default with evidence or explicitly documented as optional/deferred.

## Ordered PR sequence

Use small, reviewable PRs from current `main`. Avoid long-lived stacked branches unless a dependency genuinely requires them.

1. `docs(clod-poc): track Glacial Valley completion status` — this file.
2. Resolve and merge PR #186 after validation.
3. `feat(clod-poc): compose authoritative environment queries`.
4. `perf(clod-poc): batch environmental mask evaluation`.
5. `feat(clod-poc): carve safe gravel bars and braided reaches`.
6. `test(clod-poc): accept braided rivers and underwater cobbles`.
7. `feat(clod-poc): add physical glacial water scattering and glitter`.
8. `feat(clod-poc): add far-summary water reflection tier`.
9. `feat(clod-poc): add large-prop occlusion overlay`.
10. `feat(clod-poc): add rapid splash droplets`.
11. `feat(clod-poc): add calm-water rise rings`.
12. `feat(clod-poc): add dew and frost material accents`.
13. `feat(clod-poc): add GPU ground-debris ring`.
14. `feat(clod-poc): complete biome visual-state routing`.
15. `test(clod-poc): add Glacial Valley cumulative acceptance`.
16. `docs(clod-poc): close Glacial Valley execution plan`.

A PR may be split further when it touches more than one authority or cannot be reviewed safely as one unit.

## Pull-request rules

- Base every independent PR on current `main`.
- Do not merge draft PRs without the stated validation.
- Do not mark unit-tested plumbing as visually accepted.
- Do not weaken continuity or performance gates.
- Do not add URL-only production configuration; YAML remains authoritative.
- Do not introduce normal-gameplay GPU readbacks.
- Do not write water, stones, debris, or prop occlusion into CLOD page authority.
- Do not default-enable a new transparent effect in its first rendering commit without headed evidence.
- Use squash merge for connector-generated incremental commits.
- Update this status document after every merged slice.

## Current blockers

The connected automation environment can create branches, commits, and PRs, but currently cannot:

- clone the repository into the execution container;
- run Node/Vitest/Vite locally;
- launch the headed browser acceptance scene;
- capture GPU timing or visual screenshots.

Therefore PRs created from this environment must remain draft until the documented local checks and headed evidence are completed. This is an evidence limitation, not permission to lower gates.

## Completion rule

The Glacial Valley execution plan is fully done only when:

- every workstream is `implemented`, `acceptance_pending` with an explicit deferred decision, or `deferred` with measured justification;
- all non-deferred definition-of-done items have evidence;
- existing W4 water acceptance is still green;
- new river, atmosphere, water and ground-detail acceptance is green;
- zero WebGPU validation errors and zero normal-gameplay readbacks are recorded;
- this status file and the parent execution plan are updated to `COMPLETE` with final commit/report references.
