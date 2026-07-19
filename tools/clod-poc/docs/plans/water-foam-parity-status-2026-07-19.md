# Water Foam Parity Status

Date: 2026-07-19
Scope: `tools/clod-poc`

This document supersedes the foam-specific status section in
`water-fable5-parity-handover-2026-07-18.md`. The older handover remains the
source for traced hydrology, carving, atlases, water timing, and non-foam work.

## Current verdict

The foam implementation is no longer split into unrelated HQ, performance, and
WebGL models. All three render paths now use the same accepted behavioral
contract:

- coherent two-phase breakup rather than static sine ribbons;
- rapid eligibility from speed × local drop × river weight;
- shared shoreline and bank attenuation;
- shared maximum coverage;
- environment-modulated foam colour rather than flat white;
- configuration-owned camera-distance attenuation;
- zero CPU foam-field samples.

The remaining gap is **native headed evidence**, not another foam shader rewrite.
PR #256 adds the missing deterministic proof that the configured distance fade
actually produces the expected near, midpoint, and far response in HQ WebGPU,
performance WebGPU, and WebGL.

## Delivered on `main`

### Shared foam authority

- PR #198 / #200: coherent FBM foam, multiplicative rapid eligibility, shared
  breakup, reduced river-shore activation, coverage cap, and non-flat lighting in
  HQ WebGPU.
- PR #215: performance WebGPU moved to the shared foam authority; the old sine
  ribbons and additive rapid trigger were removed.
- PR #217: WebGL adopted the same coverage thresholds, rapid contract,
  river-shore attenuation, cap, and environment-modulated colour.

### Lighting and shade response

- PR #222: WebGPU tiers consume the GPU sun-visibility atlas; shaded coverage
  attenuates without CPU samples or readback.
- PR #234: deterministic same-camera lit-versus-shaded acceptance with explicit
  override reset and atlas restoration.
- PR #241: stable high/low shade commands and inclusion in the full water
  verification workflow.

### Quality and renderer parity

- PR #220: deterministic high/low WebGPU quality matrix with canonical poses and
  structural, lighting, temporal, and metric-ratio gates.
- PR #239: real headed WebGL lane with actual-backend verification, isolated
  evidence directories, runtime contract, and bounded browser/shader/context-loss
  error capture.
- PR #247: stable high/low WebGL commands and inclusion in `water:verify:full`.
- PR #250: four-leg WebGPU-high/WebGPU-low/WebGL-high/WebGL-low renderer matrix.
  WebGPU-high owns the canonical pose set; all other legs must reuse it exactly.
  The matrix gates individual acceptance, per-renderer quality parity, and
  WebGL-versus-WebGPU structural, lighting, temporal, and water-mask ratios.
- PR #251: narrowed WebGL warning capture so generic words such as `link` or
  `program` cannot create false acceptance failures. Node tests and the injected
  browser collector now share one regex authority.

### Runtime and operational proof

- PR #226: runtime diagnostics report the active foam revision, resolved tier,
  constants, zero CPU samples, and live sun-atlas state.
- PR #231: stable high/low/matrix commands and `water:verify:full`.
- PR #237: one YAML-owned camera-distance fade across HQ WebGPU, performance
  WebGPU, and WebGL. The performance-only clipmap-level fade was removed.
- PR #245: the canonical WebGPU runtime contract now fails on any session-
  cumulative uncaptured WebGPU error. WebGL remains on its separate browser and
  shader error authority.

## Open proof

### PR #256 — deterministic distance response

PR #256 is open and mergeable. It proves the live configured fade without moving
the camera or changing hydrology:

1. discover one real rapid;
2. place the camera once;
3. hide residue, cascade-particle, and river-mist overlays while preserving their
   exact prior visibility;
4. freeze only water material time while camera, ring, and atlas updates remain
   live;
5. inject synthetic measured distances before the real configured smoothstep;
6. capture near, midpoint, and beyond-end foam-debug frames;
7. restore distance, time, and overlays in a fail-loud cleanup.

For the current `120–320 m` range, the live-derived samples are 70 m, 220 m, and
370 m. The gate requires meaningful near foam, approximately half-strength
uncapped midpoint response, near-zero far response, and monotonic behavior among
both active and uncapped foam pixels.

The override does **not** replace the configured fade with an acceptance-only
multiplier. It replaces only measured camera distance; the production
`smoothstep(startM, endM, distanceM)` remains authoritative.

## Stable commands on `main`

```bash
npm --prefix tools/clod-poc run water:foam:accept:high
npm --prefix tools/clod-poc run water:foam:accept:low
npm --prefix tools/clod-poc run water:foam:accept:matrix

npm --prefix tools/clod-poc run water:foam:accept:shade:high
npm --prefix tools/clod-poc run water:foam:accept:shade:low
npm --prefix tools/clod-poc run water:foam:accept:shade

npm --prefix tools/clod-poc run water:foam:accept:webgl:high
npm --prefix tools/clod-poc run water:foam:accept:webgl:low
npm --prefix tools/clod-poc run water:foam:accept:webgl

npm --prefix tools/clod-poc run water:verify:full
```

The cross-renderer matrix currently runs directly:

```bash
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-renderer-matrix.ts \
  --seed=1 --world=16
```

After PR #256 merges, the distance proof runs directly until a small package-alias
follow-up lands:

```bash
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-distance-acceptance.ts \
  --renderer=webgpu --quality=high --seed=1 --world=16
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-distance-acceptance.ts \
  --renderer=webgpu --quality=low --seed=1 --world=16
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-distance-acceptance.ts \
  --renderer=webgl --quality=high --seed=1 --world=16
```

## Native evidence still required

No native headed result is claimed from connector-only implementation sessions.
Before marking foam parity complete, run and retain:

1. high/low WebGPU quality matrix reports and screenshots;
2. high/low deterministic shade reports;
3. high/low WebGL reports with `renderer.actual = webgl` and no browser errors;
4. the four-leg renderer matrix report with exact canonical pose reuse;
5. all three PR #256 distance-response reports after that PR merges;
6. zero WebGPU uncaptured errors, zero WebGL browser/shader errors, and zero CPU
   foam-field samples in the relevant reports.

Do not weaken thresholds merely to make the first native run pass. Diagnose any
failure by category first: renderer selection, stale evidence, water-mask drift,
insufficient rapid evidence, coherent-pattern divergence, lighting divergence,
temporal divergence, distance response, or actual GPU/browser errors.

## Remaining implementation work

After PR #256 and native evidence, foam-specific implementation should be limited
to:

- a small stable npm alias for the distance proof and, optionally, the renderer
  matrix;
- threshold calibration only when native evidence demonstrates a repeatable and
  technically justified renderer difference;
- visual tuning only when the acceptance reports identify a real defect.

River gravel/cobble acceptance, confluence-network hydrology, shoreline dither,
and general water polish are separate workstreams. They should not be folded into
foam acceptance or used to delay closure of the foam contract.
