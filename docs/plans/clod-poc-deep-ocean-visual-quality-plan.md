# CLOD-POC Deep Ocean Visual Quality Plan

Scope: `tools/clod-poc` border/deep ocean only. Do not touch CLOD pages, save/load, terrain
generation, colliders, or Bevy/Rust water. Follow the steps in order. Do not redesign; every
value, field name, and function name below is final.

Two render paths exist and both stay:

- **Path A (main runtime)**: static ring mesh — `src/water/deep_ocean_surface.ts` +
  `src/water/deep_ocean_material.ts` (WebGL GLSL) + `src/water/deep_ocean_node_material.ts`
  (WebGPU TSL). Instantiated by `src/runtime/water_weather/water_startup.ts`.
- **Path B (phase1 scene)**: camera-snapped grids — `src/water/deepOceanMesh.ts` +
  `src/water/deepOcean.ts` + `src/shaders/deepOcean.wgsl`. Instantiated by
  `src/phase1/phase1_scene.ts`.

Both must consume the same YAML config and converge on the same look ("Deep Ocean v2").

---

## 1. Verdict

The deep ocean reads as a flat, semi-transparent tinted sheet that visibly ends before the
horizon. Geometry is far too coarse for the wave spectrum (64–128 m cells vs 20–250 m
wavelengths), so displacement aliases into slow formless crawling. Shading is disconnected
from config and scene: hardcoded teal ramps, a hardcoded fake sky in reflections, fog that
mathematically caps at ~50–63% so the mesh edge shows against the sky, and foam that is
either white-noise speckle (WebGPU) or phase-aligned stripes (WGSL). All fixes below are
uniform/shader/mesh-resolution work — no new render passes, no FFT, no reflections.

## 2. Top 5 visual problems (ranked)

1. **The ocean visibly ends.** Elevated/oblique views show a fading disc edge and a hard
   horizon band: fog never reaches 100% and Path B's far level alpha-fades out at ~4096 m.
2. **Flat, lifeless swell.** Far geometry cells (128 m Path B far grid, ~144 m Path A ring)
   undersample every wave component; the surface barely moves and shimmers when it does.
3. **Milky glass look.** Constant material alpha + `depthWrite: false` over nothing renders
   deep water as translucent film instead of an opaque water body.
4. **Colors ignore config and scene.** Hardcoded teal height ramp and hardcoded sky-reflection
   palette; YAML `deep_color`/`shallow_color` barely affect the frame; sunset/storm presets
   reflect a wrong hardcoded sky. The WGSL path has no sky model at all
   (`reflected_sky = mix(deep_color, fog_color, …)`).
5. **Fake foam.** WebGPU foam noise is unsmoothed white noise (static speckle); WGSL foam is
   a pure slope threshold (stripes aligned to wave phase); reef/cliff foam are unbroken bands.
   Additionally Path B has a translucent ring around the camera at ~224–343 m where the
   near/far level crossfades don't sum to 1.

## 3. Top 5 technical causes (ranked)

1. **Mesh undersampling and broken level fades.** `deep_ocean_surface.ts` ring: one radial
   band, `segments`≈64 across ~9.2 km. `deepOceanMesh.ts`: near 512 m/96, far 8192 m/64, no
   mid level; `uLevelFade` near-out band (210–256 m) ≠ far-in band (215–343 m).
2. **Fog math cannot saturate.** GLSL: `fog = smoothstep(near, far, d) * fogDensity` with
   `fog_density: 0.5` → max 50%. WGSL: `1 - exp(-density * t * 2)` with density 0.5 → max
   63%. No forced horizon convergence before mesh end; fog/horizon color is a grayish
   constant, not fed from the scene sky.
3. **Constant alpha + no depth write.** `uAlpha` uniform everywhere; no inner-edge-only fade;
   deep ocean blends against the void below the horizon.
4. **Hardcoded shader constants.** GLSL/TSL `hColor1..3` ramp, `skyReflection()` palette, SSS
   colors — none from `DeepOceanShadingConfig`. WGSL fragment has no procedural normal
   detail and no sky gradient.
