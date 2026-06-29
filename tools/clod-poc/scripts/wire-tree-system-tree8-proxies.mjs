import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system.ts");

const EDITS = [
  {
    label: "crown proxy imports",
    expected: `import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";`,
    replacement: `import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";
import { createTreeCrownProxyGeometry } from "./tree_crown_proxy_math.js";
import { createTreeCrownProxyNodeMaterialHandle } from "./tree_crown_proxy_node_material.js";`,
  },
  {
    label: "crown proxy geometry field",
    expected: `  private geometries: TreeGeometryMap;
  private geometryKey: string;`,
    replacement: `  private geometries: TreeGeometryMap;
  private geometryKey: string;
  private readonly crownProxyGeometry = createTreeCrownProxyGeometry();`,
  },
  {
    label: "crown proxy geometry dispose",
    expected: `    disposeTreeGeometryMap(this.geometries);
    this.disposeBakedImpostorGeometries();`,
    replacement: `    disposeTreeGeometryMap(this.geometries);
    this.crownProxyGeometry.dispose();
    this.disposeBakedImpostorGeometries();`,
  },
  {
    label: "crown proxy shadow material selection",
    expected: `            materialHandles[shadowMaterialKey] = lod === "impostor" && this.settings.impostors.enabled && atlas?.ready
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
    replacement: `            materialHandles[shadowMaterialKey] = this.createGpuRingShadowMaterialHandle(
              species,
              lod,
              shadowRingBuffers,
              atlas,
            );`,
  },
  {
    label: "crown proxy shadow source geometry",
    expected: `    const source = this.geometryForGpuRing(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();`,
    replacement: `    const source = this.geometryForGpuRingShadow(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();`,
  },
  {
    label: "crown proxy shadow helpers",
    expected: `  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,`,
    replacement: `  private createGpuRingShadowMaterialHandle(
    species: TreeSpeciesId,
    lod: TreeLod,
    buffers: TreeRingInstanceBuffers,
    atlas: TreeImpostorAtlas | undefined,
  ): TreeMaterialHandle {
    if (lod === "far" || lod === "impostor") {
      return createTreeCrownProxyNodeMaterialHandle(this.settings, buffers, species, lod);
    }
    if (lod === "impostor" && this.settings.impostors.enabled && atlas?.ready) {
      return createTreeRingImpostorNodeMaterialHandle(
        this.settings,
        buffers,
        atlas,
        this.currentLighting ?? undefined,
        this.hydrologyWater,
      );
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
  },
];

export function wireTreeSystemTree8Source(input) {
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
      throw new Error(`Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`);
    }
    source = source.replace(edit.expected, edit.replacement);
    changed = true;
    applied.push(edit.label);
  }

  return { source: restoreEol(source, eol), changed, applied, skipped };
}

export function wireTreeSystemTree8File(path = defaultTreeSystemPath, options = {}) {
  const source = readFileSync(path, "utf8");
  const result = wireTreeSystemTree8Source(source);
  if (options.dryRun) return result;
  if (result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (isCli()) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeSystemTree8File(defaultTreeSystemPath, { dryRun });
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
