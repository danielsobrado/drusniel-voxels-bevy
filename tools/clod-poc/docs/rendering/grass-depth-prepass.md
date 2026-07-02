# CLOD-POC Vegetation Depth Prepass

## Status

CLOD-POC now exposes alpha vegetation depth-prepass controls for grass, trees, and understory.

The controls are in lil-gui:

```text
grass shader / depth prepass
grass shader / prepass tier 0/1/2
trees (props) / depth prepass max LOD
understory (props) / depth prepass
```

## Grass control

Grass uses the existing WebGPU grass-ring depth-prepass twin path.

```text
0 = off
1 = near tier only
2 = near + mid tiers
```

The default remains the previous CLOD-POC grass behavior:

```text
2 = near + mid tiers
```

Startup parameters:

```text
prepass=1 or 0
grassDepthPrepass=1 or 0
vegetationDepthPrepass=1 or 0
grassDepthPrepassTier=0, 1, or 2
prepassTier=0, 1, or 2
```

## Tree control

Trees use the existing tree GPU-ring depth-prepass twin path. The new control limits how far through the tree LODs the prepass is applied.

```text
none = off
near = near LOD only
mid = near + mid
far = near + mid + far
```

Impostors are never included.

Startup parameters:

```text
treePrepass=1 or 0
treePrepassMaxLod=none, near, mid, or far
```

`prepass=0` also disables tree depth prepass at startup.

## Understory control

Understory depth prepass is explicit and default-off.

```text
understory (props) / depth prepass
```

Startup parameters:

```text
understoryDepthPrepass=1 or 0
understoryPrepass=1 or 0
```

This applies only to the WebGPU understory ring path. It is intentionally not enabled by default because it is newer than the grass/tree prepass paths.

## How it works

Grass and tree controls rebuild their existing ring resources live.

Understory uses WebGPU node-material `positionNode` data to create depth-prepass twins for ring meshes when explicitly enabled. The twins are owned by the ring mesh lifecycle and disposed with the ring draw resources.

## How to test

Start with CLOD scenes that are heavy in vegetation and use the lil-gui controls to switch live.

Suggested startup examples:

```text
scene=infinite-naadf-flat, grass=1, prepass=1, grassDepthPrepassTier=2
scene=infinite-naadf-flat, grass=1, prepass=1, grassDepthPrepassTier=1
scene=infinite-naadf-flat, grass=1, prepass=0
scene=infinite-naadf-flat, trees=1, treePrepass=1, treePrepassMaxLod=near
scene=infinite-naadf-flat, trees=1, treePrepass=1, treePrepassMaxLod=far
scene=infinite-naadf-flat, understory=1, understoryDepthPrepass=1
```

## What to inspect

```text
main render time
vegetationTotalMs
visual holes around alpha masks
wind/depth mismatch
alpha halos
prepass tier switch stability
tree LOD switch stability
understory ring switch stability
```

## Validation commands

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run acceptance:clod:fast
```

## Current limitation

These are CLOD-POC render experiments. Keep them measured and do not assume a performance win until A/B timings and visual checks are clean.
