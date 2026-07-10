import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import {
  BLADE_ROWS,
  TWO_PI,
  grassRowsForSegments,
  type GrassSettings,
} from "./grass_config.js";
import type { GrassBladeInstance } from "./grass_cpu_patch.js";

const BLADE_PLANES = {
  single: [{ axis: "x" as const }],
  crossed: [
    { axis: "x" as const },
    { axis: "z" as const },
  ],
};
const ROUNDED_SIDE_NORMAL = 0.616;
const ROUNDED_FACE_NORMAL = 0.788;
const ROUNDED_UP_NORMAL = 0.25;

function roundedBladeNormal(axis: "x" | "z", side: 0 | 1): readonly [number, number, number] {
  const sideSign = side === 0 ? -1 : 1;
  return axis === "x"
    ? [sideSign * ROUNDED_SIDE_NORMAL, ROUNDED_UP_NORMAL, -ROUNDED_FACE_NORMAL]
    : [ROUNDED_FACE_NORMAL, ROUNDED_UP_NORMAL, sideSign * ROUNDED_SIDE_NORMAL];
}

export function createBladeGeometry(
  rows: readonly (readonly [number, number])[] = BLADE_ROWS,
  crossed = false,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const plane of crossed ? BLADE_PLANES.crossed : BLADE_PLANES.single) {
    const base = positions.length / 3;
    for (const [y, halfWidth] of rows) {
      if (plane.axis === "x") {
        positions.push(-halfWidth, y, 0, halfWidth, y, 0);
      } else {
        positions.push(0, y, -halfWidth, 0, y, halfWidth);
      }
      uvs.push(0, y, 1, y);
      normals.push(...roundedBladeNormal(plane.axis, 0), ...roundedBladeNormal(plane.axis, 1));
    }
    for (let row = 0; row < rows.length - 1; row++) {
      const lower = base + row * 2;
      const upper = lower + 2;
      indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createGrassTuftGeometry(widthOrSettings: number | GrassSettings = 1): THREE.BufferGeometry {
  const width = typeof widthOrSettings === "number"
    ? widthOrSettings
    : widthOrSettings.blade.farTuftWidthM / Math.max(widthOrSettings.blade.widthM, 0.001);
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 3; blade++) {
    const yaw = blade * 1.92 + 0.4;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const base = positions.length / 3;
    for (const [x, y] of [[-width, 0], [width, 0], [width * 0.55, 1], [-width * 0.55, 1]] as const) {
      positions.push(x * cosYaw, y, x * sinYaw);
      const side = x < 0 ? -1 : 1;
      normals.push(
        -sinYaw * ROUNDED_FACE_NORMAL + side * ROUNDED_SIDE_NORMAL * cosYaw,
        ROUNDED_UP_NORMAL,
        cosYaw * ROUNDED_FACE_NORMAL + side * ROUNDED_SIDE_NORMAL * sinYaw,
      );
      uvs.push(x < 0 ? 0 : 1, y);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function makeDeterministicRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createGrassBladeClumpGeometry(
  blades: number,
  rows: readonly (readonly [number, number])[],
  seed: number,
): THREE.BufferGeometry {
  const random = makeDeterministicRandom(seed + blades * 97 + rows.length * 17);
  const source = createBladeGeometry(rows, false);
  const sourcePosition = source.getAttribute("position");
  const sourceNormal = source.getAttribute("normal");
  const sourceUv = source.getAttribute("uv");
  const sourceIndex = source.getIndex();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let blade = 0; blade < blades; blade++) {
    const yaw = random() * TWO_PI;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const offsetX = (random() - 0.5) * 0.18;
    const offsetZ = (random() - 0.5) * 0.18;
    const heightScale = 0.62 + random() * 0.7;
    const widthScale = 0.82 + random() * 0.55;
    const lean = (random() - 0.5) * 0.34;
    const baseVertex = positions.length / 3;

    for (let i = 0; i < sourcePosition.count; i++) {
      const x = sourcePosition.getX(i) * widthScale;
      const y = sourcePosition.getY(i) * heightScale;
      const z = sourcePosition.getZ(i);
      const shearX = x + lean * y;
      positions.push(
        shearX * cosYaw + z * sinYaw + offsetX,
        y,
        z * cosYaw - shearX * sinYaw + offsetZ,
      );
      normals.push(
        sourceNormal.getX(i) * cosYaw + sourceNormal.getZ(i) * sinYaw,
        sourceNormal.getY(i),
        sourceNormal.getZ(i) * cosYaw - sourceNormal.getX(i) * sinYaw,
      );
      uvs.push(sourceUv.getX(i), sourceUv.getY(i));
    }

    if (sourceIndex) {
      for (let i = 0; i < sourceIndex.count; i++) indices.push(baseVertex + sourceIndex.getX(i));
    }
  }

  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function createGrassClumpGeometry(
  bladesPerInstance: number,
  segments: number,
  settings: GrassSettings,
): THREE.BufferGeometry {
  return createGrassBladeClumpGeometry(
    bladesPerInstance,
    grassRowsForSegments(segments),
    settings.seed + bladesPerInstance * 409 + segments * 37,
  );
}

export function populateGrassGeometry(
  geometry: THREE.InstancedBufferGeometry,
  bladeGeometry: THREE.BufferGeometry,
  footprint: PageFootprint,
  instances: readonly GrassBladeInstance[],
  settings: GrassSettings,
): void {
  geometry.setAttribute("position", bladeGeometry.getAttribute("position"));
  geometry.setAttribute("uv", bladeGeometry.getAttribute("uv"));
  geometry.setAttribute("normal", bladeGeometry.getAttribute("normal"));
  geometry.setIndex(bladeGeometry.getIndex());

  const offsets = new Float32Array(instances.length * 3);
  const heights = new Float32Array(instances.length);
  const rotations = new Float32Array(instances.length);
  const phases = new Float32Array(instances.length);
  const colorMixes = new Float32Array(instances.length);
  const edgeFades = new Float32Array(instances.length);
  const normalYs = new Float32Array(instances.length);
  const terrainNormals = new Float32Array(instances.length * 3);
  const widthScales = new Float32Array(instances.length);
  if (!bladeGeometry.boundingBox) bladeGeometry.computeBoundingBox();
  const sourceBounds = bladeGeometry.boundingBox;
  const sourceMinY = sourceBounds?.min.y ?? 0;
  const sourceMaxY = sourceBounds?.max.y ?? 1;
  const sourceHorizontalExtent = sourceBounds
    ? Math.max(
        Math.abs(sourceBounds.min.x),
        Math.abs(sourceBounds.max.x),
        Math.abs(sourceBounds.min.z),
        Math.abs(sourceBounds.max.z),
      )
    : 1;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxHeight = 0;
  let maxWidthScale = 1;
  for (let index = 0; index < instances.length; index++) {
    const instance = instances[index];
    const height = instance.height;
    const widthScale = instance.widthScale ?? 1;
    offsets.set(instance.offset, index * 3);
    heights[index] = height;
    rotations[index] = instance.rotationY;
    phases[index] = instance.phase;
    colorMixes[index] = instance.colorMix;
    edgeFades[index] = instance.edgeFade;
    normalYs[index] = instance.normalY;
    terrainNormals.set(instance.terrainNormal, index * 3);
    widthScales[index] = widthScale;
    minY = Math.min(minY, instance.offset[1] + sourceMinY * height);
    maxY = Math.max(maxY, instance.offset[1] + sourceMaxY * height);
    maxHeight = Math.max(maxHeight, height);
    maxWidthScale = Math.max(maxWidthScale, widthScale);
  }
  geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute("aHeight", new THREE.InstancedBufferAttribute(heights, 1));
  geometry.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rotations, 1));
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(colorMixes, 1));
  geometry.setAttribute("aEdgeFade", new THREE.InstancedBufferAttribute(edgeFades, 1));
  geometry.setAttribute("aNormalY", new THREE.InstancedBufferAttribute(normalYs, 1));
  geometry.setAttribute("aTerrainNormal", new THREE.InstancedBufferAttribute(terrainNormals, 3));
  geometry.setAttribute("aWidthScale", new THREE.InstancedBufferAttribute(widthScales, 1));
  geometry.instanceCount = instances.length;

  if (instances.length === 0) {
    minY = 0;
    maxY = 0;
  }
  const margin = sourceHorizontalExtent * settings.bladeWidth * maxWidthScale
    + maxHeight * settings.windStrength * 2;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(footprint.minX - margin, minY, footprint.minZ - margin),
    new THREE.Vector3(footprint.maxX + margin, maxY, footprint.maxZ + margin),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
}
