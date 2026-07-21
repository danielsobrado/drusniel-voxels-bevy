# Tree Crown Proxy Morphology Alignment

Status: draft implementation; native and headed verification pending.

## Problem

Crown lighting and shadow proxies already consumed the accepted tree morphology record for width, flattening, density, health, lean, and crown bias. Their offset math was still inconsistent with the visible crown:

- both bias axes used the base X radius;
- crown bias ignored the instance crown-width scale;
- lean used the unmorphed base center height;
- older or wider asymmetric crowns could therefore move away from their proxy ellipsoid.

This is most visible for broad, irregular crowns and strongly leaning old trees as a detached or undersized far shadow.

## Fixed formula

The CPU oracle and TSL material now use the same morphed dimensions:

```text
morphed_radius_x = base_radius_x * crown_width
morphed_radius_z = base_radius_z * crown_width
morphed_center_y = base_center_y * age_height_scale

offset_x = crown_bias_x * morphed_radius_x
         + lean_x * morphed_center_y * 0.49

offset_z = crown_bias_z * morphed_radius_z
         + lean_z * morphed_center_y * 0.49
```

The final local offset is rotated by instance yaw and scaled by the tree instance scale exactly once.

## Scope

This change:

- corrects per-axis crown-bias scaling;
- includes crown width in proxy bias displacement;
- includes age-height scaling in lean displacement;
- keeps proxy radius, height, density, retention, fade, and identity dither unchanged;
- adds numeric CPU tests and TSL source contracts.

This change does not:

- change the tree morphology record;
- change candidate acceptance or competition derivation;
- change visible tree geometry;
- change shadow cascade selection;
- change proxy tessellation, density thresholds, or LOD distances;
- overlap water, dressing, custom-prop, or large-prop work.

## Native verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/trees/tree_crown_proxy_morphology.test.ts `
  src/trees/tree_crown_proxy_node_material.test.ts `
  src/gpu/tree_ring_crown_proxy_shadow_contract.test.ts `
  src/trees/tree_system_gpu_ring_crown_proxy.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Use fixed old/wide/leaning oak, birch, willow, and pine identities at far and impostor distances.

Verify:

- proxy centers remain inside visible crowns from all azimuths;
- asymmetric X/Z crowns no longer use the wrong axis radius;
- shadow silhouettes follow wide and narrow morphology changes;
- old-tree height scaling does not detach proxy centers vertically;
- yaw rotation is applied once;
- root positions and visible tree geometry are unchanged;
- proxy draw count, readback count, and frame p95 do not regress;
- crown proxy shadow cost remains within the existing budget.

The PR remains draft until native tests and headed captures pass. Do not hide misalignment by increasing proxy radii or shadow softness.
