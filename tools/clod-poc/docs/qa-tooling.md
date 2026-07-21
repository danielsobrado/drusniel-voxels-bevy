# CLOD-POC QA Tooling

**Scope:** `tools/clod-poc` on `main`  
**Updated:** 2026-07-21  
**Purpose:** one operational guide for deterministic QA, look development, acceptance, performance, profiling, and focused subsystem verification.

## 1. Evidence classes

| Class | Purpose | Release authority |
|---|---|---|
| **Lane A — static** | Manifest validation, typecheck, unit and contract tests | Portable CI evidence |
| **Lane B — canonical capture** | Frozen WebGPU visual/performance captures and deterministic artifacts | Authoritative only on clean Windows `main` with hardware WebGPU |
| **Lane C — specialized** | Water, trees, streaming, playable-world, and performance acceptance | Required for affected subsystems; does not replace Lane B |
| **Diagnostic tools** | Investigation, A/B captures, probes, and galleries | Never release proof by themselves |

The canonical release result is a unified battery. Specialized tools add depth. Manual screenshots and probes are evidence for diagnosis, not release gates.

## 2. Determinism contract

Canonical CLOD captures now enforce the following:

- the running Vite app must match the checked-out commit, dirty state, and package-lock hash;
- an already-running server is rejected unless `CLOD_POC_REUSE_SERVER=1` explicitly allows reuse;
- reused servers still undergo runtime build-identity verification;
- authoritative output requires Windows, branch `main`, a clean tree, and a non-software WebGPU adapter;
- manifest camera angles are converted from degrees to radians before applying the pose;
- dynamic resolution, TAA jitter, tree wind, and grass wind are disabled;
- `precisionDiag=1` fixes simulation delta at zero during capture;
- sun, time-of-day metadata, precipitation mode, seed, scene, quality, viewport, and DPR are explicit;
- captures wait for stable convergence instead of relying only on large fixed frame counts;
- page errors and non-allowlisted console errors fail the scene;
- the app's content-addressed world-cache key is recorded per scene;
- deterministic artifacts contain exact stable counters plus bounded perceptual image signatures;
- a failed first attempt followed by a passing replay remains a failed **intermittent** result.

The visual signature contains a downsampled linear-RGB grid, luminance histogram, edge histogram, and informational average hash. Exact counters use tolerance `0`; visual vectors use explicit JSON-path tolerances from `command-allowlist.yaml`.

Performance timings remain statistical evidence. They are not treated as exact deterministic counters.

## 3. Canonical manifests

| File | Responsibility |
|---|---|
| `validation/manifests/visual-regression.yaml` | Canonical visual scenes, poses, probes, counters, and image gates |
| `validation/manifests/performance-regression.yaml` | Performance scenes and timing/counter gates |
| `validation/manifests/legacy-id-map.yaml` | Legacy-to-canonical scene/check mapping |
| `validation/manifests/command-allowlist.yaml` | Allowed commands, arguments, timeouts, artifacts, and tolerances |
| `validation/manifests/batteries.yaml` | Lane composition and named batteries |
| `tools/clod-poc/config/lookdev_qa.yaml` | Fixed deterministic lookdev profiles and poses |
| `tools/clod-poc/config/qa_path_ownership.yaml` | Changed-path ownership and affected subsystem suites |

Unknown fields, unsafe paths, undeclared placeholders, invalid programs, duplicate IDs, incompatible targets, missing references, and invalid tolerances are rejected by both TypeScript and Rust loaders.

## 4. Primary commands

Run from the repository root.

### Validate without GPU work

```powershell
npm --prefix tools/clod-poc run qa:validate
```

### Canonical CLOD smoke

```powershell
npm --prefix tools/clod-poc run qa:orchestrator -- `
  --mode run `
  --battery clod-smoke `
  --target clod-poc `
  --output validation-runs/orchestrated/clod-smoke
```

`clod-smoke` runs Lane A, the canonical main-view capture, and deterministic lookdev smoke.

### Canonical CLOD full

