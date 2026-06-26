import * as THREE from "three";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";

export interface DeepOceanSurface {
  mesh: THREE.Mesh;
  update(timeSeconds: number): void;
  dispose(): void;
}

const WAVE_Y_BOUNDS = 4.0;

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

function oceanWaveHeight(x: number, z: number, timeSeconds: number): number {
  const t = timeSeconds;
  const swellA = Math.sin(x * 0.018 + z * 0.007 + t * 0.46) * 1.45;
  const swellB = Math.sin(x * -0.011 + z * 0.022 + t * 0.31) * 0.95;
  const cross = Math.cos(x * 0.041 - z * 0.035 + t * 0.78) * 0.32;
  return swellA + swellB + cross;
}

function updateWavePositions(geometry: THREE.BufferGeometry, basePositions: Float32Array, timeSeconds: number): void {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const positions = attr.array as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    const x = basePositions[i];
    const z = basePositions[i + 2];
    positions[i + 1] = basePositions[i + 1] + oceanWaveHeight(x, z, timeSeconds);
  }
  attr.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Render-only deep ocean ring. It covers the outside skirt and the playable
 * border ocean band, while leaving the central CLOD terrain/hydrology area open.
 * Never fed into CLOD page source or hydrology carve.
 */
export function createDeepOceanSurface(
  worldCells: number,
  config: DeepOceanRenderConfig,
  material: THREE.Material,
  innerBandCells = 0,
): DeepOceanSurface | null {
  if (!config.enabled || worldCells <= 0) return null;

  const extend = Math.max(1, config.extendCells);
  const segments = Math.max(4, config.segments);
  const y = config.surfaceY;
  const outerMin = -extend;
  const outerMax = worldCells + extend;
  const innerBand = Math.min(Math.max(0, innerBandCells), worldCells * 0.5);
  const innerMin = innerBand;
  const innerMax = worldCells - innerBand;
  const ringWidth = Math.max(extend, innerBand, 1);
  const radialSegments = Math.max(4, Math.round(segments * ringWidth / Math.max(ringWidth, worldCells * 0.25)));
  const tangentialSegments = segments;

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
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(outerMin, y - WAVE_Y_BOUNDS, outerMin),
    new THREE.Vector3(outerMax, y + WAVE_Y_BOUNDS, outerMax),
  );
  const basePositions = new Float32Array(positions);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "deep-ocean-surface";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;

  return {
    mesh,
    update(timeSeconds: number) {
      updateWavePositions(geometry, basePositions, timeSeconds);
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
  const extend = Math.max(1, config.extendCells);
  const segments = Math.max(4, config.segments);
  const innerBand = Math.min(Math.max(0, innerBandCells), worldCells * 0.5);
  const ringWidth = Math.max(extend, innerBand, 1);
  const radialSegments = Math.max(4, Math.round(segments * ringWidth / Math.max(ringWidth, worldCells * 0.25)));
  const tangentialSegments = segments;
  const northSouth = (tangentialSegments + 1) * (radialSegments + 1) * 2;
  const eastWest = (radialSegments + 1) * (tangentialSegments + 1) * 2;
  return northSouth + eastWest;
}
