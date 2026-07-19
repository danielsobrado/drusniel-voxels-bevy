# CLOD-POC Glacial Valley Effects — Implementation Status

> Updated: 2026-07-19  
> Target: `tools/clod-poc` on `main`  
> Execution plan: `docs/plans/clod-poc-glacial-valley-effects-performance-execution-plan-2026-07-18.md`  
> Status: **IN PROGRESS — shared query foundations landed; water optics and production integration pending**

## Purpose

This is the live delivery record for the Glacial Valley execution plan.

The parent plan owns architecture, constraints, performance gates, and the final definition of done. This document owns current implementation state, merged PRs, open PRs, evidence still owed, and the next safe PR order.

Every Glacial Valley PR must update this document in the same PR or in its immediately following documentation PR.

## Status definitions

| Status | Meaning |
|---|---|
| `implemented` | Code and focused tests are on `main`. |
| `acceptance_pending` | Code is on `main`, but headed visual/performance evidence or default enablement is still missing. |
| `partial` | Some contract or renderer work exists, but the planned result is incomplete. |
| `open_pr` | Work exists in an open PR and is not on `main`. |
| `pending` | No production implementation found. |
| `deferred` | Explicitly postponed with a measured or architectural reason. |

## Executive status

Estimated completion against the full execution plan:

- implementation code: approximately **55–60%**;
- integrated and acceptance-ready: approximately **35–45%**;
- cumulative headed acceptance: **not complete**;
- normal-gameplay GPU readback policy: preserved for landed slices;
- original water W1–W4 acceptance remains the regression foundation.

The estimate separates code presence from proof. Several merged slices have focused tests, but this connected environment did not run the local TypeScript toolchain or headed WebGPU acceptance. They therefore remain acceptance-pending until evidence is attached.

## Merged Glacial Valley PRs

| PR | Result | Current classification |
|---|---|---|
| #106 | Shared EnvironmentQuery contract | `implemented` |
| #125 | Initial Glacial Valley foundations integration | `implemented` |
| #133 | Clipmap-distance water reflection tiers | `acceptance_pending` |
| #138 | Deterministic glacial-water capture tooling | `implemented` |
| #142 | Deterministic environmental-mask formulas | `implemented` |
| #150 | GPU underwater river cobbles | `acceptance_pending` |
| #159 | Glacial-water live GUI controls | `implemented` |
| #168 | Camera-local river mist | `acceptance_pending` |
| #174 | Gravel-bar dressing and live mist toggle | `acceptance_pending` |
| #186 | Sunbeam motes with live controls | `acceptance_pending` |
| #187 | Live Glacial Valley completion status | `implemented` |
| #188 | Batched environmental-mask queries | `implemented`, runtime/perf proof pending |
| #189 | Live sun-visibility EnvironmentQuery adapter | `implemented`, production composition pending |
| #192 | Live terrain EnvironmentQuery adapter | `implemented`, production composition pending |

## Open pull requests

### PR #196 — Physical glacial water scatter and glitter

Status: `open_pr`

Scope:

- per-body suspended-scatter colour, extinction, strength, and ambient response;
- path-thickness scattering using `1 - exp(-opticalThickness * extinction)`;
- YAML-owned tight and broad glitter lobes with low-sun gain;
- shared TSL optics helper for WebGPU high and performance tiers;
- equivalent WebGL fallback implementation;
- `suspendedScatter` debug mode;
- deterministic scatter capture;
- focused config, clone, body-preset, rock-flour, glitter, and acceptance tests.

Required before merge:

- typecheck;
- focused tests;
- production build;
- WebGPU high and performance material compile;
- WebGL fallback smoke;
- clear-water feature-off visual parity;
- shallow glacial river, deep lake, and low-sun captures;
- `suspendedScatter` debug capture;
- zero uncaptured GPU errors;
- suspended-scatter render delta `<= 0.20 ms p95`;
- existing W4 water budget remains green.

Do not mark Workstream 4 complete when #196 merges. The far-summary-assisted middle reflection tier and cumulative acceptance still remain.

## Workstream status

