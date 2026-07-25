# Tree flicker + vegetation regressions — analysis and checkpoints (2026-07-21)

Handoff document. Captures the diagnosis of the tree "blinking / light-darkness changing
non-stop" bug plus several other regressions found while bisecting, with the exact
commits, measurements, and tooling needed to continue in a fresh conversation.

## CONFIRMED (2026-07-21) — bake paths free GPU buffers while their submits are in flight

Found by stack trace, not by inspection. Enable `?gpuDestroyTrace=1` (see
`src/rendering/gpu_buffer_destroy_trace.ts`) to log a stack for every `GPUBuffer.destroy()`;
reproduce, then read the `[gpu-destroy]` stacks logged just before the validation errors.

Every tree bake path is shaped `render → await → dispose`. The `await` is what makes it
unsafe: the render pass is still executing on the queue when the free lands, so the backend
reports `[Buffer (unlabeled)] used in submit while destroyed` (hundreds per bake) and the
frame goes black.

Confirmed sites (all now routed through `disposeAfterGpuIdle()`):

| File | Site |
|---|---|
| `tree_impostor_baker.ts` | `captureSpeciesChannel` `finally { geometry.dispose() }` — fires per species × variant × channel (the 400× flood) |
| `tree_impostor_baker.ts` | bake render targets, bake materials `finally`, and the atlas's own `dispose()` (runs when an atlas is swapped while frames still sample it) |
| `tree_foliage_atlas_baker.ts` | `finally { geometry/material/renderTarget.dispose() }` after `render()` + awaited readback |

`disposeAfterGpuIdle()` (`src/rendering/deferred_gpu_dispose.ts`) holds the resource until
`device.queue.onSubmittedWorkDone()` resolves, falling back to immediate disposal when
there is no WebGPU device (WebGL, tests).

**Repro:** toggle `depth prepass max LOD` in the trees panel → settings update → asset
rebuild → impostor re-bake → flood + black frame. Note the bake is driven by
`tree_controller` on **settings updates**, so it compounds with the presence-vs-value bug
below (which made every update trigger a rebuild).

**Four earlier attempts at this crash missed** because they patched the ring *teardown*
path (`tree_system_gpu_ring_resources`, `tree_system_lifecycle`,
`tree_gpu_ring_resource_lifecycle`). Those were real defects but not this one. Lesson: get
the stack before patching dispose sites.

## GPU ring torn down on every settings update

`planTreeSystemSettingsUpdate` tested **presence, not value**:

```ts
const ecologyChanged   = patch.ecology   !== undefined;
const speciesChanged   = patch.species   !== undefined;
const windChanged      = patch.wind      !== undefined;
const impostorsChanged = patch.impostors !== undefined;
```

`tree_controller.makeSettings()` always emits a **complete** settings object (`lod`,
`ecology`, `impostors`, `wind`, `render`, `gpu`), so all four were true on every update →
`clearGpuRing = true` → the whole GPU tree ring was destroyed and rebuilt each time.
`needsPatchRefresh` had the same defect, rebuilding CPU patches too.

Observed console signature on main (07-21): `Buffer (unlabeled) used in submit while
destroyed` ×400 against `renderContext_3/4`, `Draw with a vertex count of 0 is unusual`,
and a black frame — i.e. buffers freed while the previous frame's submit still referenced
them, and draws issued against a just-cleared ring.

This single defect accounts for every symptom simultaneously: blinking (ring repopulating),
"only near LOD" (ring never finishes filling farther groups), the buffer-destroyed flood,
and the zero-vertex draws. It is also why prepass / crossfade / shadow / contrast / stride
fixes all failed — they act on trees being destroyed and rebuilt underneath them.

**Fixed:** all four sections now compare values via `treeSettingsSectionChanged`, and the
scalar fields in `needsPatchRefresh` via `scalarChanged`. Typecheck clean, full suite
4881/4881. One test updated: it asserted `needsPatchRefresh === true` for an *unchanged*
`lod` patch, encoding the wasteful behaviour.

**Status: awaiting visual confirmation.** Three earlier hypotheses (prepass, crossfade
cap, stride) were each disproven by measurement — do not treat this as settled until the
blinking is confirmed gone in-app.

## Also fixed (real defects, independent of the blinking)

- **Ring instance buffer stride mismatch** (below) — `tree_material_parity.ts` and
  `tree_ring_lod_crossfade_material.ts` read a 6-vec4-per-record buffer with stride 1.
- **WGSL reserved keyword** — `layout` as a struct field made Dawn reject the whole
  `dressing grass-contact` shader (`'layout' is a reserved keyword`), silently disabling
  that GPU field on every load. Renamed to `dims`.

## Ring instance buffer stride mismatch

The GPU ring writes **six vec4 values per tree record** (`TREE_INSTANCE_VEC4S = 6u` in
`src/gpu/shaders/tree_ring.compute.wgsl`, written by `write_tree_record`):

```
[0] position_scale   [1] rotation_normal_y   [2] identity   [3..5] morphology0..2
```

The continuous-morphology work (in the 07-14→07-15 bracket) expanded that record and
updated only its own reader. Two other readers kept indexing with a **stride of 1**:

| Reader | Was | Effect |
|---|---|---|
| `tree_material_parity.ts` (`createRingForestLighting`) | `capacity`, `.element(instanceIndex)` | each tree sampled the **forest lighting** textures at a bogus `forestUv` |
| `tree_ring_lod_crossfade_material.ts` | `capacity`, `.element(instanceIndex)` | **LOD distance + dither noise** computed from a neighbouring record's bits |
| `morphology/node_deformation.ts` | `capacity * 6`, `.element(instanceIndex*6)` | correct |
| `understory_node_material.ts` | `capacity` | correct — separate 1-vec4 buffer |

