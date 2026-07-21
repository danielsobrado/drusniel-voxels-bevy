# CLOD-POC QA Tooling

**Scope:** `tools/clod-poc` on `main`  
**Audited commit:** `09c3a9b9b594023b9d095407847763f56098a462`  
**Purpose:** one operational guide for the unified QA system, release gates, feature acceptance suites, performance tools, visual tools, and low-level diagnostics.

This document treats a tool as public QA when it is exposed by `tools/clod-poc/package.json`, referenced by the unified QA manifests, used by a CLOD GitHub Actions workflow, or implemented as a manual CLI under `tools/clod-poc/tools` or `tools/clod-poc/scripts`.

## 1. The important distinction

CLOD-POC has three different kinds of QA evidence. They must not be treated as equivalent.

| Class | Purpose | Can block release? | Typical output |
|---|---|---:|---|
| **Canonical unified QA** | Stable scene registry, declared commands, repeatable captures, deterministic artifacts, baseline comparisons | Yes | `validation-runs/` |
| **Specialized acceptance and performance gates** | Deep verification of one subsystem such as streaming, water, trees, playable-world behavior, or GPU meshing | Yes, for changes in that subsystem | `acceptance-runs/`, `perf-runs/`, `qa-runs/` |
| **Diagnostic captures and probes** | Investigation, visual inspection, counter inspection, A/B comparison, evidence generation | No by themselves | `shots/`, console output, local JSON |

The canonical release result is the unified battery. Specialized tools add depth; they do not replace the canonical capture lane.

## 2. Current audit findings

1. **The canonical system is manifest-driven.** Scene definitions, thresholds, allowed commands, batteries, and legacy ID mapping live under `validation/manifests/`.
2. **Lane A is in CI.** `.github/workflows/unified-qa-lane-a.yml` validates manifests, typechecks, and runs unified QA tests on pull requests and pushes to `main`.
3. **Native GPU Lane B remains a local/manual authority path.** A capture is authoritative only on clean Windows `main` using a real hardware WebGPU adapter. Linux, CI, WARP, SwiftShader, llvmpipe, software adapters, dirty trees, and non-`main` branches are diagnostic only.
4. **The unified orchestrator, CLOD capture CLI, and baseline promoter have no npm aliases.** They must currently be run through `npm exec -- tsx ...`.
5. **`npm run qa` and `visual:regression*` are evaluators, not turnkey capture commands.** They require `--summary <qa-summary.json>`. Running them with no summary fails by design. Prefer the orchestrator for normal use.
6. **Image gates in the initial canonical manifests are not yet authoritative until approved native baselines are promoted.** Counter, probe, and required timing gates can still fail.
7. **`trees:wire-*` commands mutate generated source.** Their `:check` variants are the read-only QA guards. Do not run the write variants merely to “verify” a branch.
8. **The older `battery` command is a legacy aggregate.** It still has useful coverage, but the manifest-driven `clod-smoke` and `clod-full` batteries are the preferred top-level entry points.

## 3. Canonical unified QA

### 3.1 Source-of-truth files

| File | Responsibility |
|---|---|
| `validation/manifests/visual-regression.yaml` | Canonical visual scenes, poses, image gates, region probes, counter gates, and visual timing gates |
| `validation/manifests/performance-regression.yaml` | Canonical performance scenes and required timing/counter gates |
| `validation/manifests/legacy-id-map.yaml` | Mapping from older scene/check names into canonical IDs |
| `validation/manifests/command-allowlist.yaml` | Exact commands, working directories, timeouts, placeholders, and declared artifacts |
| `validation/manifests/batteries.yaml` | Lane composition and named smoke/full batteries |
| `tools/clod-poc/tools/qa-orchestrator.ts` | Validates manifests, runs batteries, and runs fresh-process determinism |
| `tools/clod-poc/tools/qa-capture-clod.ts` | Drives the browser through `window.__drusnielQa` and writes standardized CLOD artifacts |
| `tools/clod-poc/tools/qa-baseline.ts` | Explicitly promotes authoritative captures to baselines |
| `tools/clod-poc/src/qa/unified/` | TypeScript schema, loaders, evaluators, reports, battery runner, determinism, and baseline logic |
| `docs/qa/unified-visual-regression.md` | Shared CLOD/Bevy unified QA design and baseline authority rules |

