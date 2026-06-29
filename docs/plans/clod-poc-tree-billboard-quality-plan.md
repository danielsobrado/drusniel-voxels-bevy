# clod-poc Tree Billboard (Impostor) Quality Plan (JIRAs)

> Scope: **clod-poc, WebGPU path only.** Improve the visual quality of the baked
> octahedral tree **impostor billboards** now that they engage at normal viewing
> distance (after the `config/trees.yaml` LOD tuning that pulled the far→impostor
> transition inward — see
> [clod-poc-performance-investigation-2026-06-29.md](../performance/clod-poc-performance-investigation-2026-06-29.md)).
> Performance is tracked separately in
> [clod-poc-tree-performance-plan.md](clod-poc-tree-performance-plan.md).
> Bevy port is out of scope.

## Context (current runtime state, 2026-06-29)

Baked WebGPU impostors are **live** (validated real-GPU: 1,651 impostors at the
full-forest view). The material already does more than the original parity plan
assumed:

- `relightTreeImpostorNode` sqrt-decodes albedo and relights with a sun + hemi
  model from the `normalDepth` atlas
  ([tree_impostor_material.ts:163](../../tools/clod-poc/src/trees/tree_impostor_material.ts#L163)).
- A 4-tile view-blend variant samples `treeImpostorUvRect0..3` and blends albedo/
  coverage/normal by weights
  ([tree_impostor_material.ts:56](../../tools/clod-poc/src/trees/tree_impostor_material.ts#L56)).
- Atlas defaults: `octahedralGridSize: 8`, `resolutionPx: 128`, `atlasPaddingPx: 2`,
  `sourceLod: "mid"`, `alphaTest: 0.45`
  ([tree_config.ts:480](../../tools/clod-poc/src/trees/tree_config.ts#L480)).

Known/suspected gaps (to confirm in BQ-1):

- Blended impostor normal is a raw weighted sum with **no renormalization**
  ([tree_impostor_material.ts:144](../../tools/clod-poc/src/trees/tree_impostor_material.ts#L144)) → relight errors.
- Relight does not clamp specular/over-bright and may not match the near-tree
  material's transmission/forest terms → species/lighting mismatch at the LOD seam.
- `crossfade_band_m: 0` in `config/trees.yaml` → **hard far→impostor cut** (pop on
  motion), now more visible at the closer transition.
- 128px @ grid 8 may be too low for hero distances (blocky silhouette / tile bleed).

## Validation harness (use for every BQ story)

Per [CLAUDE.md](../../CLAUDE.md): the **Playwright headless adapter is SwiftShader
software** and `perf:main --freeze 1` does not render vegetation. Use a **headed
Chromium real-GPU** capture (`chromium.launch({ headless:false, args:["--enable-unsafe-webgpu"] })`)
and drive the orbit camera; confirm the adapter is `nvidia` before trusting shots.
The `shoot` harness targets gated scenes that lack the forest, so capture the main
app path and scrape the HUD `n/m/f/i` line for impostor counts.

---

# EPIC BQ-A — Audit & honest baseline

## BQ-1 — Capture the current impostor baseline (real GPU)
**Type:** Story · **Depends on:** —

**Description:** On a headed real-GPU run, capture: (a) a near-mesh tree and its
impostor of the **same species** side by side at the LOD seam distance; (b) a slow
orbit around a single impostor; (c) the far→impostor boundary during a dolly.
Record atlas params actually in effect and whether the single or 4-tile blend
material is wired into the ring.

**Acceptance criteria:**
- [ ] Side-by-side near-vs-impostor shot per species archived with the camera pose.
- [ ] Documented list of concrete defects (lighting mismatch, tile pop, silhouette
      blockiness, seam pop) with screenshot evidence — no guesses; mark "looks ok"
      where it does.
- [ ] Confirmed which impostor material path the GPU ring draws.

**AI execution prompt:**
```
Obey CLAUDE.md (headed real-GPU capture; Playwright headless is SwiftShader). Capture near-mesh vs impostor side-by-side per species at the far→impostor seam, a single-impostor orbit, and a dolly across the boundary. Record the in-effect atlas params and which material (single vs 4-tile blend) the ring uses. Write a defect list with screenshot evidence; do not guess.
```

---

# EPIC BQ-B — Atlas fidelity

## BQ-2 — Resolution / grid / padding sweep
**Type:** Task · **Depends on:** BQ-1

**Description:** A/B `resolutionPx` (128 vs 192/256) and `atlasPaddingPx` against a
documented VRAM budget (atlas is `grid*resolutionPx`; two atlases/species × 6
species). Pick the smallest that removes blockiness at the hero seam without tile
bleed. Confirm `sourceLod` ("mid") gives a faithful silhouette vs near mesh.

**Acceptance criteria:**
- [ ] Chosen `resolutionPx`/padding documented with the VRAM cost and the before/
      after seam shots; no visible bilinear tile bleed across tiles.
- [ ] Bake time stays frame-spread (no boot stall >8 ms; measure in the perf boot window).

## BQ-3 — Coverage/alpha edge quality
**Type:** Task · **Depends on:** BQ-1

**Description:** Verify coverage (atlas A channel) gives clean foliage edges at
`alphaTest: 0.45`; tune to avoid haloing or chewed silhouettes. Confirm sqrt
albedo encode/decode round-trips within tolerance.

**Acceptance criteria:**
- [ ] No alpha halo / no over-eroded crown edges at the seam distance.
- [ ] Albedo encode→decode round-trip unit test within tolerance.

---

# EPIC BQ-C — Relight parity with near trees

## BQ-4 — Renormalize blended impostor normal
**Type:** Story · **Depends on:** BQ-1

**Description:** The 4-tile normal blend sums weighted normals without normalizing
([tree_impostor_material.ts:144](../../tools/clod-poc/src/trees/tree_impostor_material.ts#L144));
normalize the result (and decode from the atlas encoding) before relight so shading
is correct across the view blend.

**Acceptance criteria:**
- [ ] Blended normal is unit-length; impostor shading no longer darkens/flattens
      between octahedral cells.
- [ ] Unit test on the blend+normalize math.

## BQ-5 — Match the near-tree lighting model
**Type:** Story · **Depends on:** BQ-4

**Description:** Make `relightTreeImpostorNode` use the **same** sun + hemi (and a
muted leaf-transmission term) as `tree_node_material`, and **clamp** the highlight
so glancing sun does not produce silver/over-bright crowns. Goal: an impostor reads
as the same tree under the same sun as its near mesh.

**Acceptance criteria:**
- [ ] Near-vs-impostor side-by-side: same species reads as the same colour/shading
      within tolerance under low, noon, and back-lit sun.
- [ ] No silver/over-bright crowns at glancing sun.

---

# EPIC BQ-D — View-blend continuity

## BQ-6 — Octahedral cell selection + 4-tile weights correctness
**Type:** Story · **Depends on:** BQ-1

**Description:** Verify the per-instance view→capture-frame rotation, hemi-octahedral
cell pick, and the four-neighbour bilinear weights (`treeImpostorUvRect0..3`) are
correct for the GPU-ring instance yaw. Add a unit test for cell selection + weights.

**Acceptance criteria:**
- [ ] Slow camera orbit around an impostor shows smooth view interpolation, **no
      tile pop / no flip** at cell boundaries.
- [ ] Unit test covers oct-cell selection and the 4 blend weights.

---

# EPIC BQ-E — Far→impostor crossfade

## BQ-7 — Enable complementary-dither crossfade band
**Type:** Story · **Depends on:** BQ-1; coordinate with the performance plan (overdraw budget)

**Description:** Set a small `crossfade_band_m` (with `crossfade_enabled: true`,
`dither_enabled: true`) so the far-mesh→impostor transition is a complementary
screen-door dither (matched in/out bands), eliminating the hard cut. The impostor
material already consumes `treeLodFade`
([tree_impostor_material.ts:153](../../tools/clod-poc/src/trees/tree_impostor_material.ts#L153));
confirm it dithers identically to the card LODs. Keep the band tight to bound the
double-draw overdraw (the perf plan owns the budget).

**Acceptance criteria:**
- [ ] Slow dolly across the boundary: no pop, no holes; transition is dithered.
- [ ] Frozen boundary frame shows complementary dither (no overdraw doubling beyond
      the band).
- [ ] Measured added frame cost within the budget set by the performance plan.

---

# EPIC BQ-F — Quality gate

## BQ-8 — Impostor visual-honesty acceptance
**Type:** Task · **Depends on:** BQ-2..BQ-7

**Description:** Extend the acceptance suite
([visualHonesty.test.ts](../../tools/clod-poc/src/acceptance/tests/visualHonesty.test.ts))
to assert: impostors lit (not flat), view-blended (no pop on rotation), species-
colour-matched to near mesh within tolerance, crossfade has no seam. Archive the
real-GPU shot battery.

**Acceptance criteria:**
- [ ] Acceptance test fails on unlit/flat impostors, tile pop, species mismatch, or
      a hard seam.
- [ ] `npm --prefix tools/clod-poc test` + `run build` green; shot battery archived
      per CLAUDE.md "Reporting".

---

## Suggested order

1. BQ-1 audit (decides which of BQ-2..7 are actually needed).
2. BQ-4/BQ-5 relight parity (biggest "looks fake" wins).
3. BQ-6 view-blend, BQ-7 crossfade (no-pop).
4. BQ-2/BQ-3 atlas fidelity.
5. BQ-8 gate.
