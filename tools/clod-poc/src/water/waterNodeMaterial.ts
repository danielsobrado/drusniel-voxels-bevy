import type * as THREE from "three";
import { sampleActiveForestCanopyEcology } from "../forest_lighting/forest_lighting_texture.js";
import {
  createWaterNodeMaterialImpl as createWaterNodeMaterialBase,
} from "./waterNodeMaterial_base.js";
import { applyCanopyWaterReflectionFallback } from "./water_canopy_reflection_fallback.js";
import type {
  WaterMaterialHandle,
  WaterMaterialParams,
} from "./water_material_types.js";
import type { WaterVisualConfig } from "./waterConfig.js";

export function createWaterNodeMaterialImpl(params: WaterMaterialParams): WaterMaterialHandle {
  const base = createWaterNodeMaterialBase(params);
  const cameraPosition = params.cameraPosition.clone();
  let visual = params.visual;
  let appliedTerrainStrength = visual.reflection.terrainFallbackStrength;
  let appliedSkyStrength = visual.reflection.skyFallbackStrength;

  const adjustedVisual = (): WaterVisualConfig =>
    applyCanopyWaterReflectionFallback(
      visual,
      sampleActiveForestCanopyEcology(cameraPosition.x, cameraPosition.z),
    );

  const syncCanopyFallback = (): void => {
    const next = adjustedVisual();
    const terrainStrength = next.reflection.terrainFallbackStrength;
    const skyStrength = next.reflection.skyFallbackStrength;
    if (
      terrainStrength === appliedTerrainStrength &&
      skyStrength === appliedSkyStrength
    ) {
      return;
    }
    base.updateVisual(next);
    appliedTerrainStrength = terrainStrength;
    appliedSkyStrength = skyStrength;
  };

  syncCanopyFallback();

  return {
    ...base,
    updateCamera(pos: THREE.Vector3): void {
      base.updateCamera(pos);
      cameraPosition.copy(pos);
      syncCanopyFallback();
    },
    updateVisual(next: WaterVisualConfig): void {
      visual = next;
      const adjusted = adjustedVisual();
      base.updateVisual(adjusted);
      appliedTerrainStrength = adjusted.reflection.terrainFallbackStrength;
      appliedSkyStrength = adjusted.reflection.skyFallbackStrength;
    },
  };
}
