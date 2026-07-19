import { describe, expect, it } from "vitest";
import treeSystemSource from "../src/trees/tree_system_runtime.ts?raw";
import treeSystemAssetsSource from "../src/trees/tree_system_assets_runtime.ts?raw";
import treeGpuRingResourcesSource from "../src/trees/tree_system_gpu_ring_resources.ts?raw";
import wgslModulesSource from "../src/gpu/wgsl_modules.ts?raw";
import treeConfigTypesSource from "../src/trees/tree_config_types.ts?raw";
import treeConfigDefaultsSource from "../src/trees/tree_config_defaults.ts?raw";
import treeConfigParsingSource from "../src/trees/tree_config_parsing.ts?raw";
import { wireTreeSystemTree7Source } from "./wire-tree-system-tree7-shadows.mjs";
import { wireTreeSystemTree8Source } from "./wire-tree-system-tree8-proxies.mjs";
import { wireTreeRingWgslExpansionSource } from "./wire-tree-ring-wgsl-expansion.mjs";
import { wireTreeConfigTree9Source } from "./wire-tree-config-tree9-species.mjs";

const TREE7_EDIT_COUNT = 11;
const TREE8_EDIT_COUNT = 6;
const WGSL_EDIT_COUNT = 2;
const CONFIG_EDIT_COUNT = 10;
const treeConfigSource = [treeConfigTypesSource, treeConfigDefaultsSource, treeConfigParsingSource].join("\n");

describe("tree parity wiring against current source", () => {
  it("applies TREE-7 then TREE-8 to the live tree_system source", () => {
    const tree7 = wireTreeSystemTree7Source(treeSystemSource);
    const tree8 = wireTreeSystemTree8Source(tree7.source);

    expect(tree7.applied.length + tree7.skipped.length).toBe(TREE7_EDIT_COUNT);
    expect(tree8.applied.length + tree8.skipped.length).toBe(TREE8_EDIT_COUNT);
    expect(tree8.source).toContain("treeCreateGpuRingResources");
    expect(tree8.source).toContain("updateTreeGpuRingTrees");
    expect(treeGpuRingResourcesSource).toContain("createTreeSystemGpuRingDrawResources");
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
    expect(result.source).toContain("const baseTreeEntry =");
    expect(result.source).toContain("withTreePcgHash(");
    expect(result.source).toContain("withTreeFinalPlacementHeight(");
    expect(result.source).toContain("withRiverEcologyConstants(treeRingEntry)");
    expect(result.source).toContain("const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length)");
    expect(result.source).toContain("withTreeCrownProxyShadowIndexCount");
    expect(result.source).toContain("applyTreeRingWgslLayoutConstants(crownProxyTreeEntry, treeLayout)");

    const again = wireTreeRingWgslExpansionSource(result.source);
    expect(again.changed).toBe(false);
  });

  it("applies TREE-9 six-species config wiring to the live tree_config source", () => {
    const result = wireTreeConfigTree9Source(treeConfigSource);

    expect(result.applied.length + result.skipped.length).toBe(CONFIG_EDIT_COUNT);
    expect(result.source).toContain(`export const TREE_SPECIES = ["oak", "pine", "dead", "birch", "willow", "spruce"] as const;`);
    expect(result.source).toContain("export interface TreeSpeciesMorphologySettings");
    expect(result.source).toContain("export interface TreeSpeciesZoneSettings");
    expect(result.source).toContain("spruce: species(0.10, 16, 60, 10.0, 0.32, 3.4");
    expect(result.source).toContain("for (const id of TREE_SPECIES) species[id] = parseSpeciesSettings(root[id], fallback.species[id]);");
    expect(result.source).toContain("for (const id of TREE_SPECIES) speciesZones[id] = parseSpeciesZone(root[id], fallback.ecology.speciesZones[id]);");

    const again = wireTreeConfigTree9Source(result.source);
    expect(again.changed).toBe(false);
  });
});
