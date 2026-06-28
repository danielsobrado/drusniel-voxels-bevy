import { ContentRegistry, ContentValidationReport, ContentValidationIssue } from "./types.js";
import { isValidId } from "./ids.js";
import { BIOME_IDS } from "../world_source/biome_region_field.js";

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
const EXPECTED_SPATIAL_BIOME_IDS = new Set<number>(Object.values(BIOME_IDS));

function isValidRgb(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every(c => Number.isInteger(c) && c >= 0 && c <= 255);
}

function pushIssue(
  issues: ContentValidationIssue[],
  severity: ContentValidationIssue["severity"],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

export function validateContentRegistry(
  registry: ContentRegistry,
  options?: { strict?: boolean },
): ContentValidationReport {
  const strict = options?.strict ?? false;
  const issues: ContentValidationIssue[] = [];

  if (registry._errors) {
    issues.push(...registry._errors);
  }

  function scanForBannedTerms(val: any, path: string) {
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      for (const term of BANNED_TERMS) {
        if (lower.includes(term)) {
          pushIssue(issues, "error", "BANNED_TERM", path, `Value "${val}" contains banned gameplay term "${term}".`);
        }
      }
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) scanForBannedTerms(val[i], `${path}[${i}]`);
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

  for (const [id, material] of registry.materials.entries()) {
    const prefix = `materials.${id}`;
    if (!isValidId(id)) {
      pushIssue(issues, "error", "INVALID_ID_FORMAT", prefix, `Material ID "${id}" must be lowercase kebab-case.`);
    }

    if (!isValidRgb(material.colorRgb)) {
      pushIssue(issues, "error", "INVALID_COLOR_RGB", `${prefix}.colorRgb`, `Material "${id}" colorRgb must be [R, G, B] integers in 0..255.`);
    }

    if (material.strength !== undefined && (typeof material.strength !== "number" || !Number.isFinite(material.strength) || material.strength < 0)) {
      pushIssue(issues, "error", "INVALID_STRENGTH", `${prefix}.strength`, `Material "${id}" strength must be a finite number >= 0.`);
    }

    if (material.transparent && material.diggable && !material.allowTransparentDigging) {
      pushIssue(issues, "error", "TRANSPARENT_DIGGABLE", prefix, `Material "${id}" is transparent and diggable, which is not allowed unless allowTransparentDigging is true.`);
    }

    if (material.kind === "water" && !material.transparent) {
      pushIssue(issues, "error", "WATER_MUST_BE_TRANSPARENT", `${prefix}.transparent`, `Material "${id}" is of kind water but is not transparent.`);
    }
  }

  const uniqueIndices = new Map<number, string>();
  for (const [id, slot] of registry.textureSlots.entries()) {
    const prefix = `textureSlots.${id}`;
    if (!isValidId(id)) {
      pushIssue(issues, "error", "INVALID_ID_FORMAT", prefix, `Texture slot ID "${id}" must be lowercase kebab-case.`);
    }

    if (slot.materialId && !registry.materials.has(slot.materialId)) {
      pushIssue(issues, "error", "MISSING_MATERIAL_REF", `${prefix}.materialId`, `Texture slot "${id}" references missing material "${slot.materialId}".`);
    }

    if (!KNOWN_TEXTURE_SLOT_SOURCES.has(slot.source)) {
      pushIssue(issues, "error", "INVALID_TEXTURE_SOURCE", `${prefix}.source`, `Texture slot "${id}" source must be builtin, user, or generated.`);
    }

    if (!Number.isInteger(slot.slotIndex) || slot.slotIndex < 0) {
      pushIssue(issues, "error", "INVALID_SLOT_INDEX", `${prefix}.slotIndex`, `Texture slot "${id}" slotIndex must be a non-negative integer, got ${slot.slotIndex}.`);
    }

    if (!slot.alias) {
      if (uniqueIndices.has(slot.slotIndex)) {
        pushIssue(issues, "error", "DUPLICATE_SLOT_INDEX", `${prefix}.slotIndex`, `Texture slot "${id}" shares slotIndex ${slot.slotIndex} with "${uniqueIndices.get(slot.slotIndex)}" but is not marked as alias.`);
      } else {
        uniqueIndices.set(slot.slotIndex, id);
      }
    }
  }

  const seenSpatialBiomeIds = new Map<number, string>();

  for (const [id, biome] of registry.biomes.entries()) {
    const prefix = `biomes.${id}`;
    if (!isValidId(id)) {
      pushIssue(issues, "error", "INVALID_ID_FORMAT", prefix, `Biome ID "${id}" must be lowercase kebab-case.`);
    }

    if (!registry.materials.has(biome.defaultMaterialId)) {
      pushIssue(issues, "error", "MISSING_MATERIAL_REF", `${prefix}.defaultMaterialId`, `Biome "${id}" defaultMaterialId references missing material "${biome.defaultMaterialId}".`);
    }

    if (biome.waterMaterialId) {
      const waterMat = registry.materials.get(biome.waterMaterialId);
      if (!waterMat) {
        pushIssue(issues, "error", "MISSING_MATERIAL_REF", `${prefix}.waterMaterialId`, `Biome "${id}" waterMaterialId references missing material "${biome.waterMaterialId}".`);
      } else if (waterMat.kind !== "water" && !waterMat.transparent) {
        pushIssue(issues, "error", "INVALID_WATER_MATERIAL", `${prefix}.waterMaterialId`, `Biome "${id}" waterMaterialId "${biome.waterMaterialId}" must point to a water or transparent material.`);
      }
    }

    const textureSlotSet = biome.textureSlotSet || [];
    if (!Array.isArray(textureSlotSet) || textureSlotSet.length === 0) {
      pushIssue(issues, "error", "MISSING_TEXTURE_SLOT_SET", `${prefix}.textureSlotSet`, `Biome "${id}" must define a non-empty textureSlotSet.`);
    } else {
      for (let i = 0; i < textureSlotSet.length; i++) {
        const slotId = textureSlotSet[i];
        if (!registry.textureSlots.has(slotId)) {
          pushIssue(issues, "error", "MISSING_TEXTURE_SLOT_REF", `${prefix}.textureSlotSet[${i}]`, `Biome "${id}" textureSlotSet references missing texture slot "${slotId}".`);
        }
      }
    }

    if (biome.biomeId !== undefined) {
      if (!Number.isInteger(biome.biomeId) || biome.biomeId < 0) {
        pushIssue(issues, "error", "INVALID_BIOME_ID", `${prefix}.biomeId`, `Biome "${id}" biomeId must be a non-negative integer.`);
      } else {
        const previous = seenSpatialBiomeIds.get(biome.biomeId);
        if (previous) {
          pushIssue(issues, "error", "DUPLICATE_BIOME_ID", `${prefix}.biomeId`, `Biome "${id}" duplicates biomeId ${biome.biomeId} already used by "${previous}".`);
        } else {
          seenSpatialBiomeIds.set(biome.biomeId, id);
        }
      }

      if (!biome.region) {
        pushIssue(issues, "error", "MISSING_BIOME_REGION", `${prefix}.region`, `Biome "${id}" with biomeId ${biome.biomeId} must define a spatial region block.`);
      } else {
        if (biome.region.kind !== "spatial") {
          pushIssue(issues, "error", "INVALID_BIOME_REGION_KIND", `${prefix}.region.kind`, `Biome "${id}" region.kind must be spatial.`);
        }
        if (biome.region.biomeId !== biome.biomeId) {
          pushIssue(issues, "error", "BIOME_REGION_ID_MISMATCH", `${prefix}.region.biomeId`, `Biome "${id}" region.biomeId must match biomeId ${biome.biomeId}.`);
        }
        if (!isValidRgb(biome.region.debugColorRgb)) {
          pushIssue(issues, "error", "INVALID_BIOME_DEBUG_COLOR", `${prefix}.region.debugColorRgb`, `Biome "${id}" region.debugColorRgb must be [R, G, B] integers in 0..255.`);
        }
        if (typeof biome.region.canopyDensity !== "number" || !Number.isFinite(biome.region.canopyDensity) || biome.region.canopyDensity < 0 || biome.region.canopyDensity > 1) {
          pushIssue(issues, "error", "INVALID_BIOME_CANOPY_DENSITY", `${prefix}.region.canopyDensity`, `Biome "${id}" region.canopyDensity must be a finite number in 0..1.`);
        }
        if (!Array.isArray(biome.region.terrainTextureSlots) || biome.region.terrainTextureSlots.length === 0) {
          pushIssue(issues, "error", "MISSING_BIOME_REGION_TEXTURES", `${prefix}.region.terrainTextureSlots`, `Biome "${id}" region must define terrainTextureSlots.`);
        } else {
          for (let i = 0; i < biome.region.terrainTextureSlots.length; i++) {
            const slotId = biome.region.terrainTextureSlots[i];
            if (!registry.textureSlots.has(slotId)) {
              pushIssue(issues, "error", "MISSING_TEXTURE_SLOT_REF", `${prefix}.region.terrainTextureSlots[${i}]`, `Biome "${id}" region references missing texture slot "${slotId}".`);
            }
            if (!textureSlotSet.includes(slotId)) {
              pushIssue(issues, "error", "BIOME_REGION_TEXTURE_NOT_IN_SET", `${prefix}.region.terrainTextureSlots[${i}]`, `Biome "${id}" region texture slot "${slotId}" must also appear in textureSlotSet.`);
            }
          }
        }
      }
    }

    const bands = biome.terrainBands || [];
    const sortedBands = [...bands].sort((a, b) => a.minHeight - b.minHeight);
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const bandPath = `${prefix}.terrainBands[${i}]`;

      if (!registry.materials.has(band.materialId)) {
        pushIssue(issues, "error", "MISSING_MATERIAL_REF", `${bandPath}.materialId`, `Terrain band "${band.id}" in biome "${id}" references missing material "${band.materialId}".`);
      }

      if (!registry.textureSlots.has(band.textureSlotId)) {
        pushIssue(issues, "error", "MISSING_TEXTURE_SLOT_REF", `${bandPath}.textureSlotId`, `Terrain band "${band.id}" in biome "${id}" references missing texture slot "${band.textureSlotId}".`);
      }

      if (band.minHeight >= band.maxHeight) {
        pushIssue(issues, "error", "INVALID_HEIGHT_RANGE", bandPath, `Terrain band "${band.id}" in biome "${id}" has invalid height range [${band.minHeight}, ${band.maxHeight}].`);
      }
    }

    for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        const b1 = bands[i];
        const b2 = bands[j];
        if (b1.minHeight < b2.maxHeight && b2.minHeight < b1.maxHeight) {
          pushIssue(issues, "error", "OVERLAPPING_TERRAIN_BANDS", `${prefix}.terrainBands`, `Terrain bands "${b1.id}" and "${b2.id}" in biome "${id}" overlap.`);
        }
      }
    }

    for (let i = 0; i < sortedBands.length - 1; i++) {
      if (sortedBands[i].maxHeight < sortedBands[i + 1].minHeight) {
        const severity = strict ? "error" : "warning";
        pushIssue(issues, severity, "TERRAIN_BAND_GAP", `${prefix}.terrainBands`, `Terrain bands in biome "${id}" leave a height gap between ${sortedBands[i].maxHeight} and ${sortedBands[i + 1].minHeight}.`);
      }
    }
  }

  for (const expectedId of EXPECTED_SPATIAL_BIOME_IDS) {
    if (!seenSpatialBiomeIds.has(expectedId)) {
      pushIssue(issues, "error", "MISSING_SPATIAL_BIOME_CONTENT", `biomes.biomeId(${expectedId})`, `Missing spatial biome content entry for biomeId ${expectedId}.`);
    }
  }

  for (const [id, preset] of registry.clodDebugPresets.entries()) {
    const prefix = `clodDebugPresets.${id}`;
    if (!isValidId(id)) {
      pushIssue(issues, "error", "INVALID_ID_FORMAT", prefix, `Debug preset ID "${id}" must be lowercase kebab-case.`);
    }

    if (preset.errorPx === undefined || typeof preset.errorPx !== "number" || !Number.isFinite(preset.errorPx) || preset.errorPx <= 0) {
      pushIssue(issues, "error", "INVALID_ERROR_PX", `${prefix}.errorPx`, `Debug preset "${id}" errorPx must be a finite number > 0.`);
    }
  }

  for (const [id, piece] of registry.snapPieces.entries()) {
    const prefix = `snapPieces.${id}`;
    if (!isValidId(id)) {
      pushIssue(issues, "error", "INVALID_ID_FORMAT", prefix, `Snap piece ID "${id}" must be lowercase kebab-case.`);
    }

    const dims = piece.dimensions;
    if (!Array.isArray(dims) || dims.length !== 3 || dims.some(d => typeof d !== "number" || !Number.isFinite(d) || d <= 0)) {
      pushIssue(issues, "error", "INVALID_SNAP_PIECE_DIMENSIONS", `${prefix}.dimensions`, `Snap piece "${id}" dimensions must be 3 positive finite numbers.`);
    }

    if (piece.materialId && !registry.materials.has(piece.materialId)) {
      pushIssue(issues, "error", "MISSING_MATERIAL_REF", `${prefix}.materialId`, `Snap piece "${id}" references missing material "${piece.materialId}".`);
    }

    const points = piece.snapPoints || [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const pointPath = `${prefix}.snapPoints[${i}]`;
      const dir = pt.direction;
      if (!Array.isArray(dir) || dir.length !== 3 || dir.some(d => typeof d !== "number" || !Number.isFinite(d))) {
        pushIssue(issues, "error", "INVALID_SNAP_POINT_DIRECTION", `${pointPath}.direction`, `Snap point "${pt.id}" in snap piece "${id}" direction must be 3 finite numbers.`);
      } else {
        const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
        if (len < 1e-6) {
          pushIssue(issues, "error", "UNNORMALIZABLE_DIRECTION", `${pointPath}.direction`, `Snap point "${pt.id}" in snap piece "${id}" direction vector is too close to zero (magnitude ${len}).`);
        }
      }

      if (!KNOWN_SNAP_GROUPS.has(pt.group)) {
        pushIssue(issues, "error", "UNKNOWN_SNAP_GROUP", `${pointPath}.group`, `Snap point "${pt.id}" has unknown group "${pt.group}".`);
      }
      if (Array.isArray(pt.compatibleGroups)) {
        for (let j = 0; j < pt.compatibleGroups.length; j++) {
          const cg = pt.compatibleGroups[j];
          if (!KNOWN_SNAP_GROUPS.has(cg)) {
            pushIssue(issues, "error", "UNKNOWN_COMPATIBLE_SNAP_GROUP", `${pointPath}.compatibleGroups[${j}]`, `Snap point "${pt.id}" compatibleGroups contains unknown group "${cg}".`);
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
