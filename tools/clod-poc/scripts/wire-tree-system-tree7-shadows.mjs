import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system_runtime.ts");

const REALTIME_IMPORT_LABEL = "realtime shadow cascade imports";
const SHADOW_LOOP_LABEL = "tree GPU ring shadow-only mesh loop";
const SHADOW_METHOD_LABEL = "tree GPU ring shadow tier draw method";
const FINAL_REALTIME_IMPORTS = `import type { EnvironmentLighting } from "../environment/environment.js";
import { getRealtimeSunShadowCascadeCameras, markAsRealtimeSunShadowCaster } from "../rendering/realtime_sun_shadows.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import {
  TREE_RING_SHADOW_CASCADE_COUNT,
  treeRingShadowCascadePlanesFromCameras,
  treeRingShadowCasterGroupIndex,
} from "./tree_ring_shadow_casters.js";`;

const EDITS = [
  {
    label: "tree shadow group count import",
    expected: `  treeGpuRingGroupIndex,
  TREE_GPU_RING_GROUP_COUNT,
  treeGpuRingKey,`,
    replacement: `  treeGpuRingGroupIndex,
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingKey,`,
  },
  {
    label: REALTIME_IMPORT_LABEL,
    expected: `import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";`,
    replacement: FINAL_REALTIME_IMPORTS,
  },
  {
    label: "tree GPU ring resource shadow fields",
    expected: `  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;`,
    replacement: `  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  shadowCell: StorageInstancedBufferAttribute;
  shadowIndirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;`,
  },
  {
    label: "tree GPU ring shadow buffers allocation",
    expected: `    const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
    indirect.name = "tree-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const cell = this.createStorageInstancedAttribute("cell", sharedInstanceCount);
    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };`,
    replacement: `    const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
    indirect.name = "tree-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const cell = this.createStorageInstancedAttribute("cell", sharedInstanceCount);
    const shadowIndirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_SHADOW_GROUP_COUNT * 5), 5);
    shadowIndirect.name = "tree-ring-shadow-indirect";
    this.gpuBackend.createIndirectStorageAttribute(shadowIndirect);
    const shadowCell = this.createStorageInstancedAttribute("shadow-cell", count * TREE_GPU_RING_SHADOW_GROUP_COUNT);
    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };`,
  },
  {
    label: "tree GPU ring shadow ring buffers",
    expected: `    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };
    const materialHandles = {} as Record<string, TreeMaterialHandle>;`,
    replacement: `    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };
    const shadowRingBuffers: TreeRingInstanceBuffers = { cell: shadowCell, capacity: count * TREE_GPU_RING_SHADOW_GROUP_COUNT };
    const materialHandles = {} as Record<string, TreeMaterialHandle>;`,
  },
  {
    label: SHADOW_LOOP_LABEL,
    expected: `        meshes.push(this.createGpuRingTierDraw(
          species,
          lod,
          count,
          indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          materialHandles[materialKey],
        ));`,
    replacement: `        meshes.push(this.createGpuRingTierDraw(
          species,
          lod,
          count,
          indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          materialHandles[materialKey],
        ));
        if (this.treeLodCastsShadow(lod)) {
          for (let cascade = 0; cascade < TREE_RING_SHADOW_CASCADE_COUNT; cascade++) {
            const shadowMaterialKey = "shadow:" + cascade + ":" + materialKey;
            materialHandles[shadowMaterialKey] = lod === "impostor" && this.settings.impostors.enabled && atlas?.ready
              ? createTreeRingImpostorNodeMaterialHandle(
                this.settings,
                shadowRingBuffers,
                atlas,
                this.currentLighting ?? undefined,
                this.hydrologyWater,
              )
              : createTreeRingNodeMaterialHandle(
                this.settings,
                shadowRingBuffers,
                lod,
                this.currentLighting ?? undefined,
                this.hydrologyWater,
              );
            const shadowGroup = treeRingShadowCasterGroupIndex(species, lod, cascade);
            meshes.push(this.createGpuRingShadowTierDraw(
              species,
              lod,
              cascade,
              count,
              shadowIndirect,
              shadowGroup * 5 * Uint32Array.BYTES_PER_ELEMENT,
              materialHandles[shadowMaterialKey],
            ));
          }
        }`,
  },
  {
    label: "tree GPU ring shadow output buffers",
    expected: `      cell,
      indirect,
      materialHandles,
      outputBuffers: {
        cell: this.gpuBufferForAttribute(cell),
        indirectArgs: this.gpuBufferForAttribute(indirect),
      },`,
    replacement: `      cell,
      indirect,
      shadowCell,
      shadowIndirect,
      materialHandles,
      outputBuffers: {
        cell: this.gpuBufferForAttribute(cell),
        indirectArgs: this.gpuBufferForAttribute(indirect),
        shadowCell: this.gpuBufferForAttribute(shadowCell),
        shadowIndirectArgs: this.gpuBufferForAttribute(shadowIndirect),
      },`,
  },
  {
    label: "tree visible GPU ring no direct shadow cast",
    expected: `    // clod-poc has no real-time shadow-map pass; shadow-caster prepass work is N/A here.
    mesh.castShadow = this.treeLodCastsShadow(lod);`,
    replacement: `    mesh.castShadow = false;`,
  },
  {
    label: SHADOW_METHOD_LABEL,
    expected: `  private usesGpuRingPrepass(lod: TreeLod): boolean {`,
    replacement: `  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,
    lod: TreeLod,
    cascade: number,
    count: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    materialHandle: TreeMaterialHandle,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRing(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(source.getIndex());
    for (const name of Object.keys(source.attributes)) {
      geometry.setAttribute(name, source.getAttribute(name));
    }
    geometry.instanceCount = count;
    this.setGpuRingIndirect(geometry, indirect, indirectOffset);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(this.worldCells + 1, 256, this.worldCells + 1),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, materialHandle.regularMaterial);
    mesh.name = "trees-ring-gpu-shadow-c" + cascade + "-" + species + "-" + lod;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    markAsRealtimeSunShadowCaster(mesh, cascade);
    return mesh;
  }

  private usesGpuRingPrepass(lod: TreeLod): boolean {`,
  },
  {
    label: "tree shadow cascade planes before dispatch",
    expected: `      const frustumPlanes = this.frustumPlanes(camera);
      const dispatched = this.gpuRingCompute.dispatch({`,
    replacement: `      const frustumPlanes = this.frustumPlanes(camera);
      const shadowCameras = getRealtimeSunShadowCascadeCameras();
      const shadowCascadePlanes = shadowCameras.length > 0 ? treeRingShadowCascadePlanesFromCameras(shadowCameras) : undefined;
      const dispatched = this.gpuRingCompute.dispatch({`,
  },
  {
    label: "tree shadow dispatch params",
    expected: `        maxInstancesPerGroup: treeGpuRingGroupCapacity(this.settings),
        indexCounts: this.gpuRingIndexCounts(),
        frustumPlanes,`,
    replacement: `        maxInstancesPerGroup: treeGpuRingGroupCapacity(this.settings),
        maxShadowCastersPerGroup: shadowCascadePlanes ? treeGpuRingGroupCapacity(this.settings) : 0,
        indexCounts: this.gpuRingIndexCounts(),
        frustumPlanes,
        shadowCascadePlanes,`,
  },
];

