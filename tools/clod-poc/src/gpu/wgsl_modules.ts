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
import dressingBindings from "./shaders/terrain_field_bindings_dressing.wgsl?raw";
import dressingEntry from "../ecology/dressing/gpu/dressing.compute.wgsl?raw";
import vegetationAuthorityPcg from "../vegetation/gpu_authority/pcg2d.wgsl?raw";
import vegetationAuthorityHash from "../vegetation/gpu_authority/shaders/hash.wgsl?raw";
import vegetationTerrainSampling from "../vegetation/gpu_authority/terrain_sampling.wgsl?raw";
import { TREE_SPECIES } from "../trees/tree_config.js";
import { TREE_CROWN_PROXY_INDEX_COUNT } from "../trees/tree_crown_proxy_contract.js";
import { TREE_RING_SHADOW_CASCADE_COUNT } from "../trees/tree_ring_shadow_casters.js";
import { TREE_RING_INSTANCE_VEC4S } from "../trees/tree_ring_placement.js";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { applyTreeRingSpeciesWgslExpansion } from "./tree_ring_species_wgsl_expansion.js";
import { applyTreeRingWgslLayoutConstants } from "./tree_ring_wgsl_layout.js";
import { composeShader } from "./wgsl_compose.js";
import { replaceConstU32 } from "./wgsl_workgroup_size.js";
import { withConservativeGrassFrustum, withGrassActiveSlotList } from "./grass_ring_wgsl_transforms.js";
import { withGrassSunVisibility } from "./grass_sun_visibility_wgsl_transform.js";
import { withUnderstoryCanopyEcology } from "./understory_canopy_ecology_wgsl_transform.js";
import { withUnderstoryAuthorityExclusion } from "./understory_ring_wgsl_transforms.js";
import { withUnderwaterRiverCobbles } from "./stone_river_cobble_wgsl_transform.js";
import { withGravelBarStones } from "./stone_bar_field_transform.js";
import { withGravelBarFieldSampling } from "./stone_bar_field_gate_transform.js";
import { withStoneGrassContactPatches } from "./stone_contact_patch_wgsl_transform.js";
import { withRiverEcologyConstants } from "./wgsl_river_ecology_transforms.js";
import {
  withTreeCrownProxyShadowIndexCount,
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

/** Overwrite the WGSL per-record stride from the TS source of truth so the compute writer's
 *  record width cannot drift from the material readers' stride (tree_ring_placement.ts). */
export function withTreeInstanceStride(source: string): string {
  return source.replace(
    /const TREE_INSTANCE_VEC4S: u32 = \d+u;/,
    `const TREE_INSTANCE_VEC4S: u32 = ${TREE_RING_INSTANCE_VEC4S}u;`,
  );
}

const placementHeight = withPlacementExcludedHeight(placementHeightSource);

export { withTreePcgHash } from "./tree_ring_wgsl_transforms.js";

export function composeTerrainFieldShader(): string {
  return composeShader("terrain field shader", [terrainBindings, terrainCommon, terrainEntry]);
}

export function composeGrassRingShader(): string {
  const ringEntry = withGrassActiveSlotList(withConservativeGrassFrustum(grassRingEntry));
  const grassEntry = withGrassSunVisibility(withRiverEcologyConstants(ringEntry));
  return composeShader("grass ring shader", [grassBindings, terrainCommon, vegetationTerrainSampling, placementHeight, grassEntry]);
}

export function composeStoneScatterShader(): string {
  const riverEntry = withUnderwaterRiverCobbles(withRiverEcologyConstants(stoneScatterEntry));
  const gravelEntry = withGravelBarStones(riverEntry);
  const fieldEntry = withGravelBarFieldSampling(gravelEntry);
  const stoneEntry = withStoneGrassContactPatches(fieldEntry);
  return composeShader("stone scatter shader", [stoneBindings, terrainCommon, vegetationTerrainSampling, placementHeight, stoneEntry]);
}

export function composeTreeRingShader(workgroupSize = 64): string {
  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);
  const baseTreeEntry = withTreeTerrainVisibilityCull(
    withTreeShadowLodGate(
      withTreeSharedPcgModule(
        withTreePcgHash(
          withTreeFinalPlacementHeight(
            withRiverEcologyConstants(treeRingEntry),
          ),
        ),
      ),
    ),
  );
  const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length);
  const crownProxyTreeEntry = withTreeCrownProxyShadowIndexCount(
    expandedTreeEntry,
    TREE_CROWN_PROXY_INDEX_COUNT,
  );
  const treeEntry = replaceConstU32(
    applyTreeRingWgslLayoutConstants(crownProxyTreeEntry, treeLayout),
    "TREE_WORKGROUP_SIZE",
    workgroupSize,
  );
  return composeShader("tree ring shader", [vegetationAuthorityPcg, vegetationAuthorityHash, treeBindings, terrainCommon, vegetationTerrainSampling, placementHeight, withTreeInstanceStride(treeEntry)]);
}

export function composeUnderstoryRingShader(workgroupSize = 64): string {
  const entry = replaceConstU32(
    withUnderstoryCanopyEcology(
      withUnderstoryAuthorityExclusion(withRiverEcologyConstants(understoryRingEntry)),
    ),
    "UNDERSTORY_WORKGROUP_SIZE",
    workgroupSize,
  );
  return composeShader("understory ring shader", [vegetationAuthorityPcg, vegetationAuthorityHash, understoryBindings, terrainCommon, vegetationTerrainSampling, placementHeight, entry]);
}

export function composeDressingGpuShader(workgroupSize = 64): string {
  const entry = replaceConstU32(
    withRiverEcologyConstants(dressingEntry),
    "DRESSING_WORKGROUP_SIZE",
    workgroupSize,
  );
  return composeShader("dressing GPU authority shader", [
    vegetationAuthorityPcg,
    vegetationAuthorityHash,
    dressingBindings,
    terrainCommon,
    vegetationTerrainSampling,
    placementHeight,
    entry,
  ]);
}
