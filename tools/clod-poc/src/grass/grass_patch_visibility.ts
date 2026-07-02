import { grassShaderDefinition } from "./grass_geometry.js";
import type { GrassSettings } from "./grass_config.js";
import type { GrassPatch } from "./grass_system_support.js";

export function updateGrassPatchVisibility(input: {
  patch: GrassPatch;
  distance: number;
  settings: GrassSettings;
}): void {
  const { patch, distance, settings } = input;
  if (grassShaderDefinition(settings.shaderMode).patchStyle !== "terrain-patch") {
    const visible = distance <= settings.distance + patch.radius;
    patch.meshes[0].visible = visible;
    patch.visibleTier = visible ? "near" : "hidden";
    return;
  }

  const nearDistance = settings.distance * settings.lod.nearFraction + patch.radius;
  const midDistance = settings.distance * settings.lod.midFraction + patch.radius;
  const farDistance = settings.distance * settings.ring.farDistanceFraction + patch.radius;
  const coverageDistance = settings.distance + patch.radius;
  patch.meshes[0].visible = distance <= nearDistance;
  patch.meshes[1].visible = distance > nearDistance && distance <= midDistance;
  patch.meshes[2].visible = distance > midDistance && distance <= farDistance;
  patch.meshes[3].visible = distance > farDistance && distance <= coverageDistance;
  patch.visibleTier = patch.meshes[0].visible
    ? "near"
    : patch.meshes[1].visible
      ? "mid"
      : patch.meshes[2].visible ? "far" : patch.meshes[3].visible ? "super" : "hidden";
}
