# NAADF Benchmark Scene Index

This directory stores NAADF comparison and exploratory scenes that are not part of the core rendering bench set.

## Active policy

- Scenes in `bench/scenes/` are treated as active/standard.
- Scenes in `bench/scenes/naadf/` are treated as **temporary** unless explicitly promoted back to
  `bench/scenes/` with an explicit note in `docs/rendering/naadf-benchmarks.md`.
- Do not leave active CI/automated references pointed at files in this directory.
- Keep run artifacts (`bench-runs/...`) and image references near the doc entry that owns the scene.

## Temporary NAADF scenes

- `visual-regression-naadf-contact-sdf.toml`
- `visual-regression-naadf-contact.toml`
- `visual-regression-naadf-gi-secondary.toml`
- `visual-regression-naadf-gi-sun.toml`
- `visual-regression-naadf-path-a-all.toml`
- `visual-regression-naadf-terrain-ao-sdf.toml`
- `visual-regression-naadf-terrain-ao.toml`

## Reference run examples

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-a-all.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-gi-secondary.toml
```