### 3.2 Lanes

| Lane | CLOD content | Authority |
|---|---|---|
| **Lane A — static** | Manifest validation, TypeScript typecheck, unified QA unit tests | Portable CI evidence |
| **Lane B — capture** | Frozen WebGPU captures for canonical visual and performance scenes | Authoritative only on clean Windows `main` with hardware GPU |
| **Lane C — specialized** | Infinite streaming acceptance, water verification, tree parity | Diagnostic/specialized evidence; it does not replace Lane B |

### 3.3 Batteries

| Battery | What it runs |
|---|---|
| `clod-smoke` | CLOD Lane A plus the canonical main-view smoke capture |
| `clod-full` | CLOD Lane A, all canonical CLOD captures, infinite-islands acceptance, water verification, and tree parity |
| `combined-smoke` | CLOD and Bevy static plus smoke captures |
| `combined-full` | All CLOD and Bevy lanes |

The CLOD full scene set currently includes the main view, 4 km long view, and infinite-islands static, moving, and steady checkpoints.

### 3.4 Recommended commands

Run these from the repository root.

Validate the contract without launching GPU work:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode validate
```

Run the canonical CLOD smoke battery:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts `
  --mode run `
  --battery clod-smoke `
  --target clod-poc `
  --output validation-runs/orchestrated/clod-smoke
```

Run the canonical CLOD full battery:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts `
  --mode run `
  --battery clod-full `
  --target clod-poc `
  --output validation-runs/orchestrated/clod-full
```

Run the smoke battery twice in fresh processes and compare deterministic artifacts:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts `
  --mode determinism `
  --battery clod-smoke `
  --target clod-poc `
  --output validation-runs/determinism/clod-smoke
```

### 3.5 Standard capture output

```text
<run-root>/
  battery-report.json
  battery-report.md
  commands/
  targets/
    clod-poc/
      environment.json
      determinism.json
      scenes/
        clod-poc/
          <scene-id>/
            actual.png
            actual.stats.json
            actual.metrics.json
            determinism.json
```

`environment.json` records the repository commit, branch, dirty state, browser, adapter, backend, viewport, and authority status.

### 3.6 Direct capture

Use direct capture when debugging scene selection or capture behavior without the complete battery:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-capture-clod.ts `
  --output validation-runs/capture/clod-smoke `
  --tags smoke
```

Supported filters are repeated `--scene <id>` arguments and comma-separated `--tags <tag,tag>`.

The tool starts Vite when needed, launches WebGPU through Playwright, waits for `window.__drusnielQa`, applies canonical state and pose, freezes the runtime, settles, captures, evaluates region probes, and writes deterministic counters.

### 3.7 Baseline promotion

Baseline promotion is intentionally separate from capture:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-baseline.ts `
  --run-root validation-runs/orchestrated/clod-full/targets/clod-poc `
  --approve
```

Use repeated `--scene <id>` to promote a subset.

Promotion requires clean `main`, matching source/capture commits, an authoritative native environment, complete artifacts, and explicit `--approve`. `--allow-ci` is an exceptional override and must not be used to turn software-rendered output into a release baseline.

## 4. Static and build verification