5. **Wave list construction.** `buildGpuWaves()` sorts all cascades by amplitude and takes the
   top 16 — the fine cascade (small chop) is almost entirely discarded;
   `deep_ocean_node_material.ts` further truncates to `PERF_WAVE_COUNT = 8`. Spectrum
   amplitude is un-normalized, so `height_scale` is not in meters and tuning is blind.

---

## 4. Implementation steps, in order

Execute steps S1–S10 sequentially. Each step lists its files (§5), config (§6), and code
changes (§7–§10).

- **S1 — Config schema.** Add the new fields of §6 to types, YAML, strict parser, runtime
  parser. Keep both parsers aligned; update parser tests.
- **S2 — Wave selection.** Balanced cascade selection + amplitude normalization in
  `deep_ocean_waves.ts` (§9). Update/add wave tests.
- **S3 — Path A ring mesh.** Two radial bands with graded outer band in
  `deep_ocean_surface.ts` (§8). Update count helpers + tests.
- **S4 — Path B grids.** Three levels (near/mid/far) + complementary fade bands in
  `deepOceanMesh.ts`; wire third level and new uniforms in `deepOcean.ts` (§8).
- **S5 — WGSL shader.** Noise helpers, crest sharpening, normal detail, sky reflection,
  saturating fog, foam breakup, complementary level alpha in `deepOcean.wgsl` (§7).
- **S6 — GLSL material.** Config-driven colors, sky, SSS, fog, edge-band alpha, depth write
  in `deep_ocean_material.ts` (§10).
- **S7 — TSL node material.** Mirror S6 in `deep_ocean_node_material.ts`; raise wave count;
  real value noise for foam (§10).
- **S8 — Debug panel.** Add `detail normal` and `sss` sliders to `oceanDebug.ts`.
- **S9 — Visual gate.** Add `horizon` preset + camera to `border_ocean_scene.yaml`,
  `border_ocean_scene.ts`, `tools/border-ocean-visual.ts` (§13).
- **S10 — Verification.** Run the commands in §13; check §14.

## 5. Exact files to edit per step

| Step | Files |
|---|---|
| S1 | `tools/clod-poc/src/config/border_coast_ocean_config_types.ts`, `tools/clod-poc/config/border_coast_ocean.yaml`, `tools/clod-poc/src/config/borderCoastOceanConfig.ts` (strict parser), `tools/clod-poc/src/terrain/border_coast_config.ts` (runtime parser + `DeepOceanRenderConfig`), their existing parser test files |
| S2 | `tools/clod-poc/src/water/deep_ocean_waves.ts`, `tools/clod-poc/src/water/deep_ocean_waves.test.ts` (create if missing) |
| S3 | `tools/clod-poc/src/water/deep_ocean_surface.ts`, `tools/clod-poc/src/water/deep_ocean_surface.test.ts` |
| S4 | `tools/clod-poc/src/water/deepOceanMesh.ts`, `tools/clod-poc/src/water/deepOcean.ts`, `tools/clod-poc/src/water/deepOcean.test.ts`, one-line horizon-color wire in `tools/clod-poc/src/phase1/phase1_scene.ts` |
| S5 | `tools/clod-poc/src/shaders/deepOcean.wgsl`, wgslFn dependency lists in `tools/clod-poc/src/water/deepOcean.ts` |
| S6 | `tools/clod-poc/src/water/deep_ocean_material.ts` |
| S7 | `tools/clod-poc/src/water/deep_ocean_node_material.ts` |
| S8 | `tools/clod-poc/src/debug/oceanDebug.ts` |
| S9 | `tools/clod-poc/config/border_ocean_scene.yaml`, `tools/clod-poc/src/debug/border_ocean_scene.ts`, `tools/clod-poc/tools/border-ocean-visual.ts` |
| S10 | none (verification only) |

