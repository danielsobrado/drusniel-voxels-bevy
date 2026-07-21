# Tree far-to-impostor wind parity

Status: draft implementation; native Dawn and headed validation pending.

Dependency chain:

```text
PR #278 record authority
  -> PR #289 baked-depth reprojection
    -> this wind-parity PR
```

Merge and squash in that order, retargeting each remaining PR to its new parent before final validation.

## Problem

WebGPU near, mid, and far tree meshes advance the shared tree-wind time and use deterministic world-space phase. The GPU ring impostor material had an empty `setTime()` and no wind position displacement.

A fixed tree therefore stopped moving when it entered the impostor band. During gusts, far and impostor representations could visibly disagree inside the crossfade.

## Combined position authority

```text
base impostor position
  -> versioned baked-depth reprojection from PR #289
  -> coherent wind displacement
  -> identical regular/debug/prepass position
```

Wind is added after depth so the reprojected trunk/crown volume moves as one coherent tree representation.

## Shared phase contract

The impostor path uses the same constants and equations as the current detailed WebGPU tree path:

```text
phase = fract(sin(dot(world_xz, vec2(127.1, 311.7))) * 43758.5453123)
time = time_seconds * wind_speed
wave = sin(time + phase * 6.2831853 + dot(world_xz, wind_direction) * 0.035)
gust = sin(time * 0.37 + phase * 12.9898)
```

The same YAML-backed settings provide enabled state, direction, strength, speed, gust strength, and trunk-sway strength. The same morphology record provides age and stiffness response.

## Current yaw authority

Both existing detailed tree paths apply wind before the random instance-yaw transform. This rotates the configured vector per tree.

That is not the desired final global-wind authority, but skipping the transform only for impostors would break far/impostor crossfade continuity. This PR deliberately matches current near/mid/far behavior.

A separate cross-path PR must move wind displacement into world space for CPU meshes, GPU ring meshes, impostors, and prepass together.

## Card deformation

A billboard has no branch hierarchy. The card therefore uses:

```text
height_weight = smoothstep(0, 1, treeHeight01)^2
```

This keeps the base fixed and bends the crown coherently. Displacement is multiplied by instance scale and morphology wind scale.

## Intentional flutter boundary

Far mesh leaf flutter is not applied as whole-card translation. Doing that would make the trunk vibrate at foliage frequency.

```text
tree_impostor_whole_card_flutter = 0
```

Fine foliage animation remains a future atlas/normal or UV-layer concern.

## Diagnostics

```text
tree_impostor_wind_active
tree_impostor_wind_phase_parity = 1
tree_impostor_wind_prepass_parity = 1
tree_impostor_whole_card_flutter = 0
```

The depth diagnostics inherited from PR #289 remain active in the same position graph. No gameplay readback is added.

## Required verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/trees/tree_impostor_wind.test.ts `
  src/trees/tree_impostor_wind_contract.test.ts `
  src/trees/tree_impostor_depth_reprojection_contract.test.ts `
  src/trees/tree_ring_impostor_node_material.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Dawn must compile regular, debug, and prepass position graphs with both level-zero depth sampling and wind uniforms.

## Headed acceptance

Use fixed oak, pine, birch, willow, and spruce identities at a frozen far-to-impostor boundary.

Capture matched WebGPU sequences for:

1. wind disabled;
2. steady wind with gust disabled;
3. gust peak;
4. opposite gust phase;
5. young/flexible and old/stiff morphology pairs;
6. regular color and prepass diagnostics;
7. debug LOD colors during a slow boundary crossing;
8. depth reprojection enabled and legacy flat-atlas controls.

Verify:

- the same identity does not freeze in the impostor band;
- far and impostor movement reverse at the same phase;
- displacement follows the same current yaw transform;
- depth shape remains attached while the tree sways;
- crossfade silhouettes stay close at steady and gust peaks;
- the card base remains fixed;
- stiff trees move less than flexible trees;
- regular, debug, and prepass silhouettes coincide;
- trunks do not vibrate at leaf-flutter frequency;
- disabling wind immediately stops movement;
- frame p95 regression stays within 3% beyond PR #289;
- no GPU readback is introduced.

## Honest boundary

This closes coherent trunk/crown sway across the current far-to-impostor transition. It does not close detailed foliage flutter, branch animation inside the texture, or the separate global wind-direction authority defect.

Card amplitude is height-anchored because a billboard has no branch hierarchy. Phase equality alone is not enough; headed evidence must validate amplitude and silhouette continuity.
