import * as THREE from "three";
import type { DressingClassId } from "../class_registry.js";
import { groundDebrisVisualProfile, type GroundDebrisGeometryKind } from "./ground_debris_visuals.js";

interface FlatElement {
  readonly x: number;
  readonly z: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly yaw: number;
  readonly y: number;
}

const ELEMENT_LAYOUT: readonly FlatElement[] = Object.freeze([
  { x: -0.30, z: -0.18, halfLength: 0.24, halfWidth: 0.10, yaw: 0.22, y: 0.008 },
  { x: 0.20, z: -0.24, halfLength: 0.20, halfWidth: 0.09, yaw: 1.18, y: 0.012 },
  { x: 0.31, z: 0.17, halfLength: 0.22, halfWidth: 0.08, yaw: 2.38, y: 0.016 },
  { x: -0.17, z: 0.27, halfLength: 0.19, halfWidth: 0.08, yaw: 0.82, y: 0.020 },
  { x: 0.02, z: 0.02, halfLength: 0.26, halfWidth: 0.11, yaw: 1.72, y: 0.024 },
  { x: -0.36, z: 0.12, halfLength: 0.17, halfWidth: 0.07, yaw: 2.86, y: 0.028 },
]);

export function createGroundDebrisGeometry(
  classId: DressingClassId,
  lod: number,
): THREE.BufferGeometry | null {
  const profile = groundDebrisVisualProfile(classId);
  if (!profile) return null;
  const level = Math.max(0, Math.min(2, Math.floor(lod)));
  return createGeometry(profile.geometry, level);
}

function createGeometry(kind: GroundDebrisGeometryKind, lod: number): THREE.BufferGeometry {
  if (kind === "leaf_cluster") return createFlatCluster(lod, 0.95, 0.90, false);
  if (kind === "needle_cluster") return createFlatCluster(lod, 1.10, 0.34, true);
  if (kind === "twig_cluster") return createTwigCluster(lod, 1.0, 0.055);
  if (kind === "bark_cluster") return createFlatCluster(lod, 0.74, 0.56, false);
  if (kind === "talus") return createPebble(lod, 0.47, 0.34, 0.43, false);
  if (kind === "river_cobble") return createPebble(lod, 0.34, 0.20, 0.29, true);
  return createPebble(lod, 0.39, 0.17, 0.34, true);
}

function createFlatCluster(
  lod: number,
  lengthScale: number,
  widthScale: number,
  needles: boolean,
): THREE.BufferGeometry {
  const count = lod === 0 ? 6 : lod === 1 ? 3 : 1;
  const elements = ELEMENT_LAYOUT.slice(0, count).map((entry, index) => ({
    ...entry,
    halfLength: entry.halfLength * lengthScale * (needles ? 1.22 : 1),
    halfWidth: entry.halfWidth * widthScale * (needles ? 0.58 : 1),
    y: entry.y + index * 0.001,
  }));
  return createGroundQuads(elements);
}

function createTwigCluster(lod: number, lengthScale: number, halfWidth: number): THREE.BufferGeometry {
  const count = lod === 0 ? 4 : lod === 1 ? 2 : 1;
  const elements = ELEMENT_LAYOUT.slice(0, count).map((entry, index) => ({
    ...entry,
    halfLength: (0.38 - index * 0.035) * lengthScale,
    halfWidth,
    y: 0.02 + index * 0.012,
  }));
  return createGroundQuads(elements);
}

function createGroundQuads(elements: readonly FlatElement[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const element of elements) {
    const base = positions.length / 3;
    const c = Math.cos(element.yaw);
    const s = Math.sin(element.yaw);
    const corners: readonly [number, number][] = [
      [-element.halfLength, -element.halfWidth],
      [element.halfLength, -element.halfWidth],
      [element.halfLength, element.halfWidth],
      [-element.halfLength, element.halfWidth],
    ];
    for (const [localX, localZ] of corners) {
      positions.push(
        element.x + localX * c + localZ * s,
        element.y,
        element.z + localZ * c - localX * s,
      );
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPebble(
  lod: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  rounded: boolean,
): THREE.BufferGeometry {
  const geometry = lod === 2
    ? new THREE.TetrahedronGeometry(1, 0)
    : new THREE.IcosahedronGeometry(1, lod === 0 && rounded ? 1 : 0);
  const detailScale = lod === 2 ? 0.78 : lod === 1 ? 0.90 : 1;
  geometry.scale(radiusX * detailScale, radiusY * detailScale, radiusZ * detailScale);
  geometry.translate(0, radiusY * detailScale, 0);
  ensureIndexedGeometry(geometry);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function ensureIndexedGeometry(geometry: THREE.BufferGeometry): void {
  if (geometry.getIndex()) return;
  const count = geometry.getAttribute("position")?.count ?? 0;
  if (count <= 0) return;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) indices[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
}
