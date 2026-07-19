# Water Foam Renderer Matrix

Date: 2026-07-19

## Purpose

Prove that WebGPU and WebGL render the same accepted foam behavior at the same
world locations. Independent passes are not enough: both renderers can satisfy
broad visual limits while selecting different rapids, using different water
masks, or producing materially different structure and animation.

## Four deterministic legs

The matrix runs in this order:

1. WebGPU high quality;
2. WebGPU low quality;
3. WebGL high quality;
4. WebGL low quality.

WebGPU-high is the only leg allowed to discover camera poses. Its report becomes
the canonical pose authority for the other three legs through `--pose-report`.
The matrix parses every report and independently asserts exact pose parity.

Each child receives explicit `--renderer` and `--quality` arguments. The report
must confirm both requested and actual renderer identities plus the requested
quality. Existing report files are deleted before each child starts so a failed
run cannot accidentally reuse stale evidence.

## Gates

Every leg must first pass its own visual, runtime, and renderer-specific error
contracts. Cross-leg comparison is skipped when either input leg failed.

The combined matrix then requires:

- WebGPU high/low quality parity;
- WebGL high/low quality parity;
- WebGL/WebGPU parity at high quality;
- WebGL/WebGPU parity at low quality.

Renderer parity measures:

- water-pixel ratios for rapid, smooth-river, and lake-shore scenes;
- rapid active and mean-coverage ratios;
- rapid connected-component, stripe, and isolated-speckle deltas;
- excess smooth-river foam;
- lake-shore coverage delta;
- lit-foam mean and variation;
- temporal motion ratio and binary-IoU delta.

Renderer limits are intentionally wider than quality-tier limits. WebGL uses a
GLSL analytic-noise path while WebGPU uses the TSL/shared texture path, so exact
pixels are not expected. The limits still reject changed water masks,
disappearing or excessive rapids, renderer-only ribbons, flat lighting, and
unrelated animation.

## Evidence layout

```text
shots/water/foam-renderer-matrix/
  webgpu/high/report.json
  webgpu/low/report.json
  webgl/high/report.json
  webgl/low/report.json
  renderer-matrix-report.json
```

The combined report is written before the process fails, including child status,
report presence, pose parity, individual failures, quality parity, and renderer
parity measurements.

## Run

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run test -- \
  tools/water-foam-renderer-parity-contract.test.ts \
  tools/water-foam-renderer-matrix-wiring.test.ts \
  tools/water-foam-quality-parity-contract.test.ts \
  tools/water-foam-pose-parity.test.ts
npm --prefix tools/clod-poc run build
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-renderer-matrix.ts \
  --seed=1 --world=16
```

A stable npm alias should be added only after the matrix PR and the separate
WebGL-command PR are merged, avoiding package-file overlap while both are open.
