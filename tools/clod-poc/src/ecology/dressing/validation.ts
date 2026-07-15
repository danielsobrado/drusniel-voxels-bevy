import { DRESSING_CLASSES, DRESSING_CLASS_DEFINITIONS } from "./class_registry.js";
import type { DressingConfig } from "./config.js";

export function validateDressingRegistry(): void {
  if (DRESSING_CLASSES.length !== 29 || new Set(DRESSING_CLASSES).size !== 29) {
    throw new Error("dressing registry must contain exactly 29 unique classes");
  }
  for (const id of DRESSING_CLASSES) {
    const definition = DRESSING_CLASS_DEFINITIONS[id];
    if (definition.id !== id) throw new Error(`dressing definition ID mismatch: ${id}`);
    if (![2, 4, 5, 6].includes(definition.placementStage)) throw new Error(`invalid dressing placement stage: ${id}`);
    if (definition.lodDistancesM[0] > definition.lodDistancesM[1] || definition.lodDistancesM[1] > definition.lodDistancesM[2]) {
      throw new Error(`unordered dressing LOD distances: ${id}`);
    }
  }
}

export function validateDressingConfig(config: DressingConfig): void {
  if (config.schemaVersion !== 1) throw new Error(`unsupported ecological dressing schema: ${config.schemaVersion}`);
  if (config.generatorSchemaVersion < 1) throw new Error("generator schema version must be positive");
  if (config.persistence.saveCosmeticItems) throw new Error("cosmetic dressing serialization is forbidden");
}

export function validateDressingStartup(config: DressingConfig): void {
  validateDressingRegistry();
  validateDressingConfig(config);
}
