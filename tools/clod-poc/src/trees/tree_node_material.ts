// WebGPU tree material (docs/webgpu-migration.md). TSL port of the classic
// MeshStandardMaterial + onBeforeCompile path in tree_material.ts. The classic path
// relies on GLSL `onBeforeCompile` (#include <begin_vertex>, <map_fragment>) which
// WebGPURenderer silently drops, leaving the trees as solid black silhouettes. This
// reauthors the same look as a node graph: vertex-colour albedo tinted by the white
// foliage alpha atlas, foliage alpha cutout (trunk/branch geometry kept opaque via
// treeFoliageMask), wind sway/flutter, and the same hemispheric + sun lighting as the
// grass/stone node materials. Geometry/LOD/scatter stays in TreeSystem.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  cos,
  dot,
  float,
  fract,
  frontFacing,
  instanceIndex,
  max,
  mix,
  normalGeometry,
  normalWorld,
  normalize,
  positionGeometry,
  screenCoordinate,
  sin,
  smoothstep,
  storage,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import { bakeBarkTextures, type BarkTextures } from "../textures/barkSynth.js";
import { TREE_LODS, type TreeLod, type TreeSettings } from "./tree_config.js";
import { createTreeFoliageAtlas, type TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeMaterialHandle } from "./tree_material.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

// Object-space bark tiling: positionGeometry is metres, so 0.8 repeats the bark
// atlas roughly every 1.25 m on a trunk.
const BARK_TILE_SCALE = 0.8;
const BARK_RESOLUTION = 256;

// One furrowed-bark atlas, baked once and shared across every tree material handle
// (the CPU InstancedMesh path plus the four per-LOD ring handles), keyed by seed.
// Long-lived for the app: handles never dispose it. The bake produces a float
// texture; we repack its height/AO channel into an 8-bit texture because WebGPU
// cannot linearly filter rgba32float without the (unrequested) float32-filterable
// feature.
let sharedBark: { seed: number; texture: THREE.Texture } | null = null;
function sharedBarkTexture(seed: number): THREE.Texture {
  if (!sharedBark || sharedBark.seed !== seed) {
    const baked: BarkTextures = bakeBarkTextures({ layer: 0, seed, resolution: BARK_RESOLUTION });
    const texelCount = baked.resolution * baked.resolution;
    const bytes = new Uint8Array(texelCount * 4);
    for (let i = 0; i < texelCount; i++) {
      const height = Math.round(Math.min(1, Math.max(0, baked.dataA[i * 4 + 3])) * 255);
      bytes[i * 4] = height;
      bytes[i * 4 + 1] = height;
      bytes[i * 4 + 2] = height;
      bytes[i * 4 + 3] = height;
    }
    const texture = new THREE.DataTexture(bytes, baked.resolution, baked.resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = "tree-bark-height";
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    baked.texA.dispose();
    baked.texB.dispose();
    sharedBark = { seed, texture };
  }
  return sharedBark.texture;
}

// Triplanar bark height/AO (range 0.3..1.0) from the object-space geometry, blended
// by the object-space normal so angled branches read correctly. Used to shade the
// trunk/branch vertex colour into furrowed bark.
function triplanarBarkShade(barkTexture: THREE.Texture): TslNode {
  const p: TslNode = positionGeometry.mul(BARK_TILE_SCALE);
  const an: TslNode = abs(normalGeometry);
  const wsum: TslNode = an.x.add(an.y).add(an.z).add(0.0001);
  const sx: TslNode = texture(barkTexture, vec2(p.z, p.y)).w;
  const sy: TslNode = texture(barkTexture, vec2(p.x, p.z)).w;
  const sz: TslNode = texture(barkTexture, vec2(p.x, p.y)).w;
  return sx.mul(an.x).add(sy.mul(an.y)).add(sz.mul(an.z)).div(wsum);
}

function barkTrunkAlbedo(vertexColor: TslNode, barkTexture: THREE.Texture): TslNode {
  return vertexColor.mul(triplanarBarkShade(barkTexture).mul(0.85).add(0.2));
}

const LOD_COLORS: Record<TreeLod, THREE.Color> = {
  near: new THREE.Color(0x2e7d32),
  mid: new THREE.Color(0xd98032),
  far: new THREE.Color(0x3a6ea5),
  impostor: new THREE.Color(0x7755aa),
};

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(1.0, 0.96, 0.88),
    skyLight: new THREE.Color(0x6b7a94),
    groundLight: new THREE.Color(0x2e2921),
  };
}

