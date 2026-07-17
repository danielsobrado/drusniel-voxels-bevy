import { load } from "js-yaml";
import spellsYamlText from "../../config/spells.yaml?raw";
import type { BrushOp, BrushShape } from "../terrain/terrain.js";

export interface EarthSpellGameplayConfig {
  enabled: boolean;
  operation: BrushOp;
  shape: BrushShape;
  radiusM: number;
  heightM: number;
  strength: number;
  falloff: number;
  material: number;
  commandExpiryMs: number;
}

export const DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG: Readonly<EarthSpellGameplayConfig> = Object.freeze({
  enabled: true,
  operation: "remove",
  shape: "sphere",
  radiusM: 2.4,
  heightM: 2.4,
  strength: 0.72,
  falloff: 0.35,
  material: 0,
  commandExpiryMs: 1000,
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function operation(value: unknown, fallback: BrushOp): BrushOp {
  return value === "add" || value === "remove" || value === "paint" ? value : fallback;
}

function shape(value: unknown, fallback: BrushShape): BrushShape {
  return value === "sphere" || value === "cube" || value === "cylinder" ? value : fallback;
}

export function parseEarthSpellGameplayConfig(
  text: string = spellsYamlText,
  fallback: Readonly<EarthSpellGameplayConfig> = DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
): EarthSpellGameplayConfig {
  try {
    const root = record(load(text));
    const spells = record(root?.["spells"]);
    const earth = record(spells?.["earth"]);
    const gameplay = record(earth?.["gameplay"]);
    return {
      enabled: bool(gameplay?.["terrain_edit_enabled"], fallback.enabled),
      operation: operation(gameplay?.["operation"], fallback.operation),
      shape: shape(gameplay?.["shape"], fallback.shape),
      radiusM: finite(gameplay?.["radius_m"], fallback.radiusM, 0.25, 20),
      heightM: finite(gameplay?.["height_m"], fallback.heightM, 0.25, 20),
      strength: finite(gameplay?.["strength"], fallback.strength, 0.01, 1),
      falloff: finite(gameplay?.["falloff"], fallback.falloff, 0, 1),
      material: Math.floor(finite(gameplay?.["material"], fallback.material, 0, 255)),
      commandExpiryMs: finite(gameplay?.["command_expiry_ms"], fallback.commandExpiryMs, 50, 5000),
    };
  } catch (error) {
    console.warn("[spells] failed to parse earth gameplay config; using defaults", error);
    return { ...fallback };
  }
}

export const earthSpellGameplayConfig = parseEarthSpellGameplayConfig();