Do not edit `ocean_service.ts`, `border_ocean_player_config.ts`, or
`border_ocean_debug_panel.ts` (gameplay/sampler behavior is unchanged; the sampler picks up
S2 wave changes automatically through `deepOceanGpuWaves`).

## 6. Exact config fields (add/change in `config/border_coast_ocean.yaml`)

Change existing values:

```yaml
deep_ocean:
  near_subdivisions: 128        # was 96
  far_subdivisions: 128         # was 64
  wave:
    active_gpu_waves: 24        # was 16
  shading:
    deep_color: "#04294a"       # was "#042c4e"
    shallow_color: "#0d6b66"    # was "#0a5c5a"
    fog_color: "#7f98ac"        # was "#47616d"; fallback only — scene sky overrides per frame
    fog_far_m: 2200             # was 1800
    fog_density: 1.0            # was 0.5
```

Add new fields (all required in both parsers, same names snake_case):

```yaml
deep_ocean:
  mid_grid_size_m: 2048
  mid_subdivisions: 128
  ring_inner_band_m: 512
  ring_inner_radial_segments: 64
  ring_outer_radial_segments: 24
  ring_tangential_segments: 288
  wave:
    detail_normal_strength: 0.35
    detail_normal_fade_start_m: 200
    detail_normal_fade_end_m: 900
  shading:
    sky_zenith_color: "#2a5f9e"
    sss_color: "#0e5a4e"
    sss_strength: 0.9
    horizon_blend_start_m: 3520   # fog_far_m * 1.6
    horizon_blend_end_m: 4400     # fog_far_m * 2.0
    edge_fade_m: 48
```

Mirror all of these in `DeepOceanConfig` / `DeepOceanWaveConfig` / `DeepOceanShadingConfig`
in `border_coast_ocean_config_types.ts` (snake_case) and in the camelCase
`DeepOceanRenderConfig` in `src/terrain/border_coast_config.ts`
(`midGridSizeM`, `midSubdivisions`, `ringInnerBandM`, `ringInnerRadialSegments`,
`ringOuterRadialSegments`, `ringTangentialSegments`, `detailNormalStrength`,
`detailNormalFadeStartM`, `detailNormalFadeEndM`, `skyZenithColor`, `sssColor`,
`sssStrength`, `horizonBlendStartM`, `horizonBlendEndM`, `edgeFadeM`). Validate colors with
the existing `colorAt`, numbers with `numberAt(min=0)`, segment counts with
`integerAt(min=1)`.

## 7. Exact shader changes — `src/shaders/deepOcean.wgsl`

**7.1 Add noise helpers** (top of file; new functions, prefix `dow_` to keep
`extractWgslFunction` names unique):

```wgsl
fn dow_hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn dow_noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dow_hash21(i), dow_hash21(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(dow_hash21(i + vec2<f32>(0.0, 1.0)), dow_hash21(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y,
  );
}

fn dow_fbm3(p: vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    v = v + dow_noise2(q) * a;
    q = mat2x2<f32>(vec2<f32>(1.6, -1.2), vec2<f32>(1.2, 1.6)) * q + vec2<f32>(17.0, 9.0);
    a = a * 0.5;
  }
  return v;
}
```

In `deepOcean.ts`, register `dow_hash21`/`dow_noise2`/`dow_fbm3` as `wgslFn` nodes and add
`dow_fbm3` (which pulls the other two) to the dependency arrays of `oceanShade`.

**7.2 `ocean_wave` — crest sharpening** (replace body):

```wgsl
fn ocean_wave(
  world_xz: vec2<f32>, direction: vec2<f32>, wavelength: f32, amplitude: f32,
  speed: f32, time_seconds: f32, choppiness: f32,
) -> vec4<f32> {
  let k = 6.28318530718 / max(wavelength, 0.001);
  let phase = dot(world_xz, direction) * k + time_seconds * speed;
  let s = sin(phase);
  let c = cos(phase);
  let sharp = 1.0 + max(choppiness, 0.0) * 0.75;
  let base = (s + 1.0) * 0.5;
  let height = amplitude * (2.0 * pow(base, sharp) - 1.0);
  let dheight_dphase = amplitude * sharp * pow(max(base, 1e-4), sharp - 1.0) * c;
  let slope_scale = dheight_dphase * k;
  return vec4<f32>(
    height,
    direction.x * slope_scale,
    direction.y * slope_scale,
    abs(c * amplitude * k * max(choppiness, 0.0)),
  );
}
```

