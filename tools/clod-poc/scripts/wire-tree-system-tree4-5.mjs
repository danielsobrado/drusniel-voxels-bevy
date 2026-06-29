import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system.ts");

const EDITS = [
  {
    label: "GPU ring geometry selector import",
    expected: `import {
  disposeTreeGeometryMap,
  createTreeBakedImpostorGeometry,
  createTreeGeometryMap,
  treeGeometryKey,
  type TreeGeometryMap,
} from "./tree_geometry.js";`,
    replacement: `import {
  disposeTreeGeometryMap,
  createTreeBakedImpostorGeometry,
  createTreeGeometryMap,
  treeGeometryKey,
  type TreeGeometryMap,
} from "./tree_geometry.js";
import { selectTreeGpuRingGeometry } from "./tree_gpu_ring_geometry.js";`,
  },
  {
    label: "GPU ring baked impostor material import",
    expected: `import {
  createTreeNodeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  type TreeHydrologyWater,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";`,
    replacement: `import {
  createTreeNodeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  type TreeHydrologyWater,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";
import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";`,
  },
  {
    label: "GPU ring material handle map type",
    expected: `  materialHandles: Record<TreeLod, TreeMaterialHandle>;`,
    replacement: `  materialHandles: Record<string, TreeMaterialHandle>;`,
  },
  {
    label: "species-specific GPU ring material handles",
    expected: `    const materialHandles = {} as Record<TreeLod, TreeMaterialHandle>;
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
    replacement: `    const materialHandles = {} as Record<string, TreeMaterialHandle>;
    const meshes: TreeGpuRingMesh[] = [];
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const materialKey = species + ":" + lod;
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
  },
  {
    label: "GPU ring baked impostor geometry selector",
    expected: `  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    // Stage 3b decision: GPU ring uses the procedural impostor-card geometry first.
    // WebGPU render-to-atlas baking can replace this later without blocking the pipeline.
    return this.geometries[species][lod];
  }`,
    replacement: `  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    return selectTreeGpuRingGeometry({
      species,
      lod,
      geometries: this.geometries,
      settings: this.settings,
      impostorAtlases: this.impostorAtlases,
      bakedImpostorGeometries: this.bakedImpostorGeometries,
    }).geometry;
  }`,
  },
];

export function wireTreeSystemSource(input) {
  let source = input;
  let changed = false;
  const applied = [];
  const skipped = [];

  for (const edit of EDITS) {
    const expectedCount = countOccurrences(source, edit.expected);
    const replacementCount = countOccurrences(source, edit.replacement);
    if (expectedCount === 0 && replacementCount === 1) {
      skipped.push(edit.label);
      continue;
    }
    if (expectedCount !== 1 || replacementCount !== 0) {
      throw new Error(
        `Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`,
      );
    }
    source = source.replace(edit.expected, edit.replacement);
    changed = true;
    applied.push(edit.label);
  }

  return { source, changed, applied, skipped };
}

export function wireTreeSystemFile(path = defaultTreeSystemPath, options = {}) {
  const source = readFileSync(path, "utf8");
  const result = wireTreeSystemSource(source);
  if (options.dryRun) return result;
  if (result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (isCli()) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeSystemFile(defaultTreeSystemPath, { dryRun });
  const mode = dryRun ? "Checked" : "Updated";
  console.log(`${mode} ${defaultTreeSystemPath}`);
  console.log(`Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`);
  console.log(`Already present: ${result.skipped.length ? result.skipped.join(", ") : "none"}`);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function isCli() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}
