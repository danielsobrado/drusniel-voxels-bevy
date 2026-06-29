# clod-poc tree parity validation - 2026-06-29

Git SHA: `dd93c2a1445c8c4531aa70580ce7a5614268d9a9`

Final verdict: `FAIL: blocker list`

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
