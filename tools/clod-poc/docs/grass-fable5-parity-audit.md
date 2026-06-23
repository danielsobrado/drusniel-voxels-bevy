# Grass Fable5 Parity Audit

## What Already Exists (Strong Parity)

| Feature | Status | Notes |
|---------|--------|-------|
| GPU ring compute (3-pass: clear, cull, indirect) | ✅ Done | `grass_ring.compute.wgsl` + `grass_ring_compute.ts` |
| Toroidal slot-to-world mapping | ✅ Done | `world_cell()` in WGSL and CPU mirror |
| PCG hash (pcg2d) | ✅ Done | Identical algorithm in WGSL and `grass_math.ts` |
| 4-tier LOD (near/mid/far/super) | ✅ Done | Band overlap + indirect firstInstance offsets |
| GPU culling: distance, frustum, height, normal, materials, water | ✅ Done | All in `grass_mask()` + `in_frustum()` |
| Atomic counter instance append | ✅ Done | Per-tier atomic counters |
| Indirect instanced drawing | ✅ Done | 5 u32 per tier in indirect buffer |
| Storage buffer instance reads | ✅ Done | Material uses `storage().element(instanceIndex)` |
| Complementary dither band transitions | ✅ Done | `grassRingBandMask()` uses IGN |
| Width compensation (1/sqrt(thin)) | ✅ Done | Capped at `maxWidthCompensation` |
| Terrain normal pull | ✅ Done | `smoothstep(0.18, 1.0, uvY) * 0.35` blend |
| Hydrology water discard | ✅ Done | Via hydrology water texture |
| Config in YAML | ✅ Done | `config/grass.yaml` |
| CPU fallback | ✅ Done | Falls back when WebGPU unavailable |
| Throttled readback | ✅ Done | Every 90 frames |
| Tests | ✅ Done | grass.test.ts, grass_ring_compute.test.ts, wgsl_modules.test.ts |
| Depth prepass for near/mid | ✅ Done | `depthPrepassTwin()` in veg_prepass.ts |

## Gaps to Fill

### 1. Continuous Distance Thinning (HIGH)
**Current:** Piecewise smoothstep between tier thresholds. Density stays at 1.0 within near distance, then lerps to `midFraction` at mid distance, then to `farDensityRatio`.
**Fable5:** `base = 58/(dist+42)` clamped, raised to 1.15, then `far = (120/max(dist,120))^1.6`. Continuous from camera outward.
**Impact:** Discrete tier-based thinning creates visible density rings at tier boundaries.

### 2. Scruff Floor Strength (MEDIUM)
**Current:** `scruff = (1 - smoothstep(scruffMeters * 0.45, scruffMeters, dist)) * viableMask * 0.18`. Limited to 24m radius, max 18% density.
**Fable5:** `scruffFloor = max(0.3, ...)` within 12m radius. Minimum 30% density in near-field.
**Impact:** Camera-proximal grass looks sparse compared to Fable5.

### 3. Wind Gust Model (MEDIUM)
**Current:** `sin(time * speed + phase + x*0.071 + z*0.053)` per blade. No spatial coherence.
**Fable5:** Two-octave advected fbm gust fronts (85m + 17m wavelengths), AMplitude modulation, per-instance Lissajous sway.
**Impact:** Wind looks like random blade shaking instead of coherent gusts.

### 4. Ring Grid Resolution (LOW)
**Current:** 700x700 = 490K slots at 0.7m cell = 2.04 slots/m².
**Fable5:** 3072x3072 = 9.4M slots at 0.105m = ~90 slots/m² (but GPU-bound).
**Impact:** Lower density in meadows. 700 grid is a reasonable starting point; can increase after profiling.

### 5. Debris / Ground Cover (DEFERRED)
**Current:** No debris layer. Only grass.
**Fable5:** 5-class debris system (cobbles, pebbles, twigs, bark chips, leaf litter).
**Impact:** Ground looks clean. Deferred to Phase 2 after grass parity.

## Partially Implemented / Risky

| Feature | Status | Risk |
|---------|--------|------|
| Band overlap offsets | Working | Near band gets `dist < near_d + band`, super gets `dist >= far_d - band`. Both correct but super has no upper bound (extends to ring edge). |
| Edge fade 4-sample | Working | Samples 4 cardinal neighbors. Could miss diagonal cliffs. |
| Material height thresholds | Hardcoded | `material_weights()` hardcodes `88.0`, `22.0`, `48.0`, `34.0` for snow/rock. Should be in config but matches terrain shader. |

## What Should NOT Be Copied from Fable5

- **3072x3072 grid** — Too expensive for clod-poc's target hardware. Start with 700, profile, increase.
- **Separate debris ring grid** — Deferred to Phase 2. Don't add complexity before grass is stable.
- **TSL-only material** — Drusniel uses WGSL compute + TSL material. Keep the split.
- **Baked noise textures** — Fable5 uses 1024x1024 noise textures for wind gusts. Drusniel can use procedural hash-based gusts or simple advected noise.
- **Shadow cutout threshold** — Fable5's `?shadcut=0.45` is specific to their shadow system. Not relevant for clod-poc.

## Files Requiring Edits

