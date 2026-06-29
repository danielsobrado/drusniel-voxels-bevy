import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system_runtime.ts");

const SHADOW_MATERIAL_LABEL = "crown proxy shadow material selection";
const SHADOW_HELPERS_LABEL = "crown proxy shadow helpers";

const edits = [
  edit(
    "crown proxy imports",
    `import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";`,
    `import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";\nimport { createTreeCrownProxyGeometry } from "./tree_crown_proxy_math.js";\nimport { createTreeCrownProxyNodeMaterialHandle } from "./tree_crown_proxy_node_material.js";`,
  ),
  edit(
    "crown proxy geometry field",
    `  private geometries: TreeGeometryMap;\n  private geometryKey: string;`,
    `  private geometries: TreeGeometryMap;\n  private geometryKey: string;\n  private readonly crownProxyGeometry = createTreeCrownProxyGeometry();`,
  ),
  edit(
    "crown proxy geometry dispose",
    `    disposeTreeGeometryMap(this.geometries);\n    this.disposeBakedImpostorGeometries();`,
    `    disposeTreeGeometryMap(this.geometries);\n    this.crownProxyGeometry.dispose();\n    this.disposeBakedImpostorGeometries();`,
  ),
  edit(
    SHADOW_MATERIAL_LABEL,
    `            materialHandles[shadowMaterialKey] = lod === "impostor" && this.settings.impostors.enabled && atlas?.ready
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
              );`,
    `            materialHandles[shadowMaterialKey] = this.createGpuRingShadowMaterialHandle(
              species,
              lod,
              shadowRingBuffers,
              atlas,
            );`,
  ),
  edit(
    "crown proxy shadow source geometry",
    `  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,
    lod: TreeLod,
    cascade: number,
    count: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    materialHandle: TreeMaterialHandle,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRing(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();`,
    `  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,
    lod: TreeLod,
    cascade: number,
    count: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    materialHandle: TreeMaterialHandle,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRingShadow(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();`,
  ),
  edit(
    SHADOW_HELPERS_LABEL,
    `  private createGpuRingShadowTierDraw(\n    species: TreeSpeciesId,`,
    `  private createGpuRingShadowMaterialHandle(
    species: TreeSpeciesId,
    lod: TreeLod,
    buffers: TreeRingInstanceBuffers,
    atlas: TreeImpostorAtlas | undefined,
  ): TreeMaterialHandle {
    if (lod === "far" || lod === "impostor") {
      return createTreeCrownProxyNodeMaterialHandle(this.settings, buffers, species, lod);
    }
    return createTreeRingNodeMaterialHandle(
      this.settings,
      buffers,
      lod,
      this.currentLighting ?? undefined,
      this.hydrologyWater,
    );
  }

  private geometryForGpuRingShadow(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    if (lod === "far" || lod === "impostor") return this.crownProxyGeometry;
    return this.geometryForGpuRing(species, lod);
  }

  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,`,
  ),
];

export function wireTreeSystemTree8Source(input) {
  const eol = input.includes("\r\n") ? "\r\n" : "\n";
  let source = input.replace(/\r\n/g, "\n");
  let changed = false;
  const applied = [];
  const skipped = [];

  for (const item of edits) {
    if (tree8AlreadySatisfied(source, item.label)) {
      skipped.push(item.label);
      continue;
    }
    const expectedCount = countOccurrences(source, item.expected);
    const replacementCount = countOccurrences(source, item.replacement);
    if (replacementCount === 1) {
      skipped.push(item.label);
      continue;
    }
    if (replacementCount > 1 || expectedCount !== 1) {
      throw new Error(`Cannot apply ${item.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`);
    }
    source = source.replace(item.expected, item.replacement);
    changed = true;
    applied.push(item.label);
  }

  return { source: eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source, changed, applied, skipped };
}

export function wireTreeSystemTree8File(path = defaultTreeSystemPath, options = {}) {
  const result = wireTreeSystemTree8Source(readFileSync(path, "utf8"));
  if (!options.dryRun && result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeSystemTree8File(defaultTreeSystemPath, { dryRun });
  console.log(`${dryRun ? "Checked" : "Updated"} ${defaultTreeSystemPath}`);
  console.log(`Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`);
  console.log(`Already present: ${result.skipped.length ? result.skipped.join(", ") : "none"}`);
}

function tree8AlreadySatisfied(source, label) {
  if (modularCrownProxyShadowAlreadySatisfied(source)) return true;
  if (label === SHADOW_MATERIAL_LABEL) return source.includes("materialHandles[shadowMaterialKey] = this.createGpuRingShadowMaterialHandle(");
  if (label === SHADOW_HELPERS_LABEL) return source.includes("private createGpuRingShadowMaterialHandle(") && source.includes("private geometryForGpuRingShadow(");
  return false;
}

function modularCrownProxyShadowAlreadySatisfied(source) {
  return source.includes("createTreeSystemGpuRingDrawResources(") &&
    source.includes("crownProxyGeometry: this.assets.crownProxyGeometry");
}

function edit(label, expected, replacement) {
  return { label, expected, replacement };
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}