| Workstream | Status | Current state | Remaining completion requirement |
|---|---|---|---|
| GV-CLOD-00 Baseline/status | `partial` | Consolidated plan and live status owner are on `main`. | Pin the Glacial Valley source revision and record canonical before/after poses and baseline metrics. |
| GV-CLOD-01 EnvironmentQuery | `partial` | Hydrology, live terrain, and live sun-atlas adapters exist. Scalar/batch contracts, diagnostics, hint propagation, and batched mask consumption exist. | Add and install one production composition root; route river dressing and CPU stone fallback; expose source/validity/revision debug. |
| GV-CLOD-02 Far sun visibility | `partial` | Existing budgeted cache/worker, GPU atlas, terrain, fog, and god-ray consumers exist. CPU EnvironmentQuery sampling now exists. | Profile the builder, add remaining consumers, integrate large-prop overlay, and add GPU production only if measurements justify it. |
| GV-CLOD-03 Gravel bars/cobbles | `acceptance_pending` | Visual bar mask, GPU packing, gravel-bar stones, and underwater cobbles exist. | Integrate safe bed elevation, produce a real braided reach, add rejection counters, and prove continuity/non-floating/performance gates. |
| GV-CLOD-04 Glacial water | `open_pr` | Murkiness, body optics, reflection step tiers, GUI, and capture tooling are on `main`; PR #196 adds physical scattering and config-driven glitter. | Validate #196, implement the far-summary middle reflection approximation, and attach measured clear/glacial A/B evidence. |
| GV-CLOD-05 Prop occlusion overlay | `pending` | No shared large-prop height/occupancy overlay is on `main`. | Add dirty-region, stale-safe overlay and integrate it with sun visibility, water reflection, and mist clipping. |
| GV-CLOD-06 Environmental masks | `partial` | Eight deterministic mask formulas and one-batch query evaluation are on `main`. | Install the composed production query so normal/visibility are valid everywhere; add debug overlays, cursor probes, and runtime distribution counters. |
| GV-CLOD-07 Ambient effects | `partial` | River mist and sunbeam motes are on `main`. | Add rapid droplets, calm-water rise rings, dew/frost accents, quality policies, and cumulative ambience performance evidence. |
| GV-CLOD-08 Ground debris | `pending` | No grouped GPU debris ring found. | Implement one toroidal compute/indirect system for pebbles, twigs, bark, litter, and gravel; prove no walking seam. |
| GV-CLOD-09 Biome visual state | `partial` | Shared season, wetness, glacial murkiness, morning mist, pollen, and frost state exist; water, mist, and motes consume parts of it. | Route terrain, grass, understory, trees, dew/frost, and bloom; add authoring controls and seasonal acceptance. |
| GV-CLOD-10 QA/rollout | `partial` | Water W4 and glacial capture tooling exist. | Add river-detail, atmosphere, ground-detail, time-of-day, movement, integrated-GPU, and cumulative performance acceptance. |

## P0 — Production EnvironmentQuery composition

This is the next shared architecture PR after PR #196 is validated or while it remains independently reviewable.

- [x] Hydrology authority adapter.
- [x] Live terrain height/normal/material adapter.
- [x] Live sun-visibility atlas adapter.
- [x] Allocation-reusable batch buffers and field masks.
- [x] Batched environmental-mask consumption.
- [ ] Create one composed query in the application composition root.
- [ ] Order ownership as hydrology base -> terrain decorator -> sun-visibility decorator.
- [ ] Preserve real sample-size hints through every layer.
- [ ] Expose the composed query through runtime state rather than creating private instances.
- [ ] Route ambience-mask production through the composed query.
- [ ] Route river dressing and CPU stone fallback through the composed query.
- [ ] Add source, validity, revision, and cell-size debug probes.
- [ ] Add integration tests proving all requested fields come from the correct owners.
- [ ] Add an edit test proving terrain revision invalidates scalar terrain reuse.
- [ ] Add a sun-atlas update test proving visibility revision changes without rebuilding hydrology.
- [ ] Prove far hints do not trigger fine hydrology tile construction.

Exit gate:

- normal, material, water, river, and visibility can all be valid in normal gameplay;
- scalar and batch values agree;
- no new per-frame allocation hot path;
- no authority is sampled when its field is not requested.

