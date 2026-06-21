# Fix: painted-terrain "speckle" on raised/painted geometry (WebGPU)

## Symptom

On the WebGPU backend, **painted** terrain (raise/dig with a material — cubes, mounds) showed a
screen-door **speckle** on its faces (most visibly a snow/earth checkerboard), while **natural**
terrain — including a tall mountain with a clean snow cap — rendered perfectly. The speckle was
worst on steep faces and "changed" as the camera moved.

## Root causes (two distinct bugs, both in the paint albedo path)

Both live in [`src/gpu/terrain_node_material.ts`](../src/gpu/terrain_node_material.ts).

1. **Interpolated array-layer-index jitter (the speckle).**
   `paintedAlbedo`/`paintedNormal` sampled the texture array with `.depth(channel.slot)`, where
   `channel.slot` comes from the **interpolated `paintSlots` vertex attribute**. Even when the slot
   is `3.0` at every vertex, floating-point interpolation produces `3.0 ± ε` per pixel; the array
   index conversion then flips between adjacent layers (e.g. earth↔snow) → screen-door speckle.
   - Layer 0 (grass) stayed clean because it's clamped: `max(slot, 0)`.
   - The **natural band path was clean** because it indexes with a literal `float(i)` (no
     interpolation) — which is why the mountain snow cap (layer 3) was perfect.
   - **Fix:** round the index before sampling — `floor(max(slot, 0).add(0.5))` — in both
     `paintedAlbedo` and `paintedNormal`. (`paintSlots` are global/constant per the baking in
     `terrain.ts` `paintWeightsAt`, so rounding only removes FP jitter; it can't merge real slots.)

2. **Planar vs triplanar (the streaks).**
   `paintedAlbedo` sampled **planar** (`worldPos.xz` only) while `paintedNormal` and the natural
   band path use **triplanar**. On vertical painted faces the top-down planar projection streaked.
   - **Fix:** make `paintedAlbedo` triplanar too (pass triplanar `weights` + `useTriplanar`).

## How it was diagnosed (the decisive "tells")

The bug masqueraded as several other things; these observations ruled those out:

- **Natural-clean / painted-speckle** → it's the paint path, not mips / geometry / global triplanar.
- **GUI `albedo` toggle off → clean white** → it's the albedo *texture fetch*, not lighting,
  not mesh z-fighting (a z-fight would still show a faceted shading fight on white).
- **`paint weights` debug = solid white on the cubes** → paint coverage is complete (=1), so the
  `mix(band, painted, paint)` blend was never the problem → it's the fetch / layer index.

Dead ends that were ruled out (do **not** chase these again): mipmaps (disabling `generateMipmaps`
did nothing; the clean snow cap proves WebGPU array mips are fine here), the near-field bubble
(toggling changed nothing), the LOD cross-fade dither (`transition_mode: instant` disables it),
`rtk` for the build/test commands (run those without `rtk`).

## Also fixed along the way

- **Debug views now work on WebGPU.** The "procedural debug" dropdown was a no-op on the node
  material: `debugMode` was hardcoded `0` for `external_pbr` in `main.ts` and dropped in
  `toNodeTextures` ([`src/rendering/terrain_material_webgpu.ts`](../src/rendering/terrain_material_webgpu.ts)).
  Plumbed through; `paint weights` and `albedo layer` are implemented in the node material.
  (Other modes — macro noise / page LOD / seam stress — are still no-ops on WebGPU.)
- **Default terrain source is now `external_pbr`** (`main.ts`).

## Verifying

Hard-reload (texture arrays build once at load) and paint earth/rock/snow cubes:

```
http://127.0.0.1:5181/?renderer=webgpu&world=16
```

Painted faces should carry clean side-projected texture with no speckle. The `paint weights` /
`albedo layer` debug views are available to confirm coverage and layer stability.
