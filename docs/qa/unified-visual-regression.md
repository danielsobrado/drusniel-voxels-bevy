# Unified visual and performance QA

The unified QA system uses one scene registry and one orchestration registry for CLOD-POC and Bevy.

## Canonical manifests

- `validation/manifests/visual-regression.yaml`
- `validation/manifests/performance-regression.yaml`
- `validation/manifests/legacy-id-map.yaml`
- `validation/manifests/command-allowlist.yaml`
- `validation/manifests/batteries.yaml`

The TypeScript and Rust loaders reject unknown fields, duplicate IDs, unsafe paths, undeclared placeholders, non-allowlisted programs, incompatible targets, and missing command, lane, battery, or scene references.

## Lanes

| Lane | Purpose | Authority |
|---|---|---|
| Lane A | Manifest validation, type checks, and unit tests | Portable CI evidence |
| Lane B | Frozen native GPU capture and canonical visual/performance artifacts | Baseline authority only on clean Windows `main` with a hardware GPU |
| Lane C | Existing specialized water, tree, streaming, and bench-guard tools | Diagnostic evidence; never replaces Lane B |

Commands are executed with `shell: false`. The YAML allowlist may call only `cargo`, `node`, `npm`, or `npx`; arbitrary shell text is not executed.

## Validate the complete contract

TypeScript:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode validate
```

Rust:

```powershell
cargo run --bin qa_orchestrator -- --mode validate
```

## Run batteries

CLOD smoke:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode run --battery clod-smoke --target clod-poc --output validation-runs/orchestrated/clod-smoke
```

CLOD full:

```powershell
cargo run --bin qa_orchestrator -- --mode run --battery clod-full --target clod-poc --output validation-runs/orchestrated/clod-full
```

Bevy smoke:

```powershell
cargo run --bin qa_orchestrator -- --mode run --battery bevy-smoke --target bevy --output validation-runs/orchestrated/bevy-smoke
```

Bevy full:

```powershell
cargo run --bin qa_orchestrator -- --mode run --battery bevy-full --target bevy --output validation-runs/orchestrated/bevy-full
```

Combined full:

```powershell
cargo run --bin qa_orchestrator -- --mode run --battery combined-full --output validation-runs/orchestrated/combined-full
```

The TypeScript and Rust orchestrators read the same YAML definitions and produce `battery-report.json`, `battery-report.md`, command logs, and declared artifacts.

## Fresh-process determinism

Determinism mode executes the selected battery twice in separate child processes and compares declared deterministic artifacts. Volatile JSON fields are explicitly ignored in the command manifest; numeric tolerances are explicit per artifact.

CLOD:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-orchestrator.ts --mode determinism --battery clod-smoke --target clod-poc --output validation-runs/determinism/clod-smoke
```

Bevy:

```powershell
cargo run --bin qa_orchestrator -- --mode determinism --battery bevy-smoke --target bevy --output validation-runs/determinism/bevy-smoke
```

Outputs:

- `run-a/`
- `run-b/`
- `determinism-report.json`
- `determinism-report.md`

A command failure, changed command outcome, missing deterministic artifact, exact hash mismatch, or JSON difference outside the declared tolerance fails QA-U6.

## Standardized capture layout

```text
<run-root>/
  environment.json
  determinism.json
  scenes/
    clod-poc|bevy/
      <scene-id>/
        actual.png
        actual.stats.json
        actual.metrics.json
        determinism.json
```

CLOD capture drives `window.__drusnielQa`, waits for readiness, applies the canonical pose and world state, freezes the runtime, captures the viewport, and writes probe/counter evidence.

Bevy capture uses the existing native visual bench and Rust QA report. `qa_stage` maps canonical Bevy checkpoint and screenshot names into the same standardized layout.

## Baseline promotion

Baseline promotion is intentionally separate from capture. It requires:

- explicit `--approve`;
- branch `main`;
- a clean working tree;
- `HEAD` matching `origin/main` when that ref exists;
- capture commit equal to current `HEAD`;
- an authoritative native environment;
- one target per promotion command;
- complete image, stats, and metrics artifacts.

TypeScript:

```powershell
npm --prefix tools/clod-poc exec -- tsx tools/qa-baseline.ts --run-root validation-runs/orchestrated/clod-full/targets/clod-poc --approve
```

Rust:

```powershell
cargo run --bin qa_baseline -- --run-root validation-runs/orchestrated/bevy-full/targets/bevy --approve
```

Use repeated `--scene <id>` arguments to promote a subset. Promotion copies the standardized artifacts, writes `authority.json` and `baseline.sha256`, updates scene SHA-256 values, enables required image gates, and increments `baseline_version`.

The promotion command refuses non-authoritative captures. It does not turn locally generated or software-rendered images into release baselines.

## Native authority

Lane B is authoritative only on native Windows hardware GPU runs from clean `main`. CLOD reads browser WebGPU adapter diagnostics. Bevy reads adapter/backend metadata from the bench summary; `DRUSNIEL_QA_GPU_ADAPTER` and `DRUSNIEL_QA_GPU_BACKEND` are fallback metadata fields when the bench host does not yet emit them.

Linux, CI, SwiftShader, WARP, llvmpipe, and dirty-tree captures remain useful diagnostic runs but cannot be promoted.

## Initial batteries

CLOD coverage:

- main terrain view;
- 4 km long view;
- infinite-islands static, moving, and steady checkpoints;
- water verification;
- tree parity;
- streaming acceptance.

Bevy coverage:

- ridge/noon;
- water shoreline/sunset;
- forest/noon;
- fog and god rays;
- shadow-ray flag;
- cinematic photo effects;
- native bench guard.

The battery definitions are complete, but image baselines remain non-authoritative until the first approved native Lane B capture is promoted.