## P1 — Safe gravel-bed integration and braided reach

- [ ] Extend the deterministic bar result with bounded `elevationOffsetM`.
- [ ] Apply the offset inside the carved-bed stage, not as render-only displacement.
- [ ] Clamp against minimum wet depth, water Y, local banks, and continuity reserve.
- [ ] Preserve the traced channel as authority; never replace it with a sine centerline.
- [ ] Keep lakes unchanged unless a separate delta/sandbar mode is explicitly enabled.
- [ ] Publish one bar mask to terrain material, vegetation suppression, cobbles, and water breakup.
- [ ] Add counters for candidates, accepted bars, rejected continuity, rejected depth, and rejected bank safety.
- [ ] Add cobble candidates, accepted, visible, underwater, shore, rapid, and rejection-reason counters.
- [ ] Add deterministic close and aerial braided-reach captures.
- [ ] Gate acceptance on non-zero underwater cobbles after convergence.
- [ ] Prove no floating cobbles and carved-bed seating.

Exit gate:

- river continuity remains 100%;
- at least one deterministic reach visibly splits around emergent bars;
- no dry wall blocks the main channel;
- river-detail cost remains inside the plan budget.

## P2 — Finish water reflection policy

After PR #196:

- [ ] Keep current SSR for near water.
- [ ] Keep reduced-step SSR for current middle clipmap levels as a fallback policy.
- [ ] Add the intended short far-summary terrain/occupancy march for middle distance.
- [ ] Use five to eight growing steps and the existing far terrain/visibility data.
- [ ] Include large-prop overlay once Workstream 5 exists.
- [ ] Use analytic sky/atmosphere reflection for far water.
- [ ] Add reflection-tier debug output.
- [ ] Measure full SSR, reduced SSR, far-summary middle tier, and far analytic fallback separately.

Exit gate:

- middle tier is cheaper than near SSR;
- distant terrain can interrupt reflected sky without another scene render;
- no readback and no extra full-scene reflection pass.

## P3 — Large-prop occlusion overlay

- [ ] Define compact height, occupancy, validity, and revision storage.
- [ ] Include large and hero boulders only in the first slice.
- [ ] Build conservative footprints from stable transforms and bounds.
- [ ] Update dirty cells only.
- [ ] Keep old valid overlay live until replacement is ready.
- [ ] Integrate with far sun visibility.
- [ ] Integrate with middle-distance water reflection.
- [ ] Integrate as soft mist density clipping.
- [ ] Add terrain-versus-prop and stale-validity debug modes.

Exit gate:

- hero boulders affect far lighting/reflection without terrain edits;
- no full per-frame rebuild;
- no visible pop caused by overlay lag.

## P4 — Remaining ambience

- [x] Camera-local river mist prototype.
- [x] Sunbeam motes with live controls.
- [ ] Rapid splash droplets with deterministic sources and shader lifetime/ballistic arc.
- [ ] Optional rapid-rock spray after prop overlay exists.
- [ ] Calm-water rise rings placed by hydrology and excluded from rapids/shore shallows.
- [ ] Shader-only dew sparkle first.
- [ ] Shared frost-mask tint first.
- [ ] Off/low/high policies for every effect.
- [ ] Integrated-GPU defaults with transparent layers disabled or reduced.
- [ ] Cumulative mist + motes + droplets + rings measurement.

Exit gate:

- combined ambience render delta `<= 0.50 ms p95`;
- CPU update `<= 0.20 ms p95`;
- zero gameplay readbacks;
- no effect appears outside its deterministic mask.

## P5 — GPU ground debris

- [ ] One toroidal compute ring, not one grid per debris class.
- [ ] Grouped append buffers and indirect arguments.
- [ ] Tiny cobbles, flat pebbles, twigs, bark chips, litter clusters, and gravel patches.
- [ ] Material, biome, hydrology, construction, and path exclusion in compute.
- [ ] Wet response near water.
- [ ] No individual shadows.
- [ ] Dithered distance fade.
- [ ] Debug counts and rejection reasons.
- [ ] Walking ring-seam acceptance.

