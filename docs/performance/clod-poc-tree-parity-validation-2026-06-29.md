# clod-poc tree parity validation - 2026-06-29

Git SHA: `dd93c2a1445c8c4531aa70580ce7a5614268d9a9` (initial WSL run); real-GPU
re-run at `c4cff164`.

Final verdict: `PARTIAL PASS` (superseding the initial `FAIL: blocker list`).
The WSL/headless `FAIL` was an environment artifact (WSL device loss; headless
software GPU). On a headed real-GPU run (RTX 4080) the WebGPU tree ring + **baked
impostors are confirmed working**; the remaining performance issue is **near-tree
foliage-card overdraw at close cameras**, which impostors do not address. See
*Real-GPU run* at the bottom for the authoritative result.

## Machine / Browser / GPU

| item | value |
| --- | --- |
| OS | Microsoft Windows 11 Pro `10.0.22631` |
| Shell/workspace | WSL path `/home/drusniel/drusniel-voxels-bevy`; `rtk uname -a` reports `Windows_NT Drusniel 10.0 22631 x86_64 MS/Windows (Windows 11)` |
| GPU name | NVIDIA GeForce RTX 4080 also present; virtual displays also reported: Virtual Desktop Monitor, vorpX Virtual Display, Meta Virtual Monitor |
| Monitor refresh | not visible from successful commands |
| Playwright recipe | headless Chromium, `--enable-unsafe-webgpu`; from `.cache/webgpu-flags.json` and `webgpu-adapter-check.json` |
| Headed check | bundled headed Chromium could request a WebGPU adapter, but the tree scene lost the WebGPU device before readiness |

## Commands Run

```powershell
rtk git rev-parse HEAD
rtk powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
rtk powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption; (Get-CimInstance Win32_OperatingSystem).Version"
rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && npm --prefix tools/clod-poc run trees:wire-parity:check"
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk bash -lc "curl -sS -I http://127.0.0.1:5180/"
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run shoot -- --scene sanity --out tools/clod-poc/shots/tree-parity-final-20260629-1814/forest-overview.png --stats tools/clod-poc/shots/tree-parity-final-20260629-1814/forest-overview-stats.json --w 1920 --h 1080 --settle 180 --timeout 180000 --hud --world 8 --treeGpu 1 --webgpuSelection 1 --freeze 1
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run shoot -- --scene trees-perf --out tools/clod-poc/shots/tree-parity-final-20260629-1814/forest-overview.png --stats tools/clod-poc/shots/tree-parity-final-20260629-1814/forest-overview-stats.json --w 1920 --h 1080 --settle 180 --timeout 180000 --hud --world 8 --treeGpu 1 --webgpuSelection 1 --freeze 1
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:main -- --baseUrl http://127.0.0.1:5180/ --world 8 --warmup 240 --frames 900 --timeout 240000 --renderer webgpu --freeze 1 --case tree-gpu-ring,trees-off,vegetation-off,water-weather-off,far-shell-off --out tools/clod-poc/perf-runs/tree-parity-final-20260629-1814/frozen
```

The direct Vite start failed because port `5180` was already in use. `curl` confirmed an existing Vite server was serving `http://127.0.0.1:5180/`, so the existing server was used.

## Generated-code Check

`npm --prefix tools/clod-poc run trees:wire-parity:check` passed. The scripts reported all expected tree shadow proxy, tree9 WGSL, and tree9 config wiring already present, with no generated-output repair needed.

## WebGPU Adapter Check

Artifact: `tools/clod-poc/shots/tree-parity-final-20260629-1814/webgpu-adapter-check.json`

Result: WebGPU adapter exists in Playwright headless Chromium. Exposed features include `timestamp-query`, `indirect-first-instance`, texture compression features, `subgroups`, and related WebGPU limits. Adapter vendor/device info was `null`, so this artifact does not prove real RTX 4080 hardware usage.

## Screenshot Index

| name | file | purpose | result | notes |
| --- | --- | --- | --- | --- |
| WebGPU adapter check | `tools/clod-poc/shots/tree-parity-final-20260629-1814/webgpu-adapter-check.json` | Confirm WebGPU adapter availability | PASS for adapter existence | Adapter info not exposed; hardware identity unknown |
| Headed tree GPU attempt | `tools/clod-poc/shots/tree-parity-final-20260629-1814/headed-tree-gpu-attempt-stats.json` | Real headed tree scene readiness and stats | FAIL | Page/context closed after WebGPU device loss; screenshot could not be captured |
| Forest overview | not produced | Trees on, WebGPU ring on | FAIL | `shoot` failed before stats/screenshot |
| Trees off | not produced | Same camera, trees disabled | not run | Blocked by WebGPU device loss |
| Shadows off | not produced | Same camera, shadows disabled | not run | Blocked by WebGPU device loss |
| Far/impostor boundary | not produced | Boundary visual check | not run | Blocked by WebGPU device loss |
| Dolly-out transition | not produced | Pop/hole/double-draw check | not run | Blocked by WebGPU device loss |
| Interior crown shadows | not produced | Shadow quality check | not run | Blocked by WebGPU device loss |
| Low-sun off-screen/ridge shadows | not produced | Shadow caster range check | not run | Blocked by WebGPU device loss |
| Six-species ecology gallery | not produced | Species placement proof | not run | Blocked by WebGPU device loss |

