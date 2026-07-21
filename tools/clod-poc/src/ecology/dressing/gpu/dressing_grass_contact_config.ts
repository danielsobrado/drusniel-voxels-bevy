import { load } from "js-yaml";
import configText from "../../../../config/dressing_grass_contact.yaml?raw";
import { DRESSING_CLASSES, type DressingClassId } from "../class_registry.js";

export const DRESSING_GRASS_CONTACT_STRENGTH_SCALE = 65_535;

export interface DressingGrassContactClassPolicy {
  readonly radiusM: number;
  readonly strength: number;
}

export interface DressingGrassContactConfig {
  readonly enabled: boolean;
  readonly fieldGrid: number;
  readonly fieldCellM: number;
  readonly coreFraction: number;
  readonly classes: Readonly<Partial<Record<DressingClassId, DressingGrassContactClassPolicy>>>;
}

type RawObject = Record<string, unknown>;

const DEFAULT_CONFIG: DressingGrassContactConfig = Object.freeze({
  enabled: false,
  fieldGrid: 192,
  fieldCellM: 1,
  coreFraction: 0.55,
  classes: Object.freeze({}),
});

const CONFIG = parseDressingGrassContactConfig(configText);

export function parseDressingGrassContactConfig(text: string): DressingGrassContactConfig {
  const document = objectFrom(load(text), "dressing grass-contact config");
  assertKnownKeys(document, new Set(["dressing_grass_contact"]), "config root");
  const root = objectFrom(document.dressing_grass_contact, "dressing_grass_contact");
  assertKnownKeys(root, new Set(["enabled", "field_grid", "field_cell_m", "core_fraction", "classes"]), "dressing_grass_contact");

  const rawClasses = objectFrom(root.classes, "dressing_grass_contact.classes");
  const knownClasses = new Set<string>(DRESSING_CLASSES);
  const unknownClass = Object.keys(rawClasses).find((key) => !knownClasses.has(key));
  if (unknownClass) throw new Error(`unknown dressing grass-contact class: ${unknownClass}`);

  const classes: Partial<Record<DressingClassId, DressingGrassContactClassPolicy>> = {};
  for (const classId of DRESSING_CLASSES) {
    const rawValue = rawClasses[classId];
    if (rawValue === undefined) continue;
    const raw = objectFrom(rawValue, `dressing_grass_contact.classes.${classId}`);
    assertKnownKeys(raw, new Set(["radius_m", "strength"]), `dressing_grass_contact.classes.${classId}`);
    classes[classId] = Object.freeze({
      radiusM: requiredFinite(raw.radius_m, `${classId}.radius_m`, 0.01, 32),
      strength: requiredFinite(raw.strength, `${classId}.strength`, 0, 1),
    });
  }

  const fieldGrid = integer(root.field_grid, DEFAULT_CONFIG.fieldGrid, "field_grid", 16, 512);
  if (fieldGrid % 8 !== 0) throw new Error("dressing grass-contact field_grid must be divisible by 8");

  return Object.freeze({
    enabled: booleanValue(root.enabled, DEFAULT_CONFIG.enabled, "enabled"),
    fieldGrid,
    fieldCellM: finite(root.field_cell_m, DEFAULT_CONFIG.fieldCellM, "field_cell_m", 0.1, 8),
    coreFraction: finite(root.core_fraction, DEFAULT_CONFIG.coreFraction, "core_fraction", 0, 1),
    classes: Object.freeze(classes),
  });
}

export function readDressingGrassContactConfig(): DressingGrassContactConfig {
  return {
    ...CONFIG,
    classes: Object.fromEntries(
      Object.entries(CONFIG.classes).map(([classId, policy]) => [classId, policy ? { ...policy } : policy]),
    ) as Partial<Record<DressingClassId, DressingGrassContactClassPolicy>>,
  };
}

export function dressingGrassContactPolicy(classId: DressingClassId): DressingGrassContactClassPolicy | null {
  return CONFIG.classes[classId] ?? null;
}

function objectFrom(value: unknown, label: string): RawObject {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RawObject;
}

function assertKnownKeys(value: RawObject, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown ${label} key: ${unknown}`);
}

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function finite(value: unknown, fallback: number, label: string, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function requiredFinite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (value === undefined) throw new Error(`${label} is required`);
  return finite(value, minimum, label, minimum, maximum);
}

function integer(value: unknown, fallback: number, label: string, minimum: number, maximum: number): number {
  const result = finite(value, fallback, label, minimum, maximum);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer`);
  return result;
}
