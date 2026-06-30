# clod-poc tree parity status

Status: In progress.

This status note tracks the implementation state for `docs/plans/clod-poc-trees-parity-plan.md`.

## Completed or mostly implemented

- TREE-1 WebGPU render-to-atlas baker: the baker now uses generic render-target renderer methods instead of the old WebGL `getContext()` gate.
- TREE-2 Normal+depth atlas channel: `TreeImpostorAtlas` carries albedo, normalDepth, radius, and centerY; the baker emits both albedo and normal/depth targets.
- TREE-3 Bake-config parity: impostors default to enabled, `bakeOnStart=true`, grid size 8, resolution 128, with a documented VRAM budget.
- TREE-4 Baked atlas geometry in GPU ring: `selectTreeGpuRingGeometry` selects baked impostor geometry when the species atlas is ready and falls back to the procedural card otherwise.
- TREE-5 Relit, 4-tile-blended ring impostor material: `tree_ring_impostor_node_material.ts` samples four octahedral atlas tiles, blends albedo/coverage/normal, sqrt-decodes albedo, and relights through the sun/hemispheric model.
- TREE-6 Crossfade continuity: `tree_lod_crossfade.ts` adds the pure far-to-impostor dither contract and `tree_lod_crossfade.test.ts` verifies complementary keep masks across the boundary.
- TREE-11 acceptance contract: `tree_impostor_acceptance.ts` defines litness, view-blend, near/impostor color, boundary hole/double-draw, and perf-speedup gates; `tree_impostor_acceptance.test.ts` and `visualHonesty.test.ts` cover the contract.

## TREE-7 current state

Implemented:

- `tree_ring_shadow_casters.ts` defines the per-cascade caster group layout, fixed cascade/frustum-plane packing, and cascade-plane extraction from `THREE.Camera`.
- `tree_ring_shadow_casters.ts` includes CPU-side caster cascade selection and per-(cascade,species,lod) group count helpers for parity checks.
- `tree_ring_shadow_casters.test.ts` verifies cascade plane packing, cascade selection, group counts, and per-group overflow clamping.
- `tree_system_gpu_ring_draw.ts` can allocate optional `shadowCell` and `shadowIndirect` GPU buffers for per-cascade caster lists.
- `tree_ring.compute.wgsl` has shadow counters, shadow indirect args, shadow-cell output, cascade frustum checks, and appends tree casters before visible camera frustum culling.
- `tree_ring_compute.ts` binds the shadow buffers, packs shadow cascade planes into the WGSL uniform layout, builds shadow indirect args, disables shadow writes unless real output buffers are available, and reads back shadow caster counters under the debug/validation gate.
- `realtime_sun_shadows.ts` exposes active sun shadow cascade cameras and assigns each cascade a dedicated shadow-only caster layer.
- `tree_system_gpu_ring_draw.ts` includes a tested `createTreeGpuRingShadowMesh(...)` helper for cascade-layered shadow-only ring meshes.
- `tree_system_gpu_ring_resources.ts` owns GPU-ring draw resource creation after the SOLID split, including visible meshes, shadow-only meshes, shadow buffers, and crown-proxy shadow materials.
- `tree_ring_lighting_proxies.ts` now mirrors the shader order for validation: shadow casters are counted before visible-camera frustum culling, while visible groups remain camera-frustum culled.
- `tree_system_gpu_ring_runtime.ts` validates both visible LOD counts and shadow caster group counts when `debugValidateAgainstCpu` is enabled.
- `TreeStats`, `perf_probe.ts`, and `render_phase.ts` expose `gpuShadowCasterCount` / `gpuShadowOverflowed` and perf summary counters for shot evidence.

Still required before calling TREE-7 complete:

- Run `npm --prefix tools/clod-poc run trees:wire-parity:check` and confirm no pending generated rewrites.
- Run `npm --prefix tools/clod-poc run typecheck` and `npm --prefix tools/clod-poc test`.
- Capture a low-sun shot proving off-screen trees can still cast and archive perf JSON with non-zero `treeGpuShadowCasterCountAvg`.

## TREE-8 current state

Implemented:

- `tree_crown_proxy_math.ts` provides fitted species crown dimensions, ellipsoid source geometry, edge keep probability, and impostor-band fade math.
- `tree_crown_proxy_math.test.ts` covers broad oak crowns, tall pine crowns, sparse dead-tree proxies, edge falloff, and impostor-boundary fade.
- `tree_crown_proxy_node_material.ts` provides a WebGPU/TSL crown proxy material handle using GPU ring storage cells, ellipsoid placement, world/screen anchored dither, crown-edge falloff, and numeric impostor fade masks.
- `tree_crown_proxy_node_material.test.ts` covers material construction and source-level placement/mask contract.
- `tree_system_gpu_ring_resources.ts` uses crown proxy geometry/materials for far/impostor shadow-only meshes after the SOLID split.
- `npm --prefix tools/clod-poc run trees:wire-shadow-proxies` applies TREE-7 then TREE-8 in the required order for older local checkouts.

Still required before calling TREE-8 complete:

- Run `npm --prefix tools/clod-poc run trees:wire-parity:check`, `npm --prefix tools/clod-poc run typecheck`, and `npm --prefix tools/clod-poc test`.
- Capture noon forest-interior and impostor-boundary shadow shots.

## TREE-9 current state

Implemented:

