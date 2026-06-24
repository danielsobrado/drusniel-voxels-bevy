import * as THREE from "three";
import type { BrushOp, BrushShape } from "../terrain.js";
import type { TerrainSurfaceHit } from "../terrain_collider.js";
import type { PlayerInteractionMode } from "../player_controller.js";

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
  const mesh = new THREE.Mesh(
    brushPreviewGeometries.sphere,
    new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  mesh.visible = false;
  scene.add(mesh);

  return {
    mesh,
    update(options) {
      let digAimHit: TerrainSurfaceHit | null = null;
      if (options.digEnabled && options.interactionMode === "playing" && options.terraformEditActive) {
        digAimHit = options.raycastEditableTerrain(options.getPlayingAimRay());
      } else if (options.digEnabled && options.interactionMode === "orbit") {
        const hoverRay = options.getOrbitHoverRay();
        if (hoverRay) digAimHit = options.raycastEditableTerrain(hoverRay);
      }
      if (digAimHit) {
        mesh.position.copy(digAimHit.point);
        mesh.scale.set(options.digRadius, options.brushHeight, options.digRadius);
        mesh.geometry = brushPreviewGeometries[options.brushShape];
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(
          options.brushOp === "add" ? 0x55dd66 : 0xff5533,
        );
      }
      mesh.visible = digAimHit !== null;
    },
    hide() {
      mesh.visible = false;
    },
  };
}
