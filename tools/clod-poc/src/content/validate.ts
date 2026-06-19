import { ContentRegistry, ContentValidationReport, ContentValidationIssue } from "./types.js";
import { isValidId } from "./ids.js";

const BANNED_TERMS = [
  "claudecraft",
  "quest",
  "mob",
  "npc",
  "dungeon",
  "loot",
  "leveling",
  "xp",
  "mana",
  "class",
  "spell",
  "alliance",
  "horde",
  "raid",
  "boss",
];

const KNOWN_SNAP_GROUPS = new Set(["floor-edge", "wall-bottom", "wall-top", "wall-side", "roof-edge", "generic"]);
const KNOWN_TEXTURE_SLOT_SOURCES = new Set(["builtin", "user", "generated"]);

export function validateContentRegistry(
  registry: ContentRegistry,
  options?: { strict?: boolean }
): ContentValidationReport {
  const strict = options?.strict ?? false;
  const issues: ContentValidationIssue[] = [];

  // Prepend any loading errors
  if (registry._errors) {
    issues.push(...registry._errors);
  }

  // 1. Recursive check for Banned terms
  function scanForBannedTerms(val: any, path: string) {
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      for (const term of BANNED_TERMS) {
        if (lower.includes(term)) {
          issues.push({
            severity: "error",
            code: "BANNED_TERM",
            path,
            message: `Value "${val}" contains banned gameplay term "${term}".`,
          });
        }
      }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        scanForBannedTerms(val[i], `${path}[${i}]`);
      }
    } else if (val instanceof Map) {
      for (const [key, value] of val.entries()) {
        scanForBannedTerms(key, `${path}.key(${key})`);
        scanForBannedTerms(value, `${path}.${key}`);
      }
    } else if (val && typeof val === "object") {
      for (const key of Object.keys(val)) {
        if (key === "_errors") continue;
        scanForBannedTerms(val[key], `${path}.${key}`);
      }
    }
  }

  scanForBannedTerms(registry, "registry");

  // Validate Materials
  for (const [id, material] of registry.materials.entries()) {
    const prefix = `materials.${id}`;
    // 2. ID validation
    if (!isValidId(id)) {
      issues.push({
        severity: "error",
        code: "INVALID_ID_FORMAT",
        path: prefix,
        message: `Material ID "${id}" must be lowercase kebab-case.`,
      });
    }

    // 10. Color RGB validation
    const rgb = material.colorRgb;
    if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(c => !Number.isInteger(c) || c < 0 || c > 255)) {
      issues.push({
        severity: "error",
        code: "INVALID_COLOR_RGB",
        path: `${prefix}.colorRgb`,
        message: `Material "${id}" colorRgb must be [R, G, B] integers in 0..255.`,
      });
    }

    // 11. Strength validation
    if (material.strength !== undefined && (typeof material.strength !== "number" || !Number.isFinite(material.strength) || material.strength < 0)) {
      issues.push({
        severity: "error",
        code: "INVALID_STRENGTH",
        path: `${prefix}.strength`,
        message: `Material "${id}" strength must be a finite number >= 0.`,
      });
    }

    // 12. Transparent material not diggable unless explicitly allowed
    if (material.transparent && material.diggable && !material.allowTransparentDigging) {
      issues.push({
        severity: "error",
        code: "TRANSPARENT_DIGGABLE",
        path: prefix,
        message: `Material "${id}" is transparent and diggable, which is not allowed unless allowTransparentDigging is true.`,
      });
    }

    // 13. Water material must be transparent
    if (material.kind === "water" && !material.transparent) {
      issues.push({
        severity: "error",
        code: "WATER_MUST_BE_TRANSPARENT",
        path: `${prefix}.transparent`,
        message: `Material "${id}" is of kind water but is not transparent.`,
      });
    }
  }

  // Validate Texture Slots
  const uniqueIndices = new Map<number, string>();
  for (const [id, slot] of registry.textureSlots.entries()) {
    const prefix = `textureSlots.${id}`;
    // 2. ID validation
    if (!isValidId(id)) {
      issues.push({
        severity: "error",
        code: "INVALID_ID_FORMAT",
        path: prefix,
        message: `Texture slot ID "${id}" must be lowercase kebab-case.`,
      });
    }

    // 3. Missing material reference
    if (slot.materialId && !registry.materials.has(slot.materialId)) {
      issues.push({
        severity: "error",
        code: "MISSING_MATERIAL_REF",
        path: `${prefix}.materialId`,
        message: `Texture slot "${id}" references missing material "${slot.materialId}".`,
      });
    }

    if (!KNOWN_TEXTURE_SLOT_SOURCES.has(slot.source)) {
      issues.push({
        severity: "error",
        code: "INVALID_TEXTURE_SOURCE",
        path: `${prefix}.source`,
        message: `Texture slot "${id}" source must be builtin, user, or generated.`,
      });
    }

    // 8. Non-negative integer index
    if (!Number.isInteger(slot.slotIndex) || slot.slotIndex < 0) {
      issues.push({
        severity: "error",
        code: "INVALID_SLOT_INDEX",
        path: `${prefix}.slotIndex`,
        message: `Texture slot "${id}" slotIndex must be a non-negative integer, got ${slot.slotIndex}.`,
      });
    }

    // 9. Unique slotIndex check
    if (!slot.alias) {
      if (uniqueIndices.has(slot.slotIndex)) {
        issues.push({
          severity: "error",
          code: "DUPLICATE_SLOT_INDEX",
          path: `${prefix}.slotIndex`,
          message: `Texture slot "${id}" shares slotIndex ${slot.slotIndex} with "${uniqueIndices.get(slot.slotIndex)}" but is not marked as alias.`,
        });
      } else {
        uniqueIndices.set(slot.slotIndex, id);
      }
    }
  }

  // Validate Biomes
  for (const [id, biome] of registry.biomes.entries()) {
    const prefix = `biomes.${id}`;
    // 2. ID validation
    if (!isValidId(id)) {
      issues.push({
        severity: "error",
        code: "INVALID_ID_FORMAT",
        path: prefix,
        message: `Biome ID "${id}" must be lowercase kebab-case.`,
      });
    }

    // 20. defaultMaterialId check
    if (!registry.materials.has(biome.defaultMaterialId)) {
      issues.push({
        severity: "error",
        code: "MISSING_MATERIAL_REF",
        path: `${prefix}.defaultMaterialId`,
        message: `Biome "${id}" defaultMaterialId references missing material "${biome.defaultMaterialId}".`,
      });
    }

    // 21. waterMaterialId check
    if (biome.waterMaterialId) {
      const waterMat = registry.materials.get(biome.waterMaterialId);
      if (!waterMat) {
        issues.push({
          severity: "error",
          code: "MISSING_MATERIAL_REF",
          path: `${prefix}.waterMaterialId`,
          message: `Biome "${id}" waterMaterialId references missing material "${biome.waterMaterialId}".`,
        });
      } else {
        if (waterMat.kind !== "water" && !waterMat.transparent) {
          issues.push({
            severity: "error",
            code: "INVALID_WATER_MATERIAL",
            path: `${prefix}.waterMaterialId`,
            message: `Biome "${id}" waterMaterialId "${biome.waterMaterialId}" must point to a water or transparent material.`,
          });
        }
      }
    }

    // Validate Terrain Bands inside biome
    const bands = biome.terrainBands || [];
    const sortedBands = [...bands].sort((a, b) => a.minHeight - b.minHeight);

    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const bandPath = `${prefix}.terrainBands[${i}]`;

      // 18. materialId check
      if (!registry.materials.has(band.materialId)) {
        issues.push({
          severity: "error",
          code: "MISSING_MATERIAL_REF",
          path: `${bandPath}.materialId`,
          message: `Terrain band "${band.id}" in biome "${id}" references missing material "${band.materialId}".`,
        });
      }

      // 19. textureSlotId check
      if (!registry.textureSlots.has(band.textureSlotId)) {
        issues.push({
          severity: "error",
          code: "MISSING_TEXTURE_SLOT_REF",
          path: `${bandPath}.textureSlotId`,
          message: `Terrain band "${band.id}" in biome "${id}" references missing texture slot "${band.textureSlotId}".`,
        });
      }

      // 5. minHeight >= maxHeight check
      if (band.minHeight >= band.maxHeight) {
        issues.push({
          severity: "error",
          code: "INVALID_HEIGHT_RANGE",
          path: bandPath,
          message: `Terrain band "${band.id}" in biome "${id}" has invalid height range [${band.minHeight}, ${band.maxHeight}].`,
        });
      }
    }

    // 6. Overlapping terrain bands check
    for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        const b1 = bands[i];
        const b2 = bands[j];
        if (b1.minHeight < b2.maxHeight && b2.minHeight < b1.maxHeight) {
          issues.push({
            severity: "error",
            code: "OVERLAPPING_TERRAIN_BANDS",
            path: `${prefix}.terrainBands`,
            message: `Terrain bands "${b1.id}" and "${b2.id}" in biome "${id}" overlap.`,
          });
        }
      }
    }

    // 7. Gaps check
    for (let i = 0; i < sortedBands.length - 1; i++) {
      if (sortedBands[i].maxHeight < sortedBands[i + 1].minHeight) {
        const severity = strict ? "error" : "warning";
        issues.push({
          severity,
          code: "TERRAIN_BAND_GAP",
          path: `${prefix}.terrainBands`,
          message: `Terrain bands in biome "${id}" leave a height gap between ${sortedBands[i].maxHeight} and ${sortedBands[i + 1].minHeight}.`,
        });
      }
    }
  }

  // Validate CLOD Debug Presets
  for (const [id, preset] of registry.clodDebugPresets.entries()) {
    const prefix = `clodDebugPresets.${id}`;
    // 2. ID validation
    if (!isValidId(id)) {
      issues.push({
        severity: "error",
        code: "INVALID_ID_FORMAT",
        path: prefix,
        message: `Debug preset ID "${id}" must be lowercase kebab-case.`,
      });
    }

    // 17. errorPx > 0 validation
    if (preset.errorPx === undefined || typeof preset.errorPx !== "number" || !Number.isFinite(preset.errorPx) || preset.errorPx <= 0) {
      issues.push({
        severity: "error",
        code: "INVALID_ERROR_PX",
        path: `${prefix}.errorPx`,
        message: `Debug preset "${id}" errorPx must be a finite number > 0.`,
      });
    }
  }

  // Validate Snap Pieces
  for (const [id, piece] of registry.snapPieces.entries()) {
    const prefix = `snapPieces.${id}`;
    // 2. ID validation
    if (!isValidId(id)) {
      issues.push({
        severity: "error",
        code: "INVALID_ID_FORMAT",
        path: prefix,
        message: `Snap piece ID "${id}" must be lowercase kebab-case.`,
      });
    }

    // 14. Snap piece dimensions must be positive finite numbers
    const dims = piece.dimensions;
    if (!Array.isArray(dims) || dims.length !== 3 || dims.some(d => typeof d !== "number" || !Number.isFinite(d) || d <= 0)) {
      issues.push({
        severity: "error",
        code: "INVALID_SNAP_PIECE_DIMENSIONS",
        path: `${prefix}.dimensions`,
        message: `Snap piece "${id}" dimensions must be 3 positive finite numbers.`,
      });
    }

    // 3. Material reference check (if defined)
    if (piece.materialId && !registry.materials.has(piece.materialId)) {
      issues.push({
        severity: "error",
        code: "MISSING_MATERIAL_REF",
        path: `${prefix}.materialId`,
        message: `Snap piece "${id}" references missing material "${piece.materialId}".`,
      });
    }

    // Validate Snap Points
    const points = piece.snapPoints || [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const pointPath = `${prefix}.snapPoints[${i}]`;

      // 15. Directions are normalized or normalizable
      const dir = pt.direction;
      if (!Array.isArray(dir) || dir.length !== 3 || dir.some(d => typeof d !== "number" || !Number.isFinite(d))) {
        issues.push({
          severity: "error",
          code: "INVALID_SNAP_POINT_DIRECTION",
          path: `${pointPath}.direction`,
          message: `Snap point "${pt.id}" in snap piece "${id}" direction must be 3 finite numbers.`,
        });
      } else {
        const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
        if (len < 1e-6) {
          issues.push({
            severity: "error",
            code: "UNNORMALIZABLE_DIRECTION",
            path: `${pointPath}.direction`,
            message: `Snap point "${pt.id}" in snap piece "${id}" direction vector is too close to zero (magnitude ${len}).`,
          });
        }
      }

      // 16. compatibleGroups reference known groups
      if (!KNOWN_SNAP_GROUPS.has(pt.group)) {
        issues.push({
          severity: "error",
          code: "UNKNOWN_SNAP_GROUP",
          path: `${pointPath}.group`,
          message: `Snap point "${pt.id}" has unknown group "${pt.group}".`,
        });
      }
      if (Array.isArray(pt.compatibleGroups)) {
        for (let j = 0; j < pt.compatibleGroups.length; j++) {
          const cg = pt.compatibleGroups[j];
          if (!KNOWN_SNAP_GROUPS.has(cg)) {
            issues.push({
              severity: "error",
              code: "UNKNOWN_COMPATIBLE_SNAP_GROUP",
              path: `${pointPath}.compatibleGroups[${j}]`,
              message: `Snap point "${pt.id}" compatibleGroups contains unknown group "${cg}".`,
            });
          }
        }
      }
    }
  }

  const errors = issues.filter(issue => issue.severity === "error");
  const warnings = issues.filter(issue => issue.severity === "warning");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
