import { VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_THRESHOLD_M } from "../vegetation/gpu_authority/constants.js";
import terrainBindings from "./shaders/terrain_field_bindings_terrain.wgsl?raw";
import terrainCommon from "./shaders/terrain_field_common.wgsl?raw";
import placementHeightSource from "./shaders/placement_height.wgsl?raw";
import terrainEntry from "./shaders/terrain_field_entry.wgsl?raw";
import grassBindings from "./shaders/terrain_field_bindings_grass.wgsl?raw";
import grassRingEntry from "./shaders/grass_ring.compute.wgsl?raw";
import stoneBindings from "./shaders/terrain_field_bindings_stone.wgsl?raw";
import stoneScatterEntry from "./shaders/stone_scatter.compute.wgsl?raw";
import treeBindings from "./shaders/terrain_field_bindings_tree.wgsl?raw";
import treeRingEntry from "./shaders/tree_ring.compute.wgsl?raw";
import understoryBindings from "./shaders/terrain_field_bindings_understory.wgsl?raw";
import understoryRingEntry from "./shaders/understory_ring.compute.wgsl?raw";
import vegetationAuthorityPcg from "../vegetation/gpu_authority/pcg2d.wgsl?raw";
import vegetationAuthorityHash from "../vegetation/gpu_authority/shaders/hash.wgsl?raw";
import vegetationTerrainSampling from "../vegetation/gpu_authority/terrain_sampling.wgsl?raw";
import { TREE_SPECIES } from "../trees/tree_config.js";
import { TREE_RING_SHADOW_CASCADE_COUNT } from "../trees/tree_ring_shadow_casters.js";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { applyTreeRingSpeciesWgslExpansion } from "./tree_ring_species_wgsl_expansion.js";
import { applyTreeRingWgslLayoutConstants } from "./tree_ring_wgsl_layout.js";
import { composeShader } from "./wgsl_compose.js";
import { replaceConstU32 } from "./wgsl_workgroup_size.js";
import { withConservativeGrassFrustum, withGrassActiveSlotList } from "./grass_ring_wgsl_transforms.js";
import { withUnderstoryAuthorityExclusion } from "./understory_ring_wgsl_transforms.js";
import { withUnderwaterRiverCobbles } from "./stone_river_cobble_wgsl_transform.js";
import { withRiverEcologyConstants } from "./wgsl_river_ecology_transforms.js";
import {
  withTreeFinalPlacementHeight,
  withTreePcgHash,
  withTreeSharedPcgModule,
  withTreeShadowLodGate,
  withTreeTerrainVisibilityCull,
} from "./tree_ring_wgsl_transforms.js";

export function withPlacementExcludedHeight(source: string): string {
  return source.replace(
    /const PLACEMENT_EXCLUDED_HEIGHT_THRESHOLD_M: f32 = -?\d+(?:\.\d+)?;/,
    `const PLACEMENT_EXCLUDED_HEIGHT_THRESHOLD_M: f32 = ${VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_THRESHOLD_M}.0;`,
  );
}

const placementHeight = withPlacementExcludedHeight(placementHeightSource);

export { withTreePcgHash } from "./tree_ring_wgsl_transforms.js";

export function composeTerrainFieldShader(): string {
  return composeShader("terrain field shader", [terrainBindings, terrainCommon, terrainEntry]);
}

export function composeGrassRingShader(): string {
  const grassEntry = withGrassActiveSlotList(withConservativeGrassFrustum(grassRingEntry));
  return composeShader("grass ring shader", [grassBindings, terrainCommon, vegetationTerrainSampling, placementHeight, withRiverEcologyConstants(grassEntry)]);
}

export function composeStoneScatterShader(): string {
  const stoneEntry = withUnderwaterRiverCobbles(withRiverEcologyConstants(stoneScatterEntry));
  return composeShader("stone scatter shader", [stoneBindings, terrainCommon, vegetationTerrainSampling, placementHeight, stoneEntry]);
}

export function composeTreeRingShader(workgroupSize = 64): string {
  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);
  const baseTreeEntry = withTreeTerrainVisibilityCull(withTreeShadowLodGate(withTreeSharedPcgModule(withTreePcgHash(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry))))));
  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);
  const treeEntry = replaceConstU32(
    applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout),
    "TREE_WORKGROUP_SIZE",
    workgroupSize,
  );
  return composeShader("tree ring shader", [vegetationAuthorityPcg, vegetationAuthorityHash, treeBindings, terrainCommon, vegetationTerrainSampling, placementHeight, treeEntry]);
}

export function composeUnderstoryRingShader(workgroupSize = 64): string {
  const entry = replaceConstU32(
    withUnderstoryAuthorityExclusion(withRiverEcologyConstants(understoryRingEntry)),
    "UNDERSTORY_WORKGROUP_SIZE",
    workgroupSize,
  );
  return composeShader("understory ring shader", [understoryBindings, terrainCommon, vegetationTerrainSampling, placementHeight, entry]);
}