**7.3 `deep_ocean_wave_sample`** — only change the level weighting line (three levels now):

```wgsl
let fine_weight = select(select(0.0, 0.55, level_id < 1.5), 1.0, level_id < 0.5);
```

**7.4 `deep_ocean_shade`** — change signature to add parameters (after `foam_value`):
`time_seconds: f32`, `sky_zenith: vec3<f32>`, `sss_color: vec3<f32>`,
`detail_params: vec4<f32>` (x = detail_normal_strength, y = fade_start_m, z = fade_end_m,
w = sss_strength), `horizon_blend: vec2<f32>` (x = start_m, y = end_m). Then apply these
exact replacements inside:

a. **Level alpha** (replace the `inner_alpha`/`outer_alpha`/`select` block) — `level_fade`
   is reinterpreted as `(fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd)`:

```wgsl
let level_alpha = smoothstep(level_fade.x, level_fade.y, camera_distance)
  * (1.0 - smoothstep(level_fade.z, level_fade.w, camera_distance));
```

b. **Normal detail** (insert after `let normal = normalize(normal_value);`, and use the
   result everywhere `normal` was used):

```wgsl
let detail_fade = 1.0 - smoothstep(detail_params.y, detail_params.z, camera_distance);
let duv = world_position.xz * 0.14 + vec2<f32>(time_seconds * 0.04, time_seconds * -0.025);
let eps = 0.35;
let h0 = dow_fbm3(duv);
let dgrad = vec2<f32>(dow_fbm3(duv + vec2<f32>(eps, 0.0)) - h0,
                      dow_fbm3(duv + vec2<f32>(0.0, eps)) - h0)
  * (detail_params.x * detail_fade / eps);
var shaded_normal = normalize(vec3<f32>(normal.x - dgrad.x, normal.y, normal.z - dgrad.y));
shaded_normal = normalize(mix(vec3<f32>(0.0, 1.0, 0.0), shaded_normal, mix(0.4, 1.0, detail_fade)));
```

c. **Fresnel** (replace existing fresnel):

```wgsl
let fresnel = (0.02 + 0.98 * pow(1.0 - max(dot(view_direction, shaded_normal), 0.0), 5.0))
  * shading_params.y;
```

d. **Sky reflection** (replace `let reflected_sky = mix(deep_color, fog_color, …);`):

```wgsl
let reflect_dir = normalize(reflect(-view_direction, shaded_normal));
let refl_y = max(reflect_dir.y, 0.0);
let sky_grad = mix(fog_color, sky_zenith, smoothstep(0.0, 0.55, refl_y));
let sun_dot = max(dot(reflect_dir, sun), 0.0);
let sun_glow = vec3<f32>(1.0, 0.9, 0.7) * (pow(sun_dot, 96.0) * 1.2 + pow(sun_dot, 8.0) * 0.15);
let reflected_sky = sky_grad + sun_glow * shading_params.z;
```

   Keep the coast `shallow_mix` block, then replace
   `color = mix(color, reflected_sky, fresnel);` with
   `color = mix(color, reflected_sky, clamp(fresnel * shading_params.z, 0.0, 1.0));`

e. **SSS** (insert after the specular add; keep specular but multiply it by `fresnel`):

```wgsl
let sss = sss_color * detail_params.w
  * pow(max(dot(view_direction, -sun), 0.0), 4.0)
  * (0.25 + foam_value * 0.5);
color = color + sss;
```

f. **Foam breakup** (replace the final foam mix):