Why it *blinks* rather than merely looking wrong: `append_tree` assigns each tree's slot
with `atomicAdd(&counters[group], 1u)`, so which tree occupies which slot is
**nondeterministic every dispatch**. The mis-strided reads therefore returned *different*
garbage each frame — per-frame lighting flashes ("light coming right and left, dark, less
dark") and per-frame dither/LOD flips ("only closer LODs").

This sits upstream of every earlier suspect, which is why the prepass, crossfade dither,
shadow and contrast experiments all came back null, why 07-16 is full of "stabilize
dithering" commits treating symptoms, and why later merged PRs never fixed it.

**Fix applied:** exported `TREE_RING_INSTANCE_VEC4S` from `tree_ring_placement.ts`; all
readers now index with it and take `position_scale.xz` (which already holds the jittered
world position) instead of reconstructing from a mis-read cell. The magic `6` in
`node_deformation.ts` was replaced with the shared constant so the record layout cannot
desync again. Typecheck clean; full suite 4881/4881 green.

## Superseded theory (kept for context)

The blinking is **LOD oscillation**: trees re-decide their LOD every dispatch and flip
between levels. Evidence:

- Dither ON → blinking. Dither OFF (crossfade capped to 0) → **faster hard popping**,
  confirmed visually. Same underlying oscillation, two different visual skins.
- `tree_hard_lod()` in `src/gpu/shaders/tree_ring.compute.wgsl` is a **stateless**
  distance→LOD function. Grepping the whole ring compute for
  `hysteres|prev_lod|previous|stable` returns **nothing** — the GPU ring path has **no
  hysteresis**. The CPU path (`tree_lod.ts` → `lodWithHysteresis`) does, and it is only
  applied when crossfade is inactive.
- Suspect for *visibility*: `664f7ce82` (07-14) "restore directional contrast in WebGPU
  trees". At the last known-good commit the user described trees as **"washed out"** and
  not blinking; raising directional contrast would make a pre-existing oscillation suddenly
  flash. Consistent with the foliage geometric-normal fix (which shrinks the lit/dark
  delta) cutting churn 52% without removing the cause.

Implication: the durable fix is to make GPU-ring LOD selection stable (hysteresis /
per-tree previous-LOD state), not to toggle the crossfade or tune shading.

## Remaining unsafe GPU frees are inside three.js (not app code)

With `?gpuDestroyTrace=1` (now logging only frees that bypass `disposeAfterGpuIdle`), the
app-side unsafe frees are gone. What remains:

- `WebGPUTextureUtils.copyTextureToBuffer` — three.js's own readback staging buffer, freed
  during `readRenderTargetPixelsAsync` from `bakeTreeFoliageAtlas` /
  `readTreeImpostorAtlasPixels`. The 500× `renderContext_1` errors follow immediately.
- `RenderObjects.get` → `RenderObject.dispose` — three.js evicting render objects **during**
  `_renderObjects`.

Neither is patchable from app code. The app-level lever is that the impostor/foliage bake
runs **concurrently with the render loop** at startup (`bakeImpostors` is awaited inside
`runRuntimeSystemsStartup` while frames are already being submitted). Sequencing the bake
so it does not overlap live frames — or draining the queue around the readback — is the
real fix. Not attempted.

## BISECT HALTED (2026-07-22) — the flicker probe cannot discriminate good from bad

The bisect in `664f7ce82`(clean) → `4e32f47ac`(blinking) was run to its midpoint and then
**stopped, because the measurement it depends on was shown to be invalid**. Three probe runs,
same worktree, same server (5181), same pose, same build tooling, back to back:

| Commit | Date | Premise | hard-flips >60 | churn/frame-pair | What f00 actually shows |
|---|---|---|---|---|---|
| `664f7ce82` | 07-14 | **clean** | **17.0%** | 1.93% | dense in-canopy foliage |
| `36313d32e` | 07-14 | (midpoint) | **17.2%** | 1.98% | dense in-canopy foliage |
| `4e32f47ac` | 07-15 | **blinking** | **1.9%** | 0.16% | **open grassland, distant treeline** |

Two independent defects in the method, either one fatal:

**1. The metric reads ~17% at the commit we call clean.** `664f7ce82` and the midpoint are
statistically identical (17.0 vs 17.2), and their heatmaps are indistinguishable. A bisect
needs good ≠ bad on the metric; here good ≈ bad ≈ every other in-canopy reading ever taken
(main 15.1%, 07-17 12.4%, midpoint 17.2%, clean 17.0%). The number is flat across the entire
history including known-good commits, so **it was never measuring the blinking.** Almost
certainly it is dominated by the per-frame alpha-test/dither stipple of dense near foliage,
which is present at every commit — clearly visible as stipple texture in every in-canopy f00.

This retroactively weakens the "each disproven by measurement" verdicts in *Ruled out* below:
prepass 15.3-vs-15.1 and crossfade 1.3-vs-1.4 were null results from an instrument that also
reads null between clean and blinking. Those hypotheses are **un-ruled-out**, not disproven.

**2. The world moves inside the bracket.** The doc already warned the world moved after the
07-21 merges; it also moves between 07-14 and 07-15. At `4e32f47ac` the pose (256, 34, 263)
is open field, so its 1.9% means "almost no trees in frame", not "less blinking". The bracket
straddles `feat(clod-poc): advance GPU vegetation authority`, `fix(erosion): feed canonical
wetness into tree ecology`, and the vegetation-exclusion commits — all of which change *where
trees are placed*. A fixed world pose is not comparable across this range, and any per-commit
percentage is confounded by tree coverage in frame.

### Second instrument also failed: the `trees.*` LOD counters

The proposed replacement — per-LOD tree population from `__drusnielClod.stats.counters`
(`trees.near/mid/far/impostor`) — was built and abandoned the same session. Two hard blockers,
both worth knowing before anyone rebuilds it:

- **They are 250ms debug mirrors, not per-frame values.** `clod_frame_loop.ts` writes them only
  when `mirrorDue` (`DEBUG_COUNTER_MIRROR_INTERVAL_MS = 250`). Frame-to-frame LOD churn — the
  blinking itself — is not observable through them at all. Only steady-state distribution is.
- **They freeze after a teleport.** The mirror block is guarded by `if (currentTreeStats)`, and
  `stats.getTreeStats()` returns null after `setPose`, so the counters keep their last written
  values indefinitely. Measured: 25 camera positions spanning 320m all returned byte-identical
  counters, with `camera_to_vegetation_trees_center_m` pinned at 99.3m throughout. Any reading
  taken after a `setPose` is stale, not current.

So the automated options are: pixel luma (flat across clean/bad), and these counters (stale after
the only pose mechanism the harness has). **Visual A/B by a human is currently the only working
discriminator for this bug** — which is what the bisect checkpoints table was built from, and why
it is the only thing that has produced a real verdict so far.

### Main-line topology (resolved 2026-07-22)

The 11 tree-touching commits are **not** all on main's first-parent line. The continuous-morphology
trio (`f7ec7555b`, `18be683d0`, `f1175d0a0`) plus `e37518d2d`, `c8506738b`, `c088edf75` live on a
side branch that enters main as **one merge**:

```
febecb3ca  (merge, 07-15)
  parent1  bad2190f5  "performance improvements"   <- main immediately before
  parent2  caf10ca16  "test(clod-poc): cover vegetation authority height masks"  <- branch tip
```

(Verified with `git cat-file -p febecb3ca`; note `git log --format=%h/%p` gave mangled output here
— see [[rtk-git-output-unreliable]]. Read the raw object when topology matters.)

This makes the whole morphology + vegetation-authority branch testable in **one glance** at
`bad2190f5`, which splits the range 34 / 17 first-parent commits:

- `bad2190f5` **clean** → the bug arrives with merge `febecb3ca`; the standout suspect is confirmed
  and the search moves inside that branch.
- `bad2190f5` **blinking** → the bug predates the morphology work entirely; it is exonerated, and
  the culprit is among the 34 lightning/spell/docs commits in `664f7ce82..bad2190f5`.

### Visual bisect chain (the only verdicts that count)

All by direct visual inspection at `?oceanRim=0&webgpuSelection=1&materialTiers=1`, served from
the bisect worktree on port 5181.

| Commit | Date | Verdict | What it means |
|---|---|---|---|
| `664f7ce82` | 07-14 | clean | bracket floor |
| `bad2190f5` | 07-15 | **clean** | main immediately before the merge — **the 34 pre-merge lightning/spell/docs commits are exonerated** |
| `febecb3ca` | 07-15 | **blinking** | the merge — **the bug is on the merged branch** |
| `18be683d0` | 07-15 | **BROKEN — skip** | tree ring shader does not compile; no trees at all (see below) |
| `c8506738b` | 07-15 | **BROKEN — skip** | no trees; broken stretch spans at least branch index 66→80 |
| `f1175d0a0` | 07-15 | **blinking** + "near LOD only" | **first renderable commit after the broken stretch** (branch idx 84) — bug is intrinsic to the rebuilt ring; culprit pinned |
| `4e32f47ac` | 07-15 | **blinking** + "near LOD only" | bracket ceiling |

**Bisect conclusion:** the tree ring goes clean (pre-branch) → broken WIP (idx 66–82, renders no
trees) → renderable-and-blinking (`f1175d0a0`, idx 84). There is no renderable commit between the
clean baseline and `f1175d0a0` to split further, so the blinking is a property of how the
continuous-morphology work rebuilt the ring — the record-stride change documented below. Culprit
identified; the remaining work is code-level, not more bisecting.

`bad2190f5` clean + `febecb3ca` blinking pins the bug to the merged branch (`bad2190f5..caf10ca16`,
95 commits, 15 of which touch tree/vegetation paths).

**Many branch commits are broken WIP and cannot be voted on.** At `18be683d0` the composed tree ring
shader fails with `unresolved call target 'write_tree_record'` → no trees render at all. Both the
definition and the calls are in `tree_ring.compute.wgsl`, so a WGSL *transform* in the
`wgsl_modules.ts` pipeline (`applyTreeRingSpeciesWgslExpansion` /
`applyTreeRingWgslLayoutConstants` / `tree_ring_wgsl_transforms.js`) drops the definition during
composition. Grepping the source file for `fn write_tree_record` is **not** a sufficient screen —
it is present there and still unresolved after composition.

Use `tools/clod-poc/tools/screen-tree-buildable.ts` to skip these without spending a human glance:
it boots the page and reports BROKEN/BUILDABLE from console WGSL errors plus tree-mesh presence.
That signal is binary and safe to automate, unlike the flicker metrics.

### ROOT CAUSE CONFIRMED — the stride mismatch is real (a mid-session self-correction)

An earlier draft of this section claimed the stride theory was *disproved*. **That was wrong**, and
the error came from trusting a mislabeled `for`-loop over `git show` (see [[rtk-git-output-unreliable]]):
it reported `TREE_INSTANCE_VEC4S = 6u` "at `bad2190f5`" when that constant does not exist there at all.
Re-checked one commit at a time with no loop:

| | `bad2190f5` (CLEAN) | `f1175d0a0` (BLINKING) |
|---|---|---|
| `out_cell` layout | `array<vec4<f32>>`, **1 vec4 per tree** | same buffer, **6 vec4 per tree** |
| write index | `out_index = group*max_per_group + slot` | `out_index = (group*max_per_group + slot) * TREE_INSTANCE_VEC4S` (`= 6u`) |
| `write_tree_record` | **does not exist** | writes `[0]position_scale [1]rotation_normal_y [2]identity [3..5]morphology0..2` |
| the two TS readers | `records.element(instanceIndex)` — **correct at stride 1** | *unchanged* → now reads vec4 `#instanceIndex` of a **6-wide** record → wrong |

The continuous-morphology work **grew the per-tree ring record from 1 vec4 to 6** and updated the
compute writer, but `tree_material_parity.ts` (forest-lighting UV) and
`tree_ring_lod_crossfade_material.ts` (LOD distance + dither) kept indexing at stride 1. Because
`append_tree` assigns each tree's slot with `atomicAdd` — nondeterministic every dispatch — the
mis-strided reads returned *different* neighbouring records each frame. That is the mechanism for
both symptoms: per-frame forest-lighting flashes (lighting UV from a moving record) and per-frame
LOD/dither flips ("only near LOD", "light coming and going"). This is exactly what the original
*Ring instance buffer stride mismatch* section higher up describes; that section was right and the
"disproved" rebuttal was the mistake.

The byte-identical readers across the boundary are **not** exoneration — they are the bug: they
*should* have gained the `* stride` factor when the record widened, and did not.

### Status of the fix on current main (07-23)

The stride fix (`071afd64c`) **is present and correct for every reader found**:

- `tree_ring_placement.ts` exports `TREE_RING_INSTANCE_VEC4S = 6`.
- `tree_material_parity.ts:193` and `tree_ring_lod_crossfade_material.ts:134` now read
  `records.element(instanceIndex.mul(TREE_RING_INSTANCE_VEC4S))`, and both derive everything
  (world XZ, placement cell, dither noise, LOD distance) from field 0 only — so the dither is now
  deterministic per tree, not per-dispatch. The shader writes with `* TREE_INSTANCE_VEC4S = 6u` to
  match.

So the historically-confirmed root cause is already repaired on main. **If main still blinks at the
repro pose, it is a residual/second cause, not this one** — and the search space is the 07-15→07-23
range, not the original `664f7ce82..4e32f47ac` bracket. Next actions, in order:

1. Re-confirm (human eyes, no working automated discriminator) whether main *still* blinks at
   `?oceanRim=0&webgpuSelection=1&materialTiers=1`. If it is clean, the effort is done.
2. If it still blinks, audit the remaining render-side record consumers for stride/offset
   correctness — `tree_node_material.ts`, `tree_ring_far_node_material.ts`,
   `tree_ring_impostor_node_material.ts`, `tree_crown_proxy_node_material.ts` — since fields
   `[1]rotation` / `[2]identity` / `[3..5]morphology` are read there, not just field 0.
3. Only then reopen the crossfade-dither / GPU-ring-hysteresis line, which is a separate concern.

Incidental: `Draw with a vertex count of 0 is unusual` appears in the console at `bad2190f5`, which
is **clean**. That warning is therefore not sufficient to cause the blinking — the doc previously
listed it as part of the ring-teardown signature. Do not treat it as a marker for this bug.

### What a valid discriminator needs

- **Coverage-invariant**: measure LOD churn per *tree*, not per screen pixel — e.g. sample the
  per-frame LOD histogram / ring counters via `window.__drusnielClod.stats` across N frames and
  score how many trees change LOD bucket between frames. Oscillation shows up directly and does
  not care how much canopy fills the viewport.
- **Per-commit pose**: if a pixel metric is kept, the pose must be re-derived at each commit
  (query the scene for a dense tree cluster, then aim at it) instead of reusing (256, 34, 263).
- **Validated on the endpoints first**: whatever replaces it, run it on `664f7ce82` and a
  confirmed-blinking commit and require a clear separation *before* spending it on midpoints.
  That check is what this session did, and it is what the previous ~15 probe runs skipped.

The 11 candidate commits (`git log 664f7ce82..4e32f47ac -- 'tools/clod-poc/src/trees/*'
'tools/clod-poc/src/gpu/*tree*'`) are unchanged and still the right search space; the
continuous-morphology trio (`f7ec7555b`, `18be683d0`, `f1175d0a0`) is still the standout
suspect. Nothing about the *bracket* is disproven — only the instrument used to walk it.

Worktree state: `F:/drusniel-cache/tmp/bisect-wt` left detached at **`bad2190f5`** (pre-merge
main), dev server running on port 5181, awaiting a visual verdict. Probe outputs in
`tools/clod-poc/shots/bisect-{664f7ce82-control-good,36313d32e,4e32f47ac-control-bad}/`.

Confirmed by the user on 2026-07-22: `4e32f47ac` reproduces **both** the blinking and "near LOD
for trees only", at `?oceanRim=0&webgpuSelection=1&materialTiers=1`. Note those flags differ from
what the pixel probe ran (`?oceanRim=0&customProps=1` — no `webgpuSelection`, no `materialTiers`),
a third confound on top of the two above: **the probe was not measuring the configuration that
reproduces.**

## 2026-07-23 — main STILL blinks after the stride fix; symptom re-described as a moving ground shadow

Two new facts from this session change the shape of the problem.

**1. The stride fix is on main and correct, yet main still blinks.** `d5922717e` (main HEAD) has
`071afd64c`; both storage readers use `* TREE_RING_INSTANCE_VEC4S` and derive everything from field 0.
Screened BUILDABLE. User confirmed by eye: **still blinking, still only one tree LOD.** So the ring
stride bug — real, and the whole story at `f1175d0a0` — is **not** the only cause.

**2. The user re-described the blink**, and it does not match tree-record garbage:

> "the light changes position, also impacts the ground light … the blinking is really texture shadow …
> only 1 LOD of the trees is still visible"

So the visible blink is a **moving texture/shadow that also lands on the ground**, distinct from the
"only 1 LOD" collapse. These are being treated as **two separate bugs** now, not one.

### Why this is likely a *different, later* regression than the bisected one

- `src/forest_lighting/` is **byte-unchanged across the bisect boundary** `bad2190f5 → f1175d0a0`
  (the diff earlier reported "unchanged" against `src/trees/forest_lighting/`, a **path that does not
  exist** — the real path is `src/forest_lighting/`; re-checked, genuinely unchanged there too). So at
  `f1175d0a0` the moving-shadow could only come through the ring-stride corruption of the forest-UV
  that *trees* sample (`tree_material_parity.ts`) — a tree-only effect.
- But `forest_lighting_texture.ts` was **reworked +218 lines AFTER the bracket**, on main's own line:
  `8af5b2fbd` (07-19, "expose canonical forest light GPU texture"), `5a9d817cf` + `db86cdb1a` (07-20,
  "canonical canopy ecology" / "P0 canopy ecology authority"). This added a **GPU texture path** for
  the forest lighting field, which packs `ambientOcclusion / shadowProxy / fogDensity / sunShaftMask`
  — i.e. exactly the ground shadow the user now describes.

Working hypothesis: the ground-shadow blink on main is a **forest-lighting GPU-texture instability
introduced 07-19/07-20**, separate from (and later than) the 07-15 tree-stride blink that was already
fixed. Not yet proven — do not treat the three commits above as the cause until measured.

### This symptom finally admits a valid discriminator

The canopy flicker probe failed because dense foliage alpha-test stipple dominates it. A **moving
shadow on static ground** does not have that problem: pick a ground-only ROI (no canopy) at a frozen
pose and measure per-pixel luma variance across frames. Validate it on `bad2190f5` (clean ground) vs
`d5922717e` (blinking ground) first — if it separates, it is the first automated discriminator this
investigation has had, and it can bisect the 07-15→07-23 range. Ground is static geometry, so any
frozen-pose per-frame change there is real signal, and it is coverage-stable.

### Ruled out this session (checked, not assumed)

- **`diag polish` flips are NOT the per-frame ground flicker.** The HUD line
  `diag polish: candidates=41,703 flips=7,117 …` looks like a live oscillation counter but
  `polishDiagonals` (`src/diagonalPolish.ts`) runs only at **page build time** in
  `clod/quadtree.ts`, and `world.polishLine` is a **static build summary** (`info_panel_startup.ts`).
  `flips` is the cumulative count from building all pages, not a per-frame number. (Note there *is*
  a latent non-idempotency in `polishDiagonals`: `chooseBestQuadDiagonal(..., "ac", …)` hardcodes
  the current diagonal as `"ac"`, so a rebuilt page could flip a quad back — worth fixing if pages
  rebuild in place, but it is not the frozen-pose flicker.)

### Live HUD readout at the repro pose (main, 07-23)

`forest light: canopy=1.00 ao=0.62 shadow=0.00 fog=0.00 tex=1`. The forest **AO** term is active
(0.62), shadow-proxy is 0. So the ground darkening the user sees is the forest-lighting **AO**
texture — which is exactly what `forest_lighting_texture.ts` (+218 lines, GPU-texture path,
`8af5b2fbd`) now produces. Standing prime suspect for the moving ground shadow.

### 2026-07-23 cont. — the ground flicker is per-frame / FPS-coupled → terrain LOD-transition, not lighting

More user-driven isolation, each result empirical:

- **Forest lighting OFF → no change.** The forest-AO texture suspect is **wrong**. Ruled out.
- **Water OFF → flicker got *faster*.** Removing water's cost raised FPS and the flicker sped up →
  the flicker is **per-frame and FPS-coupled** (it flips state every rendered frame). That rules out
  timers, build-time work, and 250ms-throttled effects, and points at per-frame render state.

Leading hypothesis: **terrain CLOD LOD-transition crossfade is stuck active.**
`terrain_frame_phase.ts:275` calls `view.mat.setFade(fade, …, fade > 0.001 && fade < 0.999)` — the
terrain material's screen-door **fade dither** (`terrain_node_material.ts:615`,
`interleavedGradientNoise(screenCoordinate)` → `discard`) turns on whenever a view's `fade` is
strictly between 0 and 1, i.e. mid-transition. If CLOD streaming never settles at a frozen pose
(perpetual transitions / root thrash — see the `live_clod_stream_transition_active_roots`,
`root_switches_total` counters), two overlapping tessellations of the same ground are drawn every
frame with complementary dither. Their normals differ, so the lighting/"texture shadow" appears to
jump between them each frame — exactly "the light changes position on the ground", and FPS-coupled.
It also explains **"only 1 LOD"**: if the transition can't complete, the far/other LOD never commits.

