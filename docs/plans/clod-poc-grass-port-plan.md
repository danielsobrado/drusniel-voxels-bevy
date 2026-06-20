# CLOD-POC Grass Ring Port Plan

Document status: execution plan for replacing CLOD-POC page-owned grass patches with a Fable5-style camera-following WebGPU grass ring.

Related plans:

- [`grass-overhaul-plan.md`](grass-overhaul-plan.md) - older terrain-derived patch grass plan.
- [`procedural-vegetation-authoring-plan.md`](procedural-vegetation-authoring-plan.md) - offline tree/rock/understory asset generation. This grass plan is a sibling, not a dependency.
- [`glacial-valley-biome-detail-masks-plan.md`](glacial-valley-biome-detail-masks-plan.md) - terrain detail masks that grass should eventually sample.

Reference source:

- Local Fable5 reference: [`docs/reference/fable5-world-demo/src/vegetation/GroundRing.ts`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts)
- Blade/debris geometry reference: [`docs/reference/fable5-world-demo/src/vegetation/GroundCover.ts`](../reference/fable5-world-demo/src/vegetation/GroundCover.ts)
- Current CLOD-POC grass: [`tools/clod-poc/src/grass.ts`](../../tools/clod-poc/src/grass.ts)
- Current renderer seam: [`tools/clod-poc/src/rendering/renderer_backend.ts`](../../tools/clod-poc/src/rendering/renderer_backend.ts)

## 1. Decision

Use Fable5's `GroundRing` architecture for CLOD-POC grass, but do not port the whole Fable vegetation stack.

The useful part is the camera-following toroidal grass grid:

```text
camera/frustum uniforms -> deterministic world cells -> GPU cull/compact -> indirect grass draws
```

This replaces the current page-owned patch model for dense field coverage. Grass should be a derived visual cache over terrain fields, not part of CLOD terrain geometry, not part of collider data, and not tied to whichever CLOD pages are currently selected for rendering.

## 2. Why Fable GroundRing Fits

Current CLOD-POC grass already has useful foundations:

- `tools/clod-poc/src/grass.ts` owns terrain-derived placement and deterministic sampling.
- The app defaults to WebGPU unless `?renderer=webgl` is specified.
- `tools/clod-poc/package.json` pins `three` to `0.184.0`, the same major Three/WebGPU generation used by the Fable reference.

The current weakness is ownership and scaling: grass is still built as CPU-side patches near LOD0 pages. That means camera movement, CLOD selection, and terrain edit rebuilds all push the system toward CPU scatter and geometry rebuild work.

Fable's better idea is:

- a stable ring of instance slots around the camera,
- deterministic world-cell hashing so content is recreated in shaders,
- compute culling into compact draw lists,
- indirect instance counts,
- distance bands with cheaper representations,
- coverage-conserving thinning so far grass loses instances without losing apparent coverage.

## 3. Port Scope

Port these concepts from `GroundRing.ts`:

- Toroidal world-cell mapping from slot index to nearest camera-congruent world cell.
- Storage buffers for packed accepted cells and ground heights.
- Atomic counters per draw group.
- Compute passes:
  - clear counters,
  - cull fine grass cells,
  - cull optional far super-tuft cells,
  - build indirect draw instance counts.
- Grass LOD bands:
  - near clumps: multiple blades per instance, 4-segment blades,
  - mid clumps: fewer blades and 2-segment blades,
  - far tufts: wider crossed tuft cards,
  - optional super-tuft ring beyond the fine grid.
- Dithered crossfade across band overlaps.
- Coverage-conserving thinning:

```text
thin = pow(min(1, 58 / (dist + 42)), 1.15) * pow(120 / max(dist, 120), 1.6)
width_scale = clamp(1 / sqrt(thin), 1, 4)
```

- Terrain-normal lighting pull so distant grass shades like the terrain under it.
- Depth prepass twins for grass overdraw, once the WebGPU path has indirect draws working.
- GPU-read counters for debug stats.

Do not port these as part of the first grass ring:

