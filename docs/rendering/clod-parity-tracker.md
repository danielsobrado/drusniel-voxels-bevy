# CLOD parity tracker

`clod_parity_tracker` is a small file-based tracker for the remaining gap
between `tools/clod-poc` and the Bevy CLOD runtime. It is intentionally simpler
than the numeric guards: it answers whether each parity area has an owner,
status, expected Bevy files and known remaining work.

## Why this exists

After the CLOD QA stack adds many exporters and guards, it becomes easy to keep
adding more PRs without a clear stop condition. The tracker gives reviewers a
single manifest for:

- what is intentionally skipped;
- what is QA-covered but intentionally not gameplay-active yet.
The manifest lives at:

```text
assets/config/clod_parity_tracker.toml
```

id = "scripted-edit-dry-run"
status = "qa"
title = "Scripted CLOD edit dry-run pipeline"
```

## Run

Linux/macOS:

```bash
scripts/report-clod-parity-tracker.sh
```

Windows PowerShell:

```powershell
scripts/report-clod-parity-tracker.ps1
```

Direct Rust invocation:

```bash
cargo run --bin clod_parity_tracker -- \
  assets/config/clod_parity_tracker.toml \
  perf-dumps/clod-parity-tracker.md
```

## CI modes

Fail when a tracked Bevy path disappears:

```bash
CLOD_PARITY_TRACKER_FAIL_ON_MISSING=1 scripts/report-clod-parity-tracker.sh
```

Fail while any `status = "planned"` items remain:

```bash
The second mode is intentionally strict and should only be enabled once real
scripted edit execution and collider refresh guards have landed. Dry-run QA is
tracked separately from authoritative terrain mutation so the tracker does not
claim gameplay parity too early.
claim gameplay parity too early. Mutation-request CSVs are part of that guarded
handoff, but they are not the same as applying edits to the authoritative
`VoxelWorld`.