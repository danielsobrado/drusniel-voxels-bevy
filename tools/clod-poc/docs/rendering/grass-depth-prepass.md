# CLOD-POC Grass Depth Prepass

## Status

CLOD-POC has a WebGPU grass-ring depth-prepass twin path for grass.

The path is exposed in the lil-gui `grass shader` folder as:

```text
depth prepass
prepass tier 0/1/2
```

The controls are live. They rebuild the grass ring without reloading the page.

## Tier control

```text
0 = off
1 = near tier only
2 = near + mid tiers
```

The default remains the previous CLOD-POC behavior:

```text
2 = near + mid tiers
```

Startup URL parameters are also supported:

```text
prepass=1 or 0
grassDepthPrepass=1 or 0
vegetationDepthPrepass=1 or 0
grassDepthPrepassTier=0, 1, or 2
prepassTier=0, 1, or 2
```

## How it works

The grass controller applies the tier to the existing `GrassSystem` and rebuilds the grass ring.

This keeps the high-risk GPU ring draw internals unchanged while allowing live A/B testing from the UI.

## How to test

Start with a grass-heavy CLOD scene, then use the lil-gui controls to switch live between:

```text
off
near only
near + mid
```

Good startup examples:

```text
scene=infinite-naadf-flat, grass=1, prepass=1, grassDepthPrepassTier=2
scene=infinite-naadf-flat, grass=1, prepass=1, grassDepthPrepassTier=1
scene=infinite-naadf-flat, grass=1, prepass=0
```

## What to inspect

```text
near grass overdraw
main render time
vegetationTotalMs
visual holes around grass masks
wind/depth mismatch
alpha halos
prepass tier switch stability
```

## Current limitation

This is a CLOD-POC experiment for GPU grass-ring depth prepass only. It is not yet applied to trees or understory.

```text
TODO: extend to tree/understory hero foliage only after grass-ring A/B is validated.
```
