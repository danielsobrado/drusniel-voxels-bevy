import type { ConstructionTerrainConformHandler } from "./types.js";

let activeHandler: ConstructionTerrainConformHandler | null = null;

export function setActiveConstructionTerrainConformHandler(
  handler: ConstructionTerrainConformHandler | null,
): void {
  activeHandler = handler;
}

export function getActiveConstructionTerrainConformHandler(): ConstructionTerrainConformHandler | null {
  return activeHandler;
}
