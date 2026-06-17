# Plan: Port fable5 GroundRing grass techniques into clod-poc

Status: planning. Source of truth for the performant-grass port from the
`fable5-world-demo` reference into the `tools/clod-poc` sandbox.

## Context

The "very performant grass" in the reference demo is
[`GroundRing.ts`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts)
(≈520k–1M blades). clod-poc already has a working but smaller grass system in
[`tools/clod-poc/src/grass.ts`](../../tools/clod-poc/src/grass.ts) (~35k blades,
CPU page-based placement, raw GLSL `ShaderMaterial`).

### The hard constraint

| | clod-poc | fable5 GroundRing |
|---|---|---|
| Renderer | **WebGLRenderer** (three 0.169) | **WebGPURenderer** (three 0.184), no WebGL fallback by design |
| Materials | raw GLSL `ShaderMaterial` | TSL node materials + raw WGSL compute |
| Placement | **CPU**, per-LOD0-page instanced patches, distance-culled | GPU compute clipmap cull → indirect draws |
| Surface data | JS functions (`surfaceHeight`, `surfaceNormal`, `materialWeights`) | GPU textures (`biomeTex`, `fieldsTex`, `normalTex`) |
| Budget | ~35k blades | ~520k–1M blades |

The core of GroundRing's performance (GPU compute cull, atomic-append, indirect
draws, the upload-free toroidal clipmap) is **WebGL2-impossible**. clod-poc's
existing CPU page-based placement + per-patch distance culling already fills that
role at a lower budget. The *rendering-side* techniques (clumps, continuous-thin
LOD, dither crossfade, depth-prepass, hoisted shading, better normals/wind) port
cleanly into the existing GLSL system and are where most of the
visual-quality-per-millisecond gains live.

## Why GroundRing is fast (technique inventory)

**GPU-compute-dependent (the heart of the system — WebGPU only):**

1. **Toroidal clipmap streaming, zero uploads** — each instance slot maps to the
   world cell congruent to it `(mod GRID)` nearest the camera; all per-instance
   params re-derive from `pcg(worldCell)`, so a slot's content changes only when
   its world cell does. No CPU buffer rebuilds.
2. **Per-frame GPU cull kernels**
   ([`grassK`/`debrisK`/`farK`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L418))
   — sample biome/water/canopy/normal fields, thin density, frustum-test, pick
   the LOD band, `atomicAdd`-append survivors into compact lists.
3. **Indirect draws** — `IndirectStorageBufferAttribute`; the CPU never reads
   back per-frame.

**Portable to WebGL (rendering-side wins):**

4. **Multi-blade clumps**
   ([`bladeClump`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L213))
   — N blades baked into one instance. Per-pixel blade overlap reads as "lush";
   single thin blades can't at walking distance.
5. **Coverage-conserving continuous LOD** — `grassThin(dist)` smoothly drops
   blades with distance; survivors **widen by `1/√thin`** in the vertex stage so
   screen coverage stays constant (no density bands). "Cheap nanite for
   aggregates."
6. **3+1 LOD geometry bands** (4-seg clump ≤26m → 2-seg ≤60m → tuft cross → far
   super-tuft) with **complementary screen-space dither crossfade**
   ([`bandFade`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L159))
   so the two layers split the pixel set exactly.
7. **Depth-prepass twins**
   ([`VegPrepass.ts`](../reference/fable5-world-demo/src/render/VegPrepass.ts))
   — depth-only pass, then color at `depthFunc=EQUAL`, so full lighting runs once
   per visible pixel. Reference bench: GPU **49.6→39.4ms**.
8. **Vertex-stage shading hoists** — albedo/normal-blend/AO/translucency moved to
   the vertex stage since they vary at ≥blade scale. Reference bench: −1.4ms.
9. **Rounded blade normals** (±38° baked) **pulled toward the terrain normal** —
   a sward lights like the hillside it grows on; per-blade card normals made
   meadows sparkle gray.
10. **`lean²` wind rule** — strong wind flattens the sward (superlinear
    deflection), tempo unchanged.

## Strategy

Two genuinely different strategies with very different cost:

- **Option A — Port the rendering techniques into the existing WebGL system.**
  Keep CPU page-based placement; adopt techniques 4–10. Incremental, low-risk,
  each step independently benchable. Won't reach 1M blades but looks dramatically
  lusher and shades cheaper at clod-poc's budget.
- **Option B — Migrate clod-poc to WebGPURenderer and port GroundRing wholesale.**
  True parity (compute clipmap, indirect, 1M blades) but a large migration: the
  terrain shader, postprocess, and environment are all GLSL `ShaderMaterial`, and
  GroundRing also needs the heightfield/biome/canopy fields exposed as GPU
  textures. High risk for a POC.