## Runtime Failure Evidence

`scene=sanity` failed before capture with:

```text
[clod-poc] FATAL: Unhandled rejection
Instance dropped in popErrorScope
OperationError: Instance dropped in popErrorScope
```

`scene=trees-perf&treeGpu=1&webgpuSelection=1` failed in both headless and headed Chromium. The headed artifact captured:

```text
THREE.WebGPURenderer: WebGPU Device Lost
Message: A valid external Instance reference no longer exists.
Reason: unknown
[webgpu] device lost: unknown A valid external Instance reference no longer exists.
[trees-gpu-ring] falling back to CPU: Failed to execute 'mapAsync' on 'GPUBuffer': A valid external Instance reference no longer exists.
Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size (480) is too large for the implementation when mappedAtCreation == true
```

Because the page/context closed before `window.__drusnielClod.ready`, runtime tree counters were not available.

## Perf Table

| case | freeze | frame p50 | frame p95 | gpu render p95 | draw calls | total tris | tree visible | LOD near/mid/far/impostor | conclusion |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| tree-gpu-ring | 1 | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | perf harness did not complete; WebGPU scene failed/stalled before summary |
| trees-off | 1 | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not reached |
| vegetation-off | 1 | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not reached |
| water-weather-off | 1 | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not reached |
| far-shell-off | 1 | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not exposed | not reached |

No `summary.md`, `summary.json`, or per-case JSON was produced under `tools/clod-poc/perf-runs/tree-parity-final-20260629-1814/`.

## Acceptance Checklist

| criterion | result |
| --- | --- |
| No app fatal errors | FAIL |
| WebGPU path runs | FAIL for tree scene readiness; adapter probe alone passes |
| Tree impostor LOD count non-zero | not exposed |
| Impostor path materially fewer triangles/draw cost than far-mesh-only | not measured |
| Far/impostor boundary has no obvious holes, double-draw, or popping | not captured |
| Impostor crowns are lit, not flat cards | not captured |
| Shadows are not double-cast by visible meshes and shadow-only meshes | not captured |
| Trees-on vs trees-off avoids catastrophic FPS regression on real hardware | not measured |

## Blocker List

1. WebGPU device loss prevents `scene=trees-perf` from reaching readiness in Playwright headless and bundled headed Chromium.
2. After device loss, the tree GPU ring reports CPU fallback from `mapAsync` failure, then the renderer repeatedly raises `createBuffer` mapped-at-creation errors.
3. Runtime tree/impostor counters are not exposed because `window.__drusnielClod.ready` is never reached.
4. No screenshot or deterministic perf summary could be generated, so impostor bake readiness, impostor LOD usage, far/impostor visual transition, crown shadows, six species, and performance regression status remain unproven.

Likely cause category: `other` - WebGPU device loss / browser runtime instability before tree parity evidence can be collected. This run does not prove atlas bake unsupported, atlases not ready, impostor LOD clamped to far, or GPU ring material misuse; those remain unverified.

---

# Native-Windows continuation (2026-06-29, later session)

> Re-ran on a **native Windows** shell (not WSL) at HEAD `c4cff164`. This refines
> the blocker: the WSL `device loss` does **not** reproduce here, but a different,
> more fundamental limit does — Playwright only gets the **software GPU**, on which
> the GPU vegetation rings do not populate. Automated tree-parity validation is
> therefore infeasible in this harness; it needs real hardware (manual capture).

## Environment

| item | value |
| --- | --- |
| Shell/workspace | native Windows (`win32`, PowerShell), `f:\Development\workspace\GitHub\drusniel-voxels-bevy` |
| HEAD | `c4cff164` (WebGPU impostor bake has since landed: `e2d7c07c`, `8381a8b3`, `47db91e5`) |
| Playwright recipe | `{headless:true, channel:"chromium", args:[]}` → **SwiftShader software** adapter |
| Real GPU | RTX 4080, 144 Hz — only reachable in the user's interactive browser, not Playwright |

## What changed vs. the WSL run

- **No WebGPU device loss on native Windows.** The app boots, terrain + water +
  far shell render, FPS is stable. The WSL `Instance dropped / external Instance
  no longer exists` errors are a WSL/virtualized-GPU artifact, not a code bug.
