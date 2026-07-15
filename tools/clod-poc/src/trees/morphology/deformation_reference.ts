import type { TreeInstanceMorphology, TreeVertexMorphologyAttributes } from "./types.js";
import { clampTreeInstanceMorphology } from "./validation.js";

export interface TreeDeformationReferenceInput {
  position: [number, number, number];
  normal: [number, number, number];
  attributes: TreeVertexMorphologyAttributes;
  morphology: TreeInstanceMorphology;
  treeHeight: number;
  crownRadius: number;
  crownStart01: number;
}

export interface TreeDeformationReferenceResult {
  position: [number, number, number];
  normal: [number, number, number];
}

export function deformTreeVertexReference(input: TreeDeformationReferenceInput): TreeDeformationReferenceResult {
  const morphology = clampTreeInstanceMorphology(input.morphology);
  const a = input.attributes;
  const treeHeight = Math.max(1e-6, input.treeHeight);
  const h01 = clamp(a.treeHeight01, 0, 1);
  let [x, y, z] = input.position;
  let [nx, ny, nz] = input.normal;

  const ageSmooth = smoothstep(0, 1, morphology.age01);
  const heightScale = lerp(0.72, 1.08, ageSmooth);
  const radiusScale = lerp(0.78, 1.12, morphology.age01);
  x *= radiusScale;
  y *= heightScale;
  z *= radiusScale;
  nx /= Math.max(radiusScale, 1e-6);
  ny /= Math.max(heightScale, 1e-6);
  nz /= Math.max(radiusScale, 1e-6);
  const crownBlend = smoothstep(input.crownStart01 - 0.1, input.crownStart01, h01);
  y += lerp(0.08, -0.04, morphology.age01) * treeHeight * crownBlend;

  const crownCenterY = lerp(input.crownStart01, 1, 0.5) * treeHeight * heightScale;
  x *= lerp(1, morphology.crownWidth, crownBlend);
  z *= lerp(1, morphology.crownWidth, crownBlend);
  y = lerp(y, crownCenterY + (y - crownCenterY) * morphology.crownFlattening, crownBlend);

  const rootScale = lerp(1, morphology.rootFlare, clamp(a.treeRootMask, 0, 1));
  x *= rootScale;
  z *= rootScale;

  if (a.treeBranchLevel > 0) {
    const droopWeight = clamp(a.treeBranchLevel, 0, 1) * h01 * h01;
    const radialLength = Math.hypot(x, z);
    const phaseAngle = a.treeBranchPhase * Math.PI * 2;
    const directionX = radialLength > 1e-6 ? x / radialLength : Math.cos(phaseAngle);
    const directionZ = radialLength > 1e-6 ? z / radialLength : Math.sin(phaseAngle);
    y -= morphology.branchDroop * droopWeight * treeHeight;
    x += directionX * morphology.branchDroop * droopWeight * treeHeight * 0.18;
    z += directionZ * morphology.branchDroop * droopWeight * treeHeight * 0.18;
  }

  const biasWeight = smoothstep(input.crownStart01, 1, h01);
  x += morphology.crownBiasX * input.crownRadius * biasWeight;
  z += morphology.crownBiasZ * input.crownRadius * biasWeight;

  const leanWeight = h01 * h01;
  x += morphology.leanX * y * leanWeight;
  z += morphology.leanZ * y * leanWeight;
  const bendDerivativeX = morphology.leanX * 3 * leanWeight;
  const bendDerivativeZ = morphology.leanZ * 3 * leanWeight;
  ny -= bendDerivativeX * nx + bendDerivativeZ * nz;

  const normalLength = Math.hypot(nx, ny, nz) || 1;
  return {
    position: [x, y, z],
    normal: [nx / normalLength, ny / normalLength, nz / normalLength],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
