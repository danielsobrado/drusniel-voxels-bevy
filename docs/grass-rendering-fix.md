# Grass Rendering Stripe Artifact Fix

Document status (2026-05-17): historical implementation/debug note; preserve for context, but verify current behavior in code.

## Issue Description & Symptoms
- Grass rendered in obvious rows/stripes with aligned shadows, breaking natural randomness.
- Pattern most visible looking across flat terrain where triangles share similar `z` values.
- Naga debug logs appeared during shader validation but were informational, not the cause.

## Root Cause (with code)
- Grass instance sampling seeded randomness per triangle using truncated summed positions:
```rust
// Before (collect_grass_instances)
let seed_x = (v0.x + v1.x + v2.x) as i32;
let seed_z = (v0.z + v1.z + v2.z) as i32;

for i in 0..blade_count {
    let r1 = simple_hash(seed_x + i as i32 * 3, seed_z + i as i32 * 5).sqrt();
    let r2 = simple_hash(seed_x + i as i32 * 7, seed_z + i as i32 * 11);
    // ...
}
```
- Adjacent triangles along rows shared nearly identical integer `seed_z` values, so the hash inputs repeated, producing correlated blade placement (striping).

## Complete Solution (before/after)
```rust
// After (collect_grass_instances)
for (tri_idx, tri) in indices.chunks(3).enumerate() {
    let centroid = (v0 + v1 + v2) / 3.0;
    let seed_base_bits = centroid.x.to_bits()
        .wrapping_mul(73856093)
        ^ centroid.z.to_bits().wrapping_mul(19349663)
        ^ centroid.y.to_bits().wrapping_mul(83492791)
        ^ (tri_idx as u32).wrapping_mul(2654435761);
    let seed_base = seed_base_bits as i32;

    for i in 0..blade_count {
        let blade_jitter = (i as u32).wrapping_mul(97531) as i32;
        let hash_a = seed_base.wrapping_add(blade_jitter).wrapping_mul(1597334677);
        let hash_b = seed_base.wrapping_sub(blade_jitter.rotate_left(13)).wrapping_mul(374761393);
        let r1 = simple_hash(hash_a, hash_b).sqrt();
        let r2 = simple_hash(hash_b.wrapping_mul(17), hash_a.wrapping_mul(31));
        // ...
    }
}
```
- Uses full float bit patterns and triangle index to decorrelate seeds.
- Adds per-blade jitter mixed into the hash inputs.
- Preserves deterministic distribution while eliminating striping.

## Debug Process & Findings
1. Observed world rendering: rows/stripes aligned with terrain grid.
2. Inspected grass instance generation in `collect_grass_instances`; noticed integer truncation of triangle sums and repeated seeds.
3. Confirmed shader (`assets/shaders/grass.wgsl`) only drives wind/lighting; unlikely to create placement stripes.
4. Verified hash usage and determined better seeding was needed; implemented bit-mixed centroid seed with triangle index and blade jitter.

## System Architecture Overview (grass)
- Mesh sampling: `collect_grass_instances` walks chunk mesh triangles, rejects tiny/steep faces, and scatters blades based on area.
- Instancing: `build_grass_patch_mesh` builds a combined mesh per chunk from a blade template and per-instance transforms.
- Rendering: Grass uses a custom WGSL wind shader (`assets/shaders/grass.wgsl`) and per-chunk grass materials for color variety.
- Materials: Variations are picked deterministically from chunk position.

## Configuration Details
- Density and limits: `collect_grass_instances` called with `density = 20` blades/m² and `max_count = 2000` per chunk.
- Blade template/materials: Created in `setup_grass_patch_assets`; colors/wind params set in `GrassMaterial`.
- Hashing: `simple_hash` provides deterministic pseudo-random values for placement and variation.

## Related Files
- `src/vegetation/mod.rs` — grass instance generation, mesh build, material selection.
- `assets/shaders/grass.wgsl` — grass vertex/fragment shading (wind, lighting, color blend).

## Future Improvement Suggestions
- Add blue-noise or Poisson-disc jitter per triangle to further reduce clustering.
- Vary density based on biome/height map for more natural coverage.
- Introduce per-chunk seed exposed via config to allow user-tunable randomness.
- Add a small normal-based bend variation to break up uniform silhouettes.
- Consider GPU-driven instance generation for larger draw distances.
