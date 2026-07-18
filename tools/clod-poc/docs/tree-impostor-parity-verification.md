# Tree impostor parity verification

## Runtime contract

The tree impostor path uses the same source appearance and instance identity as the live tree rings:

- bark synthesis and foliage cluster coverage are included in albedo capture;
- albedo, tree-local normals, and linear depth are captured for an 8x8 octahedral view grid;
- four neighbouring views are coverage-weighted and blended at runtime;
- blended normals are normalized and rotated by the instance yaw before relighting;
- RGB, normals, and depth are dilated independently inside each tile;
- transparent coverage remains unchanged while edge data is filled for safe filtering;
- all four structural variants have distinct atlas pages;
- age, crown width, crown flattening, crown bias, health, and foliage retention remain per-instance runtime morphology;
- optional full young, mature, and old atlas pages remain available through `bake_age_layers: true`;
- mesh and impostor rings use complementary dither through the overlap band;
- impostors consume the same forest AO, canopy shadow, aerial tint, and shaft-hint texture as mesh trees;
- impostor alpha masks are available to the tree depth prepass;
- far and impostor shadow ownership can remain active through fitted crown proxies;
- capture, readback cleanup, row flipping, and dilation are resumable and deadline-bounded;
- temporary capture targets do not regenerate mipmaps after every tile;
- the completed data textures use trilinear mip filtering and anisotropic sampling;
- the active atlas set is replaced only after the complete new set succeeds;
- settings changes, rebuilds, repeated bake requests, and disposal cancel incomplete work;
- an opt-in live atlas lab exposes every baked species and channel inside the world scene.

## Quality presets

The final billboard no longer appears at the old approximately 260 m boundary in the balanced path.

| Preset | Tree reach | Far mesh to impostor | Tile resolution | Age pages | Approximate atlas memory |
|---|---:|---:|---:|---:|---:|
| ultra | 1200 m | 460 m | 160 px | mature only | 400 MiB |
| balanced | 900 m | 420 m | 128 px | mature only | 256 MiB |
| perf | 500 m | 300 m | 64 px | mature only | 64 MiB |
| potato | 240 m | 140 m | 48 px | mature only | 36 MiB |

The estimates include six species, four structural pages, two RGBA8 textures, and a full mip chain. Enabling `bake_age_layers` triples the atlas allocation.

The foliage cluster source defaults to 192 px per species/variant cell with richer broadleaf and conifer occupancy. This source is shared by the live foliage cards and the impostor capture path.

Do not reduce the structural page count below `TREE_STRUCTURAL_VARIANTS`. Reduce tile resolution, disable optional age pages, or move to persistent compressed assets if the measured memory budget is too high.

## Bake frame budget

The scheduler reads:

```yaml
tree_impostor_bake:
  max_build_ms_per_frame: 2.0
```

from `config/tree_impostor_bake.yaml`.

The budget is checked between individual capture tiles and between small CPU cleanup chunks. Readbacks are asynchronous and final texture preparation is isolated into separate scheduled stages. A single GPU render, driver readback, or texture initialization can still exceed the requested budget on slow hardware, so the real-GPU startup trace remains the final authority.

Runtime progress is available at:

```js
window.__drusnielTreeImpostorBake
```

The status includes the stage, species, variant, channel, tile progress, total progress, and most recently observed frame work time.

## Automated gate

Run from the repository root:

```bash
npm --prefix tools/clod-poc run trees:verify-impostor
```

Also run the new preset, memory, and prepass checks explicitly:

```bash
npm --prefix tools/clod-poc run test -- \
  src/app/state/tree_quality_presets.test.ts \
  src/trees/tree_impostor_quality.test.ts \
  src/trees/tree_system_gpu_ring_prepass.test.ts
```

Then run the complete tree parity suite:

```bash
npm --prefix tools/clod-poc run trees:qa-parity
```

## Real-GPU visual gate

Start the application:

```bash
npm --prefix tools/clod-poc run dev
```

Open the normal world with the GPU tree ring and live atlas lab enabled:

```text
http://127.0.0.1:5173/?world=8&treeGpu=1&webgpuSelection=1&treeImpostorLab=1
```

The lab defaults to the world centre at elevation 72 m. Override its position when needed:

```text
&treeLabX=512&treeLabY=72&treeLabZ=512
```

The runtime publishes the resolved lab position and mounted species:

```js
window.__drusnielTreeImpostorLab
```

Each species displays three panels:

1. coverage-normalized, square-root-decoded albedo;
2. packed tree-local normals;
3. normalized depth.

Inspect for:

- four vertically stacked structural pages per species in the default path;
- twelve pages only when `bake_age_layers: true` is explicitly selected;
- no black or grey fringe around foliage at distant mip levels;
- no colour or normal bleed between octahedral tiles or variant pages;
- matching crown silhouette and colour between the source mesh and billboard for variants 0, 1, 2, and 3;
- no view-cell flip or dark spike during a full orbit;
- no hole, brightness jump, or double-covered crown through the far-to-impostor boundary;
- no forest-lighting brightness jump at the LOD seam;
- continuous far crown shadow density through the impostor band;
- no structural crown change when the same tree switches from mesh to impostor.

## Existing visual and evidence tools

Run the orbit/spike detector on the real hardware browser path:

```bash
npm --prefix tools/clod-poc run trees:verify-impostor-visual -- --scene trees-perf --treeGpu 1 --webgpuSelection 1
```

Print the required parity evidence commands:

```bash
npm --prefix tools/clod-poc run trees:capture-parity-evidence
```

Execute the printed commands in a real-GPU browser environment, then validate the archived artifacts:

```bash
npm --prefix tools/clod-poc run trees:verify-parity-evidence -- --report
```

## Acceptance rule

Do not call visual parity complete from unit tests or a software WebGPU adapter. Completion requires:

- the automated gate passing;
- a real-GPU startup trace showing acceptable worst-frame bake cost;
- non-zero real-GPU impostor counts;
- all enabled species reporting four structural atlas pages in the default path;
- a clean orbit capture;
- a clean frozen far-to-impostor boundary capture at the preset-specific seam;
- stable forest lighting and crown shadows across the seam;
- the live atlas lab showing clean albedo, normal, and depth channels for every enabled species.