- Trees, tree impostors, rocks, deadfall, canopy maps, GI, particles, full biome art logic, or the whole Fable runtime scene stack.
- Fable's exact starting constants. `GRASS_GRID = 3072`, `GRASS_CELL = 0.105`, and million-instance caps are targets, not first-step defaults.
- `grassPatch()` as the primary runtime path. It is useful as blade/clump style reference only.

## 4. CLOD-POC Data Contract

Grass samples derived terrain fields. It must not ask the active CLOD cut whether grass exists.

Initial fields can be CPU-backed for Phase 1 and GPU textures/buffers for Phase 2:

```text
height(x, z)
normal(x, z)
grass_mask(x, z)
material_or_biome_id(x, z)
water_height_or_wetness(x, z)
slope_or_rock_reject(x, z)
```

The GPU-ready representation should be:

```text
heightTex   r32f or rgba16f
normalTex   rgba8snorm or rgba16f
surfaceTex  rgba8: grassMask, biomeId/materialId, wetness, rejectMask
```

The near-field source remains the authoritative voxel terrain sampling already used by the CLOD-POC. If a future far shell uses heightfield summaries, that source must stay outside the editable voxel bubble.

## 5. Initial Constants

Start below Fable's full-scale settings:

```yaml
grass:
  enabled: true
  renderer: webgpu

  fine:
    grid_dim: 1536
    cell_m: 0.14
    radius_m: 105

  far:
    grid_dim: 512
    cell_m: 0.70
    start_m: 95
    radius_m: 220

  lod:
    near_m: 26
    mid_m: 60
    band_m: 10

  caps:
    near_instances: 262144
    mid_instances: 524288
    far_instances: 786432
    super_tuft_instances: 98304

  blades:
    near_blades_per_instance: 5
    near_segments: 4
    mid_blades_per_instance: 3
    mid_segments: 2
    far_tuft_width_m: 0.22

  density:
    base: 1.0
    near_scruff_min_m: 12
    slope_reject_start: 0.55
    slope_reject_end: 0.95
    water_margin_m: 0.06

  debug:
    show_stats: true
    freeze_ring: false
    show_lod_bands: false
```

These are validation defaults. Raise them only after GPU counters, frame timing, and screenshots are stable.

## 6. Implementation Phases

### Phase 0 - Baseline And Config

- Capture current CLOD-POC grass behavior with the existing patch system.
- Add a config object or YAML-backed equivalent for the constants above.
- Keep the existing grass path selectable as `classic` or `terrain-patch-v2` until the ring is validated.
- Add a clear runtime guard: the ring path requires WebGPU. WebGL should fall back to the existing path.

Verification:

```bash
rtk npm --prefix tools/clod-poc run typecheck
rtk npm --prefix tools/clod-poc test
rtk npm --prefix tools/clod-poc run build
```

### Phase 1 - Visual CPU Prototype

Purpose: tune blade style before debugging compute.

- Reuse or adapt the current `grass.ts` blade geometry.
- Add clumped instances that match the Fable shape: several blades per instance, tapered strips, rounded normals, random yaw/lean, stable per-cell hash.
- Add near/mid/far geometry tiers, even if the instance lists are still CPU-built.
- Keep terrain qualification: grass weight, upward normal, height range, water rejection, slope rejection, edge suppression.

Pass condition:

- Close grass reads as clumps, not isolated single cards.
- Mid tier is visibly cheaper with no disruptive pop.
- Far coverage does not rely on dense alpha-heavy blades.
- Dig/edit rebuild behavior is no worse than the existing patch system.

### Phase 2 - WebGPU Fine Ring

Purpose: prove the architecture.

New module shape:

```text
tools/clod-poc/src/grass/
  GrassConfig.ts
  GrassGeometry.ts
  GrassRing.ts
  GrassMaterial.ts
  GrassGpuBuffers.ts
  GrassStats.ts
  shaders/
    grass_cull.wgsl
    grass_indirect.wgsl
```

The ring should:

- Allocate packed cell and height storage buffers.
- Allocate atomic counters for near/mid/far draw groups.
- Map each slot to a toroidal world cell around the camera.
- Recompute culling from camera/frustum uniforms.
- Append accepted cells into compact per-band lists.
- Update indirect draw counts from counters.
- Draw at most three fine grass layers: near, mid, far.

