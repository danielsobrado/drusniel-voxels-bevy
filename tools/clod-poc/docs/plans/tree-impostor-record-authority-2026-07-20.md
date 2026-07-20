# Tree Impostor Record Authority

Status: draft implementation; native and headed verification pending.

## Problem

The GPU tree candidate pass already derives competition-aware morphology once and writes the same six-`vec4` instance record to visible and shadow buffers.

The base impostor material consumes that record for:

- age-layer interpolation;
- lean and crown bias;
- crown width and flattening;
- health tint;
- foliage retention;
- color and prepass masks.

The impostor wrapper then sampled the canonical forest-detail competition channel and applied a second response only to impostors:

- additional age reduction;
- additional health loss;
- additional crown compression;
- additional foliage rejection.

That made a fixed tree change silhouette, density, age, and color at the far-mesh to impostor boundary.

## Fixed authority

```text
GPU candidate acceptance
  -> derive competition-aware morphology0/1/2 once
  -> write the same record to visible and shadow buffers
  -> far mesh consumes record
  -> impostor base consumes record
  -> prepass consumes the same position and mask
```

The live forest-detail competition texture remains available for the explicit `treeMorphologyEvidence=competition` diagnostic view. It no longer changes production geometry or occupancy.

## Scope

This change:

- removes the impostor-only competition deformation and foliage-retention pass;
- keeps record-driven age, width, flattening, lean, crown bias, health, and foliage density;
- keeps the competition debug overlay;
- publishes counters proving record authority and zero secondary response;
- adds source contracts for visible, shadow, far, impostor, and prepass parity.

This change does not:

- change tree placement or stable identities;
- change competition derivation formulas;
- change the 96-byte instance layout;
- rebake impostor atlases;
- change WebGL tree materials;
- change water, dressing, custom props, or large-prop occlusion;
- claim full MORPH-7 completion.

## Diagnostics

```text
tree_morphology_record_authority = 1
tree_impostor_secondary_competition_response = 0
tree_impostor_competition_authority = 1 when diagnostic field is available
tree_impostor_evidence_mode = 0 off, 1 age, 2 competition
```

## Native verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/trees/morphology/impostor_competition.test.ts `
  src/trees/morphology/impostor_competition_contract.test.ts `
  src/trees/morphology/tree_lod_morphology_authority.test.ts `
  src/trees/morphology/impostor_age_layers.test.ts `
  src/trees/tree_ring_impostor_node_material.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Use deterministic `tree-morphology-lod-orbit` and `tree-morphology-forest-dolly` poses in WebGPU.

For fixed identities, verify:

- no width or height snap at far-to-impostor transition;
- no foliage-density pop;
- no health-color pop;
- root position remains fixed;
- prepass and color pass retain identical coverage;
- shadow silhouettes remain aligned with visible crowns;
- `treeMorphologyEvidence=competition` still visualizes the canonical field without changing geometry;
- normal gameplay tree readbacks remain unchanged;
- frame p95 regression remains within 5%.

The PR remains draft until these checks pass. Do not hide a failed handoff by widening LOD crossfade bands or weakening visual gates.
