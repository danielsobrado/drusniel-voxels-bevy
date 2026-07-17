# Testing Handover — GPU-Driven P0/P1/P3 Validation (2026-07-17)

This is a self-contained prompt for a testing/verification agent working in this repo.
Report results back in the format at the bottom. Do not change product code except where
a step explicitly allows a fix; if something fails, capture the evidence and report.

## What changed (already typecheck/test/build green at unit level)

All in `tools/clod-poc`:

1. **Meshlet frustum cull (new)** — `src/terrain/streaming/gpu_clod_meshlet_cull.ts`,
   called from `src/app/frame_loop/terrain_frame_phase.ts`. Per frame it flips the
   `instanceCount` lane of each resident page's per-meshlet `drawIndexedIndirect`
   command (0/1) against the camera frustum, entirely on GPU. Kill switch:
   `?clodMeshletCull=0`. Counters: `clod_meshlet_cull_enabled/ready/pages/meshlets/dispatches`.
2. **WGSL reserved-keyword fix** — `let target = atomicAdd(...)` renamed in 5 shaders
   (`gpu_clod_page_compute_shaders.ts` ×2, `gpu_clod_weld_compute.ts`,
   `gpu_clod_simplify_runtime_shader.ts`, `gpu_clod_simplify_compute.ts`). Before this,
   `liveClodGpuHierarchy=1` was silently broken (2 uncaptured errors at boot, no
   resident pages ever registered).
3. **Meshlet bounds** now include the root-morph Y extent (`positionMorph.w`) in
   `GPU_CLOD_MESHLET_WGSL`, so culling is conservative under geomorphing.
4. **Selection readback** — `webgpuSelection=1` now defaults `webgpuReadback` to
   `async` (was dead dispatch); `once` mode re-arms per node-version change.
5. **farOwner** — replace-mode rule moved into `resolveFarOwner`; bootstrap override
   removed. **Understory** capacity test aligned (12 groups × 1000). **localStorage**
   stub added to `src/qa/rpg_density_scene_composition.test.ts`.

## Environment rules (violating these produces garbage data)

- Never run vitest, vite, perf tools, or acceptance through `rtk` — call npm directly.
- Port **5180 belongs to the user**. Run your own server:
  `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5184 --strictPort`
  and point tools at it with the `CLOD_POC_BASE_URL` env var.
- Never edit source while a perf/acceptance run is in flight (HMR wedges the run).
- Perf A/Bs need an otherwise-idle machine and **N≥3 replicates**; if two opposite-flag
  runs degrade identically, the machine was loaded — discard both.
- Browser checks must use the Playwright tools (`shoot`, `perf:move`, acceptance
  runners), not an in-app browser pane.
- Known pre-existing noise: an erosion `Binding size ... larger than maximum storage
  buffer binding size` warning at continent boot. Not part of this validation; note it
  but do not chase it.

