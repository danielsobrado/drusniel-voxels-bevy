# Terrain Noise Generation

## Status

Implemented.

## Problem

`src/terrain/generation/noise.rs` had a `simplex_2d` placeholder that ignored its coordinates and seed and always returned `0.0`. Any caller using this helper received flat fBm output instead of deterministic terrain variation.

## Change

- Replaced the placeholder with deterministic seeded 2D simplex noise.
- Kept the output in the expected `[-1.0, 1.0]` range for the existing fBm and ridged fBm callers.
- Added regression tests covering coordinate variation, seed determinism, fBm amplitude bounds, and terrain height variation.

## Verification

Passed:

```powershell
rtk cargo test --release --lib terrain::generation::noise
```

Result: 4 passed.

Attempted broader debug tests:

```powershell
rtk cargo test terrain::generation::noise
```

This failed before the targeted tests ran because Windows could not mmap the large debug rlib: `os error 1455`, paging file too small.

## Profiling

Baseline visual regression bench was attempted before the change with an isolated bench lock because the shared runtime lock was already held:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

The bench acquired the isolated lock and reached `ridge-run-noon`, then exited nonzero after a render-ready timeout. No usable before/after `summary.json` comparison was produced for this item.
