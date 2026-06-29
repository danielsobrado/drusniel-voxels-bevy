import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const treeSystemPath = resolve(here, "../src/trees/tree_system.ts");
let source = readFileSync(treeSystemPath, "utf8");

replaceOnce(
  `import {
  disposeTreeGeometryMap,
  createTreeBakedImpostorGeometry,
  createTreeGeometryMap,
  treeGeometryKey,
  type TreeGeometryMap,
} from "./tree_geometry.js";`,
  `import {
  disposeTreeGeometryMap,
  createTreeBakedImpostorGeometry,
  createTreeGeometryMap,
  treeGeometryKey,
  type TreeGeometryMap,
} from "./tree_geometry.js";
import { selectTreeGpuRingGeometry } from "./tree_gpu_ring_geometry.js";`,
);

replaceOnce(
  `import {
  createTreeNodeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  type TreeHydrologyWater,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";`,
  `import {
  createTreeNodeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  type TreeHydrologyWater,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";
import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";`,
);

replaceOnce(
  `  materialHandles: Record<TreeLod, TreeMaterialHandle>;`,
  `  materialHandles: Record<string, TreeMaterialHandle>;`,
);

replaceOnce(
  `    const materialHandles = {} as Record<TreeLod, TreeMaterialHandle>;
    for (const lod of TREE_LODS) {
      materialHandles[lod] = this.currentLighting
        ? createTreeRingNodeMaterialHandle(this.settings, ringBuffers, lod, this.currentLighting, this.hydrologyWater)
        : createTreeRingNodeMaterialHandle(this.settings, ringBuffers, lod, undefined, this.hydrologyWater);
    }
    const meshes: TreeGpuRingMesh[] = [];
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const group = treeGpuRingGroupIndex(species, lod);
        meshes.push(this.createGpuRingTierDraw(
          species,
          lod,
          count,
          indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          materialHandles[lod],
        ));
      }
    }`,
  `    const materialHandles = {} as Record<string, TreeMaterialHandle>;
    const meshes: TreeGpuRingMesh[] = [];
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const materialKey = `${"${species}:${lod}"}`;
        const atlas = this.impostorAtlases[species];
        materialHandles[materialKey] = lod === "impostor" && this.settings.impostors.enabled && atlas?.ready
          ? createTreeRingImpostorNodeMaterialHandle(
            this.settings,
            ringBuffers,
            atlas,
            this.currentLighting ?? undefined,
            this.hydrologyWater,
          )
          : createTreeRingNodeMaterialHandle(
            this.settings,
            ringBuffers,
            lod,
            this.currentLighting ?? undefined,
            this.hydrologyWater,
          );
        const group = treeGpuRingGroupIndex(species, lod);
        meshes.push(this.createGpuRingTierDraw(
          species,
          lod,
          count,
          indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          materialHandles[materialKey],
        ));
      }
    }`,
);

replaceOnce(
  `  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    // Stage 3b decision: GPU ring uses the procedural impostor-card geometry first.
    // WebGPU render-to-atlas baking can replace this later without blocking the pipeline.
    return this.geometries[species][lod];
  }`,
  `  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    return selectTreeGpuRingGeometry({
      species,
      lod,
      geometries: this.geometries,
      settings: this.settings,
      impostorAtlases: this.impostorAtlases,
      bakedImpostorGeometries: this.bakedImpostorGeometries,
    }).geometry;
  }`,
);

writeFileSync(treeSystemPath, source, "utf8");
console.log(`Updated ${treeSystemPath}`);

function replaceOnce(expected, replacement) {
  const occurrences = source.split(expected).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one match for snippet, found ${occurrences}:\n${expected.slice(0, 240)}`);
  }
  source = source.replace(expected, replacement);
}
