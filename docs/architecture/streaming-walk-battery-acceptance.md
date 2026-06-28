# Streaming walk battery acceptance

ISLE-15 adds a deterministic acceptance gate for infinite streaming ownership. It runs as gate `A7` inside the existing CLOD acceptance command.

## Command

```powershell
npm --prefix tools/clod-poc run acceptance:clod:fast
```

The normal acceptance command now includes:

- A1 watertight/border chain checks
- A2 border continuity
- A3 density scar checks
- A4 triangle reduction
- A5 build cost
- A6 low-benefit locked-border density
- A7 streaming walk battery

## What A7 validates

The walk battery simulates a camera route through an `infinite-islands` style world. Each frame updates the same runtime systems used by the streaming ownership code:

- `TerrainOwnershipRuntime`
- `computeOwnershipCoverageCounters`
- `BiomeTextureStreamingManager`

The gate fails if any configured invariant breaks:

| Invariant | Default |
| --- | --- |
| Camera-to-CLOD center drift | `<= 0.001m` |
| Camera-to-far-shell center drift | `<= 0.001m` |
| Live/CLOD gap holes | `0` |
| CLOD/far-shell gap holes | `0` |
| Live/CLOD overlap cells | `0` |
| Missing required live chunks | `0` |
| Missing required CLOD pages | `0` |
| Horizon hole ratio | `0` |
| Active biome texture layers | `<= 2` |

The gate also records:

- frame count
- far-shell recenter count
- last far-shell recenter frame
- biome texture-window swaps
- unique active biome windows

## Config

Configured in `tools/clod-poc/config/clod_acceptance.yaml`:

```yaml
acceptance:
  streaming_walk:
    enabled: true
    frames: 180
    step_m: 32
    live_radius_m: 128
    clod_radius_m: 512
    far_shell_outer_m: 2048
    hysteresis_m: 128
    coverage_cell_m: 32
    max_clod_level: 3
    biome_probe_distance_m: 160
    max_center_drift_m: 0.001
    max_gap_holes: 0
    max_overlap_cells: 0
    max_horizon_hole_ratio: 0.0
    max_active_biome_textures: 2
```

## Output

Each acceptance run writes:

- `summary.json`
- `summary.md`
- `metrics.csv`
- `debug/streaming_walk.json`

`debug/streaming_walk.json` stores the full A7 gate result and failure details.

## Scope

A7 is deterministic and Node-side. It does not replace visual/browser walking. It catches the ownership and texture-window regressions cheaply before running expensive browser captures.