**Decision: plan both, phased** — Option A as the near-term phases (1), Option B
as a later parity milestone (2–3) that the Option A material work carries into.

---

## Phase 0 — Measurement harness (prerequisite, do first)

clod-poc is a separate Vite/TS sandbox — the repo's `cargo run -- --bench` and
`bench_guard` **do not apply here**. Before touching grass, add a comparable
in-app measurement (mirrors the reference's `GpuProfiler.ts` + Playwright tools):

- Add a GPU timer (`EXT_disjoint_timer_query_webgl2`) + frame-time average to the
  existing HUD in [`main.ts`](../../tools/clod-poc/src/main.ts) (it already shows
  blade count near line 1216).
- Add a fixed camera path / deterministic screenshot checkpoint so before/after
  frames are comparable.
- **Capture a baseline now**: blade count, GPU ms, CPU frame ms, draw calls, at
  the current 35k budget.
- **Verify:** baseline JSON recorded; every later phase reports before/after
  against it.

## Phase 1 — Option A: WebGL rendering-technique ports

All in [`grass.ts`](../../tools/clod-poc/src/grass.ts), building on the existing
CPU page-placement + `ShaderMaterial`. Ordered by bang-for-buck; each step is
independently benchable and revertable.

### 1.1 Multi-blade clumps (highest visual/vertex ratio)
- Replace `createBladeGeometry()` (single 4-row blade) with a
  `bladeClump(blades, segs)` baker (port
  [GroundRing.ts:213](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L213)):
  N blades, per-blade yaw/offset/height/lean baked into one geometry. One
  instance = a tuft.
- Reduce instance count proportionally (e.g. 5 blades/clump → ~7k clumps for the
  same 35k blades), so draw/instance overhead drops while coverage rises.
- **Verify:** same blade budget, fewer instances, visibly lusher near-field; GPU
  ms flat or down.

### 1.2 Per-instance distance + LOD bands + dither crossfade
- Pass a `cameraPosition` uniform; compute `dist = length(aOffset.xz - cam.xz)`
  in the vertex shader.
- Three geometry tiers as separate instanced meshes per page: `bladeClump(5,4)`
  near, `bladeClump(3,2)` mid, `tuftGeometry()` far (port
  [tuftGeometry:256](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L256)).
- Add complementary screen-space **dither crossfade** (port
  [`bandFade`:159](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L159)):
  interleaved-gradient-noise on `gl_FragCoord` + `discard`, with the two bands
  splitting the pixel set exactly so density stays constant through the overlap.
- **Verify:** no visible density ring at band boundaries; distant blades cheaper.

### 1.3 Continuous distance thinning + width compensation
- Port `grassThin(dist)`
  ([:106](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L106)). Two
  options for the thin decision: bake an LOD/keep bit per instance at CPU
  generation time, **or** do it in-shader via the same IGN dither. Prefer
  in-shader to avoid CPU patch rebuilds.
- Compensate survivors by widening `1/√thin` (clamped) in the vertex stage so
  screen coverage is conserved — no density bands as the field recedes.
- **Verify:** smooth dissolve into terrain at the distance edge; coverage stable
  while walking.

### 1.4 Depth-prepass for overdraw (biggest raw GPU win in the reference bench)
- WebGL-port of
  [`VegPrepass.ts`](../reference/fable5-world-demo/src/render/VegPrepass.ts):
  render grass depth-only first (`colorWrite=false`), then the shaded pass with
  `material.depthFunc = THREE.EqualDepth`, `depthWrite=false`.
- **WebGL nuance:** to guarantee the two passes produce bit-identical depth, the
  prepass must run the **same vertex program** (same `ShaderMaterial`, color
  writes masked) rather than a separate shader — ANGLE/driver FMA reassociation
  can otherwise fail `EQUAL` and punch blade-shaped holes (the Metal `@invariant`
  problem, milder on WebGL but real). Drive both passes off one material via
  render-order + a `colorWrite` toggle, or two materials sharing identical vertex
  source.
- **Verify:** no holes-to-sky at band fades; GPU ms drops on dense meadow views
  (reference: 49.6→39.4ms).

### 1.5 Vertex-stage shading hoist + rounded/terrain-blended normals
- Bake rounded blade normals (±38°) into the clump geometry; in the shader pull
  the blade normal toward the **terrain normal** (clod-poc has `surfaceNormal` in
  [`terrain.ts`](../../tools/clod-poc/src/terrain.ts) — sample per-instance and
  pass as a varying), harder with distance. Kills the "gray sparkle" of per-card
  normals.
- Move albedo/AO/translucency that vary at ≥blade scale into the vertex stage
  (varyings), matching
  [GroundRing.ts:870-911](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L870).
- **Verify:** sward shades like the hillside; fragment cost down.

### 1.6 `lean²` wind upgrade
- Replace the current linear `wind *= uWindStrength * aHeight * bend`
  ([grass.ts:31-33](../../tools/clod-poc/src/grass.ts#L31)) with the superlinear
  lean² rule + tip² cantilever from
  [GroundRing.ts:816-842](../reference/fable5-world-demo/src/vegetation/GroundRing.ts#L816).
  A scalar gust (`sin` of advected position+time) is enough without the full WGSL
  noise field.
- **Verify:** strong wind flattens the sward instead of speeding up; tempo
  constant.

After 1.1–1.6: bump `maxBlades` and re-bench to find the new budget at target
frame time. This is where the lushness-per-millisecond gain shows up.

## Phase 2 — Option B groundwork (only if pursuing parity)

Prereqs that GroundRing assumes and clod-poc lacks:

- **Surface fields as GPU textures.** GroundRing's compute cull samples
  `biomeTex`/`fieldsTex`/`normalTex` and `sampleHeight`/`sampleWaterYNearest`.
  clod-poc has these as JS functions (`surfaceHeight`, `surfaceNormal`,
  `materialWeights`). Bake them into `DataTexture`s (or render targets) so a GPU
  pass can read them.
- **Renderer abstraction.** Terrain
  ([`terrain_shader.ts`](../../tools/clod-poc/src/terrain_shader.ts)), postprocess
  ([`postprocess.ts`](../../tools/clod-poc/src/postprocess.ts)), and environment
  are all GLSL `ShaderMaterial`. Decide: dual-stack (WebGPU only for grass) or
  full migration. A WebGPU `GroundRing` can coexist with a WebGL main scene only
  in a separate WebGPU context/canvas — usually not worth it; full migration to
  `WebGPURenderer` + TSL is the clean path.
- **Verify:** surface-field textures match the JS functions to tolerance; a
  trivial TSL material renders in clod-poc.

## Phase 3 — Option B: GroundRing parity

- Switch to `three/webgpu` `WebGPURenderer`; port terrain/post/environment
  materials to TSL (the bulk of the migration work).
- Port
  [`GroundRing.ts`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts)
  wholesale: toroidal clipmap, compute cull kernels (`instancedArray` +
  `atomicAdd`), `IndirectStorageBufferAttribute` indirect draws, plus its
  dependencies `cellHash`/`cellHash2` from
  [`Scatter.ts`](../reference/fable5-world-demo/src/gpu/passes/Scatter.ts) and the
  [`Wind.ts`](../reference/fable5-world-demo/src/render/Wind.ts) field.
- This subsumes Phase 1's grass material (Phase 1 work carries forward as the TSL
  blade/clump/LOD logic).
- **Verify:** ~520k–1M blades at target frame time with zero per-frame CPU buffer
  rebuilds; readback HUD counters match.

## What does NOT port (and why it's fine)

GPU compute cull, atomic-append, indirect draws, and the upload-free clipmap are
all WebGL2-impossible. clod-poc's existing **CPU page-based placement + per-patch
distance culling already fills this role** at a lower budget, so Phase 1 loses no
correctness, only ceiling. They only return in Phase 3 under WebGPU.

## Recommendation

Stop after Phase 1 unless you specifically need >100k blades. Steps 1.1, 1.2, and
1.4 alone (clumps, LOD-dither, depth-prepass) capture most of the "very
performant + lush" feel for a fraction of Phase 3's migration cost and risk.

## Reference index

- Performant grass: [`GroundRing.ts`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts)
- Blade/clump geometry + base material: [`GroundCover.ts`](../reference/fable5-world-demo/src/vegetation/GroundCover.ts)
- Depth-prepass: [`VegPrepass.ts`](../reference/fable5-world-demo/src/render/VegPrepass.ts)
- Wind field: [`Wind.ts`](../reference/fable5-world-demo/src/render/Wind.ts)
- Scatter hashes: [`Scatter.ts`](../reference/fable5-world-demo/src/gpu/passes/Scatter.ts)
- Current clod-poc grass: [`grass.ts`](../../tools/clod-poc/src/grass.ts)
- clod-poc surface fields: [`terrain.ts`](../../tools/clod-poc/src/terrain.ts)
