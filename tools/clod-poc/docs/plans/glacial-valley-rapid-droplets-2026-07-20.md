# Glacial Valley rapid droplets — 2026-07-20

## Scope

This slice adds rapid-only airborne droplets to the existing camera-local river cascade particle overlay.

The implementation deliberately reuses the production river dressing sample reader and its EnvironmentQuery ownership, coarse sample hint, invalid-authority fail-closed behavior, and bounded emitter scan. It does not add another hydrology sampler, scan loop, render pass, or GPU readback.

## Behavior

Rapid droplets:

- require valid wet water;
- require the canonical rapid signal to exceed a configurable threshold;
- do not depend on cascade bed drop;
- inherit the canonical river flow direction;
- use deterministic cell, emission-tick, and droplet-channel hashes for origin, velocity, lifetime, and strength;
- follow an analytic ballistic arc;
- remain bounded by a fixed particle capacity;
- are disabled with the existing cascade-particle quality policy on performance and potato presets.

Existing cascade mist, cascade splash, and foam drift behavior remains intact.

## Configuration

`config/river_ambience.yaml` is the production authority for the complete cascade-particle state, including:

- `rapid_droplet_strength`;
- `rapid_droplet_threshold`;
- `rapid_droplets_per_emitter`;
- `rapid_droplet_gravity`.

The lil-gui river particle folder exposes the same values. URL parameters remain temporary development overrides seeded from YAML.

## Diagnostics

The runtime publishes:

```text
river_rapid_droplets_active
river_rapid_droplet_emitters
river_rapid_droplet_readbacks
```

`river_rapid_droplet_readbacks` must remain zero in normal gameplay.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/water/riverCascadeParticlesRuntime.test.ts `
  src/water/riverCascadeParticleOverlay.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed WebGPU acceptance:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Use `scene=infinite-islands` and a deterministic rapid pose. Confirm:

- flat fast reaches emit droplets without requiring a cascade;
- slow water, shore shallows, and dry cells emit none;
- droplets move with river flow and follow short ballistic arcs;
- camera movement does not expose the bounded scan pattern;
- existing mist, splash, and foam remain unchanged;
- normal-gameplay GPU readback counters remain zero;
- cumulative river ambience stays inside the Glacial Valley budget.

## Honest boundary

This is a bounded CPU-managed point layer with analytic ballistic placement. It does not yet move particle lifetime integration into a GPU compute or vertex shader. That larger migration should be justified by measured CPU or upload cost and should move all river particle layers together rather than creating a one-off GPU path for droplets.
