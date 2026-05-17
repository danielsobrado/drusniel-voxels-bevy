# Phase 0 Baseline Archive

Document status (2026-05-17): current index/reference.

Captured: 2026-05-16

Source run: `bench-runs/2026-05-16T11-30-42Z`

Files:

- [visual-regression-naadf-gi-summary.json](visual-regression-naadf-gi-summary.json)
- [visual-regression-naadf-gi-settled.png](visual-regression-naadf-gi-settled.png)

Bench command:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-gi.toml
```

Summary:

| Metric | Value |
| --- | ---: |
| Scene | `visual-regression-naadf-gi.toml` |
| Checkpoint | `naadf-gi-experimental` |
| Median frame | `12.3097 ms` |
| P99 frame | `42.701 ms` |
| Ready wait | `10.0063 s` |
| Render-ready wait | `1.1570 s` |
| Requested voxel backend | `naadf` |
| Effective radiance-cascade backend | `CurrentSdf` |
| `naadf.gi_rays_last_frame` | `0` |

This is the SDF GI baseline for NAADF Path A. The scene requests NAADF so the
fallback path is exercised, but `naadf_gi_shader_backend_available()` currently
returns `false`, so radiance cascades resolve to `CurrentSdf`.