| Command | Type | What it verifies |
|---|---|---|
| `npm --prefix tools/clod-poc run visual:validate` | Gate | Parses and cross-validates canonical visual/performance/legacy manifests |
| `npm --prefix tools/clod-poc run typecheck` | Gate | TypeScript compile contract with no emitted files |
| `npm --prefix tools/clod-poc run test` | Gate | Full Vitest suite |
| `npm --prefix tools/clod-poc run test -- <paths>` | Gate | Focused Vitest files or directories |
| `npm --prefix tools/clod-poc run test:coverage` | Report | Full Vitest coverage report |
| `npm --prefix tools/clod-poc run build` | Gate | Production Vite build |
| `npm --prefix tools/clod-poc run verify:clod` | Aggregate gate | Typecheck, all tests, and fast CLOD page acceptance |
| `npm --prefix tools/clod-poc run postfx:verify` | Focused gate | Typecheck and the selected post-processing test set |
| `npm --prefix tools/clod-poc run lighting:verify` | Focused gate | Lighting/environment/post-processing/forest-lighting tests plus build |
| `npm --prefix tools/clod-poc run spells:verify` | Focused gate | Spell VFX, edit commands, and convergence tests plus build |
| `npm --prefix tools/clod-poc run playable-slice:verify` | Focused gate | Save/reload, water route, headed harness, playable contracts, and build |

`test:watch` is developer convenience, not release evidence.

## 5. CLOD page builder and structural acceptance

### 5.1 Builder commands

| Command | Purpose |
|---|---|
| `spike` | API/algorithm spike for the CLOD page pipeline |
| `build-pages` | Build page hierarchy with normal parameters |
| `build-pages:smoke` | Small smoke hierarchy |
| `build-pages:gate` | Eight-page gate-sized hierarchy |

### 5.2 Phase 3 CLOD acceptance

| Command | Purpose |
|---|---|
| `acceptance:clod` | Full CLOD Phase 3 acceptance runner |
| `acceptance:clod:fast` | Same runner without screenshots |
| `verify:clod` | Static checks plus fast acceptance |

Options:

```text
--config <path>
--scene ridge_border|cliff_corner|cave_mouth|thin_bridge
--no-screenshots
--json
```

Configuration lives in `config/clod_acceptance.yaml`. The gate checks border position, normal, and material continuity; triangle reduction; low-benefit rate; hierarchy build time; optional node rebuild time; density scars; holes/lips; stress scenes; and a streaming walk.

Current default visual capture is disabled in YAML, so `acceptance:clod` is primarily a structural and numeric gate unless visual mode is explicitly enabled.

## 6. Visual capture and regression tools

| Command | Class | Use |
|---|---|---|
| `shoot` | Diagnostic capture | One configurable screenshot plus optional stats; supports WebGPU/WebGL, explicit camera, convergence waits, keyboard input, inventory, and GPU samples |
| `shoot-props` | Diagnostic capture | Prop-focused captures |
| `compare` | Diagnostic | Side-by-side image composition or pixel sampling; no pass/fail contract |
| `sequence:capture` / `sequence:pair` | Diagnostic capture | Deterministic multi-frame or paired visual sequences |
| `sequence:evaluate` | Evaluator | Summarizes/evaluates sequence evidence |
| `visual:unified-streaming-manual` | Manual QA | Streaming visual inspection workflow |
| `border-ocean:visual` | Specialized visual | Border coast/deep-ocean visual capture |
| `phase0` | Legacy diagnostic | Phase-0 capture/evidence workflow |
| `battery` | Legacy aggregate | Older sanity, long-view, border-ocean, and infinite-islands battery |
| `visual:regression*` | Evaluator | Evaluates an existing QA summary against canonical manifests; requires `--summary` |
| `qa` | Evaluator | Compatibility wrapper over the same unified evaluator; requires `--summary` |

Example single capture:

```powershell
npm --prefix tools/clod-poc run shoot -- `
  --scene infinite-islands `
  --cam 2048,96,2048,2.65,-0.43,55 `
  --waitfar 1 `
  --waitroots 1 `
  --waitwater 1 `
  --stats shots/debug/stats.json `
  --out shots/debug/frame.png
