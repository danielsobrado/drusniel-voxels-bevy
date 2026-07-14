# Forest lighting parity verification

## Rendering contract

The WebGPU forest presentation now separates three jobs:

1. Tree and understory materials provide directional sun, low hemispheric ambient light, restrained foliage transmission, and forest AO/shadow darkening.
2. The Hillaire atmosphere provides long-distance sky and aerial perspective.
3. The froxel volume owns local fog and canopy-filtered sun shafts.

Material shaders must not paint a pale forest-fog overlay onto trees. God rays must come from depth-aware volumetric scattering with canopy and terrain visibility.

## Automated gate

Run from the repository root:

```bash
npm --prefix tools/clod-poc run lighting:verify
```

This runs strict TypeScript, the focused lighting/froxel/config/impostor tests, and the production build.

## Real-GPU gate

Start CLOD-POC:

```bash
npm --prefix tools/clod-poc run dev
```

Open the normal WebGPU forest path:

```text
http://127.0.0.1:5173/?world=8&treeGpu=1&webgpuSelection=1&froxels=1&godRays=volumetric
```

Use a sun elevation between 25 and 35 degrees for the strongest shaft inspection. At the default 55-degree elevation, shafts should remain present but subtle; a noon forest must not look like permanent theatrical fog.

Useful ablations:

```text
&froxels=0
&bloom=0
&contactShadows=0
&froxelDebug=density
&froxelDebug=transmittance
&froxelDebug=scatter
```

## Acceptance

A passing result requires:

- dark values remain dark below a closed canopy;
- directly lit leaves and trunks are clearly warmer and brighter than ambient surfaces;
- dry terrain is mostly clear rather than covered by uniform grey fog;
- fog density increases around moist lowlands and water-adjacent ground;
- shafts align with canopy openings and the current sun direction;
- shafted fog is bright while canopy-shadowed fog stays subdued;
- no pale material tint appears when the froxel volume is disabled;
- near, far, and impostor tree tiers retain similar exposure through LOD transitions;
- bloom catches bright sun and shaft highlights without lifting the entire forest;
- the WebGPU frame time remains acceptable with froxels enabled.

## Performance evidence

Record at least these two captures using the same camera and sun:

1. `froxels=0`
2. `froxels=1&godRays=volumetric`

Archive frame p50, p95, and worst-frame timing together with screenshots. Visual parity is not complete until the real-GPU capture confirms both the contrast improvement and acceptable cost.
