# Glacial Valley dressing grass-contact consumer — 2026-07-21

## Goal

Consume the accepted-dressing contact field from PR #293 through the existing grass-contact material and terrain-blending policy.

This closes the visible half of ecological-dressing Stage 7 without adding a second grass implementation.

## Dependency

```text
PR #293 producer
  -> this PR consumer
```

Squash-merge #293 first, retarget this PR to `main`, then rerun the complete contact, dressing, grass, stone, and terrain suites.

## Composition

The existing stone field remains authoritative for:

- large and medium standalone stones;
- core suppression;
- outer trample;
- directional grass splay.

The dressing field contributes:

- radial suppression;
- radial trample;
- terrain dirt tint through the existing contact tint path.

The combined policy is:

```text
suppress = max(stone.suppress, dressing.suppress)
trample = max(stone.trample, dressing.trample)
splay = stone.splay
flatten = max(suppress, trample)
dirt = max(suppress, trample)
```

The existing live `grass contact > enabled` uniform gates both sources.

## Resource lifecycle

WebGPU grass startup explicitly registers the dressing-contact `StorageBufferAttribute` before creating grass materials.

This registration is independent of GPU dressing placement eligibility. Therefore:

- normal GPU dressing can write the field;
- `dressingGpu=0` can still compile a zero-valued consumer field safely;
- a temporarily missing producer leaves the field disabled through its runtime uniform;
- material construction does not depend on asynchronous dressing initialization order.

Terrain materials may reference the same attribute earlier; Three's storage-node path creates the renderer resource, while the explicit startup registration guarantees the compute writer can retrieve the same backend buffer.

## Visual behaviour

Grass:

- blade height shrinks toward the configured minimum in contact cores;
- blades flatten through the existing contact interaction;
- standalone stones preserve directional splay;
- dressing classes do not invent an incorrect radial splay direction.

Terrain:

- the existing near-field dirt tint appears around accepted physical dressing;
- tint retains the existing 72–94 m camera fade;
- no new terrain material or texture is introduced.

## Performance contract

- one additional uint storage read in WebGPU grass/terrain contact graphs;
- no new draw call;
- no new render pass;
- no per-frame CPU proximity scan;
- no per-blade CPU data;
- no GPU readback;
- no material recreation when dressing refreshes;
- grass candidate generation remains unchanged in this slice.

## Required tests

```powershell
npm --prefix tools/clod-poc test -- `
  src/grass/dressing_grass_contact_consumer.test.ts `
  src/runtime/vegetation/grass_dressing_contact_startup.test.ts `
  src/ecology/dressing/gpu/dressing_grass_contact_config.test.ts `
  src/ecology/dressing/gpu/dressing_grass_contact_compute.test.ts `
  src/ecology/dressing/gpu/dressing_grass_contact_field.test.ts `
  src/gpu/grass_node_material.test.ts `
  src/rendering/terrain_material_webgpu.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Dawn must compile grass and terrain NodeMaterials with both contact storage sources.

## Headed acceptance

Use `scene=infinite-islands`, WebGPU, `dressing=1`, `dressingGpu=1`, grass contact enabled, and deterministic poses containing:

- dead logs and paired stumps;
- large talus;
- shallow-river cobbles;
- wet shoreline stones;
- large and small driftwood;
- standalone stones beside dressing stones;
- litter/fern-only controls.

Verify:

- grass no longer grows through accepted physical dressing footprints;
- contact transitions are soft rather than circular cut-outs;
- standalone stone splay remains unchanged;
- terrain dirt tint appears under physical dressing but not litter or ferns;
- disabling the live grass-contact switch removes both stone and dressing response;
- moving across a dressing refresh does not detach the field from instances;
- no new draw, pass, material rebuild, or readback appears;
- render p95 regression over #293 remains `<= 0.08 ms`;
- total #293 plus consumer GPU regression remains `<= 0.28 ms p95`.

Also run WebGPU with `dressingGpu=0` and verify grass/terrain compile and render with a zero dressing field.

## Scope boundary

This PR does not:

- reject grass candidates in compute;
- reduce generated/accepted grass counters;
- add log-axis directional splay;
- change grass densities or the dressing field policy;
- add CPU/WebGL dressing-contact parity;
- add contact collision or gameplay semantics.

Compute-side rejection is intentionally deferred. The material path must first prove that visual contact is valuable and that the extra generated blades are a measurable cost.
