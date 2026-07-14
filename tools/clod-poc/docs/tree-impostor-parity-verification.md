# Tree impostor parity verification

## What changed

The tree impostor path now uses the same source appearance contract as live trees:

- bark synthesis is included in albedo capture;
- foliage cluster-card coverage is applied to albedo and normal-depth captures;
- albedo, normals, and depth are dilated independently inside each octahedral tile;
- transparent coverage remains unchanged while RGB and normal-depth edge data are filled for safe filtering and mipmaps;
- CPU tree instances, GPU mesh LODs, and impostor atlas pages use the same world-space structural-variant selector;
- GPU near, mid, far, and impostor rings use complementary material-side dither during compute overlap bands;
- an opt-in live atlas lab exposes every baked species and channel inside the actual world scene.

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

- no black or grey fringe around foliage at distant mip levels;
- no colour or normal bleed between octahedral tiles or variant pages;
- matching crown silhouette and colour between the source mesh and billboard;
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
- non-zero real-GPU impostor counts;
- a clean orbit capture;
- a clean frozen far-to-impostor boundary capture;
- the live atlas lab showing clean albedo, normal, and depth channels for all enabled species.
