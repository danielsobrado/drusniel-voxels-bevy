# clod-poc Performance Investigation - 2026-06-29

## Scope

This note summarizes the clod-poc performance investigation around lower reported FPS after the tree GPU cull path was simplified.

The investigation used the deterministic clod-poc perf process:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- ..."
```

Vite-based commands were run directly, not through `rtk`.

## Main Findings

The tree GPU path was not the remaining steady-state FPS regression.

The earlier fast GPU result was misleading because it rendered zero visible GPU trees:

- `diagnose-tree-gpu-before`: frame p95 `2.70ms`, render p95 `2.30ms`, visible GPU trees `0`, LOD `0/0/0/0`
- `diagnose-tree-gpu-after-cull-simplify`: frame p95 `4.60ms`, render p95 `3.60ms`, visible GPU trees `3,463`, LOD `49/2037/1377/0`

The later result is doing real work. It is slower than the zero-tree run, but materially faster than the CPU path:

- CPU tree path: frame p95 `12.00ms`, render p95 `10.90ms`, LOD `19/564/361/0`
- GPU tree ring: frame p95 `4.60ms`, render p95 `3.60ms`, LOD `49/2037/1377/0`

## High-Load CLOD Perf Mode

The documented high-load URL shape was measured first:

```text
http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1
```

Important detail: `clodPerf=1` intentionally disables trees unless `treeGpu=1` is also supplied. The first high-load matrix therefore measured the CLOD perf-mode baseline, not the tree GPU ring.

Artifact:

- `tools/clod-poc/perf-runs/diagnose-highload-world16-now/summary.md`

Results:

| case | frame p50 | frame p95 | render p95 | tree GPU | visible trees |
| --- | ---: | ---: | ---: | --- | ---: |
| current-textured | `1.60ms` | `2.20ms` | `2.00ms` | disabled | 0 |
| trees-off | `1.60ms` | `2.10ms` | `1.90ms` | disabled | 0 |
| vegetation-off | `1.20ms` | `1.60ms` | `1.50ms` | disabled | 0 |
| water-weather-off | `1.40ms` | `2.00ms` | `1.80ms` | disabled | 0 |

This did not reproduce a steady-state FPS regression. It did show long startup before the perf hook appeared, especially on `world=16`.

## High-Load Tree GPU Mode

The tree GPU path was then measured with `clodPerf=1&treeGpu=1`.

Artifact:

- `tools/clod-poc/perf-runs/diagnose-highload-world16-treegpu-now/summary.md`

Results:

| case | frame p50 | frame p95 | render p95 | visible GPU trees | LOD avg |
| --- | ---: | ---: | ---: | ---: | --- |
| tree-gpu-ring | `2.10ms` | `3.90ms` | `2.70ms` | 17,892 | `35/2685/8539/6633` |
| tree-gpu-visible-12k | `1.90ms` | `3.30ms` | `2.50ms` | 6,228 | `35/1891/2207/2095` |
| trees-off | `1.30ms` | `2.00ms` | `1.70ms` | 0 | `0/0/0/0` |

Tree GPU rendering adds measurable cost, but the high-load tree GPU case is still well below a 16.67 ms frame budget. The 12k cap reduces the tree count and p95 modestly.

## Normal World-8 Scene

The normal world-8 textured scene was measured next.

Artifact:

- `tools/clod-poc/perf-runs/diagnose-world8-normal-now/summary.md`

Results before the water-disabled fix:

| case | frame p50 | frame p95 | top phase p95 | top prop p95 | render p95 | visible GPU trees |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| current-textured | `1.70ms` | `2.60ms` | renderMs `1.70ms` | waterMs `0.60ms` | `1.70ms` | 6,592 |
| tree-gpu-visible-12k | `1.80ms` | `3.10ms` | renderMs `2.00ms` | waterMs `0.90ms` | `2.00ms` | 4,165 |
| trees-off | `2.30ms` | `3.40ms` | renderMs `3.10ms` | grassMs `0.10ms` | `3.10ms` | 0 |
| vegetation-off | `1.60ms` | `2.20ms` | renderMs `2.00ms` | waterMs `0.10ms` | `2.00ms` | 0 |
| water-weather-off | `2.20ms` | `7.10ms` | vegetationTotalMs `4.60ms` | waterMs `4.40ms` | `2.30ms` | 6,592 |

The anomaly was `water-weather-off`: the URL disabled water and weather, but `waterMs` still dominated.

## Fix

The frame loop always called the water controller update, even when `state.waterEnabled` was false.

Changed files:

- `tools/clod-poc/src/app/frame_loop/ui_state.ts`
- `tools/clod-poc/src/app/frame_loop/vegetation_frame_phase.ts`
- `tools/clod-poc/src/app/frame_loop/vegetation_frame_phase.test.ts`

Behavior change:

- `runVegetationFramePhase` now skips `waterController.update(...)` and `logDevInitOnce(...)` when `state.waterEnabled` is false.
- A unit test covers disabled and enabled water update behavior.

## Post-Fix Measurement

Artifact:

- `tools/clod-poc/perf-runs/diagnose-world8-water-off-after-skip/summary.md`

Results:

| case | frame p50 | frame p95 | top phase p95 | top prop p95 | render p95 | visible GPU trees |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| current-textured | `1.80ms` | `2.60ms` | renderMs `1.60ms` | waterMs `0.60ms` | `1.60ms` | 6,592 |
| water-weather-off | `1.40ms` | `2.00ms` | renderMs `1.40ms` | grassMs `0.20ms` | `1.40ms` | 6,592 |

The water-disabled anomaly was removed:

- Before: frame p95 `7.10ms`, `waterMs` p95 `4.40ms`
- After: frame p95 `2.00ms`, water no longer appears in the top prop buckets

## Verification

Passed:

```powershell
npm --prefix tools/clod-poc test -- src/app/frame_loop/vegetation_frame_phase.test.ts
```

Result:

- 1 test file passed
- 2 tests passed

Typecheck was run:

```powershell
rtk npm --prefix tools/clod-poc run typecheck
```

It failed in files unrelated to this change:

- `src/trees/tree_impostor_baker.ts`
- `src/trees/tree_impostor_material.ts`
- `src/trees/tree_system_gpu_ring_draw.test.ts`

## Remaining Notes

- `world=16` perf runs repeatedly spent a long time before the perf hook appeared. That is startup/world-build behavior, not steady-state FPS. It should be investigated separately if startup latency is the user-visible problem.
- The perf markdown currently reports tree visible counts and LOD distribution, but it does not surface tree GPU dispatch/readback timing. Adding those counters to the report would make future tree GPU investigations easier.
- The old zero-visible-tree GPU runs should not be used as performance targets for real tree rendering.

---

# Follow-up: real-GPU tree regression (144 → 30 FPS)

> Added 2026-06-29 (later session). This follow-up **revises the conclusion above.**
> On real hardware the trees *are* the steady-state regression. The earlier
> "trees are well under the 16.67 ms budget" reading came from a harness that
> does not reproduce the real-GPU cost (see *Why the perf harness misled*).

## Symptom

- User reports the world-8 foric-island scene previously ran at ~**144 FPS** (144 Hz
  display) and now runs at ~**30 FPS** (~33 ms/frame) — a hard ~5× regression.
- The `docs/reference/fable5-world-demo` reference is *more* complex yet runs
  faster, so this is a clod-poc-specific regression, not inherent scene cost.
- A black-screen report just before this was a **stale Vite HMR / renderer
  state** in a long-lived tab (≈50 commits in one day); a hard reload / dev-server
  restart cleared it. A fresh load of the current code renders correctly. Not a
  code regression.

## Why the perf harness (`perf:main`) misled

The earlier conclusion is invalid for steady-state GPU cost because the harness
cannot see it:

1. **CPU-only metrics.** `perf_probe` `frameMs` is the CPU work inside the frame
   callback; `renderMs` is the JS `renderer.render()` submit (command encoding),
   **not** GPU execution. p50 ≈ 1.5 ms reflects a trivial CPU loop, not the frame.
2. **Software GPU.** Playwright's working launch recipe is headless `chromium
   args=[]`, i.e. the **SwiftShader** WebGPU adapter. With temporary
   `trackTimestamp` instrumentation, GPU `render` timestamps came back **0.02 ms**
   — impossible for the real scene; it is software and unrepresentative. Forcing
   headed Chrome did not help (channel unavailable → fell back to SwiftShader).
3. **`freeze=1` + default camera renders no trees.** In the harness the GPU tree
   ring reports `tree visible avg 0`, and toggling `trees=0` changes nothing:
   draw calls `19`, total triangles `1,269,035` identical with trees on/off. The
   harness simply was not drawing the vegetation that loads the real GPU.

Net: every number `perf:main` can produce here is the wrong scene on a software
device. The real bottleneck is **GPU fill/geometry**, which this path cannot measure.

## Method that worked: no-freeze rAF differential

Temporary harness `tools/clod-poc/tools/diff-fps.ts` ([DEBUG-bs9f]) drives the
**real app path (no `freeze`, no `perfProbe`)** so vegetation renders, settles
each page ~18 s, then measures frame throughput by counting `requestAnimationFrame`
ticks over 5 s and scrapes the HUD. Still software GPU, so **absolute FPS ≠
hardware** — but the *relative* deltas localize a gross regression.

### Subsystem differential (world 8, software GPU)

| case | rAF fps | reading |
| --- | ---: | --- |
| baseline | 60–64 | — |
| **trees off** (`&trees=0&understory=0`) | **140** | **≈2.2× — dominant** |
| vegetation off (grass+trees+stones+understory) | 142 | matches trees-off → grass/stones not involved |
| water off (`&water=0&weather=off`) | 73 | modest |
| far-shell off | 52 | noise (trees still on) |

### Tree sub-differential

| case | rAF fps | reading |
| --- | ---: | --- |
| baseline | 64 | — |
| sun shadows off (`&sunShadows=0`) | 74 | shadows ≈ +15% only |
| ablate shadows (`&ablate=shadows`) | 78 | shadows ≈ +20% only |
| **trees off** | **141** | dominant |
| tree cap 6861→1500 (`&treeGpuMaxVisible=1500`) | 61 | count barely matters |
| tree distance 150 (`&treeDistance=150`) | 58 | distance barely matters |

Trees dominate; the TREE-7/8 **shadow-proxy** work is only ~15–20%; cutting tree
count/distance does **not** help. A cost that is flat vs. tree count but vanishes
when trees are off points at **per-fragment / full-forest geometry**, not vertex
count or shadows. (Caveat: the `maxVisible` cap's effect was not independently
confirmed, and this is the software device.)

## Root cause

**There are no real impostor billboards on the WebGPU path, so the entire visible
forest renders full grammar tree meshes at every LOD, shaded by a heavy
double-sided node material.**

- The impostor baker [`tree_impostor_baker.ts`](../../tools/clod-poc/src/trees/tree_impostor_baker.ts)
  is **WebGL-only** (`getContext()` render-target bake); under `WebGPURenderer`
  it returns `supported:false`, so **no atlas is ever baked**.
- Default impostor config is `enabled:true, bakeOnStart:true,
  fallbackToPlaceholder:false` ([tree_config.ts:481](../../tools/clod-poc/src/trees/tree_config.ts#L481)).
  With no atlas and no placeholder, `resolveTreeSystemLod`
  ([tree_system_lod_resolution.ts:14](../../tools/clod-poc/src/trees/tree_system_lod_resolution.ts#L14))
  **clamps the impostor band to the `far` mesh** — i.e. distant trees that should
  be ~2-triangle billboards render real reduced-LOD mesh geometry instead.
- The tree material [`tree_node_material.ts`](../../tools/clod-poc/src/trees/tree_node_material.ts)
  is `MeshBasicNodeMaterial`, **`side: DoubleSide`, opaque** (`transparent:false`,
  `alphaTest:0`, [L263](../../tools/clod-poc/src/trees/tree_node_material.ts#L263)),
  with a per-fragment colorNode doing relight + leaf **transmission** + forest
  AO/shadow + fog + a screen-door **`maskNode` discard** ([L230-266](../../tools/clod-poc/src/trees/tree_node_material.ts#L230)).
  `DoubleSide` doubles fragment work and the dither discard weakens early-z.

This matches the earlier tree parity gap now tracked by the status note
([clod-poc-trees-parity-status.md](../plans/clod-poc-trees-parity-status.md)):
"Impostors / billboards are not real on the WebGPU path," and the recent Fable5
foliage-grammar commits (`36d019c3` foliage card placement, `843593f0` budget
grammar foliage by anchor targets, `5ab91f4e` structural variants).

## Proposed fix

**Primary (architectural — the real fix):** implement real WebGPU octahedral
impostor billboards, i.e. parity-plan **EPIC A (TREE-1..3, WebGPU atlas bake)** +
**EPIC B (TREE-4..6, relit view-blended billboard in the ring)**. This replaces
full far-mesh geometry beyond the impostor distance with cheap relit billboards
and is the direct undo of the regression.

**Interim mitigations (no bake pipeline; validate each with a real-GPU A/B):**

1. Lower the grammar foliage/leaf budget per tree (the recently raised anchor
   targets, `843593f0`) to cut per-tree triangle count.
2. Pull the far/impostor transition distance inward and/or decimate the `far`/`mid`
   mesh LODs so distant trees are cheaper while billboards are absent.
3. Use `FrontSide` for opaque trunk/branch tubes (keep `DoubleSide` only for leaf
   cards) to halve their fragment work.
4. Re-evaluate the screen-door dither `maskNode` discard's early-z cost.

## Real-hardware confirmation (CONFIRMED)

Validated on the user's 144 Hz machine (real GPU + vsync):

- **`…/?world=8&trees=0` holds a steady 144 FPS.**
- Baseline (trees on) is ~30 FPS.

So **trees alone account for the full ~5× regression** (~26 ms of a ~33 ms
frame). This confirms the software-harness differential on real hardware and
rules out shadows/water/terrain/far-shell as the primary cost. The software rAF
differential's *relative* ranking held up; only its absolute FPS differed.

For exact per-pass numbers if needed: load `…/?world=8&perfProbe=1`; the
temporary instrumentation enables `trackTimestamp` and records real
`gpuRenderMs`/`gpuComputeMs` into `window.__drusnielPerf.snapshot().samples`.

## Temporary instrumentation (remove after fix)

All tagged `[DEBUG-bs9f]`:

- `src/rendering/renderer_backend.ts` — `trackTimestamp` under `perfProbe` when
  `timestamp-query` is supported.
- `src/app/frame_loop/perf_probe.ts` — optional `gpuRenderMs`, `gpuComputeMs`,
  `drawCalls`, `totalTriangles` sample fields.
- the frame render phase — defensive GPU-timestamp resolve + record.
- `tools/perf-main.ts` — GPU render/compute + draw-call/triangle columns.
- `tools/diff-fps.ts` — the no-freeze rAF differential harness.

(All `[DEBUG-bs9f]` instrumentation + probe scripts were removed after the fix below.)

---

## Fix applied & measured (real GPU, RTX 4080)

Two config-only changes in **`tools/clod-poc/config/trees.yaml`** (the runtime tree
config; `DEFAULT_TREE_SETTINGS` is only a fallback and was *not* the source — that
caused a first no-op attempt):

1. **Pulled the far→impostor transition inward** so the visible forest converts to
   cheap baked billboards instead of full far-mesh:
   - `lod.mid_fraction` `0.242 → 0.18` (mid ring 150 m → 112 m)
   - `lod.far_fraction` `0.742 → 0.35` (far ring 460 m → 217 m; trees 217–620 m → impostors)
2. **Reduced near/mid foliage-card overdraw** (~40% fewer cards on near/mid trees):
   - oak `card_count_near` `96 → 58`, `card_count_mid` `44 → 28`
   - pine `card_count_near` `88 → 54`, `card_count_mid` `38 → 24`

**Result — full-forest view (the user's heavy camera), real GPU:**

| metric | before | after |
| --- | ---: | ---: |
| avg FPS | **31** | **44–47** |
| impostors drawn (`i`) | **0** | **1,651** |
| mid trees | 3,006 | 1,858 |
| far trees | 3,513 | 3,010 |

Every dolly step improved (70/53/39/31 → 74/56/44/47). Impostors now engage (the
far→impostor transition fires within the island). Visual check (`after-dolly-4.png`):
forest still reads as lush/full, grass present (15,784 blades), no sparse canopy and
no visible impostor seam at the overview. **~50% FPS recovery** at the worst-case
camera, visual quality preserved.

**Remaining headroom / follow-ups:**

- Near-canopy close-up is still fill-bound (the near mesh + `DoubleSide` material);
  further wins need near-mesh decimation or `FrontSide` trunk/branch tubes.
- Crossfade is disabled (`crossfade_band_m: 0`), so the now-closer far→impostor
  transition is a hard cut — watch for pop during motion; a small crossfade band
  would smooth it at a minor overdraw cost.
- The architectural endgame remains parity-plan EPIC A/B (relit view-blended
  billboards); this config tuning is the interim win.
