# Tree impostor baked-depth reprojection

Status: draft implementation; native Dawn and headed validation pending.

Dependency: PR #278 (`agent/tree-impostor-record-competition-authority`). Merge and squash #278 first, then retarget this branch to `main` before final validation.

## Problem

The impostor baker already stores tree-local normals in `normalDepth.rgb` and depth in `normalDepth.a`.

Runtime tree impostors used RGB for relighting but ignored alpha. Every baked tree therefore remained a flat four-vertex card for depth, prepass, and parallax even though the atlas carried usable geometry depth.

That produces the largest error at oblique and elevated views:

- crown and trunk layers collapse onto one plane;
- adjacent billboards intersect as cards instead of volumes;
- the far-mesh to impostor transition changes apparent depth;
- prepass depth disagrees with the baked tree structure;
- orbiting around a fixed tree exposes flat-card sliding.

## Authority after this PR

```text
centered age + structural-variant geometry
  -> octahedral bake frame
  -> signed depth along capture direction
  -> normalDepth.a encoded around 0.5
  -> coverage-weighted four-frame blend
  -> coverage-weighted age-layer blend
  -> live morphology-scaled depth vector
  -> identical color and prepass position
```

## Center-relative depth contract

Every age and variant source geometry is centered at the bake origin before capture.

The normal-depth pass encodes:

```text
capture_direction = normalize(camera_world_position)
relative_depth_m = dot(centered_world_position, capture_direction)
depth_extent_m = (far_m - near_m) / 4
encoded_depth = clamp(relative_depth_m / depth_extent_m * 0.5 + 0.5, 0, 1)
```

Runtime decodes:

```text
relative_depth_m = (encoded_depth * 2 - 1) * depth_extent_m
```

This is independent of the per-layer camera distance, so younger or smaller variant layers do not require additional metadata and cannot inherit an offset from the largest species layer.

## Runtime sampling

Depth uses the same contracts as albedo and normals:

- the same octahedral view encoding;
- the same four neighboring frames;
- coverage-weighted frame blending;
- the same structural variant page;
- the same three age layers and interpolation bands.

Empty or weak-coverage texels fade toward zero displacement. Missing normal-depth atlases fail open to the unchanged flat card.

## Live morphology parity

Decoded depth is transformed by the same runtime dimensions as the visible card:

- instance scale;
- age height scale;
- age radius scale;
- crown width;
- crown flattening by vertex height;
- instance yaw.

The resulting position node is shared by the color material and vegetation prepass.

## Geometry budget

Only baked WebGPU impostor cards are tessellated.

```text
before: 4 vertices, 2 triangles
now:    16 vertices, 18 triangles
```

The card remains below the existing 240-vertex impostor budget. Far meshes, placeholders, unbaked fallbacks, CPU patch geometry, and crown-proxy shadows are unchanged.

## Diagnostics

```text
tree_impostor_depth_reprojection_active
tree_impostor_depth_prepass_parity
```

Both counters are `1` only when the selected baked atlas has normal-depth data.

## Required verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/trees/tree_impostor_depth_contract.test.ts `
  src/trees/tree_impostor_depth_geometry.test.ts `
  src/trees/tree_impostor_depth_reprojection_contract.test.ts `
  src/trees/tree_impostor_baker.test.ts `
  src/trees/tree_impostor_capture_material.test.ts `
  src/trees/tree_ring_impostor_node_material.test.ts `
  src/trees/tree_impostor_atlas_pixels.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Dawn must compile the regular, debug, and prepass TSL graphs with vertex-stage atlas sampling enabled.

## Headed acceptance

Use fixed identities for oak, pine, birch, willow, and spruce in deterministic WebGPU poses.

Capture:

1. ground-level orbit at impostor distance;
2. elevated orbit looking down through the crown;
3. dense overlapping impostor forest;
4. frozen far-to-impostor boundary;
5. depth/prepass diagnostic view;
6. depth reprojection disabled control from the parent branch.

Verify:

- trunk and crown depth no longer collapse onto one card plane;
- orbiting does not produce depth sliding or inverted relief;
- elevated views do not pull crowns toward the camera incorrectly;
- color and prepass silhouettes remain coincident;
- the far-to-impostor boundary does not gain holes or double surfaces;
- fallback atlases remain unchanged;
- frame p95 regression stays within 5%;
- no GPU readback is introduced.

## Honest boundary

This is low-tessellation vertex reprojection, not per-fragment depth writing or a full volumetric impostor. Fine branch depth remains limited by the 3x3-cell card grid and atlas resolution.

Far and impostor shadows continue to use the existing crown proxies. WebGL runtime impostors do not consume the new depth; only WebGL bake encoding is kept compatible with the atlas contract.

Do not hide inverted depth, prepass mismatch, or excessive cost by reducing the depth extent, disabling normal-depth, widening LOD transition bands, or lowering acceptance thresholds.