Pass condition:

- Camera movement does not rebuild CPU instance geometry.
- Visible counts come from GPU counters.
- Grass remains stable while walking/flying.
- Grass does not pop when active CLOD page selection changes.
- Fine grass renders with no more than three grass draw groups, plus optional depth prepass groups.

### Phase 3 - LOD Bands And Coverage Conservation

- Add Fable-style overlapping bands:
  - near draws until `near_m + band_m`,
  - mid draws from `near_m - band_m` to `mid_m + band_m`,
  - far draws from `mid_m - band_m` outward.
- Add complementary dither masks so the overlap does not halve apparent density.
- Apply distance thinning in the cull pass.
- Apply survivor widening in the vertex/material path.
- Pull blade normals toward the sampled terrain normal, stronger at distance.

Pass condition:

- No visible thin rings at LOD transitions.
- Instance counts drop with distance.
- Far grass blends into the terrain material instead of sparkling or turning gray.

### Phase 4 - Terrain-Aware Placement

- Replace placeholder density with terrain fields:
  - grass mask or material weight,
  - slope/normal,
  - water height or wetness,
  - rock/snow/reject mask,
  - near scruff floor.
- Keep all placement deterministic from world cell + seed.
- Add debug views for rejected cells by reason.

Pass condition:

- No grass underwater.
- No grass on steep rock/cliffs.
- Grass follows material/biome changes.
- Edited-away terrain does not leave dense hanging grass.

### Phase 5 - Far Super-Tuft Ring

- Add a coarse toroidal grid for far grass silhouettes.
- Use wide, cheap crossed tufts from roughly the fine-ring fadeout to the far coverage handoff.
- Fade out into terrain tint/coverage rather than a hard geometry stop.

Pass condition:

- The meadow does not hard-stop at the fine ring radius.
- Super-tuft counters stay bounded.
- Distant coverage is cheaper than extending the fine grid.

### Phase 6 - Overdraw Control And Stats

- Add depth prepass twins for grass ring layers.
- Report separate stats:
  - fine near/mid/far accepted cells,
  - super-tuft accepted cells,
  - capped/overflow counters,
  - compute time where available,
  - grass draw group count,
  - classic patch count while fallback remains.
- Feed stats into the existing CLOD-POC QA summary.

Pass condition:

- Depth prepass can be toggled for A/B.
- Stats prove whether the ring is faster or slower than the current patch path.
- Any counter cap hit is visible in debug output.

## 7. Validation

Use the CLOD-POC checks for web changes:

```bash
rtk npm --prefix tools/clod-poc run typecheck
rtk npm --prefix tools/clod-poc test
rtk npm --prefix tools/clod-poc run build
rtk npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
```

Manual scenario:

```text
http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1
```

Visual/performance claims require a summary captured from the relevant browser scenario, not only the sample QA summary.

Because visual benches should not be run from WSL, do not claim screenshot parity or visual-bench performance from this environment. Run visual scenarios from a native Windows shell or report that they were skipped.

## 8. Acceptance Criteria

- Dense grass is camera-ring-owned and independent from active CLOD page selection.
- Per-frame camera movement does not upload rebuilt CPU instance matrices or rebuilt grass geometry.
- Terrain edits invalidate only the sampled terrain fields or affected fallback cache, not the entire grass system.
- Near grass reads as lush clumps.
- Mid and far grass use cheaper geometry with dithered transitions and no obvious density rings.
- Far grass hands off to terrain coverage/tint instead of hard-stopping.
- WebGL fallback remains available until WebGPU ring parity is measured.
- Performance reports separate classic patch grass, WebGPU ring grass, and far terrain coverage.

## 9. Non-Goals

- No full Fable vegetation port in this plan.
- No tree, shrub, rock, deadfall, moss, impostor, or asset-bundle work here; use `procedural-vegetation-authoring-plan.md` for that.
- No Bevy runtime grass rewrite before the CLOD-POC ring has measured parity.
- No coupling grass density to terrain CLOD node LOD.
- No visual performance claims without native Windows visual/QA capture.
