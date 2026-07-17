import type { TerrainRaycastService } from "./terrain_raycast_service.js";

let activeTerrainRaycastService: TerrainRaycastService | null = null;

export function setActiveTerrainRaycastService(service: TerrainRaycastService | null): void {
  activeTerrainRaycastService = service;
}

export function getActiveTerrainRaycastService(): TerrainRaycastService | null {
  return activeTerrainRaycastService;
}
