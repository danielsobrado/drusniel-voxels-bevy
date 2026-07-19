# CLOD-POC Biome Visual Routing — Delivery Status

> Updated: 2026-07-19  
> Target: `tools/clod-poc`  
> Status: **RECOVERY PR OPEN — implementation prepared for `main`; local and headed validation pending**

## Integration correction

PR #228 reached `main`, but PR #233 was merged into the #228 feature branch and PR #235 was merged into the #233 feature branch. Their GitHub states are `merged`, but their lifecycle hardening and seasonal acceptance files did not reach `main`.

The recovery branch `agent/biome-visual-main-integration` starts from the current `main` commit and reapplies only the missing #233 and #235 files. It does not replay older branch history or overwrite newer unrelated work.

## Delivered scope in the recovery PR

- split biome routing into state, shader, and runtime modules;
- preserve the existing public import path;
- replace whole-scene scans every 30 frames with named vegetation-root scans every 120 frames;
- route the direct-child far-canopy material through the tree seasonal state;
- deduplicate shared materials and remove disposed materials from the active update set;
- bind late streamed vegetation materials without geometry rebuilds or GPU readbacks;
- expose an acceptance-only vegetation visibility API behind `acceptance=1`;
- capture winter, spring, summer, and autumn in `scene=infinite-islands`;
- gate terrain, grass, tree/far-canopy, understory, bloom, runtime state, and WebGPU errors;
- write deterministic screenshots and `report.json` under `shots/biome-visual/acceptance`.

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

## Required headed validation

```powershell
Push-Location tools/clod-poc
npx tsx tools/biome-visual-acceptance.ts
Pop-Location
```

The report must show:

- exact canonical values for all four seasonal keyframes;
- non-empty terrain, grass, tree/far-canopy, and understory visual deltas;
- visible spring-versus-autumn bloom change;
- zero uncaptured WebGPU errors for every seasonal navigation.

A separate WebGL smoke must verify mesh trees, single-view impostors, and blended impostors without shader compilation errors.

## Remaining evidence

- TypeScript typecheck output;
- focused Vitest output;
- Vite production build output;
- headed WebGPU seasonal report and screenshots;
- headed WebGL tree-impostor evidence;
- before/after frame CPU p95 confirming the periodic whole-scene scan is gone.
