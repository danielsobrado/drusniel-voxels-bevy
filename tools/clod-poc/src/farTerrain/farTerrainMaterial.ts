import * as THREE from "three";
import { clamp, cos, dot, float, max, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, sin, smoothstep, step, texture, uniform, vec2, vec3, vertexColor } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";
import type { FarShellLighting } from "../gpu/far_terrain_shell.js";
import type { FarSummaryGpuAtlasRingView, FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import { getActiveFarSummaryGpuAtlasView } from "../far-summary/gpu-render-atlas.js";
import { getSunLightGpuAtlas } from "../terrain/sun_visibility/sun_light_gpu_atlas.js";
export type { FarTerrainVertexColors, FarTerrainSummaryRingUniformRefs, FarTerrainUniformRefs, FarTerrainMaterialOptions, TslNode } from "./far_terrain_material_types.js";
import type { FarTerrainSummaryRingUniformRefs, FarTerrainUniformRefs, FarTerrainMaterialOptions, TslNode } from "./far_terrain_material_types.js";
export { computeFarTerrainVertexColors, createVertexColorBuffer } from "./far_terrain_vertex_colors.js";

const SUMMARY_EDGE_EPS = 0.0001;
const SUMMARY_HEIGHT_RANGE_SHADE_M = 36.0;
const SUMMARY_HEIGHT_RANGE_SHADE_STRENGTH = 0.28;
const SUMMARY_CANOPY_TINT_STRENGTH = 0.45;
const SUMMARY_WATER_TINT_STRENGTH = 0.70;
const SUMMARY_WATER_NORMAL_FLATTEN = 0.45;
const FAR_SUN_VISIBILITY_SHADE_MIN = 0.62;

export function createFarTerrainMaterial(
  lighting: FarShellLighting,
  config: FarTerrainUniformData,
  centerX: number,
  centerZ: number,
  _farRadius: number,
  options: FarTerrainMaterialOptions = {},
): MeshBasicNodeMaterial {
  const sunVisibilityAtlas = getSunLightGpuAtlas();
  const uSunDir = uniform(lighting.sunDirection.clone());
  const uSunColor = uniform(vec3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b));
  const uSkyColor = uniform(vec3(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b));
  const uGroundColor = uniform(vec3(lighting.groundLight.r, lighting.groundLight.g, lighting.groundLight.b));
  const uCenterX = uniform(centerX);
  const uCenterZ = uniform(centerZ);
  const uHazeStart = uniform(config.hazeStartM);
  const uHazeEnd = uniform(config.hazeEndM);
  const uHazeStrength = uniform(config.hazeStrength);
  const uHazeEnabled = uniform(config.hazeEnabled);
  const uHazeColor = uniform(new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]));
  const uHemiStrength = uniform(config.hemiStrength);
  const uSunStrength = uniform(config.sunStrength);
  const uAmbientFloor = uniform(config.ambientFloor);
  const uSunVisibilityOriginX = uniform(sunVisibilityAtlas.originX);
  const uSunVisibilityOriginZ = uniform(sunVisibilityAtlas.originZ);
  const uSunVisibilityWorldSize = uniform(sunVisibilityAtlas.worldSize);
  const uSunVisibilityValid = uniform(sunVisibilityAtlas.valid);
  const dp = vec2(positionWorld.x.sub(uCenterX), positionWorld.z.sub(uCenterZ));
  const distXZ = dp.length();
  const hazeT = smoothstep(uHazeStart, uHazeEnd, distXZ);
  const hazeFactor = hazeT.mul(uHazeStrength).mul(uHazeEnabled);
  let surfaceNormal = normalize(normalGeometry) as unknown as ReturnType<typeof vec3>;
  let surfaceColor = vertexColor() as unknown as ReturnType<typeof vec3>;
  let uSummaryWidthCells: TslNode | undefined;
  let uSummaryHeightCells: TslNode | undefined;
  let uSummaryValid: TslNode | undefined;
  let uSummaryRings: FarTerrainSummaryRingUniformRefs[] | undefined;

  const material = new MeshBasicNodeMaterial();
  material.vertexColors = true;
  material.side = THREE.DoubleSide;

  if (options.gpuDisplacement) {
    const local = positionGeometry;
    const worldX = local.x.add(uCenterX);
    const worldZ = local.z.add(uCenterZ);
    const continent = sin(worldX.mul(0.0017).add(worldZ.mul(0.0011))).mul(18.0);
    const hills = sin(worldX.mul(0.009).add(worldZ.mul(0.006))).mul(7.0)
      .add(cos(worldX.mul(0.013).sub(worldZ.mul(0.011))).mul(5.0));
    const detail = sin(worldX.mul(0.041).add(worldZ.mul(0.033))).mul(1.4);
    let terrainHeight = float(46.0).add(continent).add(hills).add(detail);
    const summaryAtlas = options.summaryAtlas ?? getActiveFarSummaryGpuAtlasView();

    if (summaryAtlas) {
      uSummaryWidthCells = uniform(summaryAtlas.widthCells);
      uSummaryHeightCells = uniform(summaryAtlas.heightCells);
      uSummaryValid = uniform(summaryAtlas.valid);
      uSummaryRings = summaryAtlas.rings.map((ring) => createRingUniformRefs(ring));

      for (const ringRefs of uSummaryRings) {
        const atlasUCells = worldX.sub(ringRefs.uOriginX).div(ringRefs.uCellM);
        const atlasVCells = worldZ.sub(ringRefs.uOriginZ).div(ringRefs.uCellM);
        const atlasUCell = clamp(atlasUCells, float(0.0), ringRefs.uWidthCells.sub(float(1.0)));
        const atlasVCell = clamp(atlasVCells, float(0.0), ringRefs.uHeightCells.sub(float(1.0)));
        const atlasU = atlasUCell.add(float(0.5)).div(ringRefs.uWidthCells);
        const atlasV = ringRefs.uRowOffsetCells.add(atlasVCell).add(float(0.5)).div(uSummaryHeightCells);
        const atlasUv = vec2(atlasU, atlasV);
        const heightSample = texture(summaryAtlas.texture, atlasUv);
        const materialSample = texture(summaryAtlas.materialTexture, atlasUv);
        const coverageSample = texture(summaryAtlas.coverageTexture, atlasUv);
        const inside = step(float(0.0), atlasUCells)
          .mul(step(atlasUCells, ringRefs.uWidthCells.sub(float(SUMMARY_EDGE_EPS))))
          .mul(step(float(0.0), atlasVCells))
          .mul(step(atlasVCells, ringRefs.uHeightCells.sub(float(SUMMARY_EDGE_EPS))));
        const inDistanceBand = step(ringRefs.uStartM, distXZ).mul(step(distXZ, ringRefs.uEndM.sub(float(SUMMARY_EDGE_EPS))));
        const atlasWeight: TslNode = materialSample.a.mul(inside).mul(inDistanceBand).mul(ringRefs.uValid).mul(uSummaryValid);
        const atlasUCellL = clamp(atlasUCell.sub(float(1.0)), float(0.0), ringRefs.uWidthCells.sub(float(1.0)));
        const atlasUCellR = clamp(atlasUCell.add(float(1.0)), float(0.0), ringRefs.uWidthCells.sub(float(1.0)));
        const atlasVCellD = clamp(atlasVCell.sub(float(1.0)), float(0.0), ringRefs.uHeightCells.sub(float(1.0)));
        const atlasVCellU = clamp(atlasVCell.add(float(1.0)), float(0.0), ringRefs.uHeightCells.sub(float(1.0)));
        const atlasUvL = vec2(atlasUCellL.add(float(0.5)).div(ringRefs.uWidthCells), atlasV);
        const atlasUvR = vec2(atlasUCellR.add(float(0.5)).div(ringRefs.uWidthCells), atlasV);
        const atlasUvD = vec2(atlasU, ringRefs.uRowOffsetCells.add(atlasVCellD).add(float(0.5)).div(uSummaryHeightCells));
        const atlasUvU = vec2(atlasU, ringRefs.uRowOffsetCells.add(atlasVCellU).add(float(0.5)).div(uSummaryHeightCells));
        const hL = texture(summaryAtlas.texture, atlasUvL).r;
        const hR = texture(summaryAtlas.texture, atlasUvR).r;
        const hD = texture(summaryAtlas.texture, atlasUvD).r;
        const hU = texture(summaryAtlas.texture, atlasUvU).r;
        const dx = max(atlasUCellR.sub(atlasUCellL), float(1.0)).mul(ringRefs.uCellM);
        const dz = max(atlasVCellU.sub(atlasVCellD), float(1.0)).mul(ringRefs.uCellM);
        const dhdx: TslNode = hR.sub(hL).div(dx);
        const dhdz: TslNode = hU.sub(hD).div(dz);
        const atlasNormal: TslNode = normalize(vec3(float(0.0).sub(dhdx), float(1.0), float(0.0).sub(dhdz)));
        const heightRange = clamp(heightSample.b.sub(heightSample.g).div(float(SUMMARY_HEIGHT_RANGE_SHADE_M)), float(0.0), float(1.0));
        const rangeShade = float(1.0).sub(heightRange.mul(float(SUMMARY_HEIGHT_RANGE_SHADE_STRENGTH)).mul(atlasWeight));
        const atlasSurfaceColor = materialSample.rgb.mul(rangeShade);
        const canopyColor = mix(atlasSurfaceColor, vec3(0.10, 0.24, 0.08), coverageSample.r.mul(float(SUMMARY_CANOPY_TINT_STRENGTH)));
        const coverageColor = mix(canopyColor, vec3(0.05, 0.13, 0.23), coverageSample.g.mul(float(SUMMARY_WATER_TINT_STRENGTH)));
        const coverageNormal = normalize(mix(atlasNormal, vec3(0.0, 1.0, 0.0), coverageSample.g.mul(float(SUMMARY_WATER_NORMAL_FLATTEN))));
        terrainHeight = mix(terrainHeight, heightSample.r, atlasWeight);
        surfaceColor = mix(surfaceColor, coverageColor, atlasWeight) as unknown as ReturnType<typeof vec3>;
        surfaceNormal = normalize(mix(surfaceNormal, coverageNormal, atlasWeight)) as unknown as ReturnType<typeof vec3>;
      }
    }
    terrainHeight = terrainHeight.add(float(options.heightBiasMeters ?? 0));
    material.positionNode = vec3(local.x, terrainHeight, local.z);
  }

  const visibilityWorldUv = vec2(
    positionWorld.x.sub(uSunVisibilityOriginX).div(uSunVisibilityWorldSize),
    positionWorld.z.sub(uSunVisibilityOriginZ).div(uSunVisibilityWorldSize),
  );
  const visibilityUv = vec2(
    clamp(visibilityWorldUv.x, float(0.0), float(1.0)),
    clamp(visibilityWorldUv.y, float(0.0), float(1.0)),
  );
  const visibilityInside = step(float(0.0), visibilityWorldUv.x)
    .mul(step(visibilityWorldUv.x, float(1.0)))
    .mul(step(float(0.0), visibilityWorldUv.y))
    .mul(step(visibilityWorldUv.y, float(1.0)))
    .mul(uSunVisibilityValid);
  const visibilitySample = texture(sunVisibilityAtlas.texture, visibilityUv).r;
  const sunVisibility = mix(float(1.0), mix(float(FAR_SUN_VISIBILITY_SHADE_MIN), float(1.0), visibilitySample), visibilityInside);

  const sun = max(dot(surfaceNormal, uSunDir), float(0));
  const sky = clamp(surfaceNormal.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi = mix(uGroundColor, uSkyColor, sky).mul(uHemiStrength);
  const ambientFloor = vec3(uAmbientFloor, uAmbientFloor, uAmbientFloor);
  const directSun = uSunColor.mul(pow(sun, float(1.35))).mul(uSunStrength).mul(sunVisibility);
  const light = ambientFloor.add(hemi).add(directSun);
  const colorNode = surfaceColor as unknown as { mul: (x: unknown) => unknown };
  const lit = (colorNode.mul(light) as unknown as ReturnType<typeof vec3>);
  material.colorNode = mix(lit, uHazeColor, hazeFactor);

  const refs: FarTerrainUniformRefs = {
    uCenterX, uCenterZ, uHazeStart, uHazeEnd, uHazeStrength, uHazeEnabled, uHazeColor,
    uHemiStrength, uSunStrength, uAmbientFloor, uSunDir, uSunColor, uSkyColor, uGroundColor,
    uSunVisibilityOriginX, uSunVisibilityOriginZ, uSunVisibilityWorldSize, uSunVisibilityValid,
    uSummaryWidthCells, uSummaryHeightCells, uSummaryValid, uSummaryRings,
  };
  material.userData.farTerrainUniforms = refs;
  return material;
}

