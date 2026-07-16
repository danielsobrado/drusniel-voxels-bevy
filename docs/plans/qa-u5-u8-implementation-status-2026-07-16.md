# QA-U5 through QA-U8 implementation status — 2026-07-16

## Verdict

QA-U5 through QA-U8 are implemented as shared infrastructure for CLOD-POC and Bevy. The code, schemas, batteries, deterministic artifact contract, native Bevy staging, baseline authority checks, and Lane A workflow are present.

Authoritative GPU evidence is intentionally not fabricated. Final Lane B acceptance remains pending until the batteries are executed on clean Windows `main` using the target hardware GPU and the results are explicitly promoted.

## QA-U5 — specialized command orchestration

Implemented:

- strict `command-allowlist.yaml` and `batteries.yaml` schemas;
- shell-free process execution;
- program allowlist;
- target/lane compatibility checks;
- placeholder declaration checks;
- repository/output path containment;
- required artifact checks;
- command logs and JSON/Markdown battery reports;
- TypeScript and Rust orchestrators reading the same manifests;
- Lane C integration for existing CLOD water/tree/streaming tools and Bevy bench guard.

## QA-U6 — double-run determinism

Implemented:

- two complete fresh-process runs;
- command-outcome parity;
- declared deterministic artifact comparison;
- exact SHA-256 comparison for files/directories;
- recursive JSON comparison with explicit ignored keys and numeric tolerance;
- JSON and Markdown determinism reports;
- unit tests for tolerance and volatile-key handling.

## QA-U7 — baseline workflow

Implemented:

- explicit approval gate;
- CI refusal unless explicitly overridden;
- clean `main` and commit authority checks;
- target/environment/GPU authority validation;
- capture-commit equality check;
- standardized artifact promotion;
- SHA-256 generation and verification metadata;
- semantic YAML manifest updates for compact or expanded scene syntax;
- baseline version increment;
- required image-gate activation;
- TypeScript and Rust promotion commands.

Pending acceptance:

- first approved CLOD native baseline set;
- first approved Bevy native baseline set.

## QA-U8 — initial baseline batteries

Implemented batteries:

- `clod-smoke`
- `clod-full`
- `bevy-smoke`
- `bevy-full`
- `combined-smoke`
- `combined-full`

CLOD includes the main view, 4 km view, and three infinite-islands checkpoints. Bevy includes ridge, water, forest, fog/god-rays, shadow-ray, and cinematic-photo checkpoints. Specialized water, tree, streaming, and bench-guard diagnostics are retained as Lane C evidence.

## Acceptance status

| Item | Status |
|---|---|
| Shared orchestration schemas | Implemented |
| TypeScript orchestrator | Implemented |
| Rust orchestrator | Implemented |
| CLOD standardized capture | Implemented |
| Bevy native standardized staging | Implemented |
| Fresh-process determinism | Implemented |
| Baseline authority workflow | Implemented |
| Initial CLOD battery | Configured; native evidence pending |
| Initial Bevy battery | Configured; native evidence pending |
| Authoritative baseline images | Pending native Windows GPU execution |
