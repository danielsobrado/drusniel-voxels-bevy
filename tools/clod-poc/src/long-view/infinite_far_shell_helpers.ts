import * as THREE from "three";
import { getActiveFarSummaryGpuAtlasView } from "../far-summary/gpu-render-atlas.js";
import { writeBiomeRgb } from "../world_source/biome_colors.js";
import type { InfiniteFarShellOptions, FarShellHeightSamplingMode } from "./infinite_far_shell_types.js";

export function hasGpuSamplingInputs(options: InfiniteFarShellOptions): boolean {
  const atlas = options.farSummaryGpuAtlas ?? getActiveFarSummaryGpuAtlasView();
  return Boolean(options.useParityMaterial && options.parityConfig && atlas);
}

export function resolveHeightSamplingMode(options: InfiniteFarShellOptions): FarShellHeightSamplingMode {
  const requested = options.heightSamplingMode ?? (hasGpuSamplingInputs(options) ? "gpu" : "cpu");
  if (requested !== "gpu") return "cpu";
  if (!hasGpuSamplingInputs(options)) {
    throw new Error("Far shell GPU mode requires parity material, parity config, and a GPU far-summary atlas");
  }
  return "gpu";
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

export function applyFarShellDepthBias(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    entry.polygonOffset = true;
    entry.polygonOffsetFactor = 1;
    entry.polygonOffsetUnits = 1;
  }
}

export interface AnnularGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: number[];
}

export function buildAnnularGeometryData(options: Pick<InfiniteFarShellOptions, "innerMeters" | "outerMeters" | "angularSegments" | "radialSegments">): AnnularGeometryData {
  const { innerMeters, outerMeters, angularSegments, radialSegments } = options;
  const vertexCount = (angularSegments + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  let vi = 0;
  for (let ri = 0; ri <= radialSegments; ri++) {
    const r = innerMeters + (outerMeters - innerMeters) * (ri / radialSegments);
    for (let ai = 0; ai <= angularSegments; ai++) {
      const theta = (ai / angularSegments) * Math.PI * 2;
      positions[vi * 3] = r * Math.cos(theta);
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = r * Math.sin(theta);
      normals[vi * 3] = 0;
      normals[vi * 3 + 1] = 1;
      normals[vi * 3 + 2] = 0;
      uvs[vi * 2] = ri / radialSegments;
      uvs[vi * 2 + 1] = ai / angularSegments;
      vi++;
    }
  }
  for (let ri = 0; ri < radialSegments; ri++) {
    for (let ai = 0; ai < angularSegments; ai++) {
      const a = ri * (angularSegments + 1) + ai;
      const b = a + 1;
      const c = a + (angularSegments + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, normals, uvs, indices };
}

export function flushGeometryAttributes(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
): void {
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normAttr = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute;
  posAttr.array.set(positions);
  posAttr.needsUpdate = true;
  normAttr.array.set(normals);
  normAttr.needsUpdate = true;
  uvAttr.array.set(uvs);
  uvAttr.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

export function attachColorAttribute(geometry: THREE.BufferGeometry, colors: Float32Array): void {
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export function createDefaultParityColors(vertexCount: number): Float32Array {
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = 0.32;
    colors[i * 3 + 1] = 0.44;
    colors[i * 3 + 2] = 0.28;
  }
  return colors;
}

export function createDefaultBiomeColors(vertexCount: number): Float32Array {
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) writeBiomeRgb(colors, i, 0);
  return colors;
}
