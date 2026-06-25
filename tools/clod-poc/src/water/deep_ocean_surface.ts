import * as THREE from "three";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";

export interface DeepOceanSurface {
  mesh: THREE.Mesh;
  dispose(): void;
}

function addRectGrid(
  positions: number[],
  indices: number[],
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
  segX: number,
  segZ: number,
  y: number,
  vertexOffset: { value: number },
): void {
  const cols = Math.max(1, segX);
  const rows = Math.max(1, segZ);
  const base = vertexOffset.value;

  for (let row = 0; row <= rows; row++) {
    const tz = row / rows;
    const z = zMin + (zMax - zMin) * tz;
    for (let col = 0; col <= cols; col++) {
      const tx = col / cols;
      const x = xMin + (xMax - xMin) * tx;
      positions.push(x, y, z);
    }
  }

  const stride = cols + 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i0 = base + row * stride + col;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  vertexOffset.value = base + (rows + 1) * (cols + 1);
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
  const segments = Math.max(4, config.segments);
  const y = config.surfaceY;
  const outerMin = -extend;
  const outerMax = worldCells + extend;
  const radialSegments = Math.max(4, Math.round(segments * extend / Math.max(extend, worldCells * 0.25)));
  const tangentialSegments = segments;

  const positions: number[] = [];
  const indices: number[] = [];
  const vertexOffset = { value: 0 };

  addRectGrid(positions, indices, outerMin, outerMax, worldCells, outerMax, tangentialSegments, radialSegments, y, vertexOffset);
  addRectGrid(positions, indices, outerMin, outerMax, outerMin, 0, tangentialSegments, radialSegments, y, vertexOffset);
  addRectGrid(positions, indices, outerMin, 0, 0, worldCells, radialSegments, tangentialSegments, y, vertexOffset);
  addRectGrid(positions, indices, worldCells, outerMax, 0, worldCells, radialSegments, tangentialSegments, y, vertexOffset);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(outerMin, y - 1, outerMin),
    new THREE.Vector3(outerMax, y + 1, outerMax),
  );

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

/** Vertex count for tests and diagnostics. */
export function deepOceanSurfaceVertexCount(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  const extend = Math.max(1, config.extendCells);
  const segments = Math.max(4, config.segments);
  const radialSegments = Math.max(4, Math.round(segments * extend / Math.max(extend, worldCells * 0.25)));
  const tangentialSegments = segments;
  const northSouth = (tangentialSegments + 1) * (radialSegments + 1) * 2;
  const eastWest = (radialSegments + 1) * (tangentialSegments + 1) * 2;
  return northSouth + eastWest;
}