- `tree_species_expansion.ts` defines the six target species contract: oak, pine, dead, birch, willow, spruce.
- `tree_config.ts` uses the expanded species union, defaults, parser, clone logic, and ecology zones.
- `tree_material_bias.ts`, `tree_material_bias.test.ts`, `config/trees.yaml`, and `tree_species_expansion_config.test.ts` are six-species-ready.
- `tree_instances.ts` selects ecology species by iterating all `TREE_SPECIES`; it no longer hardcodes only oak/pine/dead.
- `tree_ecology.ts` applies `oldForestBias` to every species, not only dead trees.
- `tree_ring_species_layout.ts` defines dynamic GPU ring layout offsets for 6 species x 4 LOD groups.
- `tree_ring_compute.ts` packs species weights, group counts, material vectors, and planes through the dynamic layout helper.
- `tree_ring.compute.wgsl` uses `TREE_SPECIES_COUNT = 6`, six species material vectors, two species-weight vec4s, six index-count vec4s, 24 visible groups, and six-way species selection.
- `wgsl_modules.ts` composes the runtime browser shader through the same six-species expansion/layout path.
- `tree_species_expansion.test.ts` verifies the six-species list, YAML overrides, runtime generation coverage, GPU group counts, morphology differences, and ecology niche preferences.
- `tree_ring_shader_species.test.ts` guards the raw six-species WGSL contract.
- `tree_ring_species_wgsl_expansion.test.ts` guards both the expansion helper and final `composeTreeRingShader(...)` output.

Still required before calling TREE-9 complete:

- Run `npm --prefix tools/clod-poc run typecheck` and `npm --prefix tools/clod-poc test`.
- Run `npm --prefix tools/clod-poc run trees:wire-parity:check` and confirm it reports no pending rewrites.
- Capture the ecology-sorted species gallery shot.

## TREE-10 current state

Implemented:

- `tree_hero_fidelity.ts` adds a 100k-triangle TREE-10 near-ring hero floor contract and helpers to count total near-tree triangles, foliage triangles, min/average triangles per near tree, and pass/fail flags.
- `tree_hero_fidelity.test.ts` covers triangle counting, foliage-mask counting, visible-near-only aggregation, GPU-ring group-count estimation, and empty-shot failure.
- `tree_geometry_variants.test.ts` now includes a static near-geometry guard: every leafy species/variant must have real foliage triangles and a conservative triangle floor before any visual shot runs.
- `TreeStats` now carries hero near-tree triangle counters and pass/fail flags.
- `tree_system_runtime_stats.ts` computes TREE-10 hero fidelity stats from visible CPU patches and estimates them for GPU ring stats from near group counts when readback is available.
- If GPU group counts are not available yet, the GPU-ring TREE-10 path falls back to aggregate near count multiplied by average near geometry cost, so WebGPU perf JSON no longer reports zero hero fidelity counters.
- `perf_probe.ts` and `render_phase.ts` include TREE-10 counters in perf samples and summaries, so shot/perf JSON can archive `treeHeroNearTrianglesAvg`, `treeHeroNearFoliageTrianglesAvg`, min per-tree triangles, and pass-frame counts.

Still required before calling TREE-10 complete:

- Run typecheck/tests.
- Capture the hero forest bookmark shot/perf run and archive the stats JSON.
- Verify the archived shot reports `treeHeroNearTrianglesAvg >= 100000` and non-zero `treeHeroNearFoliageTrianglesAvg`.
- If the shot misses the floor, raise near-tree grammar/leaf detail and rerun the same bookmark A/B.

## TREE-12 current state

Implemented:

- `tree_parity_evidence.ts` provides a generic manifest-driven evidence validator for required screenshot/stats/perf artifacts and metric thresholds.
- `tree_parity_evidence.test.ts` covers pass/fail cases, missing artifacts, metric floors, and unreadable JSON.
- `tools/verify-tree-parity-evidence.ts` exposes the validator as a CLI.
- `config/tree-parity-evidence.yaml` defines the current TREE-7/8/9/10/11 evidence contract without hardcoding paths or thresholds in code.
- `npm --prefix tools/clod-poc run trees:verify-parity-evidence` runs the evidence gate after local real-GPU captures are archived under the manifest paths.

Still required before calling TREE-12 complete:

- Run typecheck/tests.
- Capture the configured artifacts under `shots/tree-parity/latest` and `perf-runs/tree-parity/latest`.
- Run `npm --prefix tools/clod-poc run trees:verify-parity-evidence` and archive the PASS output.

## Still required before calling Epic A+B closed

- Run `npm --prefix tools/clod-poc test`.
- Run `npm --prefix tools/clod-poc run typecheck`.
- Run the server-first shot/perf harness for the WebGPU path with impostors enabled.
- Capture slow dolly-out and frozen-boundary shots to confirm no far/impostor pop, holes, or double-draw.
- Run `npm --prefix tools/clod-poc run trees:verify-parity-evidence` after captures.
- Feed real screenshot/perf measurements into the TREE-11 acceptance contract.

## Next implementation order

1. Local generated rewrite check: `npm --prefix tools/clod-poc run trees:wire-parity:check`.
2. Run typecheck/tests.
3. Capture TREE-7/TREE-8/TREE-9/TREE-10/TREE-11 evidence shots and perf JSON.
4. Run `npm --prefix tools/clod-poc run trees:verify-parity-evidence`.
5. TREE-12 closeout docs and evidence links.
