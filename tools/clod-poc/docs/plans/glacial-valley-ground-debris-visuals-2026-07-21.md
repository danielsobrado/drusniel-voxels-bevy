# Glacial Valley ground-debris visuals — 2026-07-21

## Goal

Close the renderer half of GV-CLOD-08 without creating another placement ring.

The merged GPU ecological-dressing authority already owns deterministic placement, grouped append buffers, 29 classes, 87 indirect groups, hydrology/canopy sampling, and zero-readback rendering. The missing part is visual specialization for the smallest ground classes.

## Scope

This slice owns exactly:

- leaf litter;
- needle litter;
- twig clusters;
- bark-chip clusters;
- small talus;
- river cobbles;
- wet-stone clusters.

It does not change candidate placement, identities, density, persistence, hydrology, construction exclusion, group layout, indirect arguments, or CPU fallback.

## Previous renderer problem

The grouped renderer used:

- generic horizontal circles for most litter, twig, bark, and patch families;
- generic crossed vertical cards for their far LOD;
- one flat class colour;
- one mostly static roughness value;
- no stable fade before the 110 m dressing-ring edge.

That made debris read as decals or upright billboards and exposed the camera-local ring boundary.

## New contract

### Geometry

- litter and bark use small overlapping ground-aligned fragments;
- needle litter uses narrower ground strips;
- twigs use several thin grounded strips;
- talus, cobbles, and wet stones use low-poly seated pebble variants;
- all three LODs remain grounded;
- the far LOD never becomes a crossed vertical billboard;
- geometry remains shared per class and LOD, never per instance.

### Material

- `rotation_environment.z` remains the canonical wetness input;
- wet debris darkens and becomes smoother;
- `rotation_environment.w` provides stable low-amplitude colour variation;
- the same stable value drives dithered distance fade;
- fade completes at or before the existing 110 m active radius;
- no individual debris shadows are enabled.

### Performance

- the existing 29 class × 3 LOD indirect grouping remains unchanged;
- no new render pass;
- no new placement grid;
- no per-instance CPU transform;
- no gameplay readback;
- no frame-loop scene traversal.

## Required verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/gpu/ground_debris_visuals.test.ts `
  src/ecology/dressing/gpu/ground_debris_geometry.test.ts `
  src/ecology/dressing/gpu/ground_debris_render_contract.test.ts `
  src/ecology/dressing/gpu/layouts.test.ts `
  src/ecology/dressing/gpu/runtime_contract.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Use `scene=infinite-islands`, WebGPU, `dressing=1`, and `dressingGpu=1`.

Capture deterministic poses for:

1. broadleaf forest floor;
2. conifer forest floor;
3. meadow edge;
4. shallow river cobbles;
5. wet shore stones;
6. a walking path crossing the dressing-ring edge.

Verify:

- litter, needles, twigs, and bark read as grounded clusters rather than circles;
- no far debris class becomes an upright crossed card;
- cobbles and stones sit on the terrain with no visible pivot gap;
- wet classes darken and polish gradually with the existing wetness channel;
- the ring edge is hidden during straight and diagonal walking;
- draw-group count remains 87;
- `dressing_cpu_candidate_generation = 0`;
- `dressing_gpu_readbacks = 0`;
- high-quality debris render delta remains `<= 0.45 ms p95`.

## Honest boundary

This slice uses procedural low-poly geometry and class colours. It does not add texture arrays, normal maps, terrain-material blending, far-sun visibility, seasonal litter colour, grass contact suppression, or new debris classes. Those should remain separate measured slices.
