# CPU Tree Accepted-Canopy Competition

Status: draft implementation; native and headed verification pending.

## Problem

The CPU tree fallback previously derived per-instance morphology before final spacing suppression.

Its competition input came from deterministic synthetic occupancy around the candidate position. Candidates later rejected by spacing could therefore influence:

- age;
- crown width;
- health;
- foliage density;
- crown opening direction.

The visible CPU tree set and the morphology competition set were not the same population.

## Fixed authority

```text
candidate generation
  -> terrain, ecology, species and stable identity
  -> deterministic priority sort
  -> final spacing suppression
  -> retained tree set
  -> accepted-crown spatial index
  -> competition pressure and opening direction
  -> final morphology derivation
```

Only retained trees contribute to CPU morphology competition.

## Competition contract

The sampler:

- indexes accepted crowns in deterministic 32 m cells;
- examines the fixed local 32 m competition radius;
- uses the retained species crown radius multiplied by instance scale;
- weights near, middle and outer distances at `1`, `2/3` and `1/3`;
- derives scalar pressure from accumulated retained crowns;
- derives open-light direction opposite the weighted neighbor vector;
- sorts records by the full two-word stable identity before indexing;
- fails fast on duplicate identities;
- returns an open-canopy sample for missing or isolated identities.

The sampler is built once per generated CPU footprint. Queries inspect only the surrounding nine spatial buckets rather than scanning every tree.

## Preserved contracts

This change does not alter:

- candidate positions;
- species selection;
- final spacing acceptance;
- priority order;
- stable identities;
- instance packing;
- GPU tree generation;
- shadow or impostor materials;
- forest-lighting textures;
- normal gameplay readback policy.

The CPU fallback remains deterministic for an identical footprint, settings, sampler and world seed.

## Honest boundary

This PR closes accepted-tree competition inside each generated CPU footprint. It does not yet make the CPU fallback consume the streamed canonical forest competition texture across footprint boundaries.

The WebGPU ring still derives scalar crown pressure from its current deterministic occupancy sampler. Binding the canonical forest-detail competition texture into tree compute remains a separate PR because it requires dynamic texture lifecycle and bind-group replacement.

## Native verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/trees/morphology/accepted_competition.test.ts `
  src/trees/tree_instances_accepted_competition.test.ts `
  src/trees/tree_instances_competition_authority_contract.test.ts `
  src/trees/tree_instances.test.ts `
  src/trees/morphology/derive.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Use the CPU fallback in deterministic clearing-edge and dense-forest poses.

Verify:

- isolated trees retain wider, healthier crowns;
- dense accepted groups produce narrower and less dense crowns;
- crown bias points toward visible openings;
- rejected candidates do not affect retained-tree morphology;
- regeneration produces identical identities and morphology;
- page generation time does not regress materially;
- root contacts and placement counts remain unchanged.

Do not compensate for a performance regression by weakening spacing or morphology formulas.
