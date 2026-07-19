# Water Foam Distance Acceptance

Date: 2026-07-19

## Purpose

Prove that HQ WebGPU, performance WebGPU, and WebGL consume the same configured
camera-distance foam fade without mixing the measurement with perspective,
hydrology, coherent-noise animation, auxiliary water effects, or clipmap-ring
changes.

## Controlled proof

The acceptance runner discovers one real `rapid-bed-step`, places the camera once,
and waits for the scene to settle. It then:

1. hides the residue, cascade-particle, and river-mist overlays;
2. freezes water material time;
3. captures body-mask and depth evidence once;
4. substitutes a synthetic camera distance below the configured fade start;
5. captures the foam-debug output;
6. substitutes the exact fade midpoint and captures again;
7. substitutes a distance beyond the fade end and captures again;
8. resets synthetic distance, unfreezes time, and restores exact overlay visibility
   in a fail-loud `finally` block.

The synthetic value replaces only the measured camera distance. The real
configuration-owned `smoothstep(startM, endM, distanceM)` remains active in every
renderer. No forced coverage multiplier or acceptance-only fade is introduced.

For the current `120–320 m` range, the sampled distances are:

```text
near: 70 m   -> expected fade 1.0
mid:  220 m  -> expected fade 0.5
far:  370 m  -> expected fade 0.0
```

The values are derived from the live runtime range, not hardcoded into the runner.

## Renderer wiring

- **HQ WebGPU:** the shared TSL distance node selects measured or synthetic metres
  before the canonical smoothstep.
- **Performance WebGPU:** consumes the same shared TSL node and explicit configured
  start/end uniforms.
- **WebGL:** all ring materials share two renderer-neutral uniform objects for the
  debug enabled flag and synthetic metres.

The renderer-neutral state has no `three/tsl` import. Existing WebGL materials
update immediately without per-material subscriptions.

## Time and overlay isolation

The debug freeze wraps only the public `WaterClipmap.update()` delta. While frozen,
`update(0, cameraPosition)` still runs every frame, so camera uniforms, clipmap
origins, atlas windows, and material updates remain live. Only accumulated water
material time stops changing.

Cascade particles, bank residue, and river mist have independent update paths and
could contaminate foam-debug screenshots even when material time is frozen. A
scene-level debug controller snapshots each matched object's real visibility,
hides only these named auxiliary groups, and restores every exact prior value.
It does not clear particle pools or change gameplay visibility flags.

Both controllers use `WeakMap`, preventing repeated debug installation from
stacking wrappers or replacing visibility snapshots.

## Image gates

One water-pixel mask is derived from the fixed body-mask, depth, and near foam
frames. The gate requires:

- at least 1,000 water pixels and 100 active near pixels;
- meaningful near foam coverage;
- midpoint mean coverage between 25% and 75% of near;
- at least 95% monotonic response across all water pixels;
- at least 90% monotonic response among near-active foam pixels;
- at least 100 uncapped near samples;
- at least 90% monotonic response within that uncapped sample set;
- uncapped midpoint coverage between 35% and 65% of near;
- far mean coverage below 0.003 and far/near ratios below 0.05.

The uncapped sample set uses near values from `0.04` through `0.45`. This avoids
background quantization and prevents the shared `0.52` coverage cap from biasing
the midpoint ratio. Active-specific monotonic gates prevent black water pixels
from hiding a broken response where foam is actually visible.

## Renderer-specific safety

WebGPU lanes reuse the canonical foam runtime contract, including model revision,
quality tier, distance authority, sun atlas, zero CPU samples, and zero uncaptured
WebGPU errors. WebGL reuses its runtime contract plus browser/shader error gate.
The runner verifies the actual backend before capture.

## Run

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run test -- \
  src/runtime/water_weather/water_foam_auxiliary_visibility.test.ts \
  src/runtime/water_weather/water_foam_time_freeze.test.ts \
  src/water/water_foam_distance.test.ts \
  src/water/water_foam_distance_shader_contract.test.ts \
  tools/water-foam-distance-acceptance-profile.test.ts \
  tools/water-foam-distance-browser-controls.test.ts \
  tools/water-foam-distance-visual-metrics.test.ts \
  tools/water-foam-distance-acceptance-contract.test.ts \
  tools/water-foam-distance-acceptance-wiring.test.ts
npm --prefix tools/clod-poc run build

npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-distance-acceptance.ts \
  --renderer=webgpu --quality=high --seed=1 --world=16
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-distance-acceptance.ts \
  --renderer=webgpu --quality=low --seed=1 --world=16
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-distance-acceptance.ts \
  --renderer=webgl --quality=high --seed=1 --world=16
```

Evidence is written below `shots/water/foam-distance-acceptance/<renderer>/<quality>/`.
A stable npm alias can be added in a small follow-up after this proof merges.
