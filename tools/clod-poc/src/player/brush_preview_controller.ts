import * as THREE from "three";
import type { BrushOp, BrushShape } from "../terrain/terrain.js";
import type { TerrainSurfaceHit } from "../terrain/terrain_collider.js";
import type { PlayerInteractionMode } from "../player_controller.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";

const DIG_PREVIEW_COLOR = 0xff5533;
const RAISE_PREVIEW_COLOR = 0x55dd66;
const PREVIEW_OPACITY = 0.35;
const PREVIEW_RENDER_ORDER = 100;
const PREVIEW_RAYCAST_INTERVAL_MS = 33;
const PREVIEW_RAY_EPSILON_SQ = 1e-8;

export interface BrushPreviewController {
  readonly mesh: THREE.Mesh;
  update(options: {
    digEnabled: boolean;
    interactionMode: PlayerInteractionMode;
    terraformEditActive: boolean;
    brushShape: BrushShape;
    brushOp: BrushOp;
    digRadius: number;
    brushHeight: number;
    terrainRevision: number;
    raycastEditableTerrain: (ray: THREE.Ray) => TerrainSurfaceHit | null;
    getPlayingAimRay: () => THREE.Ray;
    getOrbitHoverRay: () => THREE.Ray | null;
  }): void;
  hide(): void;
}

export function createBrushPreviewController(scene: THREE.Scene): BrushPreviewController {
  const brushPreviewGeometries: Record<BrushShape, THREE.BufferGeometry> = {
    sphere: new THREE.SphereGeometry(1, 24, 16),
    cube: new THREE.BoxGeometry(2, 2, 2),
    cylinder: new THREE.CylinderGeometry(1, 1, 2, 28),
  };
  const material = trackedMeshBasicMaterial({
    color: DIG_PREVIEW_COLOR,
    transparent: true,
    opacity: PREVIEW_OPACITY,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  }, "brush-preview");
  const mesh = new THREE.Mesh(brushPreviewGeometries.sphere, material);
  const lastRayOrigin = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  const lastRayDirection = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  let lastRaycastAt = -Infinity;
  let lastTerrainRevision = -1;
  let cachedHit: TerrainSurfaceHit | null = null;
  mesh.renderOrder = PREVIEW_RENDER_ORDER;
  mesh.visible = false;
  scene.add(mesh);

  const clearCachedHit = (): void => {
    cachedHit = null;
    lastRaycastAt = -Infinity;
    lastTerrainRevision = -1;
    lastRayOrigin.set(Number.NaN, Number.NaN, Number.NaN);
    lastRayDirection.set(Number.NaN, Number.NaN, Number.NaN);
  };

  return {
    mesh,
    update(options) {
      const previewEnabled = options.digEnabled && options.terraformEditActive;
      if (!previewEnabled) {
        clearCachedHit();
        mesh.visible = false;
        return;
      }

      const ray = options.interactionMode === "playing"
        ? options.getPlayingAimRay()
        : options.interactionMode === "orbit"
          ? options.getOrbitHoverRay()
          : null;
      if (!ray) {
        clearCachedHit();
        mesh.visible = false;
        return;
      }

      const now = performance.now();
      const rayChanged = lastRayOrigin.distanceToSquared(ray.origin) > PREVIEW_RAY_EPSILON_SQ
        || lastRayDirection.distanceToSquared(ray.direction) > PREVIEW_RAY_EPSILON_SQ;
      const terrainChanged = options.terrainRevision !== lastTerrainRevision;
      if (terrainChanged || (rayChanged && now - lastRaycastAt >= PREVIEW_RAYCAST_INTERVAL_MS)) {
        cachedHit = options.raycastEditableTerrain(ray);
        lastRayOrigin.copy(ray.origin);
        lastRayDirection.copy(ray.direction);
        lastRaycastAt = now;
        lastTerrainRevision = options.terrainRevision;
      }

      if (cachedHit) {
        mesh.position.copy(cachedHit.point);
        mesh.scale.set(
          Math.max(0.001, options.digRadius),
          Math.max(0.001, options.brushHeight),
          Math.max(0.001, options.digRadius),
        );
        mesh.geometry = brushPreviewGeometries[options.brushShape];
        material.color.setHex(options.brushOp === "add" ? RAISE_PREVIEW_COLOR : DIG_PREVIEW_COLOR);
      }
      mesh.visible = cachedHit !== null;
    },
    hide() {
      clearCachedHit();
      mesh.visible = false;
    },
  };
}
