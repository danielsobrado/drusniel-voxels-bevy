import * as THREE from "three";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";

export interface DeepOceanSurface {
  mesh: THREE.Mesh;
  dispose(): void;
}

/**
 * Render-only deep ocean skirt outside the playable world square.
 * Never fed into CLOD page source or hydrology carve.
 */
export function createDeepOceanSurface(
  worldCells: number,
  config: DeepOceanRenderConfig,
  material: THREE.Material,
): DeepOceanSurface | null {
  if (!config.enabled || worldCells <= 0) return null;

  const extend = Math.max(1, config.extendCells);
  const y = config.surfaceY;
  const positions: number[] = [];
  const indices: number[] = [];
  let vertex = 0;

  const addRingStrip = (
    x0: number, z0: number, x1: number, z1: number,
    x2: number, z2: number, x3: number, z3: number,
  ) => {
    positions.push(x0, y, z0, x1, y, z1, x2, y, z2, x3, y, z3);
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    vertex += 4;
  };

  const outerMin = -extend;
  const outerMax = worldCells + extend;
  addRingStrip(0, worldCells, worldCells, worldCells, 0, outerMax, outerMax, outerMax);
  addRingStrip(outerMin, outerMin, worldCells, outerMin, 0, 0, worldCells, 0);
  addRingStrip(outerMin, 0, 0, 0, outerMin, worldCells, 0, worldCells);
  addRingStrip(worldCells, 0, outerMax, 0, worldCells, worldCells, outerMax, worldCells);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "deep-ocean-surface";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return {
    mesh,
    dispose() {
      geometry.dispose();
      mesh.parent?.remove(mesh);
    },
  };
}
