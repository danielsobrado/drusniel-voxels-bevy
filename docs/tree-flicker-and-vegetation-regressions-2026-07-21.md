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
| `4e32f47ac` | 07-15 | **blinking** + "near LOD only" | bracket ceiling |

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

### The stride-mismatch theory does not explain this transition

Checked directly across the clean→bad boundary:

- `TREE_INSTANCE_VEC4S = 6u` in `tree_ring.compute.wgsl` **already at `bad2190f5` (clean)**. The
  6-vec4 record predates the branch; the morphology work did **not** expand it. The claim above in
  *Ring instance buffer stride mismatch* that it did is wrong.
- `tree_material_parity.ts` and `tree_ring_lod_crossfade_material.ts` are **byte-identical** between
  `bad2190f5` (clean) and `caf10ca16` (bad branch tip) — both read `cellStore.element(instanceIndex)`.

So the readers did not change across the boundary that introduces the bug. The stride fix in
`071afd64c` may still be a correct robustness change, but it cannot be the cause of this
regression. What *does* change on the branch is the CPU instancing layout: `f1175d0a0` adds
`tree_system_instance_attribute_layout.ts` (new) and rewrites `tree_system_instance_attributes.ts`
(115 lines), alongside 68 changed tree files totalling ~2.4k insertions.

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