interface TreeWindNodeUniforms {
  uTime: TslNode;
  uWindDir: TslNode;
  uWindStrength: TslNode;
  uWindSpeed: TslNode;
  uGust: TslNode;
  uTrunkSway: TslNode;
  uLeafFlutter: TslNode;
}

export interface TreeRingInstanceBuffers {
  cell: THREE.BufferAttribute;
  capacity: number;
}

export interface TreeHydrologyWater {
  /** RGBA32F hydrology field; G channel = wet mask (1 inside a water body). */
  texture: THREE.Texture | null;
  /** World size (worldCells) mapping instance XZ → hydrology UV. */
  worldSize: number;
}

/**
 * Keep-mask that drops trees standing in a hydrology water body (so they stop
 * floating over lakes/rivers). XZ-only via the wet mask, so it works for both the
 * CPU InstancedMesh path and the GPU ring path. Returns null when no hydrology.
 */
function treeAboveWaterKeep(hydrology: TreeHydrologyWater | undefined, worldXZ: TslNode): TslNode | null {
  if (!hydrology?.texture) return null;
  const wetUv: TslNode = worldXZ.div(float(hydrology.worldSize || 1));
  return texture(hydrology.texture, wetUv).y.lessThan(0.5);
}

export function createTreeNodeMaterialHandle(
  settings: TreeSettings,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const wind: TreeWindNodeUniforms = {
    uTime: uniform(0),
    uWindDir: uniform(new THREE.Vector2(1, 0)),
    uWindStrength: uniform(0),
    uWindSpeed: uniform(0),
    uGust: uniform(0),
    uTrunkSway: uniform(0),
    uLeafFlutter: uniform(0),
  };
  applyWindUniforms(wind, settings);
  const uUseFoliageAlpha = uniform(settings.foliage.enabled ? 1 : 0);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const neutralForestData = new Uint8Array([0, 0, 0, 0]);
  const neutralForestTexture = new THREE.DataTexture(neutralForestData, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  neutralForestTexture.needsUpdate = true;
  const uForestEnabled = uniform(0);
  const uForestWorldSize = uniform(1);
  const uForestAoStrength = uniform(1);
  const uForestShadowStrength = uniform(1);
  const uForestFogStrength = uniform(1);
  const uForestFogColor = uniform(new THREE.Vector3(0.72, 0.78, 0.81));

  let foliageAtlas: TreeFoliageAtlas = createTreeFoliageAtlas(settings);
  const mapNodes: TslNode[] = [];
  const forestMapNodes: TslNode[] = [];
  const materials: MeshBasicNodeMaterial[] = [];

  // Shared per-vertex / per-instance attribute nodes (rebuilt per material to avoid
  // sharing a node instance across compiled materials).
  const barkTexture = sharedBarkTexture(settings.seed);
  const buildMaterial = (albedoFactory: (vertexColor: TslNode, mapRgb: TslNode) => TslNode, withBark: boolean): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aFoliageMask: TslNode = attribute("treeFoliageMask", "float");
    const aWind: TslNode = attribute("treeWind", "vec2");
    const aWindWeight: TslNode = aWind.x;
    const aFlutterWeight: TslNode = aWind.y;
    const aWorldXZ: TslNode = attribute("treeWorldXZ", "vec2");

    const mapNode: TslNode = texture(foliageAtlas.texture, uv());
    mapNodes.push(mapNode);
    const forestUv: TslNode = clamp(aWorldXZ.div(uForestWorldSize), vec2(0), vec2(1));
    const forestPacked: TslNode = texture(neutralForestTexture, forestUv);
    forestMapNodes.push(forestPacked);
    const foliageAlbedo: TslNode = albedoFactory(aColor, mapNode.xyz);
    // Trunk/branch verts (treeFoliageMask 0) get triplanar bark; foliage verts
    // (mask 1) are real leaf/needle meshes lit by their vertex colour. The old
    // alpha-card atlas cutout is retired — foliage is opaque geometry now.
    const albedo: TslNode = withBark
      ? mix(barkTrunkAlbedo(aColor, barkTexture), foliageAlbedo, aFoliageMask)
      : foliageAlbedo;
    const opacity: TslNode = float(1);

    // Wind sway/flutter, matching injectTreeWindShader() so the WebGL and WebGPU paths
    // animate identically. Applied in object space before the instance matrix, exactly
    // like the classic <begin_vertex> injection.
    const phase: TslNode = fract(sin(dot(aWorldXZ, vec2(127.1, 311.7))).mul(43758.5453123));
    const t: TslNode = wind.uTime.mul(wind.uWindSpeed);
    const waveArg: TslNode = t.add(phase.mul(6.2831853)).add(dot(aWorldXZ, wind.uWindDir).mul(0.035));
    const sway: TslNode = sin(waveArg).mul(wind.uWindStrength)
      .add(sin(t.mul(0.37).add(phase.mul(12.9898))).mul(wind.uGust))
      .mul(aWindWeight).mul(wind.uTrunkSway);
    const flutter: TslNode = sin(t.mul(7.0).add(phase.mul(19.19)).add(positionGeometry.y.mul(2.3)))
      .mul(wind.uWindStrength).mul(wind.uLeafFlutter).mul(aFlutterWeight);
    const disp: TslNode = sway.add(flutter);
    const positionNode: TslNode = positionGeometry.add(
      vec3(wind.uWindDir.x.mul(disp), float(0), wind.uWindDir.y.mul(disp)),
    );

    // Double-sided hemispheric + sun lighting (same model as grass/stones).
    const n0: TslNode = normalize(normalWorld);
    const n: TslNode = frontFacing.select(n0, n0.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const hemi: TslNode = mix(uGround, uSky, sky);
    const direct: TslNode = uSun.mul(sun);
    // Leaf translucency: sun coming from behind a leaf card glows through it.
    const back: TslNode = max(dot(n.negate(), uLight), 0.0);
    const transmission: TslNode = albedo.mul(uSun).mul(back).mul(aFoliageMask).mul(0.5);
    const litBase: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(direct))).add(transmission);
    const forestDarken: TslNode = clamp(
      forestPacked.x.mul(uForestAoStrength).add(forestPacked.y.mul(uForestShadowStrength)),
      0.0,
      0.72,
    ).mul(uForestEnabled);
    const forestFog: TslNode = clamp(forestPacked.z.mul(uForestFogStrength).mul(uForestEnabled), 0.0, 0.35);
    const lit: TslNode = mix(litBase.mul(float(1).sub(forestDarken)), uForestFogColor, forestFog)
      .add(vec3(forestPacked.w.mul(0.05).mul(uForestEnabled)));

    // Screen-door LOD crossfade: keep a fragment only when an interleaved-gradient
    // noise sample falls under the instance's fade weight. treeLodFade defaults to 1
    // (all instances drawn solid) unless TreeSystem is crossfading two LODs.
    const aLodFade: TslNode = attribute("treeLodFade", "float");
    const ign: TslNode = fract(
      fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
    );

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    (material as unknown as { opacityNode: TslNode }).opacityNode = opacity;
    const lodMask: TslNode = ign.lessThan(aLodFade);
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    (material as unknown as { maskNode: TslNode }).maskNode = aboveWater ? lodMask.and(aboveWater) : lodMask;
    material.alphaTest = settings.foliage.enabled ? settings.foliage.alphaTest : 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor) => vertexColor, true);

  const debugMaterials = {} as Record<TreeLod, THREE.Material>;
  for (const lod of TREE_LODS) {
    const color = LOD_COLORS[lod];
    debugMaterials[lod] = buildMaterial(() => vec3(color.r, color.g, color.b), false);
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      wind.uTime.value = timeSeconds;
    },
    updateSettings(next: TreeSettings) {
      applyWindUniforms(wind, next);
      uUseFoliageAlpha.value = next.foliage.enabled ? 1 : 0;
      const previous = foliageAtlas;
      foliageAtlas = createTreeFoliageAtlas(next);
      for (const mapNode of mapNodes) mapNode.value = foliageAtlas.texture;
      previous.dispose();
      for (const material of materials) {
        material.alphaTest = next.foliage.enabled ? next.foliage.alphaTest : 0;
        material.needsUpdate = true;
      }
    },
    updateLighting(next: EnvironmentLighting) {
      uLight.value.copy(next.sunDirection).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
    updateForestLighting(state: ForestLightingMaterialState | null) {
      if (!state) {
        uForestEnabled.value = 0;
        return;
      }
      const settings = state.settings;
      uForestEnabled.value = settings.enabled && settings.materialIntegration.treeEnabled ? 1 : 0;
      uForestWorldSize.value = Math.max(1, state.worldCells);
      uForestAoStrength.value = settings.ambientOcclusion.strength;
      uForestShadowStrength.value = settings.shadowProxy.strength;
      uForestFogStrength.value = settings.atmosphere.forestFogStrength + settings.atmosphere.aerialTintStrength;
      for (const mapNode of forestMapNodes) mapNode.value = state.textureHandle.texture;
    },
    dispose() {
      foliageAtlas.dispose();
      neutralForestTexture.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

export function createTreeRingNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  lod: TreeLod,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const wind: TreeWindNodeUniforms = {
    uTime: uniform(0),
    uWindDir: uniform(new THREE.Vector2(1, 0)),
    uWindStrength: uniform(0),
    uWindSpeed: uniform(0),
    uGust: uniform(0),
    uTrunkSway: uniform(0),
    uLeafFlutter: uniform(0),
  };
  applyWindUniforms(wind, settings);
  const uUseFoliageAlpha = uniform(settings.foliage.enabled ? 1 : 0);
  const uFadeCenter = uniform(new THREE.Vector2());
  const uNearDistance = uniform(settings.distanceM * settings.lod.nearFraction);
  const uMidDistance = uniform(settings.distanceM * settings.lod.midFraction);
  const uFarDistance = uniform(settings.distanceM * settings.lod.farFraction);
  const uBandDistance = uniform(settings.lod.crossfadeEnabled ? settings.lod.crossfadeBandM : 0);
  const uCellSize = uniform(3.4);
  const uSeed = uniform(settings.seed);
  const uLodIndex = uniform(TREE_LODS.indexOf(lod));
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  let foliageAtlas: TreeFoliageAtlas = createTreeFoliageAtlas(settings);
  const barkTexture = sharedBarkTexture(settings.seed);
  const mapNodes: TslNode[] = [];
  const materials: MeshBasicNodeMaterial[] = [];
  let debugColorByLod = settings.render.debugColorByLod;
  const prepassNodes = new Map<MeshBasicNodeMaterial, PrepassNodes>();

  const buildMaterial = (albedoFactory: (vertexColor: TslNode, mapRgb: TslNode, tint: TslNode) => TslNode, withBark: boolean): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aFoliageMask: TslNode = attribute("treeFoliageMask", "float");
    const aWind: TslNode = attribute("treeWind", "vec2");
    const aWindWeight: TslNode = aWind.x;
    const aFlutterWeight: TslNode = aWind.y;
    const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
    const aCell: TslNode = cellStore.element(instanceIndex);
    const worldCell: TslNode = aCell.xy;
    const jitter: TslNode = vec2(treeRingHash(worldCell, uSeed, 1103), treeRingHash(worldCell, uSeed, 1200));
    const aWorldXZ: TslNode = worldCell.add(jitter).mul(uCellSize);
    const aHeight: TslNode = aCell.z;
    const aScale: TslNode = treeRingHash(worldCell, uSeed, 601).mul(0.42).add(0.82);
    const aYaw: TslNode = treeRingHash(worldCell, uSeed, 701).mul(6.28318530718);
    const aTint: TslNode = treeRingHash(worldCell, uSeed, 1901);

    const mapNode: TslNode = texture(foliageAtlas.texture, uv());
    mapNodes.push(mapNode);
    const foliageAlbedo: TslNode = albedoFactory(aColor, mapNode.xyz, aTint);
    const albedo: TslNode = withBark
      ? mix(barkTrunkAlbedo(aColor, barkTexture), foliageAlbedo, aFoliageMask)
      : foliageAlbedo;
    const opacity: TslNode = mix(float(1), mapNode.w, aFoliageMask.mul(uUseFoliageAlpha));

    const phase: TslNode = fract(sin(dot(aWorldXZ, vec2(127.1, 311.7))).mul(43758.5453123));
    const t: TslNode = wind.uTime.mul(wind.uWindSpeed);
    const waveArg: TslNode = t.add(phase.mul(6.2831853)).add(dot(aWorldXZ, wind.uWindDir).mul(0.035));
    const sway: TslNode = sin(waveArg).mul(wind.uWindStrength)
      .add(sin(t.mul(0.37).add(phase.mul(12.9898))).mul(wind.uGust))
      .mul(aWindWeight).mul(wind.uTrunkSway).mul(aScale);
    const flutter: TslNode = sin(t.mul(7.0).add(phase.mul(19.19)).add(positionGeometry.y.mul(2.3)))
      .mul(wind.uWindStrength).mul(wind.uLeafFlutter).mul(aFlutterWeight).mul(aScale);
    const disp: TslNode = sway.add(flutter);
    const localPosition: TslNode = positionGeometry.mul(aScale).add(
      vec3(wind.uWindDir.x.mul(disp), float(0), wind.uWindDir.y.mul(disp)),
    );

    const c: TslNode = cos(aYaw);
    const s: TslNode = sin(aYaw);
    const rotX: TslNode = c.mul(localPosition.x).add(s.mul(localPosition.z));
    const rotZ: TslNode = s.mul(localPosition.x).negate().add(c.mul(localPosition.z));
    const positionNode: TslNode = vec3(aWorldXZ.x.add(rotX), aHeight.add(localPosition.y), aWorldXZ.y.add(rotZ));

    const localNormal: TslNode = normalize(normalGeometry);
    const rotatedNormal: TslNode = normalize(
      vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
    );
    const n: TslNode = frontFacing.select(rotatedNormal, rotatedNormal.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const hemi: TslNode = mix(uGround, uSky, sky);
    const direct: TslNode = uSun.mul(sun);
    // Leaf translucency: sun coming from behind a leaf card glows through it.
    const back: TslNode = max(dot(n.negate(), uLight), 0.0);
    const transmission: TslNode = albedo.mul(uSun).mul(back).mul(aFoliageMask).mul(0.5);
    const lit: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(direct))).add(transmission);

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    (material as unknown as { opacityNode: TslNode }).opacityNode = opacity;
    const lodMask: TslNode = treeRingLodMask(
      uLodIndex,
      aWorldXZ.sub(uFadeCenter).length(),
      uNearDistance,
      uMidDistance,
      uFarDistance,
      uBandDistance,
    );
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    (material as unknown as { maskNode: TslNode }).maskNode = aboveWater ? lodMask.and(aboveWater) : lodMask;
    material.alphaTest = settings.foliage.enabled ? settings.foliage.alphaTest : 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    prepassNodes.set(material, {
      positionNode,
      maskNode: (material as unknown as { maskNode: TslNode }).maskNode,
      side: material.side,
    });
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor, mapRgb, tint) =>
    vertexColor.mul(mapRgb).mul(mix(vec3(0.88, 0.93, 0.82), vec3(1.08, 1.02, 0.9), tint)),
    true,
  );
  const debugMaterials = {} as Record<TreeLod, THREE.Material>;
  for (const lod of TREE_LODS) {
    const color = LOD_COLORS[lod];
    debugMaterials[lod] = buildMaterial(() => vec3(color.r, color.g, color.b), false);
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      wind.uTime.value = timeSeconds;
    },
    setFadeCenter(x: number, z: number) {
      uFadeCenter.value.set(x, z);
    },
    prepassNodesFor(prepassLod: TreeLod) {
      const material = debugColorByLod ? debugMaterials[prepassLod] : regularMaterial;
      return prepassNodes.get(material as MeshBasicNodeMaterial);
    },
    updateSettings(next: TreeSettings) {
      debugColorByLod = next.render.debugColorByLod;
      applyWindUniforms(wind, next);
      uUseFoliageAlpha.value = next.foliage.enabled ? 1 : 0;
      uNearDistance.value = next.distanceM * next.lod.nearFraction;
      uMidDistance.value = next.distanceM * next.lod.midFraction;
      uFarDistance.value = next.distanceM * next.lod.farFraction;
      uBandDistance.value = next.lod.crossfadeEnabled ? next.lod.crossfadeBandM : 0;
      uSeed.value = next.seed;
      const previous = foliageAtlas;
      foliageAtlas = createTreeFoliageAtlas(next);
      for (const mapNode of mapNodes) mapNode.value = foliageAtlas.texture;
      previous.dispose();
      for (const material of materials) {
        material.alphaTest = next.foliage.enabled ? next.foliage.alphaTest : 0;
        material.needsUpdate = true;
      }
    },
    updateLighting(next: EnvironmentLighting) {
      uLight.value.copy(next.sunDirection).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
    updateForestLighting() {
      // Stage 1 ring trees validate the draw path first; forest lighting integration stays
      // on the existing CPU/WebGPU material until the all-LOD quality stage.
    },
    dispose() {
      foliageAtlas.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function treeRingHash(cell: TslNode, seed: TslNode, saltValue: number): TslNode {
  const salt = float(saltValue);
  return fract(
    sin(dot(cell.add(vec2(seed.add(salt), seed.mul(0.37).add(salt.mul(1.17)))), vec2(41.3, 289.1))).mul(43758.5453),
  );
}

function treeRingLodMask(
  lodIndex: TslNode,
  dist: TslNode,
  nearDistance: TslNode,
  midDistance: TslNode,
  farDistance: TslNode,
  bandDistance: TslNode,
): TslNode {
  const ign: TslNode = fract(
    fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
  );
  const noBand = bandDistance.lessThan(0.0001);
  const fadeIn = (distance: TslNode): TslNode => smoothstep(distance.sub(bandDistance), distance.add(bandDistance), dist);
  const fadeOut = (distance: TslNode): TslNode => float(1).sub(fadeIn(distance));
  const passIn = (fade: TslNode): TslNode => ign.greaterThanEqual(float(1).sub(fade));
  const passOut = (fade: TslNode): TslNode => ign.lessThan(fade);
  const nearPass = lodIndex.lessThan(0.5).and(noBand.or(passOut(fadeOut(nearDistance))));
  const midPass = lodIndex.greaterThanEqual(0.5).and(lodIndex.lessThan(1.5))
    .and(noBand.or(passIn(fadeIn(nearDistance)).and(passOut(fadeOut(midDistance)))));
  const farPass = lodIndex.greaterThanEqual(1.5).and(lodIndex.lessThan(2.5))
    .and(noBand.or(passIn(fadeIn(midDistance)).and(passOut(fadeOut(farDistance)))));
  const impostorPass = lodIndex.greaterThanEqual(2.5).and(noBand.or(passIn(fadeIn(farDistance))));
  return nearPass.or(midPass).or(farPass).or(impostorPass);
}

function applyWindUniforms(wind: TreeWindNodeUniforms, settings: TreeSettings): void {
  const direction = new THREE.Vector2(settings.wind.direction[0], settings.wind.direction[1]);
  if (direction.lengthSq() <= 1e-8) direction.set(1, 0);
  else direction.normalize();
  wind.uWindDir.value.copy(direction);
  const enabled = settings.wind.enabled ? 1 : 0;
  wind.uWindStrength.value = settings.wind.strength * enabled;
  wind.uWindSpeed.value = settings.wind.speed;
  wind.uGust.value = settings.wind.gustStrength * enabled;
  wind.uTrunkSway.value = settings.wind.trunkSwayStrength * enabled;
  wind.uLeafFlutter.value = settings.wind.leafFlutterStrength * enabled;
}
