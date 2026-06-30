# CLOD-POC Water / Fable5 Alignment — Jira Execution Plan

## Scope

This plan is for `tools/clod-poc` first. Bevy/Rust work can continue in parallel, but CLOD-POC is the reference implementation for Fable5-style water parity.

The CLOD-POC already has important Fable5-aligned pieces: a camera-following water clipmap, hydrology-driven flow fields, shore/river foam, refraction and reflection debug modes, river parity scenes, wetness masks, deep ocean support, and water QA scripts. This plan turns the remaining work into executable Jira points.

## Global Rules

```text
G1. Water is a visual/runtime layer only.
G2. Water never feeds CLOD page source meshes, meshoptimizer, page borders, LOD selection, colliders, or validation.
G3. Terrain/CLOD ownership and water ownership must stay explicitly separated.
G4. All visual/performance tuning must be config-driven through YAML or URL/debug flags.
G5. WebGL and WebGPU paths must degrade safely and keep the same debug contract.
G6. Every claim of parity needs a QA shot, probe, test, or metric.
```

## Epic WATER-100 — Water / CLOD Ownership Boundary

### WATER-101 — Add explicit water ownership stats

**Priority:** P0

Add a small ownership module that reports which water renderer owns the visible water layer: `clipmap`, `deep_ocean`, `hidden`, or `fallback`. `terrain_clod` must always remain zero.

**Acceptance criteria**

- Water ownership stats are visible in debug info.
- A helper validates that water never becomes CLOD-page-owned.
- Tests cover enabled, hidden, and invalid terrain-owned states.

### WATER-102 — Add clipmap runtime stats

**Priority:** P0

Expose per-level clipmap stats: level count, visible level count, draw index count, triangle count, cell size, and rect.

**Acceptance criteria**

- `waterDebugInfo()` includes clipmap stats.
- Disabled water reports zero visible levels and zero triangles.
- Enabled water reports deterministic per-level stats after update.

## Epic WATER-200 — Hydrology / Flow Alignment

### WATER-201 — Audit hydrology flow outputs

**Priority:** P0

Confirm flow direction, speed, drop, body mask, depth, and waterY are stable and finite for lakes, rivers, and dry areas.

**Acceptance criteria**

- Existing `WaterField` tests remain green.
- Add focused tests for river flow speed/drop thresholds used by foam.
- Debug mode `flow` remains camera-shot compatible.

### WATER-202 — Flow-driven visual tuning pass

**Priority:** P1

Tune ripple advection, river foam, lake stillness, and shore foam to be closer to Fable5's flow-aware style.

**Acceptance criteria**

- Lake shots stay calm.
- River shots show directional flow and rapid foam only when fast/steep.
- Config defaults remain simple and documented in `config/water.yaml`.

## Epic WATER-300 — Reflection / Refraction Alignment

### WATER-301 — Reflection policy cleanup

**Priority:** P1

Make the existing fake/SSR reflection config a clear policy: fake sky/terrain fallback default, SSR optional and debug-gated.

**Acceptance criteria**

- Config names and debug info expose selected mode.
- SSR misses fall back safely.
- WebGL and WebGPU maintain compatible behavior.

### WATER-302 — Refraction validation pass

**Priority:** P1

Verify screen resource/refraction debug shots do not show invalid dry-area refraction, black holes, or out-of-bounds samples.

**Acceptance criteria**

- `water:shot:refraction` remains deterministic.
- Debug mode `refraction` shows valid water-only output.

## Epic WATER-400 — Caustics Upgrade

### WATER-401 — Keep current procedural caustics as baseline

**Priority:** P1

The current procedural caustics are useful and cheap. Keep them as the baseline while preparing a future compute-baked path.

**Acceptance criteria**

- Existing caustics config remains backward compatible.
- Caustics disabled path is visually unchanged.

### WATER-402 — Add compute-caustics design stub

**Priority:** P2

Add design notes and interface shape before implementing compute caustics.

**Acceptance criteria**

- No runtime behavior change.
- WebGPU-only compute path remains opt-in when implemented.

## Epic WATER-500 — Interactive Displacement / Ripples

### WATER-501 — Define CLOD-POC interaction model

**Priority:** P1

CLOD-POC does not need Bevy buoyancy, but it can support visual player ripples. Define whether this is particle/texture/displacement based.

**Acceptance criteria**

- No fake physics claim without visual implementation.
- Player ripple QA scene exists before implementation.

## Epic WATER-600 — Wet Margins

### WATER-601 — Keep river terrain wetness mask first-class

**Priority:** P1

The existing wetness mask should be treated as the Fable5-style wet-margin implementation for CLOD-POC.

**Acceptance criteria**

- Wetness mask resolution is configurable.
- Water debug info exposes whether wetness mask was built.

## Epic WATER-700 — QA / Performance Gates

### WATER-701 — Water shot suite is the gate

**Priority:** P0

The existing water scripts are the immediate parity gate.

**Required commands**

```bash
npm run water:find
npm run water:probe
npm run water:shot -- --scene all --out shots/water/verify
npm run water:verify
```

### WATER-702 — Add machine-readable water stats

**Priority:** P0

Expose ownership, clipmap, reflection/refraction mode, and wetness-mask state in debug APIs and/or shot metadata.

**Acceptance criteria**

- Stats are available without image analysis.
- Shot tools can include stats in output JSON.

## Recommended Execution Order

```text
1. WATER-101 — Explicit water ownership stats
2. WATER-102 — Clipmap runtime stats
3. WATER-201 — Flow output audit
4. WATER-701 — Confirm water shot gate
5. WATER-702 — Machine-readable water stats
6. WATER-202 — Visual flow tuning pass
7. WATER-301 — Reflection policy cleanup
8. WATER-302 — Refraction validation pass
9. WATER-601 — Wetness mask debug/stat exposure
10. WATER-501 — Visual interaction/ripple design
11. WATER-401 — Caustics baseline lock
12. WATER-402 — Compute caustics design stub
```

## Definition Of Done

```text
1. Code is under tools/clod-poc.
2. Changes are config/debug driven.
3. Water remains outside CLOD page source ownership.
4. Tests or water QA scripts cover the change.
5. Debug output exposes enough data to validate without guessing from screenshots only.
```