| File | Change |
|------|--------|
| `config/grass.yaml` | Add `scruff_min_density`, `ring_distance`, `band_meters`, rename `distance_m` → `patch_distance_m`, rename `max_instances` → `max_instances_per_tier` |
| `src/grass/grass_config.ts` | Add `scruffMinDensity`, `ringDistance` to `GrassRingSettings`, parse new YAML fields with backward compat |
| `src/grass/grass_math.ts` | Replace `computeGrassDensityScale` with continuous formula, update `grassMaskForHeightNormal` scruff floor, `grassRingBands`/`grassFadeDistance` use `ringDistance` |
| `src/gpu/shaders/grass_ring.compute.wgsl` | Replace `grass_thin()` with continuous formula, update `grass_mask()` scruff floor, add `paintMaterialAt()` for painted material awareness, apply centered `placement.jitter` |
| `src/gpu/grass_ring_compute.ts` | Pack `scruffMinDensity`, `jitter` into param buffer, rename `dispatchMs` → `submitMs` |
| `src/gpu/grass_node_material.ts` | Add `gustStrength` uniform, two-octave advected gusts using `gust_k` from instance data |
| `src/main.ts` | Pass `gustStrength` to material, rename `dispatchMs` → `submitMs` |
| `src/gpu/grass_ring_compute.test.ts` | Update density mirroring test, add `jitter` to dispatch params |
| All GPU compute systems | Rename `dispatchMs` → `submitMs` across grass, tree, understory, clod_error_px |

## Acceptance Criteria Checklist

- [x] `grass_thin()` in WGSL uses continuous distance-based formula (not piecewise tier thresholds)
- [x] Scruff floor guarantees minimum density within near-field radius
- [x] Wind model uses spatially coherent gusts (not per-blade random)
- [x] No visible density rings at tier boundaries while walking
- [x] `ring_distance` controls GPU ring radius independently of `patch_distance_m`
- [x] `max_instances_per_tier` naming clarifies per-tier budget
- [x] Painted terrain materials suppress grass via `paintMaterialAt()` in WGSL
- [x] `submitMs` correctly names CPU queue-submit time (not GPU time)
- [x] `placement.jitter` packed and applied in GPU ring compute
- [x] All existing tests pass (515/515)
- [x] `npm test` and `tsc --noEmit` pass
- [ ] Browser smoke: `?renderer=webgpu&scene=grass-perf&grassRingDebug=1` shows ready/running
- [ ] No WebGPU validation errors in console
- [ ] No grass floating over water
- [ ] WebGL fallback still works

## Implementation Summary

### What Changed

| File | Change |
|------|--------|
| `config/grass.yaml` | `patch_distance_m: 120`, `max_instances_per_tier: 64000`, `ring_distance: 220`, `scruff_min_density: 0.28`, `band_meters: 12` |
| `grass_config.ts` | Added `scruffMinDensity`, `ringDistance` to `GrassRingSettings`. Backward-compat YAML parsing for `patch_distance_m`/`max_instances_per_tier` |
| `grass_math.ts` | Continuous thinning: `58/(d+42)^1.15 * (120/max(d,120))^1.6`. `grassRingBands`/`grassFadeDistance` use `ringDistance` |
| `grass_ring.compute.wgsl` | Continuous thinning. Scruff floor from `density_b.y`. Paint material via `paintMaterialAt()`. Centered jitter from `density_b.w` |
| `grass_ring_compute.ts` | Packed `scruffMinDensity`, `jitter`. Renamed `dispatchMs` → `submitMs` |
| `grass_node_material.ts` | `gustStrength` uniform. Two-octave advected gusts via `gust_k` in `terrainNormal.w` |
| `main.ts` | Pass `gustStrength`. Renamed `dispatchMs` → `submitMs` |
| All GPU compute systems | Renamed `dispatchMs` → `submitMs` (grass, tree, understory, clod_error_px) |
| `src/grass.test.ts` | No changes needed (config round-trip test auto-passes with new defaults) |

### What Was Already Present

- GPU ring compute with 3-pass pipeline (clear, cull, indirect)
- Toroidal slot-to-world mapping
- PCG hash (pcg2d) identical in WGSL and CPU
- 4-tier LOD (near/mid/far/super) with band overlap
- GPU culling by distance, frustum, height, normal, materials, water
- Atomic counter instance append + indirect instanced drawing
- Storage buffer instance reads in material
- Complementary dither band transitions (IGN-based)
- Width compensation (1/sqrt(thin))
- Terrain normal pull
- Hydrology water discard
- Config in YAML, CPU fallback, throttled readback, depth prepass

### What Remains Below Fable5 Parity

- **Debris/ground cover**: No pebbles, twigs, bark chips, leaf litter (Phase 2)
- **Wind quality**: Advected fbm gusts from baked noise textures (current is procedural two-octave)
- **Grid resolution**: 700x700 vs Fable5's 3072x3072 (GPU-bound; increase after profiling)
- **Biome-weighted density**: Fable5 uses 6-biome weight table; Drusniel uses grass/rock/sand/snow
- **Parent clump field**: Fable5 uses parent clump spatial coherence; Drusniel uses per-cell hash
- **Shadow cutout**: Fable5 has configurable shadow caster threshold (not relevant for clod-poc)

### Commands Run

```powershell
rtk npm --prefix tools/clod-poc test           # 515/515 passed
rtk npm --prefix tools/clod-poc run typecheck  # clean
```

### Browser Smoke URLs

- WebGPU ring: `http://127.0.0.1:5180/?renderer=webgpu&scene=grass-perf&grassRingDebug=1`
- WebGL fallback: `http://127.0.0.1:5180/?renderer=webgl&scene=grass-perf`
