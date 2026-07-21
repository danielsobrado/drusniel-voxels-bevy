# P1 water exact SSR miss integration — 2026-07-21

## Scope

Move the directional SSR miss route into the base WebGPU water shader and make its existing `ssrHit` and `hitUv` variables the only screen-space reflection authority.

## Implementation

- `waterNodeMaterial.ts` is again a thin export of the base material.
- The base material creates one `WaterSsrMissRoute` state object.
- The existing SSR loop remains the sole owner of ray traversal, hit depth validation, hit UV, and edge fade.
- The exact reflection direction used by the loop is passed to `ssrMissRoute.sample(...)`.
- `ssrHit * edgeFade` chooses between the routed miss and the sampled scene colour.
- The route module performs no viewport-depth sample and no duplicate hit approximation.
- Open misses use directional atmosphere.
- Terrain/canopy-blocked misses use directional Probe GI after `probe_gi_radiance_ready`; otherwise they use a low-energy terrain fallback.
- SSR-disabled and screen-resource-unavailable paths are treated as misses and still use the directional route.
- Debug modes, visual updates, camera updates, and disposal are wired directly through the base material handle.

## Diagnostics

```text
water_ssr_miss_exact_hit_authority = 1
water_ssr_miss_duplicate_depth_trace = 0
water_ssr_miss_constant_blend = 0
```

## Verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/water/water_ssr_miss_route.test.ts `
  src/water/water_ssr_miss_route_contract.test.ts
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed acceptance must compare exact SSR hit debug mode with the final reflection. Confirm every green hit pixel uses the screen sample, misses route by the directional horizon, and normal gameplay performs no reflection readback.