```powershell
npm --prefix tools/clod-poc run qa:orchestrator -- `
  --mode run `
  --battery clod-full `
  --target clod-poc `
  --output validation-runs/orchestrated/clod-full
```

`clod-full` runs Lane A, all canonical CLOD captures, full lookdev, infinite-islands acceptance, water verification, and tree parity.

### Fresh-process determinism

```powershell
npm --prefix tools/clod-poc run qa:orchestrator -- `
  --mode determinism `
  --battery clod-smoke `
  --target clod-poc `
  --output validation-runs/determinism/clod-smoke
```

This executes the battery twice in separate child-process runs and compares declared deterministic artifacts.

### Direct canonical capture

```powershell
npm --prefix tools/clod-poc run qa:capture -- `
  --output validation-runs/capture/clod-poc `
  --tags smoke
```

Supported filters:

```text
--scene <id>
--tags <tag,tag>
--no-replay
```

### Baseline promotion

```powershell
npm --prefix tools/clod-poc run qa:baseline -- `
  --run-root validation-runs/orchestrated/clod-full/targets/clod-poc `
  --approve
```

Promotion remains a separate explicit operation. It requires clean `main`, matching capture/source commits, an authoritative native environment, and complete artifacts.

## 5. Change-aware QA

Generate the recommended plan for files changed from `origin/main`:

```powershell
npm --prefix tools/clod-poc run qa:affected
```

Generate and execute it:

```powershell
npm --prefix tools/clod-poc run qa:affected -- --run
```

Useful options:

```text
--base <git-ref>
--config <yaml>
--out <json>
--run
```

The planner always selects at least `clod-smoke`. It adds only the affected specialized scripts, and escalates renderer-foundation changes to `clod-full`. Path ownership is configuration-driven in `config/qa_path_ownership.yaml`.

Current mappings include:

- water → `water:verify`;
- trees/vegetation → `trees:qa-parity`;
- streaming/terrain → `world:verify` and infinite-islands reuse acceptance;
- post-processing/lighting → `postfx:verify` and `lighting:verify`;
- playable-world systems → `playable-slice:verify`;
- renderer foundation → `clod-full`.

## 6. Lookdev QA

Lookdev is now a first-class QA family rather than only a manual gallery.

### Discovery

```powershell
npm --prefix tools/clod-poc run lookdev:discover
```

Discovery probes the current terrain/hydrology field and writes `discovered-poses.yaml`. It is exploratory and never canonical release proof.

### Deterministic smoke

```powershell
npm --prefix tools/clod-poc run lookdev:smoke
```

Smoke uses committed fixed poses, AgX, the ultra lookdev profile, convergence waits, visual sanity checks, perceptual signatures, stable counters, runtime/server identity checks, and frozen temporal inputs.

### Deterministic full

```powershell
npm --prefix tools/clod-poc run lookdev:full
```

Full uses AgX and ACES across fixed river, aerial, ridge, coast, valley, grazing seam, and ownership-debug poses. It writes:

```text
report.json
determinism.json
gallery.md
<tone-map>-<pose>.png
```

Lookdev smoke is part of `clod-smoke`; lookdev full is part of `clod-full`.

## 7. Convergence conditions

Canonical capture waits until relevant counters are stable across several polls. The contract includes:

- no missing/building far-summary tiles;
- no pending far-shell or terrain-texture-window work;
- no failed/building/pending/inflight near-bubble work;
- no failed/pending/inflight/apply-queue CLOD stream work;
- safety roots ready and cache capacity valid;
- no refinement or parent-coverage violations;
- hydrology atlas filled when active;
- scene compile warm-up ready when required;
- no shadow-proxy build in progress.

After convergence, only a small fixed final-frame window is rendered before capture.

## 8. Static and build verification

| Command | Purpose |
|---|---|
| `visual:validate` | Validate canonical manifests |
| `typecheck` | TypeScript compile contract |
| `test` | Full Vitest suite |
| `test -- <paths>` | Focused tests |
| `test:coverage` | Coverage report |
| `build` | Production Vite build |
| `verify:clod` | Typecheck, full tests, and fast CLOD acceptance |
| `postfx:verify` | Focused post-processing verifier |
| `lighting:verify` | Lighting/environment/post-processing tests plus build |
| `spells:verify` | Spell/edit/convergence tests plus build |
| `playable-slice:verify` | Playable-world preflight plus build |

