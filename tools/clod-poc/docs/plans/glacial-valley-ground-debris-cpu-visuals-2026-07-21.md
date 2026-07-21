# Glacial Valley ground-debris CPU visual parity — 2026-07-21

## Goal

Keep the WebGL and explicit CPU dressing fallback visually compatible with the grounded GPU debris renderer from PR #285 without duplicating placement, class, or geometry definitions.

## Scope

The CPU fallback reuses:

- `GROUND_DEBRIS_CLASSES`;
- `groundDebrisVisualProfile(...)`;
- `createGroundDebrisGeometry(classId, 0)`.

Owned classes:

```text
leaf_litter
needle_litter
twig_cluster
bark_chip_cluster
small_talus
river_cobbles
wet_stone_cluster
```

## Runtime contract

`CpuDressingSystem` remains the placement and instance-transform authority.

A subclass-owned resource adapter:

1. creates one shared geometry and one shared material for each owned class;
2. locates the CPU root `ecological-dressing`;
3. replaces only matching `dressing:<class>` mesh resources;
4. applies after the initial rebuild;
5. reapplies only after the same movement distance that can trigger a base rebuild;
6. disposes only the replacement resources it owns.

It does not scan the scene every frame.

## Visual contract

- litter, needles, twigs, and bark are grounded fragment clusters rather than circles;
- talus, cobbles, and wet stones use the same seated procedural geometry as GPU LOD0;
- debris does not cast individual shadows;
- wet-stone clusters use the profile's wet colour and roughness;
- other classes use the profile's dry colour and roughness;
- all materials remain opaque and depth-writing.

## Honest boundary

The current CPU instance record exposes transforms only. This slice therefore does not claim:

- per-instance wetness interpolation;
- per-instance stable colour variation;
- far-sun atlas sampling;
- ring-edge dither;
- GPU/CPU pixel identity;
- texture arrays or normal maps.

A separate stacked PR owns stable CPU ring-edge dither. Per-instance wetness should only be added after a compact CPU instance-colour/material contract is designed and measured.

## Required tests

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/ground_debris_cpu_resources.test.ts `
  src/ecology/dressing/dressing_cpu_ground_debris_contract.test.ts `
  src/ecology/dressing/gpu/ground_debris_visuals.test.ts `
  src/ecology/dressing/gpu/ground_debris_geometry.test.ts `
  src/ecology/dressing/dressing_runtime.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Run the same deterministic broadleaf-floor, conifer-floor, shallow-river, and wet-shore poses with:

```text
WebGPU: dressingGpu=1
CPU/WebGL fallback: dressingGpu=0
```

Verify:

- class silhouettes and ground seating match closely;
- no fallback debris returns to circles or upright cards;
- no debris receives an individual shadow;
- movement rebuilds retain the replacement resources;
- stationary frames perform no repeated root scan;
- CPU rebuild p95 does not regress by more than 0.20 ms;
- normal gameplay readbacks remain zero.

## Merge dependency

This slice is stacked on PR #285. Squash-merge #285 first, retarget this PR to `main`, then run the combined GPU and CPU dressing suites.
