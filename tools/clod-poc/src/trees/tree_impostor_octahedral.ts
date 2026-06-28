import * as THREE from "three";

export interface OctahedralFrame {
  index: number;
  x: number;
  y: number;
  uvMin: [number, number];
  uvMax: [number, number];
  direction: [number, number, number];
}

export interface OctahedralBlendSample {
  frame: OctahedralFrame;
  weight: number;
}

export interface OctahedralBlend {
  encoded: [number, number];
  cell: [number, number];
  fraction: [number, number];
  samples: [OctahedralBlendSample, OctahedralBlendSample, OctahedralBlendSample, OctahedralBlendSample];
}

export function octEncode(direction: THREE.Vector3): THREE.Vector2 {
  const normal = safeDirection(direction);
  const invL1 = 1 / (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z));
  const encoded = new THREE.Vector2(normal.x * invL1, normal.y * invL1);
  if (normal.z < 0) {
    const x = encoded.x;
    const y = encoded.y;
    encoded.x = (1 - Math.abs(y)) * Math.sign(x || 1);
    encoded.y = (1 - Math.abs(x)) * Math.sign(y || 1);
  }
  return encoded.multiplyScalar(0.5).addScalar(0.5);
}

export function octDecode(encoded: THREE.Vector2): THREE.Vector3 {
  const x = safeNumber(encoded.x, 0.5) * 2 - 1;
  const y = safeNumber(encoded.y, 0.5) * 2 - 1;
  const decoded = new THREE.Vector3(x, y, 1 - Math.abs(x) - Math.abs(y));
  if (decoded.z < 0) {
    const oldX = decoded.x;
    decoded.x = (1 - Math.abs(decoded.y)) * Math.sign(oldX || 1);
    decoded.y = (1 - Math.abs(oldX)) * Math.sign(decoded.y || 1);
  }
  if (decoded.lengthSq() <= 1e-12) return new THREE.Vector3(0, 0, 1);
  return decoded.normalize();
}

export function octFrameIndexForDirection(direction: THREE.Vector3, gridSize: number): number {
  const safeGrid = safeGridSize(gridSize);
  const encoded = octEncode(direction);
  const x = Math.min(safeGrid - 1, Math.max(0, Math.floor(encoded.x * safeGrid)));
  const y = Math.min(safeGrid - 1, Math.max(0, Math.floor(encoded.y * safeGrid)));
  return y * safeGrid + x;
}

export function octFrameBlendForDirection(
  direction: THREE.Vector3,
  gridSize: number,
  resolutionPx: number,
  paddingPx: number,
): OctahedralBlend {
  const safeGrid = safeGridSize(gridSize);
  const encoded = octEncode(direction);
  const scaledX = encoded.x * safeGrid - 0.5;
  const scaledY = encoded.y * safeGrid - 0.5;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const fx = clamp01(scaledX - x0);
  const fy = clamp01(scaledY - y0);
  const left = clampInt(x0, 0, safeGrid - 1);
  const right = clampInt(x0 + 1, 0, safeGrid - 1);
  const bottom = clampInt(y0, 0, safeGrid - 1);
  const top = clampInt(y0 + 1, 0, safeGrid - 1);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  return {
    encoded: [encoded.x, encoded.y],
    cell: [left, bottom],
    fraction: [fx, fy],
    samples: [
      { frame: octFrameForCell(left, bottom, safeGrid, resolutionPx, paddingPx), weight: w00 },
      { frame: octFrameForCell(right, bottom, safeGrid, resolutionPx, paddingPx), weight: w10 },
      { frame: octFrameForCell(left, top, safeGrid, resolutionPx, paddingPx), weight: w01 },
      { frame: octFrameForCell(right, top, safeGrid, resolutionPx, paddingPx), weight: w11 },
    ],
  };
}

export function octFrameForIndex(
  index: number,
  gridSize: number,
  resolutionPx: number,
  paddingPx: number,
): OctahedralFrame {
  const safeGrid = safeGridSize(gridSize);
  const safeIndex = Math.min(safeGrid * safeGrid - 1, Math.max(0, Math.floor(safeNumber(index, 0))));
  const x = safeIndex % safeGrid;
  const y = Math.floor(safeIndex / safeGrid);
  return octFrameForCell(x, y, safeGrid, resolutionPx, paddingPx);
}

export function octFrames(gridSize: number, resolutionPx: number, paddingPx: number): OctahedralFrame[] {
  const safeGrid = safeGridSize(gridSize);
  const frames: OctahedralFrame[] = [];
  for (let index = 0; index < safeGrid * safeGrid; index++) {
    frames.push(octFrameForIndex(index, safeGrid, resolutionPx, paddingPx));
  }
  return frames;
}

function octFrameForCell(
  x: number,
  y: number,
  gridSize: number,
  resolutionPx: number,
  paddingPx: number,
): OctahedralFrame {
  const safeGrid = safeGridSize(gridSize);
  const safeX = clampInt(x, 0, safeGrid - 1);
  const safeY = clampInt(y, 0, safeGrid - 1);
  const safeResolution = Math.max(1, Math.floor(safeNumber(resolutionPx, 1)));
  const safePadding = Math.min(Math.floor(Math.max(0, safeNumber(paddingPx, 0))), Math.floor(safeResolution * 0.5));
  const atlasSize = safeGrid * safeResolution;
  const minX = (safeX * safeResolution + safePadding) / atlasSize;
  const minY = (safeY * safeResolution + safePadding) / atlasSize;
  const maxX = ((safeX + 1) * safeResolution - safePadding) / atlasSize;
  const maxY = ((safeY + 1) * safeResolution - safePadding) / atlasSize;
  const center = new THREE.Vector2((safeX + 0.5) / safeGrid, (safeY + 0.5) / safeGrid);
  const direction = octDecode(center);
  return {
    index: safeY * safeGrid + safeX,
    x: safeX,
    y: safeY,
    uvMin: [minX, minY],
    uvMax: [maxX, maxY],
    direction: [direction.x, direction.y, direction.z],
  };
}

function safeDirection(direction: THREE.Vector3): THREE.Vector3 {
  if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z)) {
    return new THREE.Vector3(0, 0, 1);
  }
  if (direction.lengthSq() <= 1e-12) return new THREE.Vector3(0, 0, 1);
  return direction.clone().normalize();
}

function safeGridSize(gridSize: number): number {
  return Math.max(1, Math.floor(safeNumber(gridSize, 1)));
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
