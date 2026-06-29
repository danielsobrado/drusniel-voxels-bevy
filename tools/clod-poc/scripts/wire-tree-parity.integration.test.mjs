import { describe, expect, it } from "vitest";
import treeSystemSource from "../src/trees/tree_system_runtime.ts?raw";
import treeSystemAssetsSource from "../src/trees/tree_system_assets_runtime.ts?raw";
import treeGpuRingResourcesSource from "../src/trees/tree_system_gpu_ring_resources.ts?raw";
import wgslModulesSource from "../src/gpu/wgsl_modules.ts?raw";
import treeConfigSource from "../src/trees/tree_config.ts?raw";
import { wireTreeSystemTree7Source } from "./wire-tree-system-tree7-shadows.mjs";
import { wireTreeSystemTree8Source } from "./wire-tree-system-tree8-proxies.mjs";
import { wireTreeRingWgslExpansionSource } from "./wire-tree-ring-wgsl-expansion.mjs";
import { wireTreeConfigTree9Source } from "./wire-tree-config-tree9-species.mjs";

const TREE7_EDIT_COUNT = 11;
const TREE8_EDIT_COUNT = 6;
const WGSL_EDIT_COUNT = 2;
const CONFIG_EDIT_COUNT = 10;

describe("tree parity wiring against current source", () => {
  it("applies TREE-7 then TREE-8 to the live tree_system source", () => {
    const tree7 = wireTreeSystemTree7Source(treeSystemSource);
    const tree8 = wireTreeSystemTree8Source(tree7.source);

    expect(tree7.applied.length + tree7.skipped.length).toBe(TREE7_EDIT_COUNT);
    expect(tree8.applied.length + tree8.skipped.length).toBe(TREE8_EDIT_COUNT);
    expect(tree8.source).toContain("createTreeSystemGpuRingDrawResources");
    expect(treeGpuRingResourcesSource).toContain("createTreeGpuRingDrawBuffers");
    expect(treeGpuRingResourcesSource).toContain("createTreeGpuRingShadowMesh");
    expect(treeGpuRingResourcesSource).toContain("createGpuRingShadowTierDraw");
    expect(treeSystemAssetsSource).toContain("readonly crownProxyGeometry = createTreeCrownProxyGeometry()");
    expect(treeGpuRingResourcesSource).toContain("createTreeCrownProxyNodeMaterialHandle(input.settings, buffers, species, lod)");
    expect(treeGpuRingResourcesSource).toContain("TREE_GPU_RING_SHADOW_GROUP_COUNT");

    const tree7Again = wireTreeSystemTree7Source(tree8.source);
    const tree8Again = wireTreeSystemTree8Source(tree7Again.source);
    expect(tree7Again.changed).toBe(false);
    expect(tree8Again.changed).toBe(false);
  });

  it("applies TREE-9 WGSL composer wiring to the live shader composer source", () => {
    const result = wireTreeRingWgslExpansionSource(wgslModulesSource);

    expect(result.applied.length + result.skipped.length).toBe(WGSL_EDIT_COUNT);
    expect(result.source).toContain("applyTreeRingSpeciesWgslExpansion");
    expect(result.source).toContain("const baseTreeEntry = withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry))");
    expect(result.source).toContain("const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length)");
    expect(result.source).toContain("applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout)");

    const again = wireTreeRingWgslExpansionSource(result.source);
    expect(again.changed).toBe(false);
  });

  it("applies TREE-9 six-species config wiring to the live tree_config source", () => {
    const result = wireTreeConfigTree9Source(treeConfigSource);

    expect(result.applied.length + result.skipped.length).toBe(CONFIG_EDIT_COUNT);
    expect(result.source).toContain("type TreeExpandedSpeciesId");
    expect(result.source).toContain("export type TreeSpeciesId = TreeExpandedSpeciesId");
    expect(result.source).toContain("export const TREE_SPECIES: readonly TreeSpeciesId[] = TREE_EXPANDED_SPECIES");
    expect(result.source).toContain("species: cloneSpeciesSettingsMap(TREE_EXPANDED_SPECIES_DEFAULTS)");
    expect(result.source).toContain("species: readSpeciesSettingsMap(fallback.species, raw.species)");
    expect(result.source).toContain("speciesZones: readSpeciesZoneMap(fallback.speciesZones, raw?.species_zones)");

    const again = wireTreeConfigTree9Source(result.source);
    expect(again.changed).toBe(false);
  });
});
