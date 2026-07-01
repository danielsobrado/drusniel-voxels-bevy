# Tree Preset Performance Capture — 2026-07-01

## Capture Metadata

| Field | Value |
|---|---|
| Date | 2026-07-01 |
| Commit SHA | de836032 (working tree had uncommitted HUD/gate/snapshot changes) |
| Branch | main |
| Browser | Google Chrome (headed, driven via CDP) |
| Browser version | 149.0.7827.197 |
| OS | Windows 11 Pro |
| GPU | NVIDIA GeForce RTX 4080 |
| CPU | 13th Gen Intel Core i7-13700KF |
| RAM | 64 GB |
| Window size | 1920×1080 (harness viewport, deviceScaleFactor 1) |
| Render scale | default |
| WebGPU enabled | yes — GPU ring active every frame (`ring:300`) |
| Notes | Captured with the deterministic `perf:main` harness, **not** the in-app `log perf snapshot` GUI action. |

## Method

Real-GPU capture was forced through the CDP path because the harness's default
launcher picks headless Chromium first, which resolves to a SwiftShader adapter
(software) and reports fake timings.

```powershell
# Real headed Chrome with hardware GPU + remote debugging:
chrome.exe --remote-debugging-port=9222 --user-data-dir=<clean> --enable-unsafe-webgpu

# Harness attaches over CDP instead of launching its own headless browser:
$env:CLOD_POC_BASE_URL="http://127.0.0.1:5180/"
$env:CLOD_POC_CDP_URL="http://127.0.0.1:9222"
npm run perf:main -- --world 8 --warmup 600 --frames 300 --freeze 0 `
  --case tree-gpu-ring,trees-off,tree-gpu-visible-12k,tree-gpu-visible-9k,tree-distance-360 `
  --out perf-runs/tree-tuning-2026-07-01
```

`--freeze 0` is mandatory: the harness default `--freeze 1` renders no trees.
`--warmup 600` lets the GPU tree-ring compute pipelines finish async
compilation before sampling.

Artifacts: `tools/clod-poc/perf-runs/tree-tuning-2026-07-01/{summary.json,summary.md}`.

## Harness Results (perf:main via CDP, world 8, real RTX 4080)

FPS is derived as `1000 / frameMs p50` (the harness reports frame time, not FPS).

| Case (params) | Runtime path | FPS (p50) | Frame ms p50 | Frame ms p95 | Frame ms avg | Render ms p95 | Top phase p95 | Tree visible avg | Errors |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| `tree-gpu-ring` (treeGpu=1, default maxVisible=50k) | gpu-ring | ~417 | 2.40 | 5.10 | 2.72 | 3.40 | renderMs 3.40 | 0 † | 0 |
| `trees-off` (trees=0, understory=0) | disabled | ~500 | 2.00 | 2.90 | 2.22 | 2.30 | renderMs 2.30 | 0 | 0 |
| `tree-gpu-visible-12k` (maxVisible=12k) | gpu-ring | ~435 | 2.30 | 5.30 | 2.80 | 3.00 | vegetationTotalMs 3.20 | 0 † | 0 |
| `tree-gpu-visible-9k` (maxVisible=9k) ‡ | gpu-ring | ~270 | 3.70 | 10.30 | 4.67 | 5.40 | renderMs 5.40 | 0 † | 0 |
| `tree-distance-360` (treeDistance=360) ‡ | gpu-ring | ~256 | 3.90 | 9.40 | 4.57 | 4.40 | vegetationTotalMs 5.20 | 0 † | 0 |

† `tree visible avg = 0` because the perf harness runs with readback **off**
(`readback_visible_lists`/`debug_show_gpu_counts` default false). This is the
expected value here, not zero trees — see the tree-cost delta below, which
proves trees are rendered.

‡ **Noisy / not trustworthy.** These two came out *worse* than the heavier
default `tree-gpu-ring` (higher avg **and** p95), which is non-monotonic —
reducing `maxVisible` or `treeDistance` cannot legitimately increase cost.
A second client was connected to the dev server on 5180 during the run
(GPU contention). Re-run on a quiet machine before drawing tuning conclusions.

## Interpretation

- **GPU ring is active and healthy**: `ring:300`, zero console errors, real
  hardware timings (not the ~0.02 ms SwiftShader tell).
- **Tree cost at this view is modest**: `tree-gpu-ring` vs `trees-off` is
  +0.40 ms p50 / +2.20 ms p95 frame, +1.10 ms render p95, +0.80 ms vegetation
  p95. The top phase for both is `renderMs` (GPU draw/overdraw), and it is the
  bucket that moves when trees are toggled.
- **This is the default world=8 view, not a dense hero-forest shot.** The
  modest cost here does not contradict the earlier "hero forest ~30 fps"
  observation — that view has near-canopy overdraw this camera pose does not.
  A hero-forest capture needs a fixed dense-forest camera pose.

## Not captured yet (and why)

- **Quality-preset rows** (`?quality=ultra|balanced|perf|potato`), **FPS via
  `log perf snapshot`**: require the in-app GUI action / preset params, not run
  by this harness pass.
- **Debug-count rows** (visible/candidates/accepted/shadow casters): need
  `treeGpuCounts=1` (readback on). Not enabled in this run.
- **Shadow-budget rows** (`treeShadowMaxLod=none|near|mid|far`): not run.
  This is the highest-value next measurement given the view-independent shadow
  hypothesis.
- **CPU fallback control** (`treeGpu=0`, `treeGpuForceCpu=1`) and
  **CPU/GPU validation** (`treeGpuValidate=1`): not run.

## Decision Summary

| Question | Result |
|---|---|
| Is the WebGPU tree path active? | Yes — `ring:300`, RTX 4080, no errors. |
| Tree cost at default world=8 view | +0.4 ms p50 / +2.2 ms p95 vs trees-off. Modest. |
| Does maxVisible / distance tuning help? | Inconclusive — sweep was noisy (GPU contention). Re-run needed. |
| Does shadow LOD gating reduce cost? | Not measured yet. Highest-value next run. |
| Should we tune preset values now? | No — not on this data. Get a clean hero-forest capture + shadow sweep first. |

## Follow-up Actions

- Re-run the `maxVisible`/`treeDistance` sweep on a quiet machine (close other
  tabs on 5180) to get monotonic, trustworthy deltas.
- Capture a fixed **dense-forest** camera pose to measure the real hero cost.
- Run the shadow-budget sweep with `treeGpuCounts=1` to test whether shadow
  casters (view-independent) dominate tree cost.
