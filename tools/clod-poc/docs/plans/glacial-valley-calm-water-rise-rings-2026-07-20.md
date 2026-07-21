# Glacial Valley calm-water rise rings — 2026-07-20

## Dependency

This slice is stacked on the rapid-droplet branch and shares `config/river_ambience.yaml`. Merge and squash the rapid-droplet PR first, then retarget this branch to `main` before final validation.

## Scope

Add subtle expanding surface rings to calm inland water without changing water mesh authority or introducing another hydrology path.

The overlay:

- consumes the existing `RiverDressingSampleReader`;
- uses the active production `EnvironmentQuery` when available;
- preserves the caller's coarse sample-size hint;
- fails closed when active water or river authority is invalid;
- scans a fixed YAML-owned grid with a bounded number of cells per frame;
- renders every active ring through one fixed-capacity `THREE.LineSegments` draw;
- performs no gameplay GPU readback.

## Placement policy

A ring is eligible only when:

- water is valid and wet;
- depth is above the configured minimum;
- the sample is inside the configured shore-interior distance;
- flow strength is below the calm-water threshold;
- local bed drop is below the cascade threshold;
- body kind is lake, river, pond, or marsh.

Ocean water is excluded so rise rings do not compete with shore surf or deep-sea wave language. Calm river cells receive a lower body weight than still-water bodies.

Sources, phase, lifetime, radius, and acceptance are deterministic functions of world cell and scan generation.

## Configuration

Production values live under:

```text
river_ambience.calm_water_rise_rings
```

in `config/river_ambience.yaml`.

Performance and potato presets disable the effect by default. URL values are development overrides only.

## Diagnostics

```text
calm_water_rise_rings_active
calm_water_rise_ring_emitters
calm_water_rise_ring_scanned_cells
calm_water_rise_ring_readbacks
```

The readback counter must remain zero.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/water/calmWaterRiseRingsRuntime.test.ts `
  src/water/calmWaterRiseRingOverlay.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed WebGPU and WebGL acceptance:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Use deterministic `infinite-islands` lake, calm-river, rapid, cascade, coast, and shore-shallow poses. Confirm:

- lake and calm-river interiors can emit subtle expanding rings;
- rapids, cascades, ocean surf, dry cells, and shore shallows emit none;
- camera movement does not reveal the fixed scan grid;
- all rings remain on the canonical water surface;
- the effect disappears with water visibility;
- performance/potato defaults disable it;
- normal-gameplay readbacks remain zero;
- cumulative ambience stays inside the Glacial Valley budget.

## Honest boundary

This is a one-draw, CPU-updated line overlay. It is intentionally not a separate particle engine or water-surface simulation. If measurements show material CPU or upload cost, the next step should migrate all small water ambience layers to one shared GPU lifecycle rather than optimize rise rings alone.