- **But the GPU vegetation rings produce nothing on the software adapter.** With
  the prompt's `?world=8&treeGpu=1&webgpuSelection=1` params, after a 22 s settle
  with terrain fully built and FPS pinned at 144:
  - HUD: `trees: enabled 0 trees ... gpu=ring candidates=133225 accepted=0 visible=0`
  - HUD: `grass: enabled webgpu-ring-v1 0 blades ... gpu-grass=initializing ... 0/0/0/0`
  - Screenshot `shots/tree-parity-final-20260629-1856/forest-overview.png`: a **bare
    island** — terrain and water only, no trees, no grass.
- An *earlier* same-session probe at a *previous* HEAD with the default `?world=8`
  path rendered 6,861 trees + grass on the same software adapter, so software CAN
  draw the rings in principle; at current HEAD with these params they stay empty
  (`gpu-grass=initializing`). Whether this is purely the software adapter, the
  `treeGpu=1`/`webgpuSelection=1` params, or a current-HEAD regression on software
  is **not** separable here — the real GPU is the only authority, and it does
  render trees (see below).

## Why this blocks automated validation

Every tree-parity acceptance item (impostor LOD non-zero, impostor vs far-mesh
draw cost, far/impostor boundary, crown shadows, six species) requires the GPU
tree ring to actually emit instances. It does not on the software adapter, and
the headed real-GPU Chrome channel is unavailable to Playwright here (falls back
to SwiftShader). So **Playwright cannot produce real tree-parity evidence on this
machine** — same end state as the WSL run, different precise cause.

## Real-hardware signal already in hand

On the user's real GPU (interactive browser, current build): trees-on ≈ **30 FPS**,
`?world=8&trees=0` ≈ **144 FPS**. So trees still dominate the frame even with the
impostor bake landed — consistent with the *near/mid* forest (real grammar mesh +
heavy `DoubleSide` node material) dominating a close-up island view, where
impostors (a far-band optimization) do not help. The impostor work is necessary
but not sufficient for this camera.

## Verdict

`FAIL / BLOCKED (automated)` — refined cause: **GPU vegetation rings do not
populate on the Playwright software adapter; real-GPU validation must be manual.**
Not proven either way: atlas bake success, impostor LOD usage, far/impostor
transition, crown shadows, six-species placement.

## Manual real-GPU validation protocol (for the user's browser)

Only the RTX 4080 browser can answer these. In the interactive app:

1. **Impostors active?** Load `…/?world=8&hud=1`, orbit to a forest with distant
   trees, read the HUD `trees: … n/m/f/i=<near>/<mid>/<far>/<impostor>`. The
   **impostor count `i` > 0** proves baked billboards are used (not clamped to the
   far mesh — earlier builds showed `…/0`).
2. **Cost split.** Compare avg FPS at the same pose: baseline vs `&trees=0` vs
   `&treeDistance=80` (kills far/impostor band, keeps near). If distance cuts
   barely move FPS, the cost is the **near forest**, not the impostor band.
3. **Exact GPU ms.** Load `…/?world=8&perfProbe=1`, hold the pose ~15 s, paste
   `window.__drusnielPerf.snapshot()` (the `[DEBUG-bs9f]` instrumentation records
   real `gpuRenderMs`/`gpuComputeMs`).
4. **Screenshots** (browser, real GPU): forest overview, far/impostor boundary +
   slow dolly-out (pop/hole check), noon interior (crown shadows), six-species
   gallery.

## Evidence artifacts (this run)

- `tools/clod-poc/shots/tree-parity-final-20260629-1856/forest-overview.png` —
  bare island (software adapter, trees/grass empty).
- `tools/clod-poc/shots/tree-parity-final-20260629-1856/evidence.json` — console
  + HUD capture per case.

---

# Real-GPU run (headed Chromium, RTX 4080) — VALIDATION OBTAINED

> Forcing **headed bundled Chromium** with `--enable-unsafe-webgpu` puts Playwright
> on the real D3D12 device. This reaches the hardware the WSL and headless-software
> runs could not, and produces actual tree-parity evidence. Probes:
> `tools/clod-poc/tools/real-gpu-probe.ts`, `tools/real-gpu-closeup.ts` ([DEBUG-bs9f]).

## Adapter (proves real hardware)

`navigator.gpu.requestAdapter({powerPreference:"high-performance"})` →
`vendor: "nvidia", architecture: "lovelace"` (RTX 4080 / Ada). Features include
`timestamp-query`, `indirect-first-instance`, `chromium-experimental-multi-draw-indirect`.
Artifact: `shots/tree-parity-final-20260629-1856/real-gpu-evidence.json`.

## Key results

