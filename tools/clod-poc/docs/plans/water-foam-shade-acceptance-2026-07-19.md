# Water Foam Shade Acceptance

Date: 2026-07-19

## Purpose

Prove that the shared WebGPU foam authority responds to sun visibility without
changing hydrology, coherent noise, camera pose, or rapid selection between the
lit and shaded measurements.

## Method

The headed acceptance runner:

1. starts the deterministic infinite-islands foam profile;
2. discovers one real `rapid-bed-step` pose;
3. captures body-mask and depth evidence once;
4. forces the foam visibility input to `1.0` and captures foam/final frames;
5. forces the same input to `0.0` at the same camera and captures again;
6. restores the real GPU sun atlas in a fail-loud `finally` block;
7. evaluates both captures against one water-pixel mask;
8. gates the runtime foam model and live sun-atlas diagnostics as well.

The override is exposed only through the existing development/water-debug API.
The TSL bridge is dynamically imported when the acceptance control is called,
so normal gameplay and the WebGL startup path do not load it.

## Gate

The configured shade floor is `0.55`. Image-space mean coverage is allowed a
wider `0.35–0.82` ratio because the shader cap, 8-bit screenshots, and coherent
advection can shift aggregate measurements between captures.

The gate also requires:

- at least 1,000 water pixels;
- meaningful lit rapid foam;
- a measurable lit-to-shaded coverage drop;
- identical water-mask pixel counts;
- the current foam model revision and expected quality tier;
- zero CPU foam-field samples;
- a valid, non-sentinel GPU sun atlas;
- confirmed restoration of the real atlas after capture.

## Scope boundary

This proves **coverage response** only. Final shaded foam colour is recorded for
review but is not yet a pass/fail gate. WebGL does not consume the TSL sun atlas
and requires a separate headed renderer lane.

## Run

```bash
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-shade-acceptance.ts --quality=high --seed=1 --world=16
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-shade-acceptance.ts --quality=low --seed=1 --world=16
```

Evidence is written below `tools/clod-poc/shots/water/foam-shade-acceptance/`.