```wgsl
let foam_breakup = 0.45 + 0.55 * smoothstep(0.35, 0.75,
  dow_fbm3(world_position.xz * 0.09 + vec2<f32>(time_seconds * 0.03, 0.0)));
let foam_broken = clamp((foam_value + cliff_spray_glow) * foam_breakup, 0.0, 1.0);
color = mix(color, foam_color, foam_broken);
```

g. **Fog** (replace the two fog lines):

```wgsl
let fog_t = clamp((camera_distance - fog_params.x) / max(fog_params.y - fog_params.x, 1.0), 0.0, 1.0);
var fog_amount = 1.0 - exp(-fog_params.z * fog_t * fog_t * 3.0);
fog_amount = max(fog_amount, smoothstep(horizon_blend.x, horizon_blend.y, camera_distance));
color = mix(color, fog_color, clamp(fog_amount, 0.0, 1.0));
```

## 8. Exact mesh/surface changes

**8.1 `src/water/deepOceanMesh.ts` (Path B).** Replace the two-level build with three
levels. New `DeepOceanGridMesh` fields: replace `innerFadeM`/`outerFadeM` with
`fadeIn: [number, number]` and `fadeOut: [number, number]` (camera-distance meters).

```ts
// buildDeepOceanMeshes(config):
const near = buildGrid("near", config.near_grid_size_m, config.near_subdivisions,
  config.near_grid_size_m / config.near_subdivisions, [0, 1], [224, 256]);
const mid = buildGrid("mid", config.mid_grid_size_m, config.mid_subdivisions,
  config.mid_grid_size_m / config.mid_subdivisions, [224, 256], [928, 1024]);
const farExtent = Math.max(config.visual_extent_m * 2, config.far_grid_size_m);
const far = buildGrid("far", farExtent, config.far_subdivisions,
  config.far_grid_size_m / config.far_subdivisions, [928, 1024], [1e9, 1e9 + 1]);
return { near, mid, far };
```

`DeepOceanLevel` becomes `"near" | "mid" | "far"`. Fade-in band of each level must equal the
fade-out band of the previous level exactly (they are complementary smoothsteps, alphas sum
to 1). Far level never fades out — fog handles the horizon.

**8.2 `src/water/deepOcean.ts`.** Build three `createOceanLevel` calls with `levelId`
0/1/2 and `renderOrder` 9/8/7. Set `uLevelFade = vec4(fadeIn[0], fadeIn[1], fadeOut[0],
fadeOut[1])`. Add uniforms and pass to `oceanShade`: `uSkyZenith` (from
`shading.sky_zenith_color`), `uSssColor` (`shading.sss_color`), `uDetailParams` =
`Vector4(wave.detail_normal_strength, wave.detail_normal_fade_start_m,
wave.detail_normal_fade_end_m, shading.sss_strength)`, `uHorizonBlend` =
`Vector2(shading.horizon_blend_start_m, shading.horizon_blend_end_m)`, and `time_seconds:
uTime`. Add method `setHorizonColor(color: THREE.Color)` that copies into every level's
`uFogColor`. In `phase1_scene.ts`, call `deepOcean.setHorizonColor(<scene sky horizon
color>)` once per frame where the sun/haze is updated.

**8.3 `src/water/deep_ocean_surface.ts` (Path A ring).** Replace `deepOceanGridSpecs` with
a two-band layout. New function name: `deepOceanBandSpecs(worldCells, config)`. For each of
the 4 sides, emit 2 rects:

- Inner band: radial width `min(config.ringInnerBandM, extend - startOutside)`, radial
  segments `config.ringInnerRadialSegments` (linear spacing), tangential segments
  `config.ringTangentialSegments`.
- Outer band: remaining radial width, radial segments `config.ringOuterRadialSegments`
  with squared grading — radial vertex position uses `t2 = t * t` instead of `t` so cells
  grow outward. Implement by adding an optional `radialGrade?: (t: number) => number`
  parameter to `addRectGrid` and passing `t => t * t` for outer bands only (grade applies
  along the axis pointing away from the world; for the north rect that is +z, south −z,
  east +x, west −x — compute `t` from the hole edge outward).

