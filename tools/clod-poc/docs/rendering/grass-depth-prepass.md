# CLOD-POC Grass Depth Prepass

## Status

CLOD-POC already has a WebGPU grass-ring depth-prepass twin path for the near grass tiers.

This path is now exposed in the lil-gui `grass shader` folder as:

```text
depth prepass (reload)
```

The checkbox writes URL parameters and reloads the page:

```text
prepass=1
prepass=0
grassDepthPrepass=1
grassDepthPrepass=0
```

## Why it reloads

The current prepass twins are created when GPU grass-ring draw resources are built. They are not yet designed as live mutable objects. Reloading keeps the experiment safe and avoids half-mutated depth/color material state.

## How to test

Default/on:

```text
http://127.0.0.1:5173/?scene=infinite-naadf-flat&grass=1&treeGpu=0&prepass=1
```

Off:

```text
http://127.0.0.1:5173/?scene=infinite-naadf-flat&grass=1&treeGpu=0&prepass=0
```

Use the lil-gui checkbox to switch between them.

## What to inspect

```text
near grass overdraw
main render time
vegetationTotalMs
visual holes around grass masks
wind/depth mismatch
alpha halos
```

## Current limitation

This is a CLOD-POC experiment for GPU grass-ring depth prepass only. It is not yet a full runtime slider for exact distance, and it is not yet applied to trees or understory.

```text
TODO: make depth-prepass twins rebuild live without page reload.
TODO: add a distance/tier slider after live rebuild is safe.
TODO: extend to tree/understory hero foliage only after grass-ring A/B is validated.
```
