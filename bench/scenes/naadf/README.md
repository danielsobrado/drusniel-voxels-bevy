# NAADF Benchmark Scene Index

This directory is the canonical location for NAADF benchmark scenes.

## Policy

- `bench/scenes/` contains general benchmark scenes.
- `bench/scenes/naadf/` contains all NAADF-specific scenes, including regression, preview, and validation variants.
- Keep this directory as the source of truth for NAADF scene ownership and runtime examples.
- Keep run artifacts (`bench-runs/...`) and image references near the doc entry that owns each scene.

## NAADF scenes in this folder

- `dig-edit-naadf-stability.toml`
- `gameplay-movement-naadf-smoke.toml`
- `visual-regression-naadf-contact-sdf.toml`
- `visual-regression-naadf-contact.toml`
- `visual-regression-naadf-current.toml`
- `visual-regression-naadf-gi-secondary.toml`
- `visual-regression-naadf-gi-sun.toml`
- `visual-regression-naadf-gi.toml`
- `visual-regression-naadf-live-lod.toml`
- `visual-regression-naadf-path-a-all.toml`
- `visual-regression-naadf-preview-only.toml`
- `visual-regression-naadf-preview.toml`
- `visual-regression-naadf-startup-stability.toml`
- `visual-regression-naadf-terrain-ao-sdf.toml`
- `visual-regression-naadf-terrain-ao.toml`

## Reference run examples

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-a-all.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-gi-secondary.toml
```
