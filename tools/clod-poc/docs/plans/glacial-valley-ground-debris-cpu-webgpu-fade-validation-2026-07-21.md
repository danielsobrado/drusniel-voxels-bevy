# WebGPU CPU ground-debris fade validation checklist

- Run focused NodeMaterial, renderer-mode, integration-routing, and shared-resource tests.
- Run full TypeScript typecheck and production build.
- Start `scene=infinite-islands` with WebGPU, `dressing=1`, and `dressingGpu=0`.
- Confirm CPU placement remains active and GPU dressing compute remains inactive.
- Capture near, mid-fade, outer-fade, straight-walk, and diagonal-walk poses.
- Confirm no ring edge, crawling hash, transparency halo, extra draw, render pass, or readback.
- Force GPU dressing initialization failure and confirm the same WebGPU CPU material path is selected.
- Record render p50/p95 and require no more than `0.05 ms` p95 regression over PR #287.
