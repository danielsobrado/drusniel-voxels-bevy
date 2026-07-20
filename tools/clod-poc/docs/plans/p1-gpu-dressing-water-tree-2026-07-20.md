# CLOD-POC P1 GPU dressing, water SSR misses and tree morphology — 2026-07-20

## Scope

This slice implements the three P1 requests together because they share the canonical terrain, hydrology and accepted-canopy GPU mirrors.

## GPU dressing authority

WebGPU dressing no longer performs the CPU candidate walk. The runtime now:

- dispatches separate persistent and terrain category kernels;
- derives CPU-compatible stable identities, acceptance rolls, jitter, scale and deadfall orientation on GPU;
- accepts candidates against canonical streamed height, dig edits, hydrology and accepted-canopy channels;
- validates dead-log endpoint support through the canonical height mirror;
- emits paired stumps and parent attachments from accepted persistent parents;
- compacts accepted records atomically into 29 class × 3 LOD regions;
- builds 87 indexed indirect draw arguments on GPU;
- draws directly from storage-instanced records;
- performs no gameplay readback.

The CPU implementation remains only for WebGL, explicit `dressingGpu=0`, unsupported devices or GPU initialization failure. Stationary views refresh periodically and terrain edits force a refresh so in-place environment changes converge without camera movement.

## Water SSR miss routing

The base material's constant terrain/sky miss strengths are forced to zero. Its visible SSR misses are replaced by this directional route:

```text
SSR miss
  -> terrain + accepted-canopy horizon field
     -> open: directional atmosphere
     -> blocked: directional Probe GI
        -> Probe GI unavailable: low-energy terrain fallback
```

The horizon field is camera-centred, incrementally refreshed, cleared on recenter and sampled by reflection direction. Existing SSR hits and all water debug modes remain authoritative. Probe GI is used only after the explicit `probe_gi_radiance_ready` diagnostic is published, so the current empty PGI foundation cannot create bright blocked reflections.

## Tree age and competition impostors

No new billboard or atlas implementation was added. Existing coverage-safe mipmaps, age layers and lighting remain intact.

The impostor material now samples the accepted-canopy competition channel and applies it consistently to:

- effective age response;
- crown width and height;
- deterministic foliage retention;
- health and colour response;
- depth-prepass position and mask parity.

Two evidence modes are available:

```text
?treeMorphologyEvidence=age
?treeMorphologyEvidence=competition
```

`tools/tree-morphology-evidence.ts` captures normal, age and competition views from the same deterministic pose and writes a gallery.

## Diagnostics

Expected counters:

```text
dressing_gpu_authority = 1
dressing_cpu_candidate_generation = 0
dressing_gpu_readbacks = 0
dressing_environment_query_gpu_mirror = 1
water_ssr_miss_constant_blend = 0
water_ssr_miss_horizon_test = 1
water_ssr_miss_atmosphere_open = 1
water_ssr_miss_directional_probe_gi = 1
tree_impostor_age_layers_active = 1
tree_impostor_competition_authority = 1
```

## Verification completed

Isolated verification completed on 2026-07-20:

- 5 focused Vitest files / 8 tests passed in the isolated fixture;
- two additional suites could not load in the isolated fixture because repository configuration and vegetation-authority dependencies were not mounted;
- all 16 production TypeScript entry files parsed through esbuild;
- TypeScript syntax and emit validation passed with `tsc --noEmit --noCheck`.

Repository verification commands:

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/gpu/layouts.test.ts `
  src/ecology/dressing/gpu/dressing_shader.test.ts `
  src/ecology/dressing/gpu/runtime_contract.test.ts `
  src/water/water_ssr_miss_route.test.ts `
  src/water/water_ssr_miss_route_contract.test.ts `
  src/trees/morphology/impostor_competition.test.ts `
  src/trees/morphology/impostor_competition_contract.test.ts
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed evidence:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/tree-morphology-evidence.ts `
  --url "http://127.0.0.1:5180/" `
  --out tools/clod-poc/qa-runs/tree-morphology-2026-07-20
```

For water and dressing, use:

```text
?scene=infinite-islands&dressing=1&dressingGpu=1&probeGi=1&hud=1
```

Confirm that dressing remains grounded while walking, SSR misses open to atmosphere only above the directional horizon, blocked misses remain dark until Probe GI contains radiance, tree competition changes both colour and silhouette without depth mismatch, and normal gameplay readback counters remain zero.

## Honest boundary

- Saved persistent exclusion hashes are not yet uploaded to the GPU. This slice preserves CPU-compatible generated identities so a sparse exclusion upload can be added without changing generated IDs; the old CPU renderer also did not apply the persistence bridge.
- The water route disables the old constant fallback but is attached as a material decorator rather than being embedded inside the base SSR loop. It uses a matching screen-depth hit confirmation to avoid modifying detected hits. A later cleanup should move the route into the base material and reuse its exact ray hit value.
- Accepted-canopy competition is authoritative for impostor appearance. The tree compute record retains its deterministic local competition seed for near/far morphology until the forest detail texture is bound directly into the tree compute pass.
- The evidence capture tool is implemented, but headed screenshots were not generated in this environment.
