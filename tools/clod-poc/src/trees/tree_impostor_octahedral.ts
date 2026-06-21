import * as THREE from "three";

export interface OctahedralFrame {
  index: number;
  x: number;
  y: number;
  uvMin: [number, number];
  uvMax: [number, number];
  direction: [number, number, number];
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

export function octFrameForIndex(
  index: number,
  gridSize: number,
  resolutionPx: number,
  paddingPx: number,
): OctahedralFrame {
  const safeGrid = safeGridSize(gridSize);
  const safeIndex = Math.min(safeGrid * safeGrid - 1, Math.max(0, Math.floor(safeNumber(index, 0))));
  const safeResolution = Math.max(1, Math.floor(safeNumber(resolutionPx, 1)));
  const safePadding = Math.min(Math.floor(Math.max(0, safeNumber(paddingPx, 0))), Math.floor(safeResolution * 0.5));
  const x = safeIndex % safeGrid;
  const y = Math.floor(safeIndex / safeGrid);
  const atlasSize = safeGrid * safeResolution;
  const minX = (x * safeResolution + safePadding) / atlasSize;
  const minY = (y * safeResolution + safePadding) / atlasSize;
  const maxX = ((x + 1) * safeResolution - safePadding) / atlasSize;
  const maxY = ((y + 1) * safeResolution - safePadding) / atlasSize;
  const center = new THREE.Vector2((x + 0.5) / safeGrid, (y + 0.5) / safeGrid);
  const direction = octDecode(center);
  return {
    index: safeIndex,
    x,
    y,
    uvMin: [minX, minY],
    uvMax: [maxX, maxY],
    direction: [direction.x, direction.y, direction.z],
  };
}

export function octFrames(gridSize: number, resolutionPx: number, paddingPx: number): OctahedralFrame[] {
  const safeGrid = safeGridSize(gridSize);
  const frames: OctahedralFrame[] = [];
  for (let index = 0; index < safeGrid * safeGrid; index++) {
    frames.push(octFrameForIndex(index, safeGrid, resolutionPx, paddingPx));
  }
  return frames;
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