```

`shoot` requires a reachable server. It does not define a canonical baseline and should not be used as release proof by itself.

## 7. Performance and profiling

### 7.1 General frame performance

| Command | Purpose | Server |
|---|---|---|
| `perf:main` | Runs named static performance cases and writes per-case JSON plus `summary.json`/`summary.md` | Required; default URL is port 5180 |
| `perf:move` | Deterministic static + moving infinite-islands windows, route streaming, worst-frame forensics, and converged checkpoint shots | Required |
| `perf:p0` | Phase-0 performance capture | Depends on tool profile |
| `perf:p0:extract` | Extracts/normalizes Phase-0 performance evidence | No renderer |
| `perf:postfx` | PostFX performance matrix | Required |
| `perf:construction` | Construction Phase-0 benchmark | Tool-specific |
| `bench:prop-edits` | Prop edit path benchmark | Tool-specific |
| `perf:heightfield-raster` | Startup heightfield raster benchmark | Tool-specific |
| `perf:rpg-edit-storm` | Dense RPG edit-storm benchmark | Required |
| `perf:rpg-agent-envelopes` | Dense RPG agent/content envelopes | Required |
| `accept:rpg-dense` | Dense RPG acceptance gate | Required |
| `bench:rpg-dense-aggregate` | Aggregates dense RPG baseline runs | No renderer |

Typical `perf:main` options:

```text
--baseUrl --world --warmup --frames --timeout --case --out
--renderer webgpu|webgl --freeze --params key=value,key=value
```

It writes under `perf-runs/main-<timestamp>/` by default.

Typical `perf:move` options include:

```text
--baseUrl --out --profile --world --seed --scene --x --z --yaw
--route --startupWorld --staticFrames --moveFrames --speed --shots
--cpuprofile --trace --onsetFrames --turnRate
--readyTimeout --convergenceTimeout --moveTimeout
--checkpointConvergenceTimeout --renderScale
```

`perf:move` records real co-occurring fields for the worst frames. Do not add independent per-phase p95 values and call the sum a frame cost.

### 7.2 GPU CLOD pool benchmark

| Command | Meaning |
|---|---|
| `perf:gpu-clod-pools` | Hardware benchmark; auto-manages an acceptance Vite server |
| `perf:gpu-clod-pools:software` | Correctness-only execution on software adapters |
| `perf:gpu-clod-pools:gate` | Four balanced runs; fails if dual-pool ratio exceeds 1.10 |
| `perf:gpu-clod-pools:evidence` | Formats benchmark evidence |

Options use equals syntax:

```text
--runs=4
--warmup-pairs=1
--timeout=360000
--min-pages=8
--out=perf-runs/gpu-clod-pools/result.json
--max-dual-ratio=1.10
--allow-headed
--allow-software
```

`--runs` must be even so single/dual ordering is balanced. Hardware ratio gates reject unknown and software adapters.

### 7.3 PostFX gates

`postfx:verify` is CPU/static. `perf:postfx` is the runtime matrix. The repository also contains `tools/postfx-perf-gate.ts` for threshold evaluation. The `CLOD PostFX Gate` workflow currently runs the static verifier in Ubuntu CI.

## 8. Infinite streaming and continent QA

### 8.1 Infinite-islands acceptance

| Command | Coverage |
|---|---|
| `accept:infinite-islands` | Default acceptance profile |
| `accept:infinite-islands:fast` | Reduced sample count; only `walk` and `final-near` are supported |
| `accept:infinite-islands:reuse` | Reuses acceptance page/world state where supported |
| `accept:infinite-islands:full` | Full profile |
| `accept:unified-streaming-long-route` | Long movement route, performance gate |
| `accept:continent-short` | Short continent route, reuse profile |
| `accept:continent-coast-to-coast` | Coast-to-coast route |
| `accept:continent-revisit` | Outbound plus revisit/eviction economics |

The wrapper starts `vite.acceptance.config.ts`, refuses accidental reuse of an already running server, launches Playwright WebGPU, and stops the server afterward.

Environment:

```text
CLOD_POC_BASE_URL=http://127.0.0.1:5173/
CLOD_POC_REUSE_SERVER=1
```

Useful filters:

```text
--scene <name[,name]>
--gate coverage|perf|all
--fast
--reuse
--calibrate
--representative
--short-route
--coast-to-coast
--revisit
--long-route
```

The acceptance suite covers far-summary GPU authority, stones, canopy, movement, water, biome near/horizon, final near/horizon, convergence, ownership holes, streaming queues, route tails, long tasks, memory/resource envelopes, revisit eviction, screenshots, console errors, and page errors.

Outputs are written under `acceptance-runs/infinite-islands/`.

### 8.2 Continent tools

| Command | Purpose |
|---|---|
| `precision:rim` | Floating-point/rim precision verification |
| `soak:continent` | Long-running continent streaming soak |
| `drill:continent-recovery` | Immediate recovery drill using the soak harness |
| `report:continent-repeatability` | Compares long-map runs for repeatability |
| `accept:continent-tiles` | Continent tile acceptance |
| `accept:phase5-voxel-overlay` | Phase 5 voxel overlay acceptance |
| `accept:phase6-road-stamp` | Phase 6 road-stamp acceptance |
| `world:verify` | Fast deterministic CPU verification of heightfield tiles, prop IDs/exclusions, feature stamps, and construction semantics |
| `continent:tile-mesh-probe` | Low-level continent tile mesh diagnostic |

`world:verify` accepts `--tiles <count>` and defaults to 16 deterministic samples.

## 9. Playable-world acceptance

| Command | Behavior |
|---|---|
| `accept:playable-slice` | Runs both diagnostic and continuous profiles, five runs each by default, plus the continuous-profile extra run |
| `accept:playable-slice:diagnostic` | Diagnostic profile only |
| `accept:playable-slice:continuous` | Continuous profile only |
| `playable-slice:verify` | Static/unit/build preflight |
| `baseline:playable` | Explicitly writes playable baseline data; mutating and not a normal verification command |

The headed acceptance requires a real WebGPU browser, discovers a viable route, exercises the gameplay contract, writes screenshots/reports, and fails if expected runs are missing or any run reports failures.

Options:

```text
--runs=<1..100>
--mode=diagnostic|continuous
```

## 10. Tree, canopy, and vegetation QA

### 10.1 Parity preflight and evidence

| Command | Purpose |
|---|---|
| `trees:preflight-parity` | Read-only generated-source checks plus parity manifest validation |
| `trees:qa-parity` | Preflight parity, typecheck, and full tests |
| `trees:capture-parity-evidence` | Prints the screenshot/performance commands required by the parity manifest; it does not execute them |
| `trees:verify-parity-evidence` | Validates existing capture and metric files |
| `trees:report-parity-evidence` | Writes a Markdown parity evidence report |

`trees:qa-parity` is a code/preflight gate. It is not proof that the visual evidence files were freshly captured.

### 10.2 Tree impostors

| Command | Purpose |
|---|---|
| `trees:verify-impostor` | Focused impostor unit tests plus production build |
| `trees:verify-impostor-visual` | WebGPU orbit capture and dark vertical spike detector |
| `trees:tune-impostor-visual` | Tuning harness for impostor visuals |
| `trees:verify-impostor-full` | Static/build gate followed by visual spike gate |

The visual gate auto-starts Vite when needed, hides DOM overlays, captures an orbit, and evaluates thin dark-run artifacts. Defaults are eight samples at 1280×720 under `shots/trees/impostor-visual/`.

### 10.3 Generated-source guards

Read-only commands:

```text
trees:verify-terrain-cull
trees:wire-visible-cluster-mask:check
trees:wire-tree4-tree5:check
trees:wire-tree7-shadows:check
trees:wire-tree8-proxies:check
trees:wire-tree9-wgsl:check
trees:wire-tree9-config:check
trees:repair-generated:check
trees:wire-shadow-proxies:check
trees:wire-parity:check
trees:check-parity-manifest
```

The same `wire-*` and `repair-*` names without `:check` write or repair generated files. Treat them as code-generation operations, not QA runs.

### 10.4 Additional manual tree tools

These have no package alias and are primarily diagnostic/evidence tools:

```text
tools/tree-canopy-transition-acceptance.ts
tools/tree-morphology-evidence.ts
tools/probe-tree-geo.ts
tools/probe-cpu-trees.ts
```

Run them with:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/<file>.ts [options]
```

