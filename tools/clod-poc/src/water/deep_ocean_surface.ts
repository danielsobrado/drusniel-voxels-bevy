import * as THREE from "three";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { deepOceanGpuWaves, deepOceanWaveVerticalBounds } from "./deep_ocean_waves.js";

export interface DeepOceanSurface {
  mesh: THREE.Mesh;
  update(timeSeconds: number): void;
  dispose(): void;
}

interface RectGridSpec {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  segX: number;
  segZ: number;
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

function rectGridVertexCount(spec: RectGridSpec): number {
  if (spec.xMax <= spec.xMin || spec.zMax <= spec.zMin) return 0;
  return (Math.max(1, spec.segX) + 1) * (Math.max(1, spec.segZ) + 1);
}

function rectGridTriangleCount(spec: RectGridSpec): number {
  if (spec.xMax <= spec.xMin || spec.zMax <= spec.zMin) return 0;
  return Math.max(1, spec.segX) * Math.max(1, spec.segZ) * 2;
}

function visitRectGridVertices(spec: RectGridSpec, visit: (x: number, z: number) => void): void {
  if (spec.xMax <= spec.xMin || spec.zMax <= spec.zMin) return;
  const cols = Math.max(1, spec.segX);
  const rows = Math.max(1, spec.segZ);
  for (let row = 0; row <= rows; row++) {
    const z = spec.zMin + (spec.zMax - spec.zMin) * (row / rows);
    for (let col = 0; col <= cols; col++) {
      const x = spec.xMin + (spec.xMax - spec.xMin) * (col / cols);
      visit(x, z);
    }
  }
}

function deepOceanGridLayout(worldCells: number, config: DeepOceanRenderConfig) {
  const extend = Math.max(1, config.extendCells);
  const startOutside = Math.min(Math.max(0, config.startOutsideBorderM), Math.max(0, extend - 1));
  const segments = Math.max(4, config.segments);
  const outerMin = -extend;
  const outerMax = worldCells + extend;
  const holeMin = -startOutside;
  const holeMax = worldCells + startOutside;
  const ringWidth = Math.max(extend - startOutside, 1);
  const radialSegments = Math.max(4, Math.round(segments * ringWidth / Math.max(ringWidth, worldCells * 0.25)));
  const tangentialSegments = segments;
  return { outerMin, outerMax, holeMin, holeMax, radialSegments, tangentialSegments };
}

function deepOceanGridSpecs(worldCells: number, config: DeepOceanRenderConfig): RectGridSpec[] {
  const { outerMin, outerMax, holeMin, holeMax, radialSegments, tangentialSegments } = deepOceanGridLayout(worldCells, config);
  return [
    { xMin: outerMin, xMax: outerMax, zMin: holeMax, zMax: outerMax, segX: tangentialSegments, segZ: radialSegments },
    { xMin: outerMin, xMax: outerMax, zMin: outerMin, zMax: holeMin, segX: tangentialSegments, segZ: radialSegments },
    { xMin: outerMin, xMax: holeMin, zMin: holeMin, zMax: holeMax, segX: radialSegments, segZ: tangentialSegments },
    { xMin: holeMax, xMax: outerMax, zMin: holeMin, zMax: holeMax, segX: radialSegments, segZ: tangentialSegments },
  ];
}

function insideStrictRect(x: number, z: number, min: number, max: number): boolean {
  return x > min && x < max && z > min && z < max;
}

function insideClosedRect(x: number, z: number, min: number, max: number): boolean {
  return x >= min && x <= max && z >= min && z <= max;
}

export function isInDeepOceanTransitionGap(
  x: number,
  z: number,
  worldCells: number,
  startOutsideBorderM: number,
): boolean {
  const start = Math.max(0, startOutsideBorderM);
  if (insideClosedRect(x, z, 0, worldCells)) return false;
  return insideStrictRect(x, z, -start, worldCells + start);
}

export function countDeepOceanTransitionGapVertices(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  let count = 0;
  for (const spec of deepOceanGridSpecs(worldCells, config)) {
    visitRectGridVertices(spec, (x, z) => {
      if (isInDeepOceanTransitionGap(x, z, worldCells, config.startOutsideBorderM)) count += 1;
    });
  }
  return count;
}

export function createDeepOceanSurface(
  worldCells: number,
  config: DeepOceanRenderConfig,
  material: THREE.Material,
): DeepOceanSurface | null {
  if (!config.enabled || worldCells <= 0) return null;

  const y = config.surfaceY;
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexOffset = { value: 0 };

  for (const spec of deepOceanGridSpecs(worldCells, config)) {
    addRectGrid(
      positions,
      indices,
      spec.xMin,
      spec.xMax,
      spec.zMin,
      spec.zMax,
      spec.segX,
      spec.segZ,
      y,
      vertexOffset,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const waveBounds = deepOceanWaveVerticalBounds(deepOceanGpuWaves(config.wave));
  const { outerMin, outerMax } = deepOceanGridLayout(worldCells, config);
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
    update(_timeSeconds: number) {},
    dispose() {
      geometry.dispose();
      mesh.removeFromParent();
    },
  };
}

export function deepOceanSurfaceVertexCount(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  return deepOceanGridSpecs(worldCells, config).reduce((total, spec) => total + rectGridVertexCount(spec), 0);
}

export function deepOceanSurfaceTriangleCount(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  return deepOceanGridSpecs(worldCells, config).reduce((total, spec) => total + rectGridTriangleCount(spec), 0);
}