## Step 1 — Static gates (fast, do first)

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
```

All three must be green (they were at handover; re-confirm on the current tree).

## Step 2 — Resident path boots clean (validates the WGSL fix)

Start the dev server (above), then:

```powershell
$env:CLOD_POC_BASE_URL='http://127.0.0.1:5184/'
npm --prefix tools/clod-poc run shoot -- --scene continent --seed 1 --freeze 1 --waitroots 1 --settle 30 --timeout 240000 --liveClodGpuHierarchy 1 --out shots/p1-meshlet-cull/cull-on.png --stats shots/p1-meshlet-cull/cull-on-stats.json
```

PASS requires, in the stats JSON counters:
- `webgpu_uncaptured_errors == 0`  ← was 2 before the WGSL fix
- `live_clod_gpu_resident_render_views_total > 0` and
  `live_clod_gpu_indirect_render_views_total > 0`  ← resident indirect views exist
- `clod_meshlet_cull_ready == 1`, `clod_meshlet_cull_pages > 0`,
  `clod_meshlet_cull_meshlets > 0`  ← the cull pass is actually running over pages
- `window.__drusnielClod.error` null (shoot fails loudly otherwise)

If `resident_render_views` stays 0, check whether the boot pose only builds L1+ roots:
resident render currently covers only L0 (`liveClodGpuResidentMaxLevel` default 0). Move
the camera to ground level via `--cam x,y,z,yaw,pitch` and re-check before concluding.

## Step 3 — Visual parity A/B (cull must be invisible)

Same command as Step 2 but capture both variants at 2–3 poses, including one grazing
low-altitude pose looking across terrain and one looking straight down:

- ON:  `--liveClodGpuHierarchy 1` (cull defaults on) → `cull-on-<pose>.png`
- OFF: `--liveClodGpuHierarchy 1 --clodMeshletCull 0` → `cull-off-<pose>.png`

PASS: screenshots per pose are visually identical (compare lumas/pixels; the repo has
`tools/compare.ts` and the `visual:validate` harness). Any missing terrain patch, hole,
or popped meshlet at a frustum edge is a FAIL — capture the pose string and both images.
Also spin the camera 360° at one pose (setPose steps) and screenshot each 90°: no holes.

## Step 4 — Perf A/B (the actual point of P1)

Three replicates per variant, idle machine, via perf:move on the continent scene with
the hierarchy enabled (add `--params`/URL flags as the tool supports; if perf:move can't
target continent, use `perf:main --world 8` fixed-pose as fallback and say so):

- Variant A: `liveClodGpuHierarchy=1` (cull on)
- Variant B: `liveClodGpuHierarchy=1&clodMeshletCull=0`

Report from each run's `summary.json`: `frameMs` p50/p95, `renderMs` p95, terrain
triangles, `clod_meshlet_cull_meshlets`, and the top phase bucket. Expectation: culled
triangle count drops at grazing poses; renderMs p95 equal or better; frameMs must not
regress beyond noise. If renderMs is flat, that is a valid finding (draw-submission
bound — the plan's P2 is then the next lever); report it honestly, do not spin it.

## Step 5 — Selection readback default (P3)

Boot `?world=16&clodPerf=1&webgpuSelection=1` (no explicit webgpuReadback) via shoot
with `--stats`:
- selection stats must show `readbackMode: "async"`, `selectionSource: "webgpu"` once
  a map lands, `parity: "ok"`, and `readbackFrames > 0` with `skippedDispatches` low.
- Confirm `webgpuSelection=1&webgpuReadback=off` still yields `selectionSource: "cpu"`
  (dispatch-cost measurement mode preserved).

## Step 6 — Regression sweep

```powershell
npm --prefix tools/clod-poc run accept:infinite-islands:reuse
npm --prefix tools/clod-poc run accept:continent-short
```

Both must pass their existing gates. The changes must not alter any default-path
behavior (cull only activates with `liveClodGpuHierarchy=1`, which defaults off), so
any default-path diff traces to the farOwner or readback changes — investigate there
first (`window.__drusnielFarOwnership` labels, HUD `far=` string).

## Step 7 — Edit stress (bounds + residency interplay)

With `liveClodGpuHierarchy=1`, dig/carve terrain near the camera (player interaction or
the edit service probe), then verify: no uncaptured errors, no stale terrain holes, and
edited pages either rebuild resident or fall back to the CPU path without visual gaps.

## Report back (paste this filled-in)

```
STATIC:    typecheck / tests / build: PASS|FAIL (counts)
BOOT:      uncaptured=<n> resident_views=<n> indirect_views=<n> cull_pages=<n> cull_meshlets=<n>
PARITY:    poses tested=<n> identical=<y/n> (diffs attached: paths)
PERF:      A(frameMs p50/p95, renderMs p95, tris) vs B(...), N=<runs>, verdict
SELECTION: readbackMode=<> selectionSource=<> parity=<>
ACCEPT:    infinite-islands:reuse=<PASS|FAIL> continent-short=<PASS|FAIL>
EDITS:     <observations>
BLOCKERS / ANOMALIES: <anything unexplained, with evidence paths>
RECOMMENDATION: flip liveClodGpuHierarchy default ON? yes/no/needs-more
```