## 11. Water QA

### 11.1 Core reports and probes

| Command | Purpose |
|---|---|
| `water:report` | Static/config/runtime-model verification report |
| `water:find` | Finds deterministic useful water shot locations |
| `water:probe` | Probes water/terrain margins |
| `water:hydrology` | Hydrology field diagnostic |
| `water:graph` | Builds/inspects the water graph |
| `water:graph-startup` | Startup graph probe |
| `water:graph-semantics` | Water graph semantic checks |
| `water:tile-carve-perf` | Heightfield tile carve benchmark |
| `water:seam` | Hydrology seam report |
| `water:streaming` | Water streaming report |
| `water:ownership` | Water ownership report |
| `water:stats` | Runtime water statistics report |
| `probe:far-handoff` | Terrain/far-water handoff diagnostic |
| `probe:rim-gpu-mesher` | Rim GPU mesher diagnostic |

`water:report` verifies runtime-only water ownership, zero terrain-CLOD-owned water surfaces, clipmap activation and triangle budget, safe reflection fallback, no false SSR/compute-caustic claims, and wetness-mask bounds. Its default report is `qa-runs/water/water-verify-report.json`.

### 11.2 Water captures

| Command | Purpose |
|---|---|
| `water:shot` | General deterministic water capture harness |
| `water:shot:glacial` | Glacial preset capture |
| `water:capture:glacial` | Glacial water acceptance capture |
| `water:capture:glacial:ab` | Glacial A/B profile |
| `water:shot:lake-final` | Final lake shading |
| `water:shot:river-final` | Final river shading |
| `water:shot:lake-depth` | Depth debug |
| `water:shot:river-foam` | Foam debug |
| `water:shot:flow` | Flow debug |
| `water:shot:clipmap` | Clipmap-level debug |
| `water:shot:refraction` | Refraction debug |
| `water:shot:reflection` | Reflection debug |
| `water:shot:ssr-hit` | SSR hit debug |

