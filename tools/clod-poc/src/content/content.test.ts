import { describe, expect, it } from "vitest";
import { loadContentRegistry } from "./load_yaml.js";
import { validateContentRegistry } from "./validate.js";
import { isValidId } from "./ids.js";
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
    // Simulate duplicate material ID
    const firstMaterial = Array.from(registry.materials.values())[0];
    
    // We manually add an error to simulate duplicate loading
    const registryWithDupe = {
      ...registry,
      _errors: [
        ...(registry._errors || []),
        {
          severity: "error" as const,
          code: "DUPLICATE_ID",
          path: `materials.${firstMaterial.id}`,
          message: `Duplicate ID found`,
        }
      ]
    };
    
    const report = validateContentRegistry(registryWithDupe);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("4. missing material referenced by biome fails", () => {
    const registry = loadContentRegistry();
    // Set biome's default material to something non-existent
    const biome = registry.biomes.get("test-plain");
    if (biome) {
      biome.defaultMaterialId = "non-existent-material";
    }
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
    if (material) {
      material.colorRgb = [300, -5, 12]; // Invalid RGB values
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_COLOR_RGB")).toBe(true);
  });

  it("7. invalid texture slot index fails", () => {
    const registry = loadContentRegistry();
    const slot = registry.textureSlots.get("natural");
    if (slot) {
      slot.slotIndex = -1; // Must be non-negative
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_SLOT_INDEX")).toBe(true);
  });

  it("8. invalid terrain band range fails", () => {
    const registry = loadContentRegistry();
    const biome = registry.biomes.get("test-plain");
    if (biome && biome.terrainBands.length > 0) {
      biome.terrainBands[0].minHeight = 50;
      biome.terrainBands[0].maxHeight = 10; // minHeight >= maxHeight
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_HEIGHT_RANGE")).toBe(true);
  });

  it("9. invalid snap piece dimensions fail", () => {
    const registry = loadContentRegistry();
    const piece = registry.snapPieces.get("wood-floor");
    if (piece) {
      piece.dimensions = [0, 4, -2]; // Must be positive finite numbers
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "INVALID_SNAP_PIECE_DIMENSIONS")).toBe(true);
  });

  it("10. invalid snap point direction fails", () => {
    const registry = loadContentRegistry();
    const piece = registry.snapPieces.get("wood-floor");
    if (piece && piece.snapPoints.length > 0) {
      piece.snapPoints[0].direction = [0, 0, 0]; // Cannot be zero vector (unnormalizable)
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "UNNORMALIZABLE_DIRECTION")).toBe(true);
  });

  it("11. banned gameplay terms are rejected from production YAML if present", () => {
    const registry = loadContentRegistry();
    // Simulate banned term injection
    const piece = registry.snapPieces.get("wood-floor");
    if (piece) {
      (piece as any).notes = "This is a quest item for dungeons"; // "quest" and "dungeon" are banned
    }
    const report = validateContentRegistry(registry);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === "BANNED_TERM")).toBe(true);
  });

  it("12. production modules do not import from external reference paths", () => {
    const srcDir = resolve(import.meta.dirname, "..");
    const files = getAllTsFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith("content.test.ts") || file.endsWith("deployment.test.ts")) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (/^\s*(import|const|let|var)\b/.test(line)) {
          expect(line).not.toContain("/reference/");
        }
      }
    }
  });
});
