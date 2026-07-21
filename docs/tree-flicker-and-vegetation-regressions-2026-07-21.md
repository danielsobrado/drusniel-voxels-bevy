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

## Ruled out (do not re-try)

- **Depth prepass** — `treePrepass=0` at the in-canopy pose: 15.3% vs 15.1% baseline. No
  effect. (`veg_prepass` EqualDepth→LessEqualDepth is still a correct robustness fix, but
  it only helps the far view.)
- **LOD crossfade dither** — A/B on identical build/scene/pose: cap ON 1.3% / 0.17% vs cap
  OFF 1.4% / 0.14%. No difference, and disabling it made the artefact *worse* (hard
  popping). Restoring `TREE_LOD_CROSSFADE_MAX_BAND_M` was reverted.
- **Impostor pull-in** (`farFraction` 420→260) — no change to distant speckle. Reverted.

## Measurement pitfalls (cost real time — read this)

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