export function wireTreeSystemTree7Source(input) {
  const eol = detectEol(input);
  let source = normalizeEol(input);
  let changed = false;
  const applied = [];
  const skipped = [];

  const normalized = normalizeRealtimeShadowImports(source);
  if (normalized !== source) {
    source = normalized;
    changed = true;
  }

  for (const edit of EDITS) {
    if (tree8AlreadySatisfiesTree7Edit(source, edit.label)) {
      skipped.push(edit.label);
      continue;
    }
    const expectedCount = countOccurrences(source, edit.expected);
    const replacementCount = countOccurrences(source, edit.replacement);
    if (replacementCount === 1) {
      skipped.push(edit.label);
      continue;
    }
    if (replacementCount > 1 || expectedCount !== 1) {
      throw new Error(`Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`);
    }
    source = source.replace(edit.expected, edit.replacement);
    changed = true;
    applied.push(edit.label);
  }

  return { source: restoreEol(source, eol), changed, applied, skipped };
}

export function wireTreeSystemTree7File(path = defaultTreeSystemPath, options = {}) {
  const source = readFileSync(path, "utf8");
  const result = wireTreeSystemTree7Source(source);
  if (options.dryRun) return result;
  if (result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (isCli()) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeSystemTree7File(defaultTreeSystemPath, { dryRun });
  const mode = dryRun ? "Checked" : "Updated";
  console.log(`${mode} ${defaultTreeSystemPath}`);
  console.log(`Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`);
  console.log(`Already present: ${result.skipped.length ? result.skipped.join(", ") : "none"}`);
}

function tree8AlreadySatisfiesTree7Edit(source, label) {
  if (modularShadowDrawAlreadySatisfiesTree7(source)) return true;
  if (label === SHADOW_METHOD_LABEL) return countOccurrences(source, "  private createGpuRingShadowTierDraw(") > 0;
  if (label === SHADOW_LOOP_LABEL) return source.includes("this.createGpuRingShadowMaterialHandle(") && source.includes("this.createGpuRingShadowTierDraw(");
  return false;
}

function modularShadowDrawAlreadySatisfiesTree7(source) {
  const updatesGpuRing =
    source.includes("updateTreeGpuRingTrees(")
    || source.includes("updateTreeGpuRingTreesSafely(");
  if (source.includes("treeCreateGpuRingResources(") &&
    updatesGpuRing &&
    source.includes("treeGpuRingInput(")) return true;
  return source.includes("createTreeSystemGpuRingDrawResources(") &&
    updatesGpuRing &&
    source.includes("TreeGpuRingRuntimeInput");
}

function normalizeRealtimeShadowImports(source) {
  if (source.includes(FINAL_REALTIME_IMPORTS)) return source;
  if (!source.includes("getRealtimeSunShadowCascadeCameras") && !source.includes("treeRingShadowCascadePlanesFromCameras")) return source;
  let next = source
    .replace(/import \{[^\n]*getRealtimeSunShadowCascadeCameras[^\n]*\} from "\.\.\/rendering\/realtime_sun_shadows\.js";\n/g, "")
    .replace(/import \{\n(?:  [A-Z_]+,\n)?  treeRingShadowCascadePlanesFromCameras,\n(?:  treeRingShadowCasterGroupIndex,\n)?\} from "\.\/tree_ring_shadow_casters\.js";\n/g, "")
    .replace(/import \{[^\n]*treeRingShadowCascadePlanesFromCameras[^\n]*\} from "\.\/tree_ring_shadow_casters\.js";\n/g, "");
  const fullAnchor = `import type { EnvironmentLighting } from "../environment/environment.js";\nimport type { ForestLightingMaterialState } from "../forest_lighting/index.js";`;
  if (next.includes(fullAnchor)) return next.replace(fullAnchor, FINAL_REALTIME_IMPORTS);
  const envAnchor = `import type { EnvironmentLighting } from "../environment/environment.js";`;
  if (!next.includes(envAnchor)) return source;
  return next.replace(envAnchor, FINAL_REALTIME_IMPORTS);
}

function normalizeEol(source) {
  return source.replace(/\r\n/g, "\n");
}

function restoreEol(source, eol) {
  return eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source;
}

function detectEol(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function isCli() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}