### 11.3 Foam matrices

| Command | Coverage |
|---|---|
| `water:foam:accept:high` / `:low` | Visual acceptance for one quality tier |
| `water:foam:accept:matrix` | High/low captures at matching poses plus cross-tier parity |
| `water:foam:accept:shade` | High and low shade acceptance |
| `water:foam:accept:webgl` | High and low WebGL fallback acceptance |
| `water:verify` | Report + location finding + margin probe + all-scene water shots |
| `water:verify:full` | `water:verify` plus quality, shade, and WebGL matrices |

The quality matrix writes per-tier `report.json` files and a root `matrix-report.json`, normally under `shots/water/foam-acceptance/`.

Additional manual-only water gates include:

```text
tools/water-foam-distance-acceptance.ts
tools/water-foam-renderer-matrix.ts
tools/biome-visual-acceptance.ts
tools/verify-traced-carve.ts
tools/capture-glacial-water-acceptance.ts
```

## 12. Terrain, props, and focused diagnostics

| Command | Purpose |
|---|---|
| `terrain:diagnose` | Terrain material/config/runtime diagnostic |
| `props:generate-snaps` | Generates prop snap metadata; mutating utility, not a gate |
| `bench:prop-edits` | Measures prop edit path |
| `shoot-props` | Prop visual capture |

Manual probes currently include:

```text
tools/farsum-probe.ts
tools/probe-user-pose-flicker.ts
tools/probe-static-flicker.ts
tools/probe-sun-mismatch.ts
tools/probe-hydrology-atlas.ts
tools/probe-lod-perf.ts
tools/probe-far-handoff.ts
tools/probe-rim-gpu-mesher.ts
tools/shot-seam-grazing.ts
tools/lookdev-gallery.ts
```

These are excellent for root-cause analysis but should only become release gates after they have deterministic inputs, explicit thresholds, declared artifacts, and a place in the canonical command allowlist/battery manifest.

## 13. Server and hardware rules

| Tool family | Server behavior |
|---|---|
| Unified CLOD capture | Starts Vite if the configured URL is unreachable |
| Infinite-islands wrapper | Starts acceptance Vite; rejects accidental reuse unless explicitly enabled |
| GPU CLOD pool wrapper | Starts acceptance Vite; same explicit reuse rule |
| Legacy `battery` | Starts acceptance Vite if needed |
| Tree impostor visual gate | Starts normal Vite unless `--noServe` is passed |
| `shoot`, `perf:main`, `perf:move` | Expect an already reachable server |

