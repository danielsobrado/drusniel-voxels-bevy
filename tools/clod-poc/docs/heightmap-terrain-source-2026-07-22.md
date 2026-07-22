# Imported Heightmap Terrain Source

Load an external grayscale heightmap (for example an [Azgaar Fantasy-Map-Generator](https://github.com/Azgaar/Fantasy-Map-Generator) export) and use it as the terrain of a **finite** world. The heightmap fully replaces the analytic low-frequency shape (continent / mountains / hills / valleys / island) with a bilinear sample of the raster plus a small procedural micro-relief, while the engine's water, hydrology, materials, props, and lighting continue to run on top.

Status: implemented and verified under WebGPU on 2026-07-22.

---

## Quick start

1. Put a grayscale PNG in `public/heightmaps/` (a synthetic test map, `sample.png`, is committed there).
2. Start the dev server and open the default scene with the `heightmap` query param:

```
http://127.0.0.1:5180/?heightmap=/heightmaps/sample.png&materialTiers=1
```

The finite world builds from the raster: bright pixels become high land, dark pixels become ocean floor, and everything below the engine sea level (18) floods as water. The rectangular border coast is automatically turned off (the map defines its own coastline), so the debug panel shows `coast=off`.

### Query parameters

| Param | Default | Meaning |
|---|---|---|
| `heightmap` | *(none)* | URL/path to the PNG under the dev server (e.g. `/heightmaps/sample.png`). Presence enables the feature. |
| `heightmapBaseM` | `0` | Engine surface height at luminance 0 (black). |
| `heightmapSpanM` | `90` | Height added at luminance 1 (white): `height = baseM + luminance*spanM`. |
| `heightmapDetail` | `1.2` | Amplitude (m) of the additive micro-relief so close-up geometry is not faceted. `0` disables it. |
| `heightmapFlipZ` | `false` | `false`: image top row → world `z=0`. `true`: image bottom row → world `z=0`. |

The default vertical mapping (`base 0`, `span 90`) is chosen so that luminance `0.2` — which is FMG's sea level of `20/100` — lands at engine sea level `18`. Peaks (luminance 1) reach `90 m`, comfortably under the terrain ceiling (`118 m`).

### Getting a heightmap out of FMG

- FMG stores heights on a Voronoi grid as integers `0–100`, sea level `20`.
- Export a heightmap PNG via **Menu → Tools → Heightmap → Export as image** (convert to grayscale in an image editor if needed). The plain "export map view to PNG" loses fidelity; the heightmap-tool export or the `.map`/GeoJSON route preserves the real per-cell heights.
- Any grayscale PNG works. Colour PNGs are read via Rec.601 luminance, so they still load but are less predictable.

---

## How it works

### This is a CPU-authority feature (why the WGSL was not touched)

A **finite** world (the default scene, no `gpuMesh=1`, not a streaming scene) is meshed **entirely on the CPU**:

- Startup pages are built by the CLOD worker (`clod_worker.ts`, no `navigator.gpu`).
- Near-field chunks and dig-edit re-meshes use CPU `meshChunk` — `gpuMesherEnabledForScene(...)` returns `false` for the default scene, so the GPU chunk mesher never starts.
- Colliders, props, raycasts, and the far-height provider all call the CPU `surfaceHeight`.

The WGSL/GPU meshers (`gpu_clod_page`, `gpu_clod_root_*`, `gpu_chunk_mesher`) only run for **streamed roots**, which do not exist in a finite world. Therefore the heightmap only needs to live in the CPU field, and `terrain_field_common.wgsl` was intentionally left unchanged. (Streaming or `gpuMesh=1` worlds would need a WGSL follow-up — see Limitations.)

### The shared sampler (parity by construction)

Terrain height in this repo is duplicated across implementations that must agree:

- `terrain_surface.ts` → `baseSurfaceHeight` (canonical f64 CPU field), used by `surfaceHeight`.
- `gpu/terrain_field_core_math.ts` → `surfaceHeightCore` (the "GPU-shaped" TS port), pinned byte-identical to `baseSurfaceHeight` by `gpu/terrain_field_core.test.ts`.

To keep these in parity, a **single shared sampler** — `src/terrain/heightmap_source.ts` — is called by both:

```ts
// at the top of baseSurfaceHeight() and surfaceHeightCore()
const heightmapHeight = sampleHeightmapHeight(x, z);
if (heightmapHeight !== null) return heightmapHeight;
// ...analytic field below (unchanged)...
```

Because both call the identical function reading the identical module global, their heightmap results are bit-identical, and the existing parity test stays green. The parity test was extended to install a heightmap and assert `surfaceHeightCore(x,z) === surfaceHeight(x,z)` across a grid (with and without micro-relief).

### Sampling math

`sampleHeightmapHeight(x, z)` in `heightmap_source.ts`:

1. Map world → normalized: `u = x / worldCells`, `v = z / worldCells` (`v → 1-v` when `flipZ`), clamped to `[0,1]` (world outside the map clamps to the edge texel — usually ocean).
2. Bilinear-interpolate the luminance raster at `(u·(W-1), v·(H-1))`.
3. `h = baseM + luminance·spanM`, plus `fbm2` micro-relief scaled by `detailM`.
4. Clamp to `[1, 117.5]` (bedrock floor; ceiling matches `TERRAIN_CONFIG.height.max - 0.5`). Ocean basins are allowed below sea level.

`worldCells = WORLD_pages · pageCells` (the finite world extent). The raster stretches to fill the world domain regardless of its pixel dimensions.

### World-mode interaction

`resolveWorldMode(...)` in `app/world_mode.ts` takes a `heightmapEnabled` flag:

```ts
const borderCoastEnabled = mode === "finite" && input.borderCoastConfigEnabled && !input.heightmapEnabled;
```

The finite rectangular border coast is disabled when a heightmap is active, because the map already carries its own coastline. Everything downstream (info panel, cache `borderCoastMode`, runtime border coast) follows the resolved value.

### Worker plumbing

The raster is deliberately kept **out of `TerrainFieldConfig`**, which is JSON-hashed for cache identity — a `Float32Array` there would blow up the hash. Instead it lives in a module global (`setHeightmapSource`), mirroring the existing `terrainSurfaceOverride` / `borderCoastRuntime` runtime authorities.

- Main thread: `world_build_startup.ts` loads the PNG (after `worldCells` is known) and calls `setHeightmapSource(...)`.
- Worker: the raster is sent as a new `heightmap` field on the `build` request (`clod_worker_protocol.ts` / `clod_worker_client.ts`), and `clod_worker.ts` `handleBuild` calls `setHeightmapSource(request.heightmap ?? null)`. `Float32Array` structure-clones for free.

### Cache identity

`TerrainSourceInputs` gained `heightmapSourceHash`, computed as `JSON(describeHeightmapSource) + ":" + lightweightArrayDigest(data)` and folded into `computeTerrainSourceHash`. `TERRAIN_SOURCE_VERSION` was bumped to `world-modes-v13-heightmap-source`, so any page cached under the old analytic field is invalidated.

---

## Parity and the hydrology "non-seam"

While verifying, the main-thread `surfaceHeight(x,z)` was observed to differ from `baseSurfaceHeight(x,z)` (e.g. ocean corner `6.3 → -1.2`, island centre `71 → 58`). This is **not** a heightmap seam:

- `baseSurfaceHeight == sampleHeightmapHeight` exactly (verified live) — the sampler is correct.
- The gap is the engine's pre-existing **hydrology carve**. The default scene builds a `HydrologySystem` and installs `system.terrainHeight` as the terrain-surface override, which carves rivers/lakes and levels low ground toward water level (18).
- The **no-heightmap baseline shows the same gap** (`10,10`: `39.7 → 17.8`), so it is normal behavior, present with or without the heightmap.
- The hydrology system is built **from** `baseSurfaceHeight`, which is now the heightmap — so rivers follow the imported terrain, and main-thread ↔ worker parity is unchanged from baseline.

Do **not** "fix" this by nulling the override; that would remove the water leveling the base game relies on. The heightmap-plus-hydrology result is the intended behavior (imported landmass + engine water/rivers on top).

---

## Verifying in a browser

The in-app browser pane stalls at "LOD0 0%" (it does not composite frames, so the build never progresses) — do not use it for boot checks here.

Use `tools/shoot.ts`, which launches a real WebGPU Chrome (`launchWebGPU` in `tools/launch.ts`) and turns any unknown `--key value` into a query param:

```bash
# From tools/clod-poc. MSYS_NO_PATHCONV stops Git Bash mangling the leading-slash path.
MSYS_NO_PATHCONV=1 CLOD_POC_BASE_URL=http://127.0.0.1:5190/ \
  npx tsx tools/shoot.ts --scene main --heightmap /heightmaps/sample.png \
  --materialTiers 1 --hud 1 --out shots/heightmap/sample.png
```

Caveat: the **default scene never sets `window.__drusnielClod.ready`**, so `shoot` (which waits for ready) times out on it. For a screenshot, use a small `launchWebGPU` script with a fixed settle/wait instead of the ready gate. To confirm the field, sample it in-page:

```js
const t = await import("/src/terrain/terrain.ts");
t.surfaceHeight(250, 240);      // island centre → high
t.baseSurfaceHeight(250, 240);  // == sampleHeightmapHeight (heightmap value)
```

### Test / build gates (all green as of 2026-07-22)

```bash
npm run typecheck
npx vitest run          # 4891 passing, incl. heightmap sampler + core parity tests
npm run build
```

---

## Files

New:

- `src/terrain/heightmap_source.ts` — shared sampler, module global, descriptor.
- `src/terrain/heightmap_loader.ts` — browser PNG → luminance `Float32Array`.
- `src/terrain/heightmap_source.test.ts` — sampler unit tests.
- `public/heightmaps/sample.png` — synthetic 2-island test map.

Modified:

- `src/terrain/terrain_surface.ts`, `src/gpu/terrain_field_core_math.ts` — early heightmap branch in the two CPU fields.
- `src/gpu/terrain_field_core.test.ts` — parity extension with a heightmap installed.
- `src/app/world_mode.ts` — `heightmapEnabled` disables border coast.
- `src/app/bootstrap/world_build_startup.ts` — parse params, load raster, install global, pass to worker, cache hash.
- `src/clod_worker_client.ts`, `src/clod_worker_protocol.ts`, `src/clod_worker.ts` — carry the raster to the worker.
- `src/cache/terrainSource.ts` — `heightmapSourceHash` + version bump to `world-modes-v13-heightmap-source`.

---

## Limitations & follow-ups

- **Finite only.** A heightmap is a bounded rectangle; world outside it clamps to the edge texel. It does not stream. Streaming / infinite worlds are a separate mode.
- **CPU meshing only.** Because a finite world is CPU-meshed, the WGSL field was not modified. A streaming or `gpuMesh=1` world would render GPU-meshed geometry from the analytic WGSL field and ignore the heightmap. Adding it there means binding the raster as a texture in `terrain_field_common.wgsl` and the CLOD page/root pipelines, kept in bilinear parity with the CPU sampler.
- **Heights only.** FMG's rivers, biomes, coastlines, and burgs are not imported — only elevation. The engine re-derives its own hydrology/biomes from the imported heights. Importing FMG's own features would require parsing the `.map`/GeoJSON and feeding the hydrology graph.
- **8-bit precision.** A grayscale PNG gives 256 elevation steps; the micro-relief hides most terracing, but a very shallow, wide gradient can band. A higher-bit-depth source would need loader changes.
