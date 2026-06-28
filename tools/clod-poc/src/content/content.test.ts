import { describe, expect, it } from "vitest";
import { loadContentRegistry } from "./load_yaml.js";
import { validateContentRegistry } from "./validate.js";
import { isValidId } from "./ids.js";
import {
  EXPECTED_BIOME_REGION_IDS,
  buildBiomeTextureLayerMap,
  getBiomeContentByBiomeId,
  getBiomeTextureSlotSet,
} from "./biome_content.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

function getAllTsFiles(dir: string): string[] {
  let files: string[] = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files = files.concat(getAllTsFiles(filePath));
    } else if (file.endsWith(".ts")) {
      files.push(filePath);
    }
  }
  return files;
}

describe("Content Registry Validation Tests", () => {
  it("1. default registry validates ok", () => {
    const registry = loadContentRegistry();
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("2. all default material IDs are kebab-case", () => {
    const registry = loadContentRegistry();
    for (const id of registry.materials.keys()) {
      expect(isValidId(id)).toBe(true);
    }
  });

  it("3. duplicate material IDs fail", () => {
    const registry = loadContentRegistry();
    const firstMaterial = Array.from(registry.materials.values())[0];
    const registryWithDupe = {
      ...registry,
      _errors: [
        ...(registry._errors || []),
        {
          severity: "error" as const,
          code: "DUPLICATE_ID",
          path: `materials.${firstMaterial.id}`,
          message: `Duplicate ID found`,
        },
      ],
    };

    const report = validateContentRegistry(registryWithDupe);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("4. missing material referenced by biome fails", () => {
    const registry = loadContentRegistry();
    const biome = registry.biomes.get("meadows");
    if (biome) biome.defaultMaterialId = "non-existent-material";
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "MISSING_MATERIAL_REF")).toBe(true);
  });

  it("5. missing texture slot referenced by terrain band fails", () => {
    const registry = loadContentRegistry();
    const biome = registry.biomes.get("test-plain");
    if (biome && biome.terrainBands.length > 0) {
      biome.terrainBands[0].textureSlotId = "non-existent-slot";
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "MISSING_TEXTURE_SLOT_REF")).toBe(true);
  });

  it("6. invalid RGB fails", () => {
    const registry = loadContentRegistry();
    const material = registry.materials.get("top-soil");
    if (material) material.colorRgb = [300, -5, 12];
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_COLOR_RGB")).toBe(true);
  });

  it("7. invalid texture slot index fails", () => {
    const registry = loadContentRegistry();
    const slot = registry.textureSlots.get("natural");
    if (slot) slot.slotIndex = -1;
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_SLOT_INDEX")).toBe(true);
  });

  it("7b. invalid texture slot source fails", () => {
    const registry = loadContentRegistry();
    const slot = registry.textureSlots.get("natural");
    if (slot) slot.source = "external" as any;
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_TEXTURE_SOURCE")).toBe(true);
  });

  it("8. invalid terrain band range fails", () => {
    const registry = loadContentRegistry();
    const biome = registry.biomes.get("test-plain");
    if (biome && biome.terrainBands.length > 0) {
      biome.terrainBands[0].minHeight = 50;
      biome.terrainBands[0].maxHeight = 10;
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_HEIGHT_RANGE")).toBe(true);
  });

  it("9. invalid snap piece dimensions fail", () => {
    const registry = loadContentRegistry();
    const piece = registry.snapPieces.get("wood-floor");
    if (piece) piece.dimensions = [0, 4, -2];
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_SNAP_PIECE_DIMENSIONS")).toBe(true);
  });

  it("10. invalid snap point direction fails", () => {
    const registry = loadContentRegistry();
    const piece = registry.snapPieces.get("wood-floor");
    if (piece && piece.snapPoints.length > 0) {
      piece.snapPoints[0].direction = [0, 0, 0];
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "UNNORMALIZABLE_DIRECTION")).toBe(true);
  });

  it("11. banned gameplay terms are rejected from production YAML if present", () => {
    const registry = loadContentRegistry();
    const piece = registry.snapPieces.get("wood-floor");
    if (piece) (piece as any).notes = "This is a quest item for dungeons";
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "BANNED_TERM")).toBe(true);
  });

  it("12. production modules do not import from external reference paths", () => {
    const srcDir = resolve(import.meta.dirname, "..");
    const files = getAllTsFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith("content.test.ts") || file.endsWith("deployment.test.ts")) continue;
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (/^\s*(import|const|let|var)\b/.test(line)) {
          expect(line).not.toContain("/reference/");
        }
      }
    }
  });

  it("13. every runtime biome id maps to spatial content and texture slots", () => {
    const registry = loadContentRegistry();
    for (const biomeId of EXPECTED_BIOME_REGION_IDS) {
      const biome = getBiomeContentByBiomeId(registry, biomeId);
      expect(biome, `biomeId ${biomeId}`).toBeDefined();
      expect(biome!.region?.kind).toBe("spatial");
      expect(biome!.region?.biomeId).toBe(biomeId);
      expect(biome!.region!.canopyDensity).toBeGreaterThanOrEqual(0);
      expect(biome!.region!.canopyDensity).toBeLessThanOrEqual(1);
      expect(biome!.region!.terrainTextureSlots.length).toBeGreaterThanOrEqual(3);
      const textureSlotSet = getBiomeTextureSlotSet(registry, biomeId);
      expect(textureSlotSet?.slots.length).toBeGreaterThan(0);
      expect(textureSlotSet?.slotIndices.every(Number.isInteger)).toBe(true);
    }
  });

  it("14. detects missing spatial biome content", () => {
    const registry = loadContentRegistry();
    registry.biomes.delete("ocean");
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "MISSING_SPATIAL_BIOME_CONTENT")).toBe(true);
  });

  it("15. detects duplicated runtime biome ids", () => {
    const registry = loadContentRegistry();
    const plains = registry.biomes.get("plains");
    if (plains?.region) {
      plains.biomeId = 0;
      plains.region.biomeId = 0;
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DUPLICATE_BIOME_ID")).toBe(true);
  });

  it("16. builds a complete biome-to-texture-layer map for ISLE-11", () => {
    const registry = loadContentRegistry();
    const map = buildBiomeTextureLayerMap(registry);
    expect(map.size).toBe(EXPECTED_BIOME_REGION_IDS.length);
    for (const biomeId of EXPECTED_BIOME_REGION_IDS) {
      const layers = map.get(biomeId) ?? [];
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.every(layer => Number.isInteger(layer) && layer >= 0)).toBe(true);
    }
  });

  it("17. terrain material keeps biome debug overlay wired to biomeId", () => {
    const materialPath = resolve(import.meta.dirname, "../gpu/terrain_node_material.ts");
    const material = readFileSync(materialPath, "utf8");
    expect(material).toContain("debugMode === 11");
    expect(material).toContain("attribute(\"biomeId\", \"float\")");
  });

  it("18. terrain material samples biome layer sets with rounded array layers", () => {
    const materialPath = resolve(import.meta.dirname, "../gpu/terrain_node_material.ts");
    const material = readFileSync(materialPath, "utf8");
    expect(material).toContain("biomeLayerSets");
    expect(material).toContain("sampleBiomeTerrainTexture");
    expect(material).toContain("sampleBiomeTerrainNormal");
    expect(material).toContain("function roundedLayer");
  });

  it("19. WebGPU wrapper builds biome layer sets from content registry", () => {
    const wrapperPath = resolve(import.meta.dirname, "../rendering/terrain_material_webgpu.ts");
    const wrapper = readFileSync(wrapperPath, "utf8");
    expect(wrapper).toContain("buildBiomeLayerSets");
    expect(wrapper).toContain("getBiomeTextureSlotSet");
    expect(wrapper).toContain("EXPECTED_BIOME_REGION_IDS");
  });

  it("20. terrain material color uniforms use runtime vector values", () => {
    const materialPath = resolve(import.meta.dirname, "../gpu/terrain_node_material.ts");
    const material = readFileSync(materialPath, "utf8");
    expect(material).toContain("function v3(c: THREE.Color): THREE.Vector3");
    expect(material).toContain("new THREE.Vector3(c.r, c.g, c.b)");
    expect(material).not.toContain("function v3(c: THREE.Color): TslNode");
  });
});