Update `deepOceanSurfaceVertexCount`, `deepOceanSurfaceTriangleCount`, and
`visitRectGridVertices` to iterate the same band specs (counts are pure functions of the
specs, so reuse the shared spec list). `countDeepOceanTransitionGapVertices` must remain 0.

## 9. Exact wave/normal changes — `src/water/deep_ocean_waves.ts`

**9.1 Balanced cascade selection.** New function:

```ts
function selectSpectrumWaves(waves: SpectrumWave[], count: number): SpectrumWave[] {
  const byAmp = (a: SpectrumWave, b: SpectrumWave) => b.amp - a.amp;
  const coarse = waves.filter(w => w.cascade === 0).sort(byAmp);
  const fine = waves.filter(w => w.cascade === 1).sort(byAmp);
  const fineCount = Math.floor(count / 2);
  return [...coarse.slice(0, count - fineCount), ...fine.slice(0, fineCount)];
}
```

In `buildGpuWaves`, replace `.sort(...).slice(0, config.activeGpuWaves)` with
`selectSpectrumWaves(spectrum, config.activeGpuWaves)`.

**9.2 Amplitude normalization.** In `buildCascade`, remove `config.heightScale` from the
`amp` formula (`const amp = Math.sqrt(Math.max(0, spectrum)) * dk;`). After selection in
`buildGpuWaves`, normalize so `height_scale` is meters of total spectrum amplitude:

```ts
function normalizeSelectedAmplitudes(waves: SpectrumWave[], heightScale: number): void {
  const sum = waves.reduce((t, w) => t + Math.abs(w.amp), 0);
  if (sum <= 1e-9) return;
  const scale = heightScale / sum;
  for (const w of waves) w.amp *= scale;
}
```

Call it with `config.heightScale` before mapping to `DeepOceanGpuWave`. Swells keep their
existing `swellHeightScale` scaling and are appended unchanged. Keep `fitDefaultWaveCount`
as is (uniform array sizing).

**9.3 No other changes.** `sampleDeepOceanWave` / `sampleDeepOceanNormal` /
`deepOceanWaveVerticalBounds` stay as they are; the CPU sampler and both material paths pick
up the new wave list automatically.

## 10. Exact color/fog/horizon/foam changes in material files

**10.1 `src/water/deep_ocean_material.ts` (GLSL).**

- New uniforms: `uOceanDeepColor` (shading.deepColor), `uOceanShallowColor`
  (shading.shallowColor), `uSkyZenith` (shading.skyZenithColor), `uSssColor`
  (shading.sssColor), `uSssStrength`, `uHorizonBlend: Vector2(horizonBlendStartM,
  horizonBlendEndM)`, `uEdgeFadeM`, `uWorldBounds: Vector4(min_x, max_x, min_z, max_z)`,
  `uStartOutsideM`, `uWaveHeightRef` = `wave.heightScale * 1.5`.
- Delete the `deepColor`/`shallowColor` locals and the entire `hColor1..3` ramp block.
  Replace with:

```glsl
float crest = smoothstep(0.0, uWaveHeightRef, waveHeight);
vec3 albedo = mix(uOceanDeepColor, uOceanShallowColor,
  clamp(crest * 0.45 + vWaveCompression * 0.25, 0.0, 1.0));
```

- `skyReflection()`: change signature to `skyReflection(vec3 reflectDir, vec3 sunDir, vec3 horizonColor, vec3 zenithColor)`; replace the hardcoded `horizon` and `vec3(0.15, 0.35, 0.75)` with the two parameters (`sky = mix(horizonColor, zenithColor, smoothstep(0.0, 0.6, reflYClamped));`); keep mie/sun-disc terms; call with `uHorizonColor, uSkyZenith`.
- SSS block: replace both hardcoded SSS colors with
  `mix(uOceanDeepColor, uSssColor, smoothstep(-1.0, 5.0, waveHeight) * 0.55)` and multiply
  the final `sss` by `uSssStrength`.