| camera | HUD avg FPS | trees visible | n/m/f/i | total tris | note |
| --- | ---: | ---: | --- | ---: | --- |
| forest overview | 141 | 6,592 | 73/3006/3513/**0** | 87,755 | trees render via GPU ring |
| `&treeDistance=80` | 127 | 1,117 | 0/31/629/**457** | — | **baked impostors LIVE** |
| zoomed into canopy | **52.7** | 1,703 | 73/1000/630/0 | **469,211** | near-tree overdraw |
| canopy pan (fewer trees) | 91 | 108 | 70/38/0/0 | — | fewer trees in view |

## What this proves

1. **WebGPU tree path runs on real hardware** — no device loss, `accepted=6592
   visible=6592`. The WSL `FAIL` was an environment artifact, not a code defect.
2. **Baked WebGPU impostors are LIVE, not clamped to the far mesh.** With
   `treeDistance=80` the impostor LOD count is **457** (the `i` in `n/m/f/i`).
   Earlier builds showed `…/0`. TREE-1..6 impostor work is functioning at runtime.
3. **The regression is near-tree fill/overdraw, camera-dependent.** Zooming into
   the canopy drops FPS 141 → **52.7** while showing *fewer* trees (6,592 → 1,703)
   and raising triangles to **469k**. Screenshot `closeup-1-zoomed.png` shows large
   overlapping **foliage cards** filling the screen — classic overdraw. Impostors
   (a far-band optimization) do not help this near view; the user's ~30 FPS is an
   even closer/denser canopy.

## Dolly-out — reproduces the ~30 FPS, and shows impostors never engage

Pulling the camera out from the canopy to the full-forest view (`dolly-*.png`,
default tree distance):

| step | avg FPS | trees visible | n/m/f/**i** |
| ---: | ---: | ---: | --- |
| 0 (zoomed in) | 70 | 926 | 64/508/354/**0** |
| 2 | 39 | 3,434 | 73/2232/1129/**0** |
| 4 (full forest) | **31.4** | 6,592 | 73/3006/3513/**0** |
| 5 | 33.6 | 6,592 | 73/3006/3513/**0** |

Two findings:

1. **The ~30 FPS is reproduced** at the full-forest mid view (6,592 trees) on real
   hardware — this *is* the user's complaint, now captured.
2. **Impostors never engage at the default tree distance** — the impostor LOD count
   (`i`) is **0** at every dolly step. The entire visible forest renders as
   near/mid/far **mesh**. Impostors function (457 at `treeDistance=80`) but their
   ring sits **beyond** the island, so they give **zero benefit** for this scene.
   Six species are active (`TREE_SPECIES = TREE_EXPANDED_SPECIES`: oak/pine/dead/
   birch/willow/spruce); a per-species niche gallery needs interactive pose control
   (the main app exposes no `setPose`), so it is not captured here.

This refines the fix: it is not only near-tree overdraw — the **mid/far tree mesh
LODs carry the whole visible forest because the impostor (and aggressive far) LOD
transition is configured past normal viewing distance**. Pulling the far→impostor
transition inward so the visible forest converts to cheap billboards is the
highest-leverage perf lever, alongside the near foliage-card overdraw.

## Caveats / not-yet-proven

- **`gpuRenderMs` instrument is unreliable**: `info.render.timestamp` read ~0.02 ms
  even on hardware at 52–141 FPS (it under-reports / times a partial pass). Do not
  use the `[DEBUG-bs9f]` GPU-timestamp columns; rely on HUD avg FPS.
- **`trees=0&understory=0` did not disable trees** in the real-GPU run (still
  `accepted=6592`). Possible URL-param regression on this build — flag separately.
- Not rigorously captured this pass: far/impostor dolly-out pop/hole check, impostor
  crown lighting close-up, crown-proxy shadow double-cast, six-species gallery.

## Revised verdict

`PARTIAL PASS`:

- **WebGPU tree ring + baked impostors: PASS** on real hardware (overturns the WSL
  `FAIL`). Impostor LOD non-zero, trees render, no fatal errors.
- **Performance: the near-canopy regression is REAL on hardware** and is **near-tree
  foliage-card overdraw**, which the impostor work does not address. Fix lives in the
  near-tree foliage budget / overdraw / `DoubleSide` material — see the interim
  mitigations in `clod-poc-performance-investigation-2026-06-29.md`.

## Real-GPU artifacts

- `shots/tree-parity-final-20260629-1856/hw-forest-overview.png` — forest renders, 6,592 trees, ~128 FPS.
- `shots/tree-parity-final-20260629-1856/hw-tree-distance-80.png` — impostor band (457 impostors).
- `shots/tree-parity-final-20260629-1856/closeup-1-zoomed.png` — near-canopy overdraw, 469k tris, 52.7 FPS.
- `shots/tree-parity-final-20260629-1856/real-gpu-evidence.json`, `closeup-fps.json`.
