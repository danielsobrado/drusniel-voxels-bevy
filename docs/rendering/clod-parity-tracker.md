# CLOD parity tracker

`clod_parity_tracker` is a small file-based tracker for the remaining gap
between `tools/clod-poc` and the Bevy CLOD runtime. It is intentionally simpler
than the numeric guards: it answers whether each parity area has an owner,
status, expected Bevy files and known remaining work.

## Why this exists

After the CLOD QA stack adds many exporters and guards, it becomes easy to keep
adding more PRs without a clear stop condition. The tracker gives reviewers a
single manifest for:

- what is already ported;
- what is only QA-covered;
- what remains planned;
- what is intentionally skipped.

## Config

The manifest lives at:

```text
assets/config/clod_parity_tracker.toml
```

Each `[[item]]` has:

```toml
id = "scripted-edit-execution"
category = "editing"
priority = "high"
status = "planned"
title = "Execute scripted CLOD edit operations during benches"
poc_refs = ["tools/clod-poc/src/clod/edit"]
bevy_paths = ["src/voxel/pages/edit_dirtiness.rs"]
notes = "Why this item matters and what is still missing."
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
CLOD_PARITY_TRACKER_FAIL_ON_PLANNED=1 scripts/report-clod-parity-tracker.sh
```

The second mode is intentionally strict and should only be enabled once scripted
edit execution and collider refresh guards have landed.
