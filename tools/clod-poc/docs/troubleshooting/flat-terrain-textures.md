# Terrain textures look flat / "not applied"

**Status:** Resolved (2026-07-09). Not a regression — the demo texture tile was simply too coarse for close-up viewing.

## Symptom

The near-terrain chunks render as a flat colour wash (uniform green grass, uniform tan dirt, flat‑grey raised cubes) with **no visible surface texture detail**, even up close. Height-based layer selection still works (grass low near water, dirt/rock higher), so the terrain isn't one solid fallback colour — each band shows the *average* colour of its texture but not the pattern.

Easy to mistake for:
- textures failing to load / bind,
- a shader or WebGPU `DataArrayTexture` bug,
- a coordinate/height regression,
- distance/mip blur.

It is **none of those**. See "Root cause" below.

## Root cause

The default demo texture preset uses `scale = 0.06` for grass ([terrain_builtin_textures.ts](../../src/terrain/material/terrain_builtin_textures.ts) `DEFAULT_TERRAIN_TEXTURE_PRESETS`). `scale` is *UV per world metre*, so the tile size is `1/scale ≈ 16.7 m`. At an extreme close-up the camera sits inside a single 16.7 m tile, so you see a magnified, smooth patch of the image → reads as flat. From the mid-distance most screenshots are taken at, many tiles are visible and it reads as detail — which is why it "looked fine before."

Git history confirmed this was never a regression: `grass-2 scale` has been `0.06` since it was created (`1d9fd89c`), and `state.textureScale` has been `1` since introduction (`9158510`). Nothing in the sampling path changed the effective scale.

## Fix

Tighten the tile to the detail range (~4–5 m tiles) by raising the per-layer `scale` in `DEFAULT_TERRAIN_TEXTURE_PRESETS`:

```
grass-2        0.06 -> 0.24
earth-2        0.04 -> 0.16
earth-1        0.04 -> 0.16
snow-rocks-1   0.025 -> 0.10
```

Trade-off: smaller tiles show more visible repetition at distance (mips soften it). If it looks too repetitive far away, lower the scales slightly; if still too smooth up close, raise them. This is pure tuning — no code change needed.

The PBR built-ins (`pbr-grass-008`, etc.) have near-uniform albedo (they lean on normal/roughness maps for detail), so they read flatter than the demo textures regardless of scale. The demo set is the default for that reason; PBR stays available in the palette.

## Diagnostic ladder (reuse this for any "terrain looks flat" report)

Walk these in order — each step eliminates one layer. All are temporary edits in [terrain_node_material.ts](../../src/gpu/terrain_node_material.ts) / [terrain_texture_controller.ts](../../src/terrain/material/terrain_texture_controller.ts); remove them after.

1. **Is sampling even on?** Log in the WebGPU material's `setTextures` ([terrain_material_webgpu.ts](../../src/rendering/terrain_material_webgpu.ts)): `enabled`, `!!albedoArray`, `slots.length`. If sampling is `off`, the terrain shows the flat fallback `vec3(0.35,0.45,0.22)` — chase why (`clodPerf=1` disables PBR loading; `state.albedo` off; empty slots).
2. **Does the array data have detail?** In `buildDataArray`, after `getImageData`, log each layer's `hasImage`, `imgSize`, and R‑channel min/max. Wide spread (`R:47-255`) = detail present; narrow (`R:88-90`) = the image never drew (loader/decode).
3. **Mips?** Force `generateMipmaps = false; minFilter = LinearFilter`. If detail returns, the `DataArrayTexture` mip chain was collapsing to the flat top mip. (It did **not** here.)
4. **Do UVs vary?** Override `baseColor = vec3(fract(worldPos.x*0.2), fract(worldPos.z*0.2), 0)`. Tiling red/green = UVs vary; flat = `worldPos` constant (geometry).
5. **Does the raw sample work?** `baseColor = sampleArray(albedoArray, worldPos.xz.mul(0.3), float(0)).rgb`. A visible grass pattern here (as happened) proves the `.depth(layer)` sample is fine and the flatness is *scale or blend*, not the sampler.
6. **Is height right?** `baseColor = vec3(step(18.0, worldPos.y), fract(worldPos.y*0.1), 0)`. The red edge must sit at the waterline (sea level 18 m) and green rings must be smooth, continuous contours ~10 m apart. Broken per-chunk squares = `worldPos` is local, not world.
7. **Scale.** If 2–6 all pass, the data is good, the sample works, UV/height are correct — the flat look is the tile scale. Compare a known-good scale (the step‑5 debug used `0.3`) to the preset scale.

The key insight: step 5 passing (raw sample shows detail) + step 4/6 passing (UV & height correct) localises the problem to **scale**, not the material.

## Related notes

- `clodPerf=1` (CLOD perf mode) forces `color by LOD` on **and** skips PBR texture loading — terrain then shows flat LOD-tier colours by design, not a bug.
- `color by LOD` (checkbox) tints the terrain ~35% toward per-LOD debug colours; it does not fully hide textures.
- Height bands (per layer `heightMin`/`heightMax`, sea level 18 m): grass 12–20, dirt 18–42, rock 38–66, snow 62–118. Low coastal terrain is mostly grass by design; dirt/rock/snow only appear higher.
