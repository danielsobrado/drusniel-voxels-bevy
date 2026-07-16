# Bevy unified visual and performance QA

The CLOD-POC TypeScript implementation remains intact. The Rust/Bevy side now implements the same QA-U1 through QA-U4 contracts as a first-class runner under `src/diagnostics/qa/unified`.

## Canonical configuration

Both targets consume the same files:

```text
validation/manifests/visual-regression.yaml
validation/manifests/performance-regression.yaml
validation/manifests/legacy-id-map.yaml
```

The canonical manifests now include the existing Bevy visual-regression checkpoints and absolute timing gates. `assets/config/qa_visual.yaml` remains only as an explicit compatibility input and is not used by the normal unified path.

## Commands

Validate every canonical Bevy scene without launching the renderer:

```powershell
cargo run --bin qa -- --manifest-validate-only
```

Run the Bevy smoke scenes through the existing deterministic bench and evaluate the result:

```powershell
cargo run --release --bin qa -- --tag smoke --run-bench
```

Evaluate an existing Bevy summary:

```powershell
cargo run --bin qa -- --summary bench-runs/<run>/summary.json --output validation-runs/<run>
```

Select a single scene:

```powershell
cargo run --release --bin qa -- --scene bevy-ridge-noon --run-bench
```

The old evaluator is available only when deliberately requested:

```powershell
cargo run --bin qa -- --legacy --summary bench-runs/<run>/summary.json
```

## Rust implementation

The unified Rust modules provide:

- strict shared-manifest parsing, safe repository paths, baseline SHA-256 checks, and complete legacy ID validation;
- Bevy capture-state, readiness, and full freeze contracts;
- linear Rec.709 image loading, weighted masks, Sobel metrics, semantic region probes, and diff artifacts;
- required and advisory timing gates, required and optional counters, and informational metrics;
- environment recording and manifest snapshots;
- JSON, Markdown, HTML, and JUnit reports.

Generated artifacts are written below `validation-runs` and remain uncommitted.

## Pending

QA-U5 through QA-U8 remain separate work: specialized command orchestration, fresh-process determinism runs, authoritative baseline updates, and the complete native Lane B/C baseline batteries.