Lane A runs manifest validation, typecheck, and focused unified/lookdev/affected-planner tests concurrently. GPU/runtime work stays serialized to avoid port, adapter, and output collisions.

## 9. Structural CLOD acceptance

| Command | Purpose |
|---|---|
| `build-pages` | Build normal page hierarchy |
| `build-pages:smoke` | Small hierarchy smoke |
| `build-pages:gate` | Gate-sized hierarchy |
| `acceptance:clod` | Full Phase 3 structural acceptance |
| `acceptance:clod:fast` | Structural acceptance without screenshots |
| `verify:clod` | Static checks plus fast structural acceptance |

`config/clod_acceptance.yaml` controls border continuity, reduction, build-time, density-scar, holes/lips, stress-scene, and streaming-walk thresholds.

## 10. Infinite-world and continent QA

| Command | Purpose |
|---|---|
| `accept:infinite-islands` | Default infinite-islands acceptance |
| `accept:infinite-islands:fast` | Reduced `walk`/`final-near` acceptance |
| `accept:infinite-islands:reuse` | Reuse compatible content-addressed world/page state |
| `accept:infinite-islands:full` | Full profile |
| `accept:unified-streaming-long-route` | Long-route performance gate |
| `accept:continent-short` | Short continent route |
| `accept:continent-coast-to-coast` | Coast-to-coast route |
| `accept:continent-revisit` | Revisit and eviction economics |
| `soak:continent` | Long-running streaming soak |
| `drill:continent-recovery` | Recovery drill |
| `report:continent-repeatability` | Compare repeated long-map runs |
| `accept:continent-tiles` | Continent tile acceptance |
| `accept:phase5-voxel-overlay` | Voxel overlay acceptance |
| `accept:phase6-road-stamp` | Road-stamp acceptance |
| `world:verify` | Deterministic CPU world/prop/construction verification |

The existing world cache is content-addressed from terrain source, generator/config state, hydrology, edits, imported data, procedural textures, feature stamps, and world-manifest artifacts. Canonical QA records the resolved key. Release evidence should include at least one cold-process determinism run; within one battery, safe browser/context reuse reduces repeated setup cost.

## 11. Performance and profiling

| Command | Purpose |
|---|---|
| `perf:main` | Named static performance cases and summaries |
| `perf:move` | Static/moving windows, streaming, worst-frame forensics, checkpoint shots |
| `perf:postfx` | PostFX runtime matrix |
| `perf:gpu-clod-pools` | GPU CLOD pool benchmark |
| `perf:gpu-clod-pools:gate` | Balanced hardware ratio gate |
| `perf:rpg-edit-storm` | Dense edit-storm benchmark |
| `perf:rpg-agent-envelopes` | Dense agent/content envelopes |
| `accept:rpg-dense` | Dense RPG acceptance |
| `perf:heightfield-raster` | Startup raster benchmark |
| `perf:construction` | Construction benchmark |
| `bench:prop-edits` | Prop-edit benchmark |

Performance evidence must record commit, dirty state, browser, GPU, renderer, viewport, resolution, quality, seed, scene, parameters, and cache state. Do not add independent phase percentiles and call the sum a frame cost; use co-occurring worst-frame samples.

## 12. Playable-world QA

| Command | Purpose |
|---|---|
| `playable-slice:verify` | Static/unit/build preflight |
| `accept:playable-slice` | Diagnostic and continuous headed WebGPU acceptance |
| `accept:playable-slice:diagnostic` | Diagnostic mode only |
| `accept:playable-slice:continuous` | Continuous mode only |
| `baseline:playable` | Explicit mutating baseline writer |

## 13. Tree and vegetation QA