function createRingUniformRefs(ring: FarSummaryGpuAtlasRingView): FarTerrainSummaryRingUniformRefs {
  return {
    uOriginX: uniform(ring.originX), uOriginZ: uniform(ring.originZ), uCellM: uniform(ring.cellM),
    uStartM: uniform(ring.startM), uEndM: uniform(ring.endM),
    uRowOffsetCells: uniform(ring.rowOffsetCells), uWidthCells: uniform(ring.widthCells),
    uHeightCells: uniform(ring.heightCells), uValid: uniform(ring.valid),
  };
}

export function createFarSummaryAtlasPreviewTexture(view: FarSummaryGpuAtlasView): THREE.DataTexture {
  return view.texture;
}

export function updateFarTerrainMaterial(material: MeshBasicNodeMaterial, config: Partial<FarTerrainUniformData>): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;
  if (config.hazeStartM !== undefined) refs.uHazeStart.value = config.hazeStartM;
  if (config.hazeEndM !== undefined) refs.uHazeEnd.value = config.hazeEndM;
  if (config.hazeStrength !== undefined) refs.uHazeStrength.value = config.hazeStrength;
  if (config.hazeEnabled !== undefined) refs.uHazeEnabled.value = config.hazeEnabled;
  if (config.hazeColor) refs.uHazeColor.value = new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]);
  if (config.hemiStrength !== undefined) refs.uHemiStrength.value = config.hemiStrength;
  if (config.sunStrength !== undefined) refs.uSunStrength.value = config.sunStrength;
  if (config.ambientFloor !== undefined) refs.uAmbientFloor.value = config.ambientFloor;
}

export function updateFarTerrainMaterialCenter(material: MeshBasicNodeMaterial, centerX: number, centerZ: number): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;
  refs.uCenterX.value = centerX;
  refs.uCenterZ.value = centerZ;
  const activeSummaryAtlas = getActiveFarSummaryGpuAtlasView();
  if (activeSummaryAtlas) updateFarTerrainMaterialSummaryAtlas(material, activeSummaryAtlas);
  updateFarTerrainMaterialSunVisibility(material);
}

export function updateFarTerrainMaterialSummaryAtlas(material: MeshBasicNodeMaterial, view: FarSummaryGpuAtlasView): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;
  if (refs.uSummaryWidthCells) refs.uSummaryWidthCells.value = view.widthCells;
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

function updateFarTerrainMaterialSunVisibility(material: MeshBasicNodeMaterial): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;
  const atlas = getSunLightGpuAtlas();
  refs.uSunVisibilityOriginX.value = atlas.originX;
  refs.uSunVisibilityOriginZ.value = atlas.originZ;
  refs.uSunVisibilityWorldSize.value = atlas.worldSize;
  refs.uSunVisibilityValid.value = atlas.valid;
}
