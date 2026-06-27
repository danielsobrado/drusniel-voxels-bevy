import * as THREE from "three";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { deepOceanWaveVerticalBounds } from "./deep_ocean_waves.js";

export interface DeepOceanSurface {
  mesh: THREE.Mesh;
  update(timeSeconds: number): void;
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
  if (xMax <= xMin || zMax <= zMin) return;

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

function rectGridVertexCount(
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
  segX: number,
  segZ: number,
): number {
  if (xMax <= xMin || zMax <= zMin) return 0;
  return (Math.max(1, segX) + 1) * (Math.max(1, segZ) + 1);
}

function deepOceanGridLayout(worldCells: number, config: DeepOceanRenderConfig, _innerBandCells: number) {
  const extend = Math.max(1, config.extendCells);
  const segments = Math.max(4, config.segments);
  const outerMin = -extend;
  const outerMax = worldCells + extend;
  const innerMin = 0;
  const innerMax = worldCells;
  const ringWidth = Math.max(extend, 1);
  const radialSegments = Math.max(4, Math.round(segments * ringWidth / Math.max(ringWidth, worldCells * 0.25)));
  const tangentialSegments = segments;
  return {
    outerMin,
    outerMax,
    innerMin,
    innerMax,
    radialSegments,
    tangentialSegments,
  };
}

/**
 * Render-only deep ocean ring. Vertices stay static on CPU; wave displacement,
 * chop, compression, and foam are evaluated in the GPU material.
 */
export function createDeepOceanSurface(
  worldCells: number,
  config: DeepOceanRenderConfig,
  material: THREE.Material,
  innerBandCells = 0,
): DeepOceanSurface | null {
  if (!config.enabled || worldCells <= 0) return null;

  const y = config.surfaceY;
  const layout = deepOceanGridLayout(worldCells, config, innerBandCells);
  const { outerMin, outerMax, innerMin, innerMax, radialSegments, tangentialSegments } = layout;

  const positions: number[] = [];
  const indices: number[] = [];
  const vertexOffset = { value: 0 };

  addRectGrid(positions, indices, outerMin, outerMax, innerMax, outerMax, tangentialSegments, radialSegments, y, vertexOffset);
  addRectGrid(positions, indices, outerMin, outerMax, outerMin, innerMin, tangentialSegments, radialSegments, y, vertexOffset);
  addRectGrid(positions, indices, outerMin, innerMin, innerMin, innerMax, radialSegments, tangentialSegments, y, vertexOffset);
  addRectGrid(positions, indices, innerMax, outerMax, innerMin, innerMax, radialSegments, tangentialSegments, y, vertexOffset);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const waveBounds = deepOceanWaveVerticalBounds();
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(outerMin - waveBounds, y - waveBounds, outerMin - waveBounds),
    new THREE.Vector3(outerMax + waveBounds, y + waveBounds, outerMax + waveBounds),
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "deep-ocean-surface";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;

  return {
    mesh,
    update(_timeSeconds: number) {
      // Time is pushed to the GPU material; CPU geometry is intentionally immutable.
    },
    dispose() {
      geometry.dispose();
      mesh.parent?.remove(mesh);
    },
  };
}

/** Vertex count for tests and diagnostics. */
export function deepOceanSurfaceVertexCount(worldCells: number, config: DeepOceanRenderConfig, innerBandCells = 0): number {
  if (!config.enabled || worldCells <= 0) return 0;
  const layout = deepOceanGridLayout(worldCells, config, innerBandCells);
  const { outerMin, outerMax, innerMin, innerMax, radialSegments, tangentialSegments } = layout;
  return rectGridVertexCount(outerMin, outerMax, innerMax, outerMax, tangentialSegments, radialSegments)
    + rectGridVertexCount(outerMin, outerMax, outerMin, innerMin, tangentialSegments, radialSegments)
    + rectGridVertexCount(outerMin, innerMin, innerMin, innerMax, radialSegments, tangentialSegments)
    + rectGridVertexCount(innerMax, outerMax, innerMin, innerMax, radialSegments, tangentialSegments);
}
