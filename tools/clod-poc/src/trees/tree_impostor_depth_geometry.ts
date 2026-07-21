import * as THREE from "three";
import { TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS } from "./tree_impostor_depth_contract.js";

const MAX_UINT16_GRID_SEGMENTS = 255;

export function createTreeImpostorDepthGridGeometry(
  source: THREE.BufferGeometry,
  segments = TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS,
): THREE.BufferGeometry {
  const position = source.getAttribute("position");
  const uv = source.getAttribute("uv");
  const safeSegments = Math.min(MAX_UINT16_GRID_SEGMENTS, Math.max(1, Math.floor(segments)));
  if (!position || !uv || position.count !== 4 || uv.count !== 4 || safeSegments === 1) return source;

  const corners = resolveQuadCorners(uv);
  if (!corners) return source;

  const side = safeSegments + 1;
  const vertexCount = side * side;
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  geometry.userData = { ...source.userData };

  for (const [name, attribute] of Object.entries(source.attributes)) {
    const itemSize = attribute.itemSize;
    const values = new Float32Array(vertexCount * itemSize);
    for (let z = 0; z < side; z++) {
      const v = z / safeSegments;
      for (let x = 0; x < side; x++) {
        const u = x / safeSegments;
        const vertex = z * side + x;
        for (let component = 0; component < itemSize; component++) {
          values[vertex * itemSize + component] = bilerpAttribute(
            attribute,
            corners,
            component,
            u,
            v,
          );
        }
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize, attribute.normalized));
  }

  const indices = new Uint16Array(safeSegments * safeSegments * 6);
  let cursor = 0;
  for (let z = 0; z < safeSegments; z++) {
    for (let x = 0; x < safeSegments; x++) {
      const a = z * side + x;
      const b = a + 1;
      const d = a + side;
      const c = d + 1;
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  source.dispose();
  return geometry;
}

interface QuadCorners {
  readonly bottomLeft: number;
  readonly bottomRight: number;
  readonly topRight: number;
  readonly topLeft: number;
}

function resolveQuadCorners(
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): QuadCorners | null {
  const minU = minComponent(uv, "x");
  const maxU = maxComponent(uv, "x");
  const minV = minComponent(uv, "y");
  const maxV = maxComponent(uv, "y");
  if (![minU, maxU, minV, maxV].every(Number.isFinite) || maxU - minU <= 1e-6 || maxV - minV <= 1e-6) {
    return null;
  }
  return {
    bottomLeft: nearestUv(uv, minU, minV),
    bottomRight: nearestUv(uv, maxU, minV),
    topRight: nearestUv(uv, maxU, maxV),
    topLeft: nearestUv(uv, minU, maxV),
  };
}

function bilerpAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  corners: QuadCorners,
  component: number,
  u: number,
  v: number,
): number {
  const bottom = mix(
    attributeComponent(attribute, corners.bottomLeft, component),
    attributeComponent(attribute, corners.bottomRight, component),
    u,
  );
  const top = mix(
    attributeComponent(attribute, corners.topLeft, component),
    attributeComponent(attribute, corners.topRight, component),
    u,
  );
  return mix(bottom, top, v);
}

function attributeComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  component: number,
): number {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  if (component === 3) return attribute.getW(index);
  return 0;
}

function nearestUv(
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  targetU: number,
  targetV: number,
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < uv.count; index++) {
    const du = uv.getX(index) - targetU;
    const dv = uv.getY(index) - targetV;
    const distance = du * du + dv * dv;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function minComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  component: "x" | "y",
): number {
  let value = Number.POSITIVE_INFINITY;
  for (let index = 0; index < attribute.count; index++) {
    value = Math.min(value, component === "x" ? attribute.getX(index) : attribute.getY(index));
  }
  return value;
}

function maxComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  component: "x" | "y",
): number {
  let value = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < attribute.count; index++) {
    value = Math.max(value, component === "x" ? attribute.getX(index) : attribute.getY(index));
  }
  return value;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