Common environment variables:

```text
CLOD_POC_BASE_URL
CLOD_POC_REUSE_SERVER
DRUSNIEL_QA_RUN_INDEX
```

Performance evidence must record the exact repository SHA, dirty state, renderer, adapter, viewport, resolution scale, quality profile, seed, scene, and relevant URL parameters. A number without that identity is not a trustworthy regression result.

## 14. Output directories

| Directory | Contents |
|---|---|
| `validation-runs/` | Canonical unified battery, capture, determinism, and comparison reports |
| `validation/baselines/` | Approved canonical image/stats/metrics baselines and authority metadata |
| `acceptance-runs/` | CLOD page, infinite-islands, playable, and other acceptance outputs |
| `perf-runs/` | Runtime performance measurements and summaries |
| `qa-runs/` | Focused machine-readable QA reports |
| `shots/` | Diagnostic screenshots, visual matrices, and evidence captures |
| `docs/performance/` | Human-readable evidence reports generated from captured artifacts |

Generated outputs should not be treated as current merely because their file timestamp is recent. Always check the recorded commit SHA, dirty flag, profile, seed, scene, renderer, and adapter.

## 15. GitHub Actions coverage

| Workflow | Current coverage |
|---|---|
| `.github/workflows/unified-qa-lane-a.yml` | Canonical manifest validation, CLOD typecheck, unified QA tests, and corresponding Bevy validation/tests |
| `.github/workflows/clod-postfx-gate.yml` | CLOD PostFX static verifier on relevant path changes |
| `.github/workflows/clod-gpu-hierarchy-gate.yml` | Typecheck and focused GPU hierarchy/residency/runtime tests |

Native Lane B capture is intentionally not ordinary Linux CI authority. It should run on a controlled Windows hardware-GPU machine and publish its complete `validation-runs` artifacts.

## 16. Recommended developer workflows

### Small code change

```powershell
npm --prefix tools/clod-poc run visual:validate
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run test -- <focused-test-paths>
npm --prefix tools/clod-poc run build
```

### Renderer or visual change

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode run --battery clod-smoke --target clod-poc --output validation-runs/orchestrated/clod-smoke
```

Then run the relevant specialized visual/performance suite, such as `trees:verify-impostor-full`, `water:verify:full`, `perf:postfx`, or `perf:move`.

### Streaming or terrain ownership change

```powershell
npm --prefix tools/clod-poc run world:verify
npm --prefix tools/clod-poc run verify:clod
npm --prefix tools/clod-poc run accept:infinite-islands:reuse
npm --prefix tools/clod-poc run perf:move -- --out perf-runs/move-change
```

### Playable-world change

```powershell
npm --prefix tools/clod-poc run playable-slice:verify
npm --prefix tools/clod-poc run accept:playable-slice
```

### Release candidate

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode determinism --battery clod-smoke --target clod-poc --output validation-runs/determinism/clod-smoke
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode run --battery clod-full --target clod-poc --output validation-runs/orchestrated/clod-full
npm --prefix tools/clod-poc run accept:playable-slice
```

Add the subsystem-specific full suite for every changed high-risk area. Do not promote baselines until all failures are understood.

## 17. Maintenance rules

1. New canonical scenes belong in the YAML manifests, not in a second hard-coded registry.
2. New orchestrated commands must be added to `command-allowlist.yaml`; never inject arbitrary shell text.
3. Every gate needs deterministic inputs, explicit thresholds, clear required/advisory status, and declared artifacts.
4. Captures and evaluators must remain separate. Baseline promotion must remain an explicit third step.
5. A diagnostic script should not block release until it is deterministic and represented in a battery.
6. Feature tools must fail loudly on missing hooks, missing counters, page errors, console errors, software-adapter misuse, and incomplete reports.
7. Do not weaken thresholds to make a regression disappear. Calibrate from measured clean-main hardware runs and record the reason.
8. Prefer one canonical smoke battery and targeted specialized suites over one ever-growing monolithic command.
9. Add npm aliases for `qa-orchestrator`, `qa-capture-clod`, and `qa-baseline` when the package script surface is next cleaned up.
10. Retire or clearly label legacy aggregate tools after their unique coverage has moved into the unified manifests.

