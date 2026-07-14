# Tree impostor parity verification

## What changed

The tree impostor path now uses the same source appearance contract as live trees:

- bark synthesis is included in albedo capture;
- foliage cluster-card coverage is applied to albedo and normal-depth captures;
- albedo, normals, and depth are dilated independently inside each octahedral tile;
- transparent coverage remains unchanged while RGB and normal-depth edge data are filled for safe filtering and mipmaps;
- CPU tree instances, GPU mesh LODs, and impostor atlas pages use the same world-space structural-variant selector;
- every one of the four live structural variants has its own atlas page; variants 2 and 3 are no longer folded onto pages 0 and 1;
- GPU near, mid, far, and impostor rings use complementary material-side dither during compute overlap bands;
- capture, readback cleanup, row flipping, and dilation are resumable and deadline-bounded;
- temporary capture targets do not regenerate mipmaps after every tile;
- the active atlas set is replaced only after the complete new set succeeds;
- settings changes, rebuilds, repeated bake requests, and disposal cancel incomplete work;
- an opt-in live atlas lab exposes every baked species and channel inside the actual world scene.

## Atlas memory contract

The production atlas preserves the current 8x8 views and 192-pixel frame resolution for all four structural variants. With six species, two RGBA8 textures per species, and mipmaps, the estimated impostor atlas allocation is approximately 576 MiB.

This is an intentional fidelity tradeoff. Do not reduce the variant-page count below `TREE_STRUCTURAL_VARIANTS`; tune frame resolution or move to persistent compressed assets if the measured memory budget is too high.

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

## Automated local gate

Run from the repository root:

```bash
npm --prefix tools/clod-poc run trees:verify-impostor
```

This runs strict TypeScript, focused tree-impostor tests, and the production build.

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

- four vertically stacked variant pages per species;
- no black or grey fringe around foliage at distant mip levels;
- no colour or normal bleed between octahedral tiles or variant pages;
- matching crown silhouette and colour between the source mesh and billboard for variants 0, 1, 2, and 3;
- no view-cell flip or dark spike during a full orbit;
- no hole, brightness jump, or double-covered crown through the far-to-impostor boundary;
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

- the automated local gate passing;
- a real-GPU startup trace showing acceptable worst-frame bake cost;
- non-zero real-GPU impostor counts;
- all enabled species reporting four atlas variant pages;
- a clean orbit capture;
- a clean frozen far-to-impostor boundary capture;
- the live atlas lab showing clean albedo, normal, and depth channels for all enabled species.
