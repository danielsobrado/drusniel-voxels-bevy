# Water Foam WebGL Acceptance

Date: 2026-07-19

## Purpose

Prove that the real WebGL fallback renders the accepted coherent foam model.
Source parity alone is insufficient because renderer selection, shader compilation,
uniform synchronization, or debug routing can still fail at runtime.

## Lane

The existing foam visual runner now accepts:

```bash
--renderer=webgpu
--renderer=webgl
```

WebGPU remains the default, so the existing high/low quality matrix is unchanged.
The WebGL lane forces both:

```text
renderer=webgl
webgpuSelection=0
```

The water debug API reports the backend created by the application. Acceptance
fails before capture if the runtime backend does not match the requested backend.
The report records requested renderer, actual renderer, and forced query values.

## Shared visual proof

WebGL uses the same deterministic infinite-islands scenarios and image metrics:

- a real rapid/bed step;
- a smooth fast river that must remain mostly clear;
- a lake shoreline;
- body-mask, depth, two temporal foam frames, and final shaded output;
- coverage, connected-component, stripe, speckle, temporal, and lighting gates.

No second capture implementation is introduced. Camera-pose reuse through
`--pose-report` remains available.

## Runtime contract

The WebGL runtime contract verifies:

- current foam model revision;
- requested high/low configuration tier;
- accepted coverage and coherent-pattern constants;
- river-shore and shoreline-distance attenuation;
- multiplicative speed × drop × river rapid authority;
- zero CPU foam-field samples.

It intentionally does **not** require a valid sun-visibility atlas. WebGL does not
consume the TSL atlas bridge; requiring it would prove an unrelated resource and
could hide a renderer-routing mistake.

## Run

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run test -- \
  tools/water-foam-renderer-profile.test.ts \
  tools/water-foam-webgl-runtime-contract.test.ts \
  tools/water-foam-webgl-wiring-contract.test.ts \
  tools/water-foam-visual-metrics.test.ts \
  tools/water-foam-visual-contract.test.ts
npm --prefix tools/clod-poc run build
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-visual-acceptance.ts \
  --renderer=webgl --quality=high --seed=1 --world=16 \
  --out=shots/water/foam-acceptance/webgl
```

## Evidence required

Before marking WebGL foam parity complete, attach:

- `shots/water/foam-acceptance/webgl/report.json`;
- rapid, smooth-river, and lake-shore final/foam frames;
- zero browser shader/program errors;
- confirmation that `renderer.actual` is `webgl`;
- a comparison against the canonical HQ pose report.
