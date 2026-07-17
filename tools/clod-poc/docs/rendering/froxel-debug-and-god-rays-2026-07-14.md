# Froxel Debug Overlay, God-Rays Modes, and Volumetric Cost

Created 2026-07-14.

Covers three things from the 2026-07-14 post-process pass: a broken god-rays dropdown, exposing the
froxel debug overlay in lil-gui, and a measurement answering "is the volumetric system costing us
frame time?". It also records a visual gap opened by `671f2143` that is still open.

---

## 1. God-rays dropdown listed a mode that does not exist

`GodRaysMode` is `"off" | "cheap" | "heavy" | "volumetric"`
(`src/environment/postprocess_settings.ts`), but the lil-gui dropdown offered
`["off", "screen", "volumetric"]`.

`"screen"` was never a member of the union, so selecting it wrote a value no consumer matched —
`godRaysModeValue()` fell through and the shafts silently did nothing. `"cheap"` and `"heavy"`
(the two screen-space raymarch budgets, `GOD_RAYS_SCREEN_SAMPLES`) were unreachable from the UI
entirely.

Fixed in `src/ui/gui/environment_gui.ts` to `["off", "cheap", "heavy", "volumetric"]`. No other
change was needed — the render path already handled all four.

**Correction (2026-07-17):** "the render path already handled all four" held only for
`?renderer=webgl` (the frozen `PostProcessPipeline`). The default WebGPU pipeline ignored
`godRaysMode` entirely until the dedicated dust god-rays stage landed — see
`lighting-god-rays-improvement-plan-2026-07-16.md`. On WebGPU, `volumetric` now means the
screen-space dust shafts at the heavy tap budget plus the froxel fog layer forced on; the old
`GodraysNode` wrapper (`god_rays_volumetric.ts`) was deleted.

---

## 2. Froxel debug overlay: the render path already existed, the controls did not

**The important finding: nothing needed to be written in the shader or the froxel volume.** The
debug views were already implemented and reachable from the URL:

| already present | where |
| --- | --- |
| `PostFxFroxelDebugMode` union | `src/gpu/postfx_atmosphere.ts:5` |
| `parsePostFxFroxelDebugMode` (+ aliases, unit-tested) | `src/gpu/postfx_atmosphere.ts` |
| `density` / `transmittance` / `scatter` branches | `src/gpu/postfx_atmosphere_nodes.ts` (froxel-volume path and raymarch fallback) |
| `?froxelDebug=…` query parse | `src/gpu/webgpu_postprocess.ts` |
| non-`off` mode forces the froxel volume to run even when `froxelsEnabled` is false | `shouldUseFroxelVolume()` |

What was missing was the **control path**. `froxelDebugMode` was `private readonly` and parsed
**once, in the constructor, from the URL** — so nothing could change it at runtime, and there was no
GUI or app state behind it.

### What the debug buffers show

The froxel volume writes two 3D textures, which is what makes the three modes cheap to expose:

- `scatterTexture` = `vec4(scatterRadiance * density, density)`
- `integratedTexture` = `vec4(integratedScatter, transmittance)`

so `density` → extinction, `transmittance` → integrated transmittance, `scatter` → in-scattered
radiance. All are written as `vec3(x)` for the scalar modes, i.e. greyscale — which is also how the
change was verified (see below).

### Wiring added

| file | change |
| --- | --- |
| `src/environment/postprocess_settings.ts` | `froxelDebugEnabled` / `froxelDebugMode` on `PostProcessSettings` (defaults `false` / `"off"`); `?froxelDebug` parsing |
| `src/app/state/environment_state.ts` | matching app-state fields + defaults |
| `src/app/state/environment_query_overrides.ts` | `?froxelDebug` → app state, so the GUI reflects the URL at boot |
| `src/app/bootstrap/terrain_view_state.ts` | state → `PostProcessSettings` mirror |
| `src/ui/gui/environment_gui.ts` | `froxel debug` folder (`enabled`, `mode`, `reset`) |
| `src/gpu/webgpu_postprocess.ts` | `froxelDebugMode` made mutable and settings-driven |

Behaviour: selecting a named mode implies `froxelDebugEnabled = true`; selecting `off` disables the
overlay. This holds identically for the GUI and for `?froxelDebug=<mode>`. `reset` returns the
folder to `off` / disabled.

### The one non-obvious constraint: the debug branch is baked into the node graph

The mode checks in `postfx_atmosphere_nodes.ts` are **JS-level conditionals evaluated while the TSL
graph is built**, not a uniform branch in the shader. A live toggle therefore requires a **pipeline
rebuild**, not a uniform write.

That already works, but only because `graphKey()` includes `froxel-debug-${mode}` and
`updateSettings()` disposes the pipeline when the key changes. The new mode must be applied
**before** `graphKey()` is re-read — hence `applyFroxelDebugSettings()` sits between the settings
merge and the `nextKey` comparison in `updateSettings()`. Anyone touching that ordering will
silently break live switching (the GUI will change state but the image will not move).

`applyFroxelDebugSettings()` only overrides when the caller actually passes the froxel-debug fields,
so callers that never mention them keep whatever the URL asked for.