- Fog (replace the two fog lines):

```glsl
float outsideD = max(max(uWorldBounds.x - vWorldPos.x, vWorldPos.x - uWorldBounds.y), 0.0);
float outsideDz = max(max(uWorldBounds.z - vWorldPos.z, vWorldPos.z - uWorldBounds.w), 0.0);
float holeDist = length(vec2(outsideD, outsideDz));
float fogT = clamp((dist - uFogNear) / max(uFogDistance - uFogNear, 1.0), 0.0, 1.0);
float fog = 1.0 - exp(-uFogDensity * fogT * fogT * 3.0);
fog = max(fog, smoothstep(uHorizonBlend.x, uHorizonBlend.y, dist));
vec3 finalColor = mix(litOcean, uHorizonColor, clamp(fog, 0.0, 1.0));
```

- Alpha / depth: replace the constant-alpha output with an inner-edge-only fade and make the
  body opaque:

```glsl
float edgeFade = smoothstep(0.0, max(uEdgeFadeM, 1.0), holeDist - uStartOutsideM);
gl_FragColor = vec4(finalColor, clamp(mix(0.55, 1.0, edgeFade), 0.0, 1.0));
```

  In `createDeepOceanShaderMaterial`, set `depthWrite: true` (remove the
  `params.visual.depthWrite` pass-through for this material only; keep `transparent: true`
  for the edge band) and change `side: THREE.DoubleSide` to `THREE.FrontSide`.

**10.2 `src/water/deep_ocean_node_material.ts` (TSL).** Mirror 10.1 one-to-one:

- `PERF_WAVE_COUNT`: 8 → 16.
- Replace `hashNoise` foam sampling with real value noise. New function `valueNoise2(p)`:
  `i = floor(p); f = fract(p); u = f*f*(3-2f);` bilinear-mix four `hashNoise(i + corner)`
  samples. Use `valueNoise2` for `n1/n2/n3` (same octave scales as now) and add a bump
  normal term: `bumpGrad = 2-tap gradient of (valueNoise2(worldPos.xz * 0.14 + timeDrift) * detailStrength * detailFade)`
  with `detailFade = 1 - smoothstep(detailFadeStartM, detailFadeEndM, dist)`, added to
  `slopeX/slopeZ` before the normal is built.
- Same albedo replacement (delete `hColor1..3`, use `uOceanDeepColor`/`uOceanShallowColor`
  uniforms), same sky parameterization (`uHorizon`, new `uSkyZenith`), same SSS
  (`uSssColor`, `uSssStrength`), same fog + horizon clamp (`uHorizonBlend`), same edge-fade
  alpha (compute `holeDist` from a `uWorldBounds` uniform + `uStartOutsideM`), and
  `depthWrite: true`, `side: THREE.FrontSide`.

**10.3 Horizon color feed.** `water_startup.ts` already receives the material handle;
verify `updateHorizonColor(...)` is called each frame with the scene sky/haze horizon color
(same value the sky dome uses at elevation 0). If it is not called, add the call where
`updateSunDirection` is called. Path B equivalent is `DeepOcean.setHorizonColor` (S4).

## 11. What to cache/precompute

- Wave list: built once per config load (already the case) — keep; never rebuild per frame.
- Ring and grid geometries: built once — keep static; the graded outer band is precomputed
  at build time.
- Shared resolved visual config between WebGL and WebGPU (already exists) — extend it with
  the new shading fields so both paths read identical values.
- Nothing else. All noise is procedural in-shader; do not add noise textures or lookup
  tables. Per-frame updates are limited to: `uTime`, camera position, sun direction,
  horizon color.

## 12. What NOT to do (performance)