This is a **terrain streaming** bug, unrelated to the tree-ring stride bug that was correctly fixed.
The two symptoms the user chased were never one bug.

### Terrain LOD-transition ALSO ruled out (user, 07-23)

`force max level = 3` + `freeze selection = ON` → **no change, still flickering.** With the terrain
pinned as static geometry, the transition dither cannot be running, yet the ground shading still
flips per frame. So the flicker is a **per-frame lighting / screen-space input to static terrain**,
not the mesh or its LOD transitions. (Console also floods with `Buffer used in submit while
destroyed` against `renderContext_1` every frame — per-frame GPU resource churn, consistent with a
screen-space pass rebuilding a resource each frame.)

### 2026-07-23 cont2 — post-process ruled out; user reports SUN moves with the MOUSE

`gtao=0`, `froxels=0`, `godRays=off`, `bounce=0` each tested alone → **none stopped the flicker.**
Screen-space post-process is fully ruled out. (Disabling all at once → WebGPU device-lost,
`Instance dropped in popErrorScope`; the all-off combo trips a resource crash, not a clean test.)

Then the decisive user observation:

> "when I am in player mode and I move the mouse the sun moves as well — that is the issue."

So the **sun / lighting direction is coupled to the camera view** in player mode. Every symptom
follows from this: mouse-look updates the camera every frame → the sun swings → shadows / the
sun-light visibility atlas move across the static ground → per-frame, FPS-coupled "texture shadow
that changes position", plus "only 1 LOD" as an unrelated second bug.

