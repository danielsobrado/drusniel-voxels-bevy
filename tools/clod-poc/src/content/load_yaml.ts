import { load } from "js-yaml";
import { ContentRegistry, ContentValidationIssue } from "./types.js";
import {
  DEFAULT_MATERIALS,
  DEFAULT_TEXTURE_SLOTS,
  DEFAULT_BIOMES,
  DEFAULT_CLOD_DEBUG_PRESETS,
  DEFAULT_SNAP_PIECES,
} from "./defaults.js";

// Statically imported YAML files (with ?raw) so they're always bundled for Vite
import materialsYamlText from "../../config/content/materials.yaml?raw";
import textureSlotsYamlText from "../../config/content/texture_slots.yaml?raw";
import biomesYamlText from "../../config/content/biomes.yaml?raw";
import clodDebugPresetsYamlText from "../../config/content/clod_debug_presets.yaml?raw";
import snapPiecesYamlText from "../../config/content/snap_pieces.yaml?raw";

let readFileSyncFn: ((path: string, encoding: "utf8") => string) | undefined;
let existsSyncFn: ((path: string) => boolean) | undefined;
let joinPathFn: ((...paths: string[]) => string) | undefined;

// Use top-level await in Vite/Node environment to conditionally load fs/path
if (typeof window === "undefined" && typeof process !== "undefined" && process.versions?.node) {
  try {
    const fs = await import(/* @vite-ignore */ "node:fs");
    const path = await import(/* @vite-ignore */ "node:path");
    readFileSyncFn = fs.readFileSync;
    existsSyncFn = fs.existsSync;
    joinPathFn = path.join;
  } catch (e) {
    // ignore
  }
}

export function loadContentRegistry(options?: { rootDir?: string; strict?: boolean }): ContentRegistry {
  const strict = options?.strict ?? false;
  const errors: ContentValidationIssue[] = [];

  let materialsText = materialsYamlText;
  let textureSlotsText = textureSlotsYamlText;
  let biomesText = biomesYamlText;
  let clodDebugPresetsText = clodDebugPresetsYamlText;
  let snapPiecesText = snapPiecesYamlText;

  const rootDir = options?.rootDir || "config/content";

  if (typeof window === "undefined" && readFileSyncFn && existsSyncFn && joinPathFn) {
    const loadFile = (fileName: string, defaultText: string): string => {
      const fullPath = joinPathFn!(rootDir, fileName);
      if (existsSyncFn!(fullPath)) {
        try {
          return readFileSyncFn!(fullPath, "utf8");
        } catch (e) {
          if (strict) {
            throw new Error(`Failed to read file ${fullPath}: ${e}`);
          }
          console.warn(`[ContentRegistry] Warning: Failed to read ${fullPath}. Falling back to default.`);
          errors.push({
            severity: "warning",
            code: "LOAD_FILE_FAILED",
            path: fullPath,
            message: `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
          });
          return defaultText;
        }
      } else {
        if (strict) {
          throw new Error(`Required file ${fullPath} is missing.`);
        }
        console.warn(`[ContentRegistry] Warning: ${fullPath} not found. Falling back to default.`);
        errors.push({
          severity: "warning",
          code: "FILE_MISSING",
          path: fullPath,
          message: `File not found on disk.`,
        });
        return defaultText;
      }
    };

    materialsText = loadFile("materials.yaml", materialsYamlText);
    textureSlotsText = loadFile("texture_slots.yaml", textureSlotsYamlText);
    biomesText = loadFile("biomes.yaml", biomesYamlText);
    clodDebugPresetsText = loadFile("clod_debug_presets.yaml", clodDebugPresetsYamlText);
    snapPiecesText = loadFile("snap_pieces.yaml", snapPiecesYamlText);
  }

  const parseYaml = (text: string, fallback: any, category: string): any => {
    try {
      const result = load(text);
      if (!result || typeof result !== "object") {
        throw new Error("Parsed YAML is not an array or object");
      }
      return result;
    } catch (e) {
      if (strict) {
        throw new Error(`YAML syntax error in ${category}: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.warn(`[ContentRegistry] Warning: Failed to parse YAML for ${category}. Falling back to defaults.`);
      errors.push({
        severity: "error",
        code: "YAML_PARSE_ERROR",
        path: category,
        message: `YAML syntax error: ${e instanceof Error ? e.message : String(e)}`,
      });
      return fallback;
    }
  };

  const parsedMaterials = parseYaml(materialsText, DEFAULT_MATERIALS, "materials");
  const parsedTextureSlots = parseYaml(textureSlotsText, DEFAULT_TEXTURE_SLOTS, "texture_slots");
  const parsedBiomes = parseYaml(biomesText, DEFAULT_BIOMES, "biomes");
  const parsedDebugPresets = parseYaml(clodDebugPresetsText, DEFAULT_CLOD_DEBUG_PRESETS, "clod_debug_presets");
  const parsedSnapPieces = parseYaml(snapPiecesText, DEFAULT_SNAP_PIECES, "snap_pieces");

  const buildMap = <T extends { id: string }>(parsed: any, category: string): Map<string, T> => {
    const map = new Map<string, T>();
    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (item && typeof item === "object") {
          if (typeof item.id === "string" && item.id.trim() !== "") {
            if (map.has(item.id)) {
              errors.push({
                severity: "error",
                code: "DUPLICATE_ID",
                path: `${category}.${item.id}`,
                message: `Duplicate ID "${item.id}" found in ${category}.`,
              });
            }
            map.set(item.id, item);
          } else {
            errors.push({
              severity: "error",
              code: "INVALID_ENTRY",
              path: `${category}[${i}]`,
              message: `Entry is missing a valid string "id".`,
            });
          }
        } else {
          errors.push({
            severity: "error",
            code: "INVALID_ENTRY",
            path: `${category}[${i}]`,
            message: `Entry is not a valid object.`,
          });
        }
      }
    } else {
      errors.push({
        severity: "error",
        code: "INVALID_CATEGORY_FORMAT",
        path: category,
        message: `${category} content YAML must define a list of entries.`,
      });
    }
    return map;
  };

  const materials = buildMap<any>(parsedMaterials, "materials");
  const textureSlots = buildMap<any>(parsedTextureSlots, "texture_slots");
  const biomes = buildMap<any>(parsedBiomes, "biomes");
  const clodDebugPresets = buildMap<any>(parsedDebugPresets, "clod_debug_presets");
  const snapPieces = buildMap<any>(parsedSnapPieces, "snap_pieces");

  return {
    materials,
    textureSlots,
    biomes,
    clodDebugPresets,
    snapPieces,
    _errors: errors.length > 0 ? errors : undefined,
  };
}
