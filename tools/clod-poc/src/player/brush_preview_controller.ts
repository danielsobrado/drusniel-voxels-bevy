import * as THREE from "three";
import type { BrushOp, BrushShape } from "../terrain/terrain.js";
import type { TerrainSurfaceHit } from "../terrain/terrain_collider.js";
import type { PlayerInteractionMode } from "../player_controller.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";

const DIG_PREVIEW_COLOR = 0xff5533;
const RAISE_PREVIEW_COLOR = 0x55dd66;
const PREVIEW_OPACITY = 0.35;
const PREVIEW_RENDER_ORDER = 100;

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
  mesh.renderOrder = PREVIEW_RENDER_ORDER;
  mesh.visible = false;
  scene.add(mesh);

  return {
    mesh,
    update(options) {
      let digAimHit: TerrainSurfaceHit | null = null;
      const previewEnabled = options.digEnabled && options.terraformEditActive;
      if (previewEnabled && options.interactionMode === "playing") {
        digAimHit = options.raycastEditableTerrain(options.getPlayingAimRay());
      } else if (previewEnabled && options.interactionMode === "orbit") {
        const hoverRay = options.getOrbitHoverRay();
        if (hoverRay) digAimHit = options.raycastEditableTerrain(hoverRay);
      }
      if (digAimHit) {
        mesh.position.copy(digAimHit.point);
        mesh.scale.set(
          Math.max(0.001, options.digRadius),
          Math.max(0.001, options.brushHeight),
          Math.max(0.001, options.digRadius),
        );
        mesh.geometry = brushPreviewGeometries[options.brushShape];
        material.color.setHex(options.brushOp === "add" ? RAISE_PREVIEW_COLOR : DIG_PREVIEW_COLOR);
      }
      mesh.visible = digAimHit !== null;
    },
    hide() {
      mesh.visible = false;
    },
  };
}