**Verified world-fixed (so the coupling is indirect, not a direct assignment):**
- `environment.ts:223` builds `sunDirection` from `sunAzimuthDeg`/`sunElevationDeg` (constants;
  no runtime writes found).
- `realtime_sun_shadows.ts` `updateSunPose` uses camera **position** only (translation is fine;
  keeps direction constant).
- `setupCsmSunShadows` passes camera but `void camera` — CSM takes direction from the `sun` light,
  frusta follow camera normally.

Candidate indirect couplings still to check: (a) the **sun-light visibility atlas** bins `sunVec`
(`light_update.ts` `toSunBin`) and rebuilds tiles when the bin flips — if `sunVec` jitters per frame
the ground AO/shadow atlas rebuilds every frame; (b) a **view-relative lighting term** in a terrain
material (lighting computed in view space and not transformed back to world); (c) **player-mode camera
input** writing an environment/sky value. The `sunVec` passed into `light_update` comes from
`currentLighting().sunDirection` (world-fixed), so if the atlas still flips, suspect (b)/(c).

**Decisive narrowing test needed:** does the flicker happen in **Orbit** mode, or **only Player**
mode? Orbit and Player use different camera/input paths; "only Player" localizes the bug to
player-mode camera/lighting handling. Also worth: set a fixed sun via `&sunElevationDeg=55&sunAzimuthDeg=128`
and see whether mouse-look still swings the lighting (isolates render-time coupling from the sun
angle source).

### God rays move with the mouse = expected parallax (NOT the flicker)

User: "I move the mouse and the god rays are in a different place." God rays radiate from the sun's
**projected screen position** (`postprocess.ts:616` `projectSunToScreen(sunDir, camera)`), so looking
around moves their origin — normal. Consistent with `godRays=off` not stopping the flicker. This is
almost certainly what "the sun moves with the mouse" was too: fixed-world sun, screen parallax. So
the earlier "camera-coupled sun direction" framing is likely **not** a bug — downgrade that lead.

### Concrete live bug to chase next: per-frame `renderContext_1` buffer-destroy churn

The console shows 500+/frame `[Buffer (unlabeled)] used in submit while destroyed` against
`renderContext_1`, plus `Draw with a vertex count of 0`. A GPU buffer is freed while the render's
command buffer still references it, every frame. Two known sources:
- `gpu_timestamp_recorder.ts` frees timestamp readback buffers per frame (diagnostic; not a render
  input — noise, not flicker).
