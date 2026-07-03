# CLOD-POC P0 Atlas Dirty Upload Diagnostics

Source: `../../validation-artifacts/clod-poc-p0-smoke-5-rerun/summary.json`

| case | status | contaminated | renderer | mode | fallback | dirty/full | dirty pixels/total | dirty pct | threshold | raw rects | merged rects | raw pixels | merged pixels | changed tiles | clear/blit | window shift X/Z | exercise status/bumped/requested | diagnosis |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| terrain-material-cache-disabled | failed | no | webgpu | - | - | -/- | -/- | - | - | - | - | - | - | - | -/- | -/- | -/-/- | needs inspection |
| terrain-material-cache-enabled | failed | no | webgpu | - | - | -/- | -/- | - | - | - | - | - | - | - | -/- | -/- | -/-/- | needs inspection |
| gpu-early-reject-disabled | failed | no | webgpu | - | - | -/- | -/- | - | - | - | - | - | - | - | -/- | -/- | -/-/- | needs inspection |
| gpu-early-reject-enabled | failed | no | webgpu | - | - | -/- | -/- | - | - | - | - | - | - | - | -/- | -/- | -/-/- | needs inspection |
| combined-cache-and-early-reject-enabled | failed | no | webgpu | - | - | -/- | -/- | - | - | - | - | - | - | - | -/- | -/- | -/-/- | needs inspection |

## Codes

- Upload mode: 0=none, 1=dirty, 2=full.
- Fallback reason: 0=none, 1=initial, 2=explicit, 3=disabled, 4=too_many_rects, 5=threshold, 6=invalid_atlas, 7=partial_ranges_unsupported, 8=full_invalidation.

