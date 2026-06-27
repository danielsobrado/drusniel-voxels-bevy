import * as THREE from "three";
import { clamp, float, mix, positionGeometry, sin, smoothstep, step, texture, uniform, vec2, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { FarSummaryGpuAtlasRingView, FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";

const SUMMARY_EDGE_EPS = 0.0001;
const WATER_SURFACE_OFFSET_M = 0.42;
const WATER_ALPHA = 0.62;
const WATER_MASK_THRESHOLD = 0.04;
const WATER_VISIBLE_ALPHA_THRESHOLD = 0.01;
const WATER_RIPPLE_HEIGHT_M = 0.18;
const WATER_RIPPLE_SCALE_1 = 0.012;
const WATER_RIPPLE_SCALE_2 = 0.021;

export interface FarWaterSummaryRingUniformRefs {
  uOriginX: ReturnType<typeof uniform>;
  uOriginZ: ReturnType<typeof uniform>;
  uCellM: ReturnType<typeof uniform>;
  uStartM: ReturnType<typeof uniform>;
  uEndM: ReturnType<typeof uniform>;
  uRowOffsetCells: ReturnType<typeof uniform>;
  uWidthCells: ReturnType<typeof uniform>;
  uHeightCells: ReturnType<typeof uniform>;
  uValid: ReturnType<typeof uniform>;
}

export interface FarWaterUniformRefs {
  uCenterX: ReturnType<typeof uniform>;
  uCenterZ: ReturnType<typeof uniform>;
  uSummaryHeightCells?: ReturnType<typeof uniform>;
  uSummaryValid?: ReturnType<typeof uniform>;
  uSummaryRings?: FarWaterSummaryRingUniformRefs[];
}

export function createFarWaterMaterial(
  centerX: number,
  centerZ: number,
  summaryAtlas: FarSummaryGpuAtlasView,
): MeshBasicNodeMaterial {
  const uCenterX = uniform(centerX);
  const uCenterZ = uniform(centerZ);
  const uSummaryHeightCells = uniform(summaryAtlas.heightCells);
  const uSummaryValid = uniform(summaryAtlas.valid);
  const uSummaryRings = summaryAtlas.rings.map((ring) => createRingUniformRefs(ring));

  const local = positionGeometry;
  const worldX = local.x.add(uCenterX);
  const worldZ = local.z.add(uCenterZ);
  const distXZ = vec2(local.x, local.z).length();
  let waterHeight = float(0.0);
  let waterCoverage = float(0.0);

  for (const ringRefs of uSummaryRings) {
    const atlasUCells = worldX.sub(ringRefs.uOriginX).div(ringRefs.uCellM);
    const atlasVCells = worldZ.sub(ringRefs.uOriginZ).div(ringRefs.uCellM);
    const atlasUCell = clamp(atlasUCells, float(0.0), ringRefs.uWidthCells.sub(float(1.0)));
    const atlasVCell = clamp(atlasVCells, float(0.0), ringRefs.uHeightCells.sub(float(1.0)));
    const atlasU = atlasUCell.add(float(0.5)).div(ringRefs.uWidthCells);
    const atlasV = ringRefs.uRowOffsetCells.add(atlasVCell).add(float(0.5)).div(uSummaryHeightCells);
    const atlasUv = vec2(atlasU, atlasV);
    const heightSample = texture(summaryAtlas.texture, atlasUv);
    const coverageSample = texture(summaryAtlas.coverageTexture, atlasUv);
    const inside = step(float(0.0), atlasUCells)
      .mul(step(atlasUCells, ringRefs.uWidthCells.sub(float(SUMMARY_EDGE_EPS))))
      .mul(step(float(0.0), atlasVCells))
      .mul(step(atlasVCells, ringRefs.uHeightCells.sub(float(SUMMARY_EDGE_EPS))));
    const inDistanceBand = step(ringRefs.uStartM, distXZ).mul(step(distXZ, ringRefs.uEndM.sub(float(SUMMARY_EDGE_EPS))));
    const atlasWeight = heightSample.a.mul(coverageSample.a).mul(inside).mul(inDistanceBand).mul(ringRefs.uValid).mul(uSummaryValid);
    waterHeight = mix(waterHeight, heightSample.r, atlasWeight);
    waterCoverage = mix(waterCoverage, coverageSample.g, atlasWeight);
  }

  const ripple = sin(worldX.mul(float(WATER_RIPPLE_SCALE_1)).add(worldZ.mul(float(WATER_RIPPLE_SCALE_2))))
    .mul(float(WATER_RIPPLE_HEIGHT_M));
  const alpha = smoothstep(float(WATER_MASK_THRESHOLD), float(0.35), waterCoverage)
    .mul(float(WATER_ALPHA));
  const deepWater = vec3(0.035, 0.11, 0.19);
  const shallowWater = vec3(0.08, 0.22, 0.30);
  const color = mix(shallowWater, deepWater, clamp(waterCoverage, float(0.0), float(1.0)));

  const material = new MeshBasicNodeMaterial();
  material.name = "naadf-far-water-overlay";
  material.colorNode = color;
  material.opacityNode = alpha;
  material.positionNode = vec3(local.x, waterHeight.add(float(WATER_SURFACE_OFFSET_M)).add(ripple.mul(waterCoverage)), local.z);
  material.transparent = true;
  material.alphaTest = WATER_VISIBLE_ALPHA_THRESHOLD;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  material.userData.farWaterUniforms = {
    uCenterX,
    uCenterZ,
    uSummaryHeightCells,
    uSummaryValid,
    uSummaryRings,
  } satisfies FarWaterUniformRefs;

  return material;
}

export function updateFarWaterMaterialCenter(
  material: MeshBasicNodeMaterial,
  centerX: number,
  centerZ: number,
): void {
  const refs = material.userData.farWaterUniforms as FarWaterUniformRefs | undefined;
  if (!refs) return;
  refs.uCenterX.value = centerX;
  refs.uCenterZ.value = centerZ;
}

export function updateFarWaterMaterialSummaryAtlas(
  material: MeshBasicNodeMaterial,
  view: FarSummaryGpuAtlasView,
): void {
  const refs = material.userData.farWaterUniforms as FarWaterUniformRefs | undefined;
  if (!refs) return;
  if (refs.uSummaryHeightCells) refs.uSummaryHeightCells.value = view.heightCells;
  if (refs.uSummaryValid) refs.uSummaryValid.value = view.valid;
  if (!refs.uSummaryRings) return;

  for (let i = 0; i < refs.uSummaryRings.length; i++) {
    const ring = view.rings[i];
    const ringRefs = refs.uSummaryRings[i];
    if (!ring || !ringRefs) continue;
    ringRefs.uOriginX.value = ring.originX;
    ringRefs.uOriginZ.value = ring.originZ;
    ringRefs.uCellM.value = ring.cellM;
    ringRefs.uStartM.value = ring.startM;
    ringRefs.uEndM.value = ring.endM;
    ringRefs.uRowOffsetCells.value = ring.rowOffsetCells;
    ringRefs.uWidthCells.value = ring.widthCells;
    ringRefs.uHeightCells.value = ring.heightCells;
    ringRefs.uValid.value = ring.valid;
  }
}

function createRingUniformRefs(ring: FarSummaryGpuAtlasRingView): FarWaterSummaryRingUniformRefs {
  return {
    uOriginX: uniform(ring.originX),
    uOriginZ: uniform(ring.originZ),
    uCellM: uniform(ring.cellM),
    uStartM: uniform(ring.startM),
    uEndM: uniform(ring.endM),
    uRowOffsetCells: uniform(ring.rowOffsetCells),
    uWidthCells: uniform(ring.widthCells),
    uHeightCells: uniform(ring.heightCells),
    uValid: uniform(ring.valid),
  };
}
