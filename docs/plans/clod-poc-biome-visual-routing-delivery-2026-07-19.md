# CLOD-POC Biome Visual Routing — Delivery Status

> Updated: 2026-07-19  
> Target: `tools/clod-poc`  
> Status: **IMPLEMENTED IN STACKED PRS — local and headed acceptance pending**

## Delivered scope

The requested biome visual-state consumers are implemented against the existing shared `BiomeVisualState` authority:

- terrain seasonal tint and altitude snowline;
- grass green, dry, autumn, dew, and frost response;
- tree seasonal foliage colour, dew, and frost response;
- understory seasonal foliage colour, dew, frost, and flower bloom response;
- live look-development GUI with reset and deterministic YAML export;
- WebGPU/TSL and WebGL material paths;
- deterministic infinite-islands seasonal acceptance tooling.

No second season clock, private interpolation curve, gameplay GPU readback, geometry rebuild, or extra render pass was introduced.

## Pull-request stack

### PR #221 — merged

`feat(clod-poc): route biome state into terrain and vegetation materials`

Initial shared-state material routing for terrain, grass, trees, and understory.

### PR #224 — merged

`feat(clod-poc): add biome look-development controls and export`

Transient live overrides, reset, refresh, and YAML export. Canonical YAML remains production authority.

### PR #228 — open draft

`fix(clod-poc): complete biome material WebGL parity`

- custom WebGL tree and understory shader support;
- tree-impostor output injection;
- valid GLSL preamble ordering;
- clamped terrain snow upness;
- fail-closed unsupported shader handling.

### PR #233 — open draft, stacked on #228

`refactor(clod-poc): harden biome material routing lifecycle`

- separates state, shader, and runtime responsibilities;
- replaces whole-scene scans every 30 frames with named vegetation-root scans every 120 frames;
- deduplicates shared materials;
- removes disposed materials from the active update set;
- safely reactivates reused materials without decorating them twice;
- preserves immediate terrain material creation and swap hooks;
- adds streamed-material lifecycle regression coverage.

### PR #235 — open draft, stacked on #233

`test(clod-poc): accept seasonal biome material routing`

- exact winter, spring, summer, and autumn YAML keyframes;
- identical infinite-islands seed and camera pose;
- isolated terrain, grass, tree, and understory captures;
- far canopy included in the tree domain;
- per-domain image masks and visual deltas;
- runtime state-value gates;
- flower-bloom gate;
- zero WebGPU-error gate;
- JSON report and deterministic screenshots.

## Merge order

1. Validate and merge #228.
2. Retarget #233 to `main`, validate, and merge.
3. Retarget #235 to `main`, run the headed battery, attach evidence, and merge.

Use squash merge for each connector-generated branch.

## Required local validation

```powershell
npm --prefix tools/clod-poc run typecheck

npm --prefix tools/clod-poc run test -- `
  src/environment/biome_visual_material_routing.test.ts `
  src/environment/biome_visual_material_runtime.test.ts `
  src/environment/biome_visual_acceptance_api.test.ts `
  tools/biome-visual-acceptance-contract.test.ts

npm --prefix tools/clod-poc run build
```

## Required headed acceptance

Run from the CLOD-POC directory so the harness can start Vite with the correct working directory:

```powershell
Push-Location tools/clod-poc
npx tsx tools/biome-visual-acceptance.ts
Pop-Location
```

Expected output:

- `shots/biome-visual/acceptance/winter/*.png`;
- `shots/biome-visual/acceptance/spring/*.png`;
- `shots/biome-visual/acceptance/summer/*.png`;
- `shots/biome-visual/acceptance/autumn/*.png`;
- `shots/biome-visual/acceptance/report.json`.

The report must pass:

- resolved keyframe values;
- terrain winter/summer change;
- grass winter/summer change;
- trees summer/autumn change;
- understory summer/autumn change;
- bloom spring/autumn change;
- non-empty per-domain masks;
- zero uncaptured WebGPU errors.

PR #228 also requires a WebGL run that visibly verifies mesh trees, single-view impostors, and blended impostors without shader compilation errors.

## Still pending

- actual TypeScript, Vitest, and Vite build output from a local checkout;
- headed WebGPU report and captures;
- headed WebGL tree-impostor evidence;
- frame CPU p95 comparison proving the lifecycle hardening removes periodic scene-scan spikes;
- final update of the parent Glacial Valley status after the stack is merged and accepted.
