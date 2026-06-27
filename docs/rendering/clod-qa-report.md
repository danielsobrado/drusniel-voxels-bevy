# CLOD QA report

`clod_qa_report` aggregates the CLOD parity CSV artifacts into two reviewable
files:

- `clod-qa-report.md` for PR review;
- `clod-qa-report.json` for future CI/archive tooling.

The dedicated guards remain the source of truth for pass/fail decisions. This
report is intentionally a compact index of the artifacts emitted by the CLOD
parity suite.

## Inputs

The reporter looks for these files in a bench run directory:

- `clod-selection-runtime.csv`
- `clod-rebuild-observer.csv`
- `clod-crossfade-runtime.csv`
- `clod-cut-freeze.csv`
- `clod-border-locks.csv`
- `clod-topology.csv`
- `clod-simplify.csv`
- `clod-weld.csv`
- `clod-edit-plan.csv`

Missing files are reported as missing instead of causing a hard failure. The
only hard failure is a completely empty run directory unless `--allow-empty` is
passed.

## Run

```bash
scripts/report-clod-qa.sh bench-runs/<run>
```

PowerShell:

```powershell
scripts/report-clod-qa.ps1 -RunDir bench-runs/<run>
```

Direct binary:

```bash
cargo run --bin clod_qa_report -- \
  --run-dir bench-runs/<run> \
  --out-md bench-runs/<run>/clod-qa-report.md \
  --out-json bench-runs/<run>/clod-qa-report.json
```

## Why this exists

The web CLOD PoC has a QA/reporting workflow around runtime diagnostics. The
Rust/Bevy port now emits separate CSV streams for selection, rebuild,
crossfade, cut-freeze, border locks, topology, simplification and weld state.
This reporter makes those streams easier to inspect together without weakening
the stricter per-metric guards.