Exit gate:

- forest and meadow floors no longer read unnaturally clean;
- no visible ring boundary;
- CPU update remains near zero after initialization.

## P6 — Complete biome-state routing

- [ ] Terrain seasonal tint and snowline.
- [ ] Grass seasonal green/dry response.
- [ ] Understory and tree seasonal color.
- [x] Mote pollen/frost mode foundation.
- [ ] Dew and frost strengths.
- [ ] Flower bloom.
- [ ] Compact look-development GUI with reset/export.
- [ ] Verify consumers do not recompute private season curves.
- [ ] Audit tone mapping, color conversion, exposure, vignette, grain, and grade before adding post effects.

Exit gate:

- fixed seasonal checkpoints change all participating systems coherently;
- default values preserve existing non-glacial scenes.

## P7 — Final acceptance and closeout

- [ ] Extend the normal `infinite-islands` battery rather than relying on toy scenes.
- [ ] River detail: close/aerial braid, underwater cobbles, shore/bar transition, rapid effects.
- [ ] Atmosphere: shaded/sunlit mist, shaft/mote alignment, time-of-day transition.
- [ ] Ground detail: forest, river bar, meadow, movement seam.
- [ ] Water: clear/glacial A/B, deep lake, shallow river, rapid, glitter, scatter debug.
- [ ] Feature-off/feature-on matrix.
- [ ] Static/moving matrix.
- [ ] High/performance/integrated policy matrix.
- [ ] Fresh/reuse acceptance matrix.
- [ ] Zero uncaptured WebGPU errors.
- [ ] Zero normal-gameplay GPU readbacks.
- [ ] Existing W4 water acceptance remains green.
- [ ] Record exact commands, URLs, poses, reports, screenshots, and deltas here.

## Ordered remaining PR sequence

1. PR #196 — physical glacial water scatter and glitter — open, validation required.
2. `feat(clod-poc): install composed environment query`.
3. `debug(clod-poc): visualize environment query sources and validity`.
4. `feat(clod-poc): carve safe gravel bars and braided reaches`.
5. `test(clod-poc): accept braided rivers and underwater cobbles`.
6. `feat(clod-poc): add far-summary water reflection tier`.
7. `feat(clod-poc): add large-prop occlusion overlay`.
8. `feat(clod-poc): add rapid splash droplets`.
9. `feat(clod-poc): add calm-water rise rings`.
10. `feat(clod-poc): add dew and frost material accents`.
11. `feat(clod-poc): add GPU ground-debris ring`.
12. `feat(clod-poc): complete biome visual-state routing`.
13. `test(clod-poc): add Glacial Valley cumulative acceptance`.
14. `docs(clod-poc): close Glacial Valley execution plan`.

Split a PR further whenever it crosses multiple authorities or cannot be safely reviewed and reverted as one unit.

## Pull-request rules

- Base each independent PR on current `main`.
- Synchronize again before opening when `main` moves.
- Do not merge draft PRs without their stated validation.
- Do not label unit-tested plumbing as visually accepted.
- Do not weaken continuity, error, or performance gates.
- YAML remains production authority; URL flags are temporary overrides.
- Do not introduce normal-gameplay GPU readbacks.
- Do not write water, stones, debris, or prop occlusion into CLOD page authority.
- Do not default-enable a transparent effect in its first rendering commit without headed evidence.
- Use squash merge for connector-generated incremental commits.
- Update this file after every merged slice.

## Current evidence limitation

The connected environment can create branches, commits, and PRs, but it currently cannot run the local Node/Vitest/Vite toolchain or headed browser/GPU acceptance. Draft PRs must remain draft until those checks are executed and evidence is attached. This limitation is not permission to reduce the gates.

## Completion rule

The Glacial Valley plan is fully done only when:

- every non-deferred workstream is implemented and accepted;
- deferred work has measured justification;
- existing W4 water acceptance remains green;
- new river, atmosphere, water, and ground-detail acceptance is green;
- zero WebGPU validation errors and zero normal-gameplay readbacks are recorded;
- this status file and the parent execution plan are updated to `COMPLETE` with final commit and report references.