- No FFT/compute-shader ocean, no WebGPU-only features in the base path.
- No planar reflections, screen-space reflections, or render-to-texture of any kind.
- No depth-buffer readback refraction.
- No per-frame geometry rebuilds or CPU vertex displacement.
- Do not raise `visual_extent_m`, camera far plane, or any cull distance.
- Do not exceed 24 geometry waves (Path A vertex loop) or `PERF_WAVE_COUNT` 16 (node
  material) without a perf run.
- Do not add shadows, per-pixel ray-marched foam, or extra fbm octaves beyond the 3
  specified.
- Keep `max_deep_ocean_draw_calls: 1` for Path A; Path B is 3 draws (one per level) — do
  not add more levels.

## 13. Tests/screenshots to add or update

Unit tests (run **without** rtk: `npm --prefix tools/clod-poc test`):

- `deep_ocean_waves.test.ts` (new): with default config, selection returns exactly
  `active_gpu_waves` spectrum waves of which ≥ `floor(active_gpu_waves / 2)` have
  `cascade === 1`; sum of spectrum `|amp|` equals `height_scale` within 1e-3.
- `deep_ocean_surface.test.ts`: update expected vertex/triangle counts for the two-band
  ring; assert transition-gap vertices stay 0; assert outer-band radial spacing is
  monotonically increasing.
- `deepOcean.test.ts` / `deepOceanMesh` tests: three levels exist; `mid.fadeIn` equals
  `near.fadeOut` and `far.fadeIn` equals `mid.fadeOut`; far `fadeOut[0] >= 1e9`.
- Strict/runtime parser tests: all §6 fields parsed identically by both parsers; missing
  field fails loud.

Visual gate (native Windows shell, not WSL):

- `config/border_ocean_scene.yaml`: add under `border_ocean_scene:`:

```yaml
  horizon_camera:
    eye_x_ratio: 0.50
    eye_y: 320
    eye_z_ratio: 0.50
    look_x_ratio: 0.50
    look_y: 0
    look_z_ratio: 4.0
    fov: 55
```

- `border_ocean_scene.ts`: parse `horizon_camera` (same optionalNumber pattern; `eye_y` and
  `look_y` absolute meters) and export `borderOceanHorizonCameraForWorld(worldCells, cfg)`.
- `tools/border-ocean-visual.ts`: add preset
  `{ name: "horizon", renderer: "webgl", weather: "off", extra: ["--cam", HORIZON_CAM_ARG] }`
  built from the new camera. Keep all existing presets and the WebGPU parity flow.
- Run: `npm run border-ocean:visual` and
  `BORDER_OCEAN_VISUAL_WEBGPU=1 npm run border-ocean:visual` on a GPU machine.
- Build + typecheck: `rtk npm --prefix tools/clod-poc run typecheck` (rtk OK),
  `npm --prefix tools/clod-poc run build` (no rtk).

## 14. Acceptance checklist

- [ ] Typecheck, unit tests, and build all pass (vitest/vite run without rtk).
- [ ] `npm run border-ocean:visual` passes; `report.json` status `pass`; all existing
      counters still published; `border_ocean.deep_ocean_transition_gap_vertices == 0`.
- [ ] Horizon preset shot: no visible mesh edge, no alpha ring; the top ocean rows within
      20 px below the horizon line match the horizon color within mean delta 4/255.
- [ ] Noon shot: foam appears as broken patches (no stripes, no static speckle); editing
      `deep_color` in YAML visibly changes the shot (re-shoot and confirm diff mean > 2).
- [ ] Phase1 scene at seed 1: standing at the coast, no translucent ring at 224–343 m; the
      three levels crossfade without a visible seam.
- [ ] WebGPU parity within existing thresholds (mean ≤ 18, p95 ≤ 80).
- [ ] `border_ocean.frame_ms_p95 ≤ 50` and `border_ocean.deep_ocean_triangles ≤ 600000`
      still hold with the new mesh counts.
- [ ] Player clamp/pushback counters unchanged (`player_*` counters identical to before).
- [ ] Report shot paths + stats JSON paths + before/after `frame_ms_p95` in the PR/summary;
      if any check was skipped (e.g. no WebGPU machine), say so explicitly.
