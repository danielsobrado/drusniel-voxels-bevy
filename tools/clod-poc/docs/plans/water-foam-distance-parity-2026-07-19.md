# Water Foam Distance Parity

Date: 2026-07-19

## Problem

The performance WebGPU material faded foam by discrete clipmap level while the
HQ WebGPU and WebGL materials kept full detail. That produced two avoidable
visual defects:

- foam could step at ring boundaries because the attenuation depended on
  `aLevel` rather than world/camera distance;
- switching between high and low water quality changed distant foam coverage
  even when hydrology, camera, and all foam strengths were identical.

## Runtime contract

One range in `config/water.yaml` owns close-range foam detail:

```yaml
visual:
  foam:
    detail_fade_start_m: 120.0
    detail_fade_end_m: 320.0
```

The range is normalized once. Negative and non-finite values fail to zero, and
a reversed/zero-width range receives a small positive width so no shader sees
undefined `smoothstep` edges.

All renderers evaluate the same continuous function:

```text
camera distance <= start: 1.0
start < camera distance < end: inverse smoothstep
camera distance >= end: 0.0
```

The fade multiplies the final shared foam coverage after coherent breakup and
sun-visibility attenuation. It therefore affects shoreline, bank, and rapid
sources equally.

## Renderer wiring

- **HQ WebGPU:** consumes the shared renderer-neutral range through a small TSL
  bridge and the canonical `buildWaterFoamNodes` path.
- **Performance WebGPU:** uses the same shared path with explicit uniforms and no
  `aLevel` fade.
- **WebGL:** receives the same normalized metre range through shader uniforms and
  evaluates camera XZ distance in GLSL.

The renderer-neutral state contains no `three/tsl` import. Material construction
publishes the resolved range; repeated identical publications allocate nothing
and do not advance its revision.

## Diagnostics

Foam runtime model revision 4 reports:

- `modelName = coherent-fbm-flow-sun-distance-v4`;
- distance authority `camera-distance-shared`;
- valid flag and revision;
- active start/end metres;
- the existing quality tier, coverage constants, zero CPU samples, and sun-atlas
  state.

Headed foam acceptance fails if the distance authority is absent or has an
invalid range.

## Verification

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run test -- \
  src/water/water_foam_distance.test.ts \
  src/water/water_foam_distance_config.test.ts \
  src/water/water_foam_distance_shader_contract.test.ts \
  src/water/water_foam_model.test.ts \
  src/water/water_foam_diagnostics.test.ts \
  tools/water-foam-runtime-contract.test.ts
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run water:foam:accept:matrix
```

The last command depends on PR #231's stable npm aliases. Before #231 merges,
run `tsx tools/water-foam-quality-matrix.ts --seed=1 --world=16` from
`tools/clod-poc`.

## Headed evidence still required

Capture one river while moving the camera smoothly across 120–320 m and confirm:

- no clipmap-ring foam step;
- high/low quality coverage remains within the existing cross-tier matrix;
- WebGL follows the same distance envelope;
- no uncaptured GPU errors or material churn regression.