### Debug survives the perf downgrades

`?froxelDebug` is parsed **after** the `fx=0` / `postmin` blocks that strip the post stack, so
`fx=0&froxelDebug=density` still shows the overlay (`froxelsEnabled: false`,
`froxelDebugEnabled: true`). A debug view that perf mode silently disables would be useless.

### Verification

Unit tests cover the URL rules (`postprocess.test.ts`, `environment_query_overrides.test.ts`):
each mode, explicit `off`, default-off, and survival of `fx=0`.

Browser verification drove the **real lil-gui DOM controls** on the running app (not the harness
scenes — `clodUrl()` defaults to `scene=sanity`, which has no GUI; pass `scene: null` for the app):

| check | result |
| --- | --- |
| god-rays options | `["off","cheap","heavy","volumetric"]` |
| froxel debug folder | present: `enabled` checkbox + mode select + `reset` |
| GUI live toggle | mean chroma **0.118 → ~0.016** for all three modes (scalar buffers render greyscale) |
| `?froxelDebug=<mode>` | renders, and the GUI shows `enabled=true` + the matching mode |
| `reset` | `enabled=false`, `mode=off`, image returns to colour (chroma 0.114) |

Mean-pixel luminance: `transmittance` 0.457, `density` 0.072, `scatter` 0.071.

**Caveats, honestly:** `density` and `scatter` are both dim in a clear-air scene, so aggregate pixel
stats cannot separate *those two from each other* — each is clearly distinct from the normal image,
and `transmittance` is clearly distinct from both, but that is all the metric proves. The measured
values also match the **raymarch fallback** formulas rather than the froxel-volume ones, suggesting
the fallback path was active in that capture. Both paths implement all three modes, so the overlay
works either way; if you specifically need to eyeball the *volume* buffers, confirm that separately.

---

## 3. Is the volumetric system costing frame time? No — not measurably

Measured with the purpose-built matrix (`tools/postfx-perf-matrix.ts`), world 8, identical
warmup/frames, `postfx-default` (no froxels) vs `postfx-froxels`:

| case | frame p50 | frame p95 | render p95 |
| --- | ---: | ---: | ---: |
| `postfx-default` | 3.00 | 4.20 | 3.00 |
| `postfx-froxels` | 3.00 | 4.20 | 3.00 |

Identical at 600 frames. A first 300-frame run *looked* like it showed a difference, but it was
noise — the giveaway was `postfx-all-on` (contact + gtao + bounce + froxels) coming out **fastest**
of all three, which is impossible if those stages cost anything. Re-running longer collapsed the
delta to zero.

Reproduce:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
# then, with CLOD_POC_BASE_URL set:
npx tsx tools/postfx-perf-matrix.ts --case postfx-default,postfx-froxels --world 8 --warmup 120 --frames 600 --out perf-runs/volumetric-ab
```

**Caveats:** the per-pass GPU columns (`froxScatter`, `froxIntegrate`) all read `0.00` — timestamps
never resolved — so this rests on end-to-end frame time, not direct pass cost. At ~3 ms/frame the
scene has large headroom under the 8 ms gate, so a cheap pass can hide in GPU idle; this does not
prove the cost stays zero under heavier load.

### Where froxels actually run

Worth knowing before drawing conclusions from any perf run:

- `clodPerf=1` sets `postProcessEnabled: false` — it disables the **whole** post chain, froxels
  included (`src/app/state/environment_state.ts`). Standard perf/acceptance runs therefore measure
  volumetrics at zero cost because they never execute.
- Quality presets: `ultra` and `balanced` enable froxels; `perf` and `potato` disable them
  (`src/app/state/postprocess_quality_presets.ts`).

---

## 4. Open: `671f2143` may have left the low presets with no fog at all

`671f2143 "fix(clod-poc): align forest lighting defaults with volumetric ownership"` zeroed the
forest-lighting atmospherics — `forestFogStrength`, `edgeFogBoost`, `aerialTintStrength`,
`sunShaftsStrength` all → `0.0` — on the basis that the volumetric system now owns fog. (It also
strengthened AO 0.32 → 0.38 and shadow 0.28 → 0.32.)

But the volumetric froxel stage is **disabled in the `perf` and `potato` presets**. On those presets
there is now neither forest fog nor volumetric fog. `perf` still has aerial perspective and may look
fine; `potato` disables that too.

Not changed here — flagging it rather than guessing at the intended look.

Consequence for tests: `forest_lighting_fields.test.ts` asserted `fog > 0` from the **defaults**,
which that commit made unreachable. The test now sets the fog strengths explicitly (the file's own
convention — it already did this for sun shafts), and a new test pins the decision: *by default,
forest lighting contributes no fog and no sun shafts.*

---

## Verification protocol

```powershell
npm --prefix tools/clod-poc run typecheck   # rtk OK
npm --prefix tools/clod-poc test            # NO rtk
npm --prefix tools/clod-poc run build       # NO rtk
```

Green at the time of writing: typecheck clean, 566 files / 3043 tests, build clean.