## 18. Command inventory by package alias

This is the complete QA-related script surface currently exposed by `tools/clod-poc/package.json`.

### Core, build, visual, and test

```text
spike
build-pages
build-pages:smoke
build-pages:gate
qa
visual:validate
visual:regression
visual:regression:smoke
visual:regression:full
shoot
sequence:capture
sequence:pair
sequence:evaluate
shoot-props
compare
battery
border-ocean:visual
phase0
test
test:coverage
test:watch
typecheck
build
```

### Performance

```text
perf:main
perf:move
perf:rpg-edit-storm
perf:rpg-agent-envelopes
accept:rpg-dense
bench:rpg-dense-aggregate
perf:p0
perf:p0:extract
perf:postfx
perf:construction
bench:prop-edits
perf:heightfield-raster
perf:gpu-clod-pools
perf:gpu-clod-pools:software
perf:gpu-clod-pools:gate
perf:gpu-clod-pools:evidence
```

### Focused verification

```text
postfx:verify
lighting:verify
spells:verify
acceptance:clod
acceptance:clod:fast
verify:clod
```

### Infinite world, continent, and playable slice

```text
accept:infinite-islands
accept:infinite-islands:fast
accept:infinite-islands:reuse
accept:infinite-islands:full
accept:unified-streaming-long-route
accept:continent-short
accept:continent-coast-to-coast
accept:continent-revisit
precision:rim
visual:unified-streaming-manual
soak:continent
drill:continent-recovery
report:continent-repeatability
accept:continent-tiles
accept:phase5-voxel-overlay
world:verify
baseline:playable
accept:playable-slice
accept:playable-slice:diagnostic
accept:playable-slice:continuous
playable-slice:verify
accept:phase6-road-stamp
terrain:diagnose
props:generate-snaps
```

### Trees

```text
trees:verify-terrain-cull
trees:wire-visible-cluster-mask
trees:wire-visible-cluster-mask:check
trees:wire-tree4-tree5
trees:wire-tree4-tree5:check
trees:wire-tree7-shadows
trees:wire-tree7-shadows:check
trees:wire-tree8-proxies
trees:wire-tree8-proxies:check
trees:wire-tree9-wgsl
trees:wire-tree9-wgsl:check
trees:wire-tree9-config
trees:wire-tree9-config:check
trees:repair-generated
trees:repair-generated:check
trees:wire-shadow-proxies
trees:wire-shadow-proxies:check
trees:wire-parity
trees:wire-parity:check
trees:check-parity-manifest
trees:preflight-parity
trees:qa-parity
trees:capture-parity-evidence
trees:verify-parity-evidence
trees:report-parity-evidence
trees:verify-impostor
trees:verify-impostor-visual
trees:tune-impostor-visual
trees:verify-impostor-full
```

### Water and related probes

```text
water:find
water:probe
water:hydrology
water:graph
water:graph-startup
water:graph-semantics
water:tile-carve-perf
continent:tile-mesh-probe
water:seam
water:streaming
water:ownership
water:stats
probe:far-handoff
probe:rim-gpu-mesher
water:report
water:shot
water:shot:glacial
water:capture:glacial
water:capture:glacial:ab
water:shot:lake-final
water:shot:river-final
water:shot:lake-depth
water:shot:river-foam
water:shot:flow
water:shot:clipmap
water:shot:refraction
water:shot:reflection
water:shot:ssr-hit
water:foam:accept
water:foam:accept:high
water:foam:accept:low
water:foam:accept:matrix
water:foam:accept:shade
water:foam:accept:shade:high
water:foam:accept:shade:low
water:foam:accept:webgl
water:foam:accept:webgl:high
water:foam:accept:webgl:low
water:verify
water:verify:full
```
