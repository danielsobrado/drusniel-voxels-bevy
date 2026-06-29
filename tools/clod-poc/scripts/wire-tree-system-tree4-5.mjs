import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system_runtime.ts");

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
  {
    label: "GPU ring invalidation after impostor atlas bake",
    expected: `  private setImpostorAtlases(atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>): void {
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    this.impostorAtlases = { ...atlases };
    this.disposeImpostorMaterials();
    this.updateImpostorMaterials();
  }`,
    replacement: `  private setImpostorAtlases(atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>): void {
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    this.impostorAtlases = { ...atlases };
    this.disposeImpostorMaterials();
    this.updateImpostorMaterials();
    this.clearGpuRing();
  }`,
  },
  {
    label: "patch mesh LOD dither role attribute",
    expected: `        geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(
          new Float32Array(speciesCapacity).fill(1),
          1,
        ));
        if (lod === "impostor") {`,
    replacement: `        geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(
          new Float32Array(speciesCapacity).fill(1),
          1,
        ));
        geometry.setAttribute("treeLodDitherRole", new THREE.InstancedBufferAttribute(
          new Float32Array(speciesCapacity),
          1,
        ));
        if (lod === "impostor") {`,
  },
  {
    label: "primary tree LOD dither role write",
    expected: `        this.placeTreeInstance(patch, instance, primaryLod, crossfade ? selection.fade : 1, cameraPosition, write);`,
    replacement: `        this.placeTreeInstance(patch, instance, primaryLod, crossfade ? selection.fade : 1, 0, cameraPosition, write);`,
  },
  {
    label: "secondary tree LOD dither role write",
    expected: `            this.placeTreeInstance(patch, instance, secondaryLod, selection.secondaryFade, cameraPosition, write);`,
    replacement: `            this.placeTreeInstance(patch, instance, secondaryLod, selection.secondaryFade, 1, cameraPosition, write);`,
  },
  {
    label: "place tree instance dither role parameter",
    expected: `    lod: TreeLod,
    fade: number,
    cameraPosition: THREE.Vector3,
    write: TreeMeshWriteState,`,
    replacement: `    lod: TreeLod,
    fade: number,
    ditherRole: number,
    cameraPosition: THREE.Vector3,
    write: TreeMeshWriteState,`,
  },
  {
    label: "write tree LOD dither role attribute",
    expected: `    if (this.writeTreeLodFadeIfChanged(mesh, index, fade)) write.fadeChanged.set(mesh, true);`,
    replacement: `    if (
      this.writeTreeLodFadeIfChanged(mesh, index, fade) ||
      this.writeTreeLodDitherRoleIfChanged(mesh, index, ditherRole)
    ) write.fadeChanged.set(mesh, true);`,
  },
  {
    label: "tree mesh LOD dither role buffer update",
    expected: `    if (worldXZChanged) this.treeWorldXZ(mesh).needsUpdate = true;
    if (fadeChanged) this.treeLodFade(mesh).needsUpdate = true;
    if (impostorUvChanged) this.treeImpostorUvRect(mesh).needsUpdate = true;`,
    replacement: `    if (worldXZChanged) this.treeWorldXZ(mesh).needsUpdate = true;
    if (fadeChanged) {
      this.treeLodFade(mesh).needsUpdate = true;
      this.treeLodDitherRole(mesh).needsUpdate = true;
    }
    if (impostorUvChanged) this.treeImpostorUvRect(mesh).needsUpdate = true;`,
  },
  {
    label: "tree LOD dither role writer method",
    expected: `  private writeTreeLodFadeIfChanged(mesh: THREE.InstancedMesh, index: number, fade: number): boolean {
    const attribute = this.treeLodFade(mesh);
    const array = attribute.array as Float32Array;
    if (Math.abs(array[index] - fade) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
    array[index] = fade;
    return true;
  }

  private writeTreeImpostorUvRectIfChanged(`,
    replacement: `  private writeTreeLodFadeIfChanged(mesh: THREE.InstancedMesh, index: number, fade: number): boolean {
    const attribute = this.treeLodFade(mesh);
    const array = attribute.array as Float32Array;
    if (Math.abs(array[index] - fade) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
    array[index] = fade;
    return true;
  }

  private writeTreeLodDitherRoleIfChanged(mesh: THREE.InstancedMesh, index: number, role: number): boolean {
    const attribute = this.treeLodDitherRole(mesh);
    const array = attribute.array as Float32Array;
    if (Math.abs(array[index] - role) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
    array[index] = role;
    return true;
  }

  private writeTreeImpostorUvRectIfChanged(`,
  },
  {
    label: "tree LOD dither role accessor",
    expected: `  private treeLodFade(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeLodFade") as THREE.InstancedBufferAttribute;
  }

  private treeImpostorUvRect(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {`,
    replacement: `  private treeLodFade(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeLodFade") as THREE.InstancedBufferAttribute;
  }

  private treeLodDitherRole(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeLodDitherRole") as THREE.InstancedBufferAttribute;
  }

  private treeImpostorUvRect(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {`,
  },
  {
    label: "replaced impostor geometry LOD dither role attribute",
    expected: `        nextGeometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
        nextGeometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
        nextGeometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));`,
    replacement: `        nextGeometry.setAttribute("treeWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
        nextGeometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1));
        nextGeometry.setAttribute("treeLodDitherRole", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
        nextGeometry.setAttribute("treeImpostorUvRect", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));`,
  },
];

export function wireTreeSystemSource(input) {
  const eol = detectEol(input);
  let source = normalizeEol(input);
  let changed = false;
  const applied = [];
  const skipped = [];

  for (const edit of EDITS) {
    const expectedCount = countOccurrences(source, edit.expected);
    const replacementCount = countOccurrences(source, edit.replacement);
    if (replacementCount === 1) {
      skipped.push(edit.label);
      continue;
    }
    if (replacementCount > 1 || expectedCount !== 1) {
      throw new Error(
        `Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`,
      );
    }
    source = source.replace(edit.expected, edit.replacement);
    changed = true;
    applied.push(edit.label);
  }

  return { source: restoreEol(source, eol), changed, applied, skipped };
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
