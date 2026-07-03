# CLOD-POC P0 Atlas Dirty Upload Diagnostics

Source: `../../validation-artifacts/clod-poc-p0-smoke-4/summary.json`

| case | status | contaminated | renderer | mode | fallback | dirty/full | dirty pixels/total | dirty pct | threshold | raw rects | merged rects | raw pixels | merged pixels | changed tiles | clear/blit | window shift X/Z | exercise move/request/tile/eps | diagnosis |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| terrain-material-cache-disabled | passed | no | webgpu | 2.00 | 5.00 | 3.00/3.00 | 76,800/76,800 | 1.00 | 0.35 | 35.00 | 3.00 | 35,840 | 30,720 | 35.00 | 8.00/27.00 | 20.00/1.00 | 435.20/768.00/1,024/8.00 | raw dirty area already exceeds threshold |
| terrain-material-cache-enabled | passed | no | webgpu | 2.00 | 5.00 | 2.00/18.00 | 76,800/76,800 | 1.00 | 0.35 | 27.00 | 3.00 | 27,648 | 27,648 | 27.00 | 0.00/27.00 | 0.00/0.00 | 435.20/768.00/1,024/8.00 | raw dirty area already exceeds threshold |
| gpu-early-reject-disabled | passed | no | webgpu | 2.00 | 5.00 | 2.00/18.00 | 76,800/76,800 | 1.00 | 0.35 | 29.00 | 3.00 | 29,696 | 30,720 | 29.00 | 0.00/29.00 | 0.00/0.00 | 307.20/768.00/1,024/8.00 | raw dirty area already exceeds threshold |
| gpu-early-reject-enabled | passed | no | webgpu | 2.00 | 5.00 | 2.00/18.00 | 76,800/76,800 | 1.00 | 0.35 | 29.00 | 3.00 | 29,696 | 30,720 | 29.00 | 0.00/29.00 | 0.00/0.00 | 307.20/768.00/1,024/8.00 | raw dirty area already exceeds threshold |
| combined-cache-and-early-reject-enabled | passed | no | webgpu | 2.00 | 5.00 | 2.00/18.00 | 76,800/76,800 | 1.00 | 0.35 | 29.00 | 3.00 | 29,696 | 30,720 | 29.00 | 0.00/29.00 | 0.00/0.00 | 307.20/768.00/1,024/8.00 | raw dirty area already exceeds threshold |

## Codes

- Upload mode: 0=none, 1=dirty, 2=full.
- Fallback reason: 0=none, 1=initial, 2=explicit, 3=disabled, 4=too_many_rects, 5=threshold, 6=invalid_atlas, 7=partial_ranges_unsupported, 8=full_invalidation.