| Command | Purpose |
|---|---|
| `trees:preflight-parity` | Generated-source checks and parity-manifest validation |
| `trees:qa-parity` | Preflight, typecheck, and focused tree/shared tests |
| `trees:capture-parity-evidence` | Print required evidence commands |
| `trees:verify-parity-evidence` | Validate captured evidence |
| `trees:report-parity-evidence` | Write Markdown evidence report |
| `trees:verify-impostor` | Focused impostor tests plus build |
| `trees:verify-impostor-visual` | WebGPU orbit and dark-spike detector |
| `trees:verify-impostor-full` | Static/build plus visual impostor gate |

Commands ending in `:check` are read-only generated-source guards. Corresponding `wire-*` or `repair-*` commands without `:check` mutate generated files.

## 14. Water QA

| Command family | Purpose |
|---|---|
| `water:report` | Ownership, clipmap, reflection, caustics, and wetness verification |
| `water:find`, `water:probe`, `water:hydrology` | Deterministic location and field probes |
| `water:graph*` | Hydrology graph build/startup/semantic checks |
| `water:seam`, `water:streaming`, `water:ownership`, `water:stats` | Focused reports |
| `water:shot*` | Deterministic visual/debug captures |
| `water:foam:accept:*` | Quality, shade, and WebGL matrices |
| `water:verify` | Core water verification suite |
| `water:verify:full` | Core plus all foam/renderer matrices |

## 15. Diagnostic tools

Useful manual diagnostics include:

```text
shoot
shoot-props
compare
sequence:capture
sequence:pair
sequence:evaluate
lookdev:discover
visual:unified-streaming-manual
terrain:diagnose
probe:far-handoff
probe:rim-gpu-mesher
continent:tile-mesh-probe
```

A diagnostic tool becomes a release gate only after it has deterministic inputs, explicit thresholds, declared artifacts, failure semantics, and manifest/battery ownership.

## 16. Server rules

| Tool | Server behavior |
|---|---|
| Unified capture and lookdev | Start acceptance Vite when absent; reject implicit reuse |
| Infinite-islands wrapper | Starts acceptance Vite; reuse must be explicit |
| GPU CLOD pool wrapper | Starts acceptance Vite; reuse must be explicit |
| `shoot`, `perf:main`, `perf:move` | Expect a reachable server |

Common environment variables:

```text
CLOD_POC_BASE_URL
CLOD_POC_REUSE_SERVER
DRUSNIEL_QA_RUN_INDEX
```

## 17. Output layout

| Directory | Contents |
|---|---|
| `validation-runs/` | Canonical batteries, captures, comparisons, determinism |
| `validation/baselines/` | Approved baselines and authority metadata |
| `acceptance-runs/` | Acceptance outputs |
| `perf-runs/` | Performance measurements |
| `qa-runs/` | Focused reports and lookdev galleries |
| `shots/` | Diagnostic screenshots |

Generated QA outputs are ignored by Git. Trust recorded identity fields, not file modification time.

## 18. Recommended workflows

### Small change

```powershell
npm --prefix tools/clod-poc run qa:affected -- --run
```

### Renderer or visual change

```powershell
npm --prefix tools/clod-poc run qa:orchestrator -- --mode run --battery clod-smoke --target clod-poc --output validation-runs/orchestrated/clod-smoke
npm --prefix tools/clod-poc run lookdev:smoke
```

### Streaming change

```powershell
npm --prefix tools/clod-poc run world:verify
npm --prefix tools/clod-poc run accept:infinite-islands:reuse
npm --prefix tools/clod-poc run perf:move -- --out perf-runs/move-change
```

### Release candidate

```powershell
npm --prefix tools/clod-poc run qa:orchestrator -- --mode determinism --battery clod-smoke --target clod-poc --output validation-runs/determinism/clod-smoke
npm --prefix tools/clod-poc run qa:orchestrator -- --mode run --battery clod-full --target clod-poc --output validation-runs/orchestrated/clod-full
npm --prefix tools/clod-poc run accept:playable-slice
```

Do not promote baselines until every failure, intermittent replay, environment mismatch, and threshold change is understood.