- three.js `RenderObjects.get → RenderObject.dispose` evicting render objects **during** the render
  pass (doc's CONFIRMED section) — this **can** flicker: objects destroyed + rebuilt mid-frame,
  matching the zero-vertex draws.

**Next step handed to user:** reproduce with `?…&gpuDestroyTrace=1` (see
`src/rendering/gpu_buffer_destroy_trace.ts`) and read one `[gpu-destroy] UNSAFE …` stack — it names
the exact buffer + call site being freed mid-submit. That is the single most decisive remaining
diagnostic and directly answers "what about these errors?".

### 2026-07-23 cont3 — the reports separate into TWO distinct problems

After extended user-driven isolation it is clear there are (at least) two different things, and
conflating them is why nothing converged. TAA/jitter also ruled out (`&taa=0` / `&jitter=0` — user
had tested before, no change).

**Problem B (now diagnosed): player camera "stuck, then unsticks" + god-ray source follows mouse.**
User: "the camera is stuck and then moving the mouse moves exactly the source of god rays for a
while." Mechanism, confirmed in code:
- `player_input_controller.ts:230-235` — in `"playing"` mode, `updateFrame` sets camera **position**
  from `player.update()` and **rotation** from mouse yaw/pitch. Rotation is *not* gated.
- `player_controller.ts:381-387` — `player.update()` **blocks translation** when
  `movementReadiness(aheadX, z) === "blocked"` (colliders ahead not ready). Wired at
  `renderer_startup.ts:319-320` via `movementReadinessAt` (`cell_readiness.ts`).
- Result: position frozen (can't walk), rotation live (can look). Looking around sweeps the sun's
  projected screen position → the god-ray source slides over a world that isn't translating. When
  colliders stream in, movement "unsticks" and the world moves again.

This is a **movement-readiness gate**, not a lighting bug.

**Root cause (traced end-to-end 2026-07-23):** movement is frontier-gated on two fail-closed,
streaming-dependent conditions, and *either* freezes translation:
1. `player_controller.ts:381-387` blocks when `movementReadinessAt(...) === "blocked"`.
2. `cell_readiness.ts:109`: `"blocked"` iff `!movementCollisionReady || !waterQueryReady`.
   - `movementCollisionReady` — a collider page covers the cell, OR `appColumnCertified` (heightfield
     fallback: true unless a voxel-overlay/cave is resident or the column was edited).
   - `waterQueryReady` — `waterAuthority.readyAt(x,z)` = `sample(x,z).state !== "unknown"`
     (`water_authority.ts:304`). The hydrology source returns `unknown` when `!hydrologySampleReady`
     — i.e. **outside the startup grid `[0, worldCells]` wherever the hydrology tile atlas has not
     built the tile yet** (`water_authority.ts:148-156, 237`).

So walking faster than hydrology tiles / colliders stream in trips the gate → position frozen,
rotation live → god-ray source sweeps a static world → "unsticks" when the tile/collider lands. This
is exactly the user's water clue: disabling water nulls the authority (`player_startup.ts:52`), so
`waterQueryReady` defaults `true` and that half of the gate vanishes.

**Fix candidates (pick after confirming which condition trips at the stuck pose):**
- (b, most promising) `movementReadinessAt` blocks movement on `!waterQueryReady` **even when the
  ground is collision-ready**. Requiring water *classification* to translate across known-solid
  terrain is likely over-strict — water residency matters for swim/drown state, not for whether you
  may step onto a collider-ready cell. Consider gating movement on `movementCollisionReady` only and
  handling unknown-water as a separate swim/hazard check.
- (a) Predictive/priority streaming of hydrology tiles + colliders in the player's heading so the
  frontier stays ahead of movement.
- (c) Widen/pre-warm the hydrology tile atlas around the player before enabling movement.

**Confirm-first:** at the stuck pose, log which of `movementCollisionReady` / `waterQueryReady` is
false (add a temporary counter, or read `waterAuthority.sample(px,pz).state` and
`colliderStatusAt(px,pz)`). The user's water toggle already implicates `waterQueryReady`; verify
before changing the gate.

**Problem A (still open): per-frame ground shading "flicker."** Confirmed per-frame, FPS-coupled
(water toggle changed its rate). Ruled out: forest AO, terrain LOD transition, all screen-space
postfx (gtao/froxels/godRays/bounce), TAA/jitter, diag polish. The `renderContext_1`
buffer-destroy logs are three.js-internal (no app `[gpu-destroy] UNSAFE` stacks under gpuDestroyTrace).
No automated discriminator survived validation, so this needs **direct frame-diff observation**
(two consecutive frozen-pose frames, diff the ground ROI) or a short screen recording — remote
toggle-diagnosis has hit diminishing returns. Do **not** resume by toggling more effects.

### (earlier) suspect: a screen-space / temporal post-process pass — RULED OUT above

Remaining things that are per-frame, FPS-coupled, land on static ground, and interact with water
(also screen-space): **GTAO** (screen-space AO, darkens ground — classic temporal flicker if its
history is broken), **froxel volumetrics** ("light changes position"), **screen-space colour bounce**,
**god rays**, **volumetric clouds**. All default **ON** (`environment_query_overrides.ts` resets them
to false only in perf mode; normal state has them on). Each has a URL flag:
`gtao/ao`, `froxels/volumetrics`, `bounce`, `godRays`, `clouds`, `bounce`, `aerial`, `fog`.

**Decisive test — kill all screen-space postfx at once:**

```text
http://127.0.0.1:5181/?oceanRim=0&webgpuSelection=1&materialTiers=1&gtao=0&froxels=0&bounce=0&godRays=off&clouds=0&aerial=0
```

- Flicker **stops** → it is a post-process pass; re-enable one at a time (start `gtao=0` alone) to
  pinpoint. GTAO is the top prior for a moving ground "texture shadow".
- Flicker **continues** → not post-process; pivot to the sun **shadow map** and the per-frame
  `renderContext_1` buffer-destroy churn (a render resource recreated every frame).

NB: the automated counter-delta probe (`probe-counter-deltas.ts`) could not launch WebGPU headless on
this box (`No Chromium launch recipe produced a stable WebGPU device`); it was removed. To run browser
probes here, pass `CLOD_POC_CDP_URL` pointing at a native Chrome with WebGPU. The user's own live
toggles have been the working instrument this whole session — keep using them.

### Next steps (revised)

1. Confirm the terrain/prop material actually samples the forest-lighting texture (mechanism for
   "impacts ground light"); the quick grep for it in `src/terrain` / `src/rendering` came back empty,
   so the ground coupling may be via prop/understory materials or a global — locate it.
2. Build the ground-ROI frozen-pose variance probe; validate on `bad2190f5` vs `d5922717e`.
3. If it separates, bisect `f1175d0a0..d5922717e` (main line) for the moving-ground-shadow, prime
   suspects `8af5b2fbd` / `5a9d817cf` / `db86cdb1a`.
4. Treat **"only 1 LOD visible"** as its own track: on main `treeLodCrossfadeHalfBandM()` has **no**
   hard `TREE_LOD_CROSSFADE_MAX_BAND_M` cap (the 07-21 guard was not carried through the refactor), so
   crossfade dither can be active — but that is a tree-pixel effect, not the ground shadow.

## Ruled out (do not re-try)

- **Depth prepass** — `treePrepass=0` at the in-canopy pose: 15.3% vs 15.1% baseline. No
  effect. (`veg_prepass` EqualDepth→LessEqualDepth is still a correct robustness fix, but
  it only helps the far view.)
- **LOD crossfade dither** — A/B on identical build/scene/pose: cap ON 1.3% / 0.17% vs cap
  OFF 1.4% / 0.14%. No difference, and disabling it made the artefact *worse* (hard
  popping). Restoring `TREE_LOD_CROSSFADE_MAX_BAND_M` was reverted.
- **Impostor pull-in** (`farFraction` 420→260) — no change to distant speckle. Reverted.

## Measurement pitfalls (cost real time — read this)

- **The probe's hard-flip % does not track the bug.** It reads ~17% at a known-clean commit.
  See *BISECT HALTED* above before using it to accept or reject anything.
- The probe **must** use `customProps=1` or `setPose` is absent and it silently measures
  the default far camera (~1–3%, useless).
- **The world moved.** After the 07-21 PR merges, pose (256, 34, 263) is open dunes with a
  distant treeline, not the in-canopy forest it used to be. Numbers from that pose are not
  comparable to the earlier baselines, and a "great" reading there can be pure scene
  change. Always sanity-check `f00.png` shows dense canopy before trusting a number.
- Always A/B on the *same* build/scene/pose when validating a fix.

## Earlier (superseded) hypothesis — crossfade guard

The blinking is the **tree LOD crossfade dither** (a screen-door pattern that alternates
pixels between two LODs). Timeline:

| When | Commit | Effect |
|---|---|---|
| 07-14 | `c67d108f4` + `2d1679f1b` + `5079233e9` (`dither GPU tree ring LOD transitions`, `apply…`, `harden…`) | **LOD dithering introduced → blinking starts** |
| 07-16 | four `stabilize … tree LOD dithering` commits | repeated failed attempts to make the dither stable |
| 07-17 | `7634285cd` `fix: disable blinking tree crossfades` | set `TREE_LOD_CROSSFADE_MAX_BAND_M = 0` → **blinking fixed** |
| 07-20 | `16cf4b103` `feat: restore stable tree LOD crossfades` | **removed that guard** — created `tree_lod_transition.ts` whose `treeLodCrossfadeHalfBandM()` ignores the cap, leaving `tree_lod_constants.ts` empty/orphaned → **blinking returned** |

The 07-17 fix carried an explicit note: *"Crossfade dithering can be re-enabled after it has
a temporally stable implementation that does not shimmer during movement."* The 07-20
commit re-enabled it without that stability, and the guard became dead code.

This is why the many PRs merged afterwards did not help: they were mitigations, never the
re-enabled dither itself.

## Fix applied (2026-07-21, uncommitted at time of writing)

Restore the guard and make it authoritative everywhere:

- `src/trees/tree_lod_constants.ts` — restored `TREE_LOD_CROSSFADE_MAX_BAND_M = 0`.
- `src/trees/tree_lod_transition.ts` — `treeLodCrossfadeHalfBandM()` now caps the band by
  that constant.
- `src/trees/tree_ring_lod_crossfade_material.ts`, `src/trees/tree_lod.ts`,
  `src/trees/tree_system_gpu_policy.ts` — their enable-gates now test the **capped**
  half-band instead of the raw `crossfadeBandM`, so the dither keep-node is fully bypassed
  rather than left wired with a degenerate zero-width band.

Result: hard LOD transitions with `hysteresisM` (the documented fallback), no dither.

**Open:** 8 tests assert the crossfade is active (e.g. `tree_ring_math.test.ts` "keeps the
crossfade band for the GPU ring path" expects 12; `tree_system_gpu_policy.test.ts` "keeps
CPU crossfade…"). They encode the 07-20 behaviour and must be updated to expect the
intentional cap — do this only after confirming the fix visually//via harness.

## Issue inventory

| # | Issue | Status |
|---|---|---|
| 1 | **Tree blinking / lit-dark flip** | Root cause found (crossfade dither); fix applied, verification in progress |
| 2 | WebGPU `buffer used in submit while destroyed` (toggling *fallback to CPU*) | **Fixed** in `09c3a9b9b` — settings-plan no longer tears down the ring for policy-only gpu flags; `tree_ring_compute.destroy()` defers frees to `queue.onSubmittedWorkDone()` |
| 3 | Foliage flash amplitude | **Mitigated** in `09c3a9b9b` — foliage lit from geometric card normal (`tree_node_material.ts`), so the front/back winner flip can't slam to black. Measured −52% churn |
| 4 | Vegetation depth-prepass fragility | **Fixed** in `09c3a9b9b` — `veg_prepass.ts` `EqualDepth`→`LessEqualDepth`. NB: helps the far view only; **not** the in-canopy blinking |
| 5 | **Ground terrain textures worse** (grass/snow surface blend) | Open. Regressed between **07-07 (good)** and **07-14 (bad)**. Suspects: `f36d99b5a` (07-09 "fix textures"), `6939b3bcb` (07-11 "normalize procedural terrain texture scale"), `22498d945` (07-14 "reduce procedural terrain texture zoom"), `1c0788954` (07-14 "align terrain texture bands") |
| 6 | **Digging slower** | Open. 07-07 showed 143 FPS / 80ms edit; current far lower. Regressed after 07-07 |
| 7 | **Meadows effect missing** | Open. Present at 07-14, absent on recent main |
| 8 | "Only one LOD" for trees | Likely a symptom of #1 (crossfade/dither). All LODs rendered correctly at 07-14 |

## Bisect checkpoints (verified)

| Commit | Date | Verdict |
|---|---|---|
| `959e96ee3` | 06-21 | Ground textures + digging **good**; trees **too old to compare** |
| `1084e07b4` | 07-07 | Ground **good**, 143 FPS, digging fast. Builds |
| `1c0788954` | 07-14 | **Trees GOOD — all LODs, no flicker** (textures washed out); meadows present; ground already **bad** |
| `704f2d3f0` | 07-17 | Trees **BAD** — 12.4% hard-flips (harness) |
| current main | 07-21 | Trees **BAD** — 15.1% hard-flips before mitigation, 10.8% after |
| `9775b6859` | 07-01 | **Does not build** (shader-split: imports `terrain_bindings.wgsl` after it was split) — skip |

## Measurements at the in-canopy pose (X256 Y34 Z263)

Far/default camera reads ~1–3% and is **useless** for this bug — always set the pose.

| Config | hard-flips >60 | churn/frame-pair |
|---|---|---|
| baseline (pre-fixes) | 15.1% | 2.42% |
| `sunShadows=0` | 11.8% | 1.23% | → shadows ≈ 1/3 |
| `treePrepass=0` | 15.3% | 1.77% | → prepass ≈ **nothing** |
| + foliage geometric-normal fix | 10.8% | 1.16% |

Shadow contribution note: near/mid trees cast shadows from the **full alpha-tested foliage
geometry**; the solid crown-proxy shadow only applies at `lod >= TREE_LOD_FAR`
(`tree_ring_wgsl_transforms.ts` → `shadow_index_count_for_group`). Extending the proxy to
near/mid is a geometry-binding change, not a threshold flip.

## Tooling

**QA harness** — `tools/probe-user-pose-flicker.ts` (recreated 07-21; it was lost once).
Reproduces the in-canopy pose and reports per-pixel luma range, %-swinging, hard-flip
churn, a heatmap, and f00–f03 frames.

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
# then
$env:CLOD_POC_BASE_URL="http://127.0.0.1:5180/"; npx tsx tools/probe-user-pose-flicker.ts "?oceanRim=0&customProps=1" 24 shots/run-name
```

- `customProps=1` is **required** — it is what enables `enableAutomationHooks` and installs
  `window.__drusnielClod.setPose` (see `src/app/bootstrap/post_renderer_startup.ts`). The
  plain `?oceanRim=0` URL has no pose hook, and the probe silently measures the wrong
  camera.
- Override the pose with `CAMX/CAMY/CAMZ/YAW/PITCH` env vars.

**Bisect worktree** — `F:/drusniel-cache/tmp/bisect-wt` (currently at `1c0788954`), with
`node_modules` as a directory junction to the main checkout, served on port **5181**:

```powershell
git -C F:/drusniel-cache/tmp/bisect-wt checkout --detach <commit>
npm --prefix F:/drusniel-cache/tmp/bisect-wt/tools/clod-poc run dev -- --host 127.0.0.1 --port 5181 --strictPort
# sanity: a 500 on /src/gpu/wgsl_modules.ts means that commit does not build — skip it
```

## Next steps

1. Confirm the crossfade-cap fix kills the blinking (harness + visual at the in-canopy pose).
2. Update the 8 crossfade tests to expect the intentional cap.
3. Bisect #5 (ground textures) in `1084e07b4..1c0788954` — ground is comparable across all
   commits, so visual bisect works well there.
4. Then #6 (digging perf) and #7 (meadows), both regressed after 07-07 / 07-14.
5. Only revisit crossfade dithering if someone implements a temporally stable version
   (that is what the constant's comment is guarding).

## 2026-07-24 — TASK C hardening landed + TASK B movement gate instrumented (both uncommitted on main)

Continuation after main HEAD advanced to `11b540dce` (a concurrent session committed the prior
session's sun-shadows toggle + this doc). Problem 1 (tree stride/blink) stays settled. Problem 2
(CSM / ground flicker) remains UNCONFIRMED — teed up for a human A/B (`sunShadows=0` / `csmfade=0`
/ `csmcasc=1`, all real flags in `realtime_sun_shadows.ts`; reload between each), plus the decisive
**still-vs-moving** question: CSM crawl is camera-motion-coupled, but Problem A was described as
frozen-pose / FPS-coupled — if the ground flickers while standing perfectly still, CSM crawl is the
wrong lead and texel-snap must not be built yet. `debugColorByLod` is NOT a URL flag (vegetation GUI
/ config only).

### TASK C — tree record schema single-source-of-truth (done; full suite 4895 green; uncommitted)
The three hand-maintained `= 6` stride constants can no longer diverge:
- `tree_ring_placement.ts` defines ordered `TREE_RING_RECORD_FIELDS`; `TREE_RING_INSTANCE_VEC4S` is
  `.length`; added `treeRingRecordFieldIndex()`.
- New `tree_ring_record_access.ts` (`treeRingRecords`, `treeRingRecordField`); the 3 storage readers
  (`tree_material_parity.ts`, `tree_ring_lod_crossfade_material.ts`, `morphology/node_deformation.ts`)
  read by field name — no raw `.mul(stride)` in any reader (byte-identical TSL graph).
- `TREE_GPU_RING_INSTANCE_VEC4S` is now an alias of the record stride.
- `withTreeInstanceStride` in `wgsl_modules.ts` regenerates the WGSL `TREE_INSTANCE_VEC4S` from TS at
  composition — applied on the `composeShader` **argument**, NOT the `treeEntry` definition, because
  `scripts/wire-tree-ring-wgsl-expansion.mjs` keys its `alreadyApplied` list on that definition
  (wrapping it there fails `wire-tree-parity.integration.test.mjs`; hit and fixed).
- Tests: `tree_ring_record_layout.test.ts` (field→offset map + alias) + composed-WGSL sentinel in
  `tree_ring_compute.test.ts` (stride == TS; `write_tree_record` writes exactly N contiguous fields).
- Deliberately did NOT build a named-offset codegen framework or GPU-execution sentinel.

### TASK B — movement-readiness gate instrumented (uncommitted; `?movementTrace=1`; TEMPORARY)
`movementReadinessAt` (`player/cell_readiness.ts`) has TWO `attachMovementReadiness` callers
(`renderer_startup.ts:320`, `ui/player_startup.ts:54`); last attach wins, so a wrap-site trace can
miss — that is almost certainly why the prior `[movement-block]` trace didn't fire. Instrument the
shared function. THREE flag-gated, throttled traces (all `?movementTrace=1`):
- `[movement-gate] blocked` in `cell_readiness.ts` — `movementCollisionReady`, `waterQueryReady`
  (false ⇔ look-ahead water unknown), collider covered/replacementPending/revision, fallbackKind, cell.
- `[water-freeze] blocked_unknown` in `player_controller.ts:327` — `waterState`, grounded, cell. The
  swim system freezes ALL velocity at the CURRENT cell when `sample.state === "unknown"`
  (`swim_locomotion.ts:64` `resolveSwimContact`). This is a SEPARATE freeze the look-ahead gate does
  not cover — the prior `[movement-block]` trace (gate-only) would MISS it. Likely the true "position
  frozen, rotation live".
- `[movement-recover] <reason>` in `player_controller.ts` `recoverToLastSafe` — fall-through events
  (fell-to-Y / safe-Y / drop); `player_recovery_missing_collider` = the fall-through symptom.

KEY FINDING: unknown water (outside the built hydrology grid, `water_authority.ts:237`) freezes movement
via TWO independent paths — the `movementReadinessAt` water half AND the swimContact `blocked_unknown`
freeze — and BOTH vanish when water is disabled, so the earlier water-toggle CANNOT distinguish gate vs
swim-freeze. Handoff fix candidate (b) "gate movement on `movementCollisionReady` only" is therefore
INCOMPLETE: removing the gate's water half still leaves the swimContact freeze (player steps one cell
and freezes anyway). A real fix must also change `blocked_unknown` on collision-ready ground (e.g. treat
unknown-water-over-collider as walkable) OR fix hydrology streaming lag — a design call, made only after
the trace confirms which path trips. Strip traces after reading; do not change the gate blind.

REPRODUCED (2026-07-24, automated headless harness `player/unknown_water_movement.test.ts`, 2 tests
green — no WebGPU): walking the real `PlayerController` across the built-hydrology boundary on
collision-ready floor freezes via BOTH paths independently — (A) the `movementReadinessAt` look-ahead
gate halts the player just shy of the boundary (`swimMode` "dry"); (B) with the gate forced ready, swim
contact freezes at the current cell (`swimMode` "blocked_unknown", crosses then stops). Confirms the
two-path finding and that fixing only the gate leaves path B. This test is the regression gate for the
fix (flip to "crosses freely" once walkable-on-collision-ready lands).

FIX LANDED (2026-07-24, design call = predictive streaming, NOT walkable — fail-closed "unknown != dry"
preserved): `water/hydrology_prefetch_lead.ts` `leadHydrologyPrefetchCenter` biases the hydrology tile
prefetch center ahead of the camera heading (capped at radius/2 so the current cell stays covered),
wired at `water_controller.ts` update (was camera-centered `prefetchTiles`). Tiles build async on the
worker, so requesting ahead-of-travel gives them time to land before the player arrives. Unit-tested
(`hydrology_prefetch_lead.test.ts`, 7). The reproduction test is UNCHANGED and still green — the freeze
on genuinely-unknown water is intended and preserved; the fix prevents water being unknown *ahead* of
the player, it does not weaken the gate.

VALIDATION (headless, as far as it goes): lead math (`hydrology_prefetch_lead.test.ts`, 7) + a
tile-cache integration test (`hydrology_predictive_prefetch.test.ts`) proving leading streams the
about-to-enter tile that camera-centering leaves unknown, while keeping the current cell covered. The
new headless-reproduction methodology (reproduce the mechanism in vitest when the browser can't; state
which link each test covers) is documented in `docs/qa/visual-qa.md`. CEILING: the tile worker cannot run
in node, so "player crosses the streamed frontier without freezing" under real movement stays
browser-only — confirm with `?movementTrace=1` (no `[water-freeze]` / `[movement-gate]` while walking).
This is a MITIGATION: extreme speed or a saturated worker (8 inflight) could still momentarily outrun it;
levers = lead-seconds / inflight cap / radius. Remove the temp traces once confirmed.

### 2026-07-24 cont — CPU/GPU tree LOD threshold parity (Issue #8 guardrail)

Found a second duplicated-constant risk of the TASK C class: `treeRingLodParams` (GPU ring,
`tree_ring_math.ts`) recomputed near/mid/far LOD thresholds independently of `treeLodDistances`
(CPU selection, `tree_lod.ts`) — byte-identical formulas in two files, so the GPU ring could
silently select a different LOD than the CPU path for the same distance (the "only one LOD" class).
FIXED: `treeRingLodParams` now derives from `treeLodDistances` (single source, no import cycle,
byte-equivalent). Guarded by `tree_lod_cpu_gpu_parity.test.ts` (GPU thresholds == CPU thresholds +
composed-WGSL `tree_lod_ring` ladder matches the CPU `lodForDistance` ladder) and a shipping-config
band-reachability test in `tree_lod.test.ts`. CEILING: this locks LOD-selection thresholds CPU==GPU
and band reachability headlessly; it does NOT prove all LODs render in a frame — that stays visual
(Issue #8). Tree shadow flicker itself has no headless discriminator (see BISECT HALTED) — visual only.

### 2026-07-25 — startup buffer-destroy flood + "shadow max LOD → black screen" fixed

**IMPORTANT diagnostic caveat:** the console shows `WebGPU: too many warnings, no more warnings will
be reported to the console for this GPUDevice` after ~500 errors at startup. **After that cap, "no
errors in console" proves nothing** — later failures (e.g. the shadow-LOD black screen) cannot report.
Fix the startup flood first or you are debugging blind.

**Startup flood (FIXED).** App-side frees were already deferred via `disposeAfterGpuIdle`; what
remained is inside three.js (readback staging buffers in `copyTextureToBuffer`, render-object eviction
during `_renderObjects`) and is only avoidable by not overlapping a bake with a live submit — the
doc's own "not attempted" lever. New `rendering/gpu_bake_gate.ts`: `runExclusiveGpuBake()` wraps
`bakeTreeImpostorAtlases` + `bakeTreeFoliageAtlas`, and `clod_frame_loop.ts` skips frames while
`gpuBakeInProgress()`. Hold is bounded (20s) so a hung bake cannot freeze the view; released in a
`finally` so a throwing bake cannot wedge it. Unit-tested (`gpu_bake_gate.test.ts`, 6).

**"Shadow max LOD" → black screen (FIXED).** `planTreeSystemSettingsUpdate` set `clearGpuRing` on ANY
`shadowsMaxLod` change, tearing down and rebuilding the whole GPU ring — the exact destroy-in-flight
path this doc blames for black frames. But the cap is enforced by a **per-frame uniform**
(`params.settings_e.z` via `withTreeShadowLodGate`), not by the mesh/buffer set, so moving between real
LODs — or down to "none" (which also zeroes caster capacity) — needs no new resources. Only leaving
"none" does, since the shadow ring buffers are not created at zero capacity. Now only that case
rebuilds (`shadowBuffersMissing`). Tested in `tree_system_settings_plan_shadow.test.ts`.

**LOD ("only nearest") — code double-checked, NOT yet root-caused.** Verified CORRECT and ruled out:
LOD thresholds (near 26.04 / mid 100.8 / far 260.4 / radius 760 m), ring extent (grid 448 x 3.4 m =
±761.6 m, so every band is reachable), group indexing (WGSL `species*TREE_LOD_COUNT+lod` ≡ TS), the
index-count cache (properly invalidated after the impostor bake), and the crossfade keep/dither logic.
LEADING SUSPECT: uniform per-group capacity. `treeGpuRingGroupCapacity = floor(gpu.maxVisible/24)` =
5,333 for EVERY group, but candidate cells per band per species are ~59 near / ~545 mid / ~2,940 far /
~24,000 impostor — the impostor group is ~4.5x oversubscribed before acceptance masking and
`append_tree` hard-drops past capacity, while near never saturates. Distant LODs get silently clipped.
NOT changed yet: confirm first by toggling **"show GPU counts"** (a pure policy flag, explicitly
excluded from `treeGpuRingResourcesChanged`, so unlike shadow max LOD it does NOT tear the ring down)
and reading the per-LOD counts in the HUD.

Pending: in-browser confirm of the flood + shadow fixes and the movement fix (`?movementTrace=1`);
per-LOD counts to confirm/deny the capacity hypothesis; human A/B for Problem 2 (+still-vs-moving);
then strip the temp traces.

### 2026-07-25 cont — "only one LOD" RESOLVED: it was a measurement window, not acceptance

**The premise was wrong, and the evidence says so plainly.** The handoff framed this as a CPU/GPU
acceptance divergence ("find which term zeroes on GPU"). It is not. Measured with the ring actually
live, all four LODs render:

| Counter | measured at ready+3s (old probes) | measured after ring settles |
|---|---|---|
| `trees.near` | 1 | **56** |
| `trees.mid` | 21 | **942** |
| `trees.far` | 0 | **2846** |
| `trees.impostor` | 0 | **264** |
| `trees.candidates` | 0 | **200704** |
| `trees.visible` | 0 | **4108** |
| `trees.patches` | 2 | **0** |
| `trees.shadowCasters` | 0 | **5269** |

`trees.patches` is the discriminator: `tree_system_stats.ts` only increments it on the **non-ring**
branch (`if (input.gpuRing) { ... } else { for (const patch of input.patches) ... }`). `patches=2`
therefore proved the ring was not the reporting path; `patches=0` proves it is.

**Chain of evidence (each step measured, not inferred):**

1. Every `trees.*` GPU counter is gated on `input.gpuRing` = `treeReportsGpuRingStats(...)`. A `0`
   means "no ring reporting", not "zero trees". All reject buckets reading `0` *too*
   (`treeReject.*`, `treeGpuClustersTotal`) was the tell — real acceptance rejection would make
   those large.
2. `treeGpuStatus` (via `?perfProbe=1` → `window.__drusnielPerf.lastSample`) read **`ring`**, while
   `patches=2` proved `reportsGpuRingStats=false`. A temporary trace on the predicate gave the
   deciding input: `hasDraw=true hasCompute=false ringStatsStatus=initializing`, stable forever.
3. Lifecycle trace: `clear gen=0->1` once, `start gen=1` once, **no resolve** — so it was not a
   stale-generation discard and not a compile rejection (that path logs `[trees-gpu-ring]`).
4. Per-pipeline timing: shader `compilationInfo messages=0 problems=0`;
   `clear_counters` and `build_indirect_args` OK after **1401 ms**; `tree_cull` OK after
   **9244 ms**. Not a deadlock — a slow compile of the one heavy entry point.
5. Ring init did not even *begin* until **~70 s** into startup; the ring became the reporting path
   at **62 s** in a clean run.

So for the first ~60–80 s the scene shows only the CPU fallback patches (2 patches, 22 trees,
near+mid only) — which is exactly the reported symptom. Every probe to date sampled inside that
window: `probe-tree-lod-counts.ts` waits for tree meshes then +3 s, far too early.

**Two traps worth keeping.** `gpuStatus` is set to `"ring"` **unconditionally** at the end of
`updateTreeGpuRingTrees` even when `compute` is still null and nothing has dispatched — it reports
intent, not liveness, and it is what made two sessions read the system wrong. And "no
`[trees-gpu-ring]` errors" proves nothing here: the ring was never failing, just not ready.

**New tooling** (`tools/clod-poc/tools/`):
- `probe-tree-lod-counts-settled.ts` — waits for `trees.patches === 0 && trees.candidates > 0`
  before reading. **Use this instead of `probe-tree-lod-counts.ts`.**
- `probe-tree-gpu-status.ts` — `treeGpuStatus` + `[trees-gpu-ring]` logs + console errors.
- `probe-tree-cull-pipeline.ts` — times each compute pipeline's compile.

#### Startup latency — measured, decomposed, and the tree-owned part fixed

NB the doc's earlier `rendering/gpu_bake_gate.ts` / `runExclusiveGpuBake` suspect **does not exist
in this tree** — that entry describes work that never landed here. Measured instead with
`tools/probe-tree-ring-startup-timeline.ts`, the ~70 s decomposes as:

| Segment | Cost | Owner |
|---|---|---|
| navigate → scene exists | ~28 s | world build (`build_world_ms` **19976**, `hydrology_ms` **4421**, `procedural_textures_ms` **2720**) |
| scene → first frame | ~22 s | renderer/startup |
| first frame → ring live | **~12 s** | **the tree ring** |

Only the last segment is tree-owned, and it was almost entirely the 9.2 s `tree_cull` compile,
which the ring requested only on the *first frame that updates trees* — long after the GPU device
existed.

FIXED: the shader module, bind group layout and the three pipelines depend only on the device and
`settings.gpu.workgroupSize` (never on the ring's buffers/settings), and `destroy()` frees only
buffers and textures — so they are now memoised per device+workgroup size
(`treeGpuRingPipelineSet` in `gpu/tree_ring_compute.ts`) and prewarmed from `createTreeController`
via `prewarmTreeGpuRingPipelines`. Failed compiles are deliberately **not** cached so the ring can
recover. A ring rebuild (settings/key change) is now also free instead of re-paying 9 s.

Measured, 2 samples per side (same host, same URL; normalise to **first frame** — absolute times
move ±5 s with world-build load):

| Run | first frame → ring live | ring live on |
|---|---|---|
| baseline 1 | 12.0 s | frame 5 |
| baseline 2 | 11.4 s | frame 5 |
| prewarmed 1 | **2.8 s** | **frame 2** |
| prewarmed 2 | **8.2 s** | **frame 2** |

Frame number is the clean discriminator (5,5 → 2,2). Wall-clock is noisier on the prewarmed side
because what remains is simply "when does frame 2 happen" — early startup frames themselves cost
0.5–8 s — not tree work. Guarded by `gpu/tree_ring_pipeline_cache.test.ts` (4 tests: compile-once,
per-workgroup-size, per-device, failure-not-cached).

**Still open, NOT tree-owned:** the ~50 s before the first frame (world build ~28 s + renderer
~22 s). That is a separate startup workstream. Cutting `tree_cull`'s own compile cost is also still
available if wanted — it inlines `surfaceHeightField` up to ~21× via `tree_height_normal` ×4 plus
`terrain_ridge_filter`'s ≤16-sample loop — but with the compile off the critical path it no longer
delays anything visible.

#### Acceptance parity gap found and fixed (the real divergence)

Separately, and genuinely: WGSL `tree_accept_mask` multiplies in **three terms the CPU
`treeAcceptMask` did not implement** — `forest_cover`, `shoreline_mask`, `competition_mask` — so the
CPU oracle systematically **over-accepted**. Both CPU callers want GPU parity
(`tree_ring_validation_counts.ts`, the oracle behind `gpu.debugValidateAgainstCpu`, and
`tree_ring_lighting_proxies.ts`), and the gap is far larger than the validator's 2 % tolerance, so
`debugValidateAgainstCpu` could not have been trusted. The CPU fallback patch generator does **not**
use this function, so no fallback behaviour changed.

FIXED in `tree_ring_math.ts`: ported `treeForestCoverMask`, `treeShorelineDensityMask` and
`treeLocalCompetitionMask` (plus `treeRingHash`, the sin/fract mirror of WGSL `tree_hash`) and
multiplied them into `treeAcceptMask`. Guarded by `tree_accept_cpu_gpu_parity.test.ts` (6 tests),
which pins the shader's multiplicative term list **and its arity**, so a new GPU-only factor fails
the test instead of silently reopening the gap.

CEILING: deterministic terms only. WGSL also applies `tree_hydrology_bank_density_mask` and
hard-rejects via `tree_hydrology_reject_tree`, both reading the hydrology texture; the CPU oracle
has no hydrology sampler, so those stay GPU-only. Per-cell decisions are also not comparable —
WGSL `tree_hash` is sin/fract while the CPU validation hash is pcg2d — so only aggregate counts
(what the validator actually compares) line up.
