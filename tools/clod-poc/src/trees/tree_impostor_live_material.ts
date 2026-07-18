import * as THREE from "three";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  frontFacing,
  max,
  mix,
  normalize,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  createTreeImpostorBlendMaterial,
  createTreeImpostorBlendNodeMaterial,
  createTreeImpostorMaterial,
  createTreeImpostorNodeMaterial,
} from "./tree_impostor_material.js";
import { TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME } from "./tree_system_instance_attributes.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface NodeMaterialShape extends THREE.Material {
  colorNode?: TslNode;
  normalNode?: TslNode;
}

interface LiveTreeImpostorMaterialSelection {
  webgpu: boolean;
  viewBlend: boolean;
}

interface NodeLightingUniforms {
  light: TslNode;
  sun: TslNode;
  sky: TslNode;
  ground: TslNode;
  ambientFloor: TslNode;
}

const LIVE_LIGHTING_KEY = "treeImpostorLiveLighting";
const DEFAULT_AMBIENT_FLOOR = 0.25;
const LEAF_TRANSMISSION = 0.22;
const NORMAL_DETAIL_WEIGHT = 0.65;
const SUN_MAX = 0.85;
const MIN_COVERAGE = 0.0001;

export function createLiveTreeImpostorMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
  selection: LiveTreeImpostorMaterialSelection,
  lighting?: EnvironmentLighting,
): THREE.Material {
  const material = selection.webgpu
    ? selection.viewBlend
      ? createTreeImpostorBlendNodeMaterial(settings, atlas)
      : createTreeImpostorNodeMaterial(settings, atlas)
    : selection.viewBlend
      ? createTreeImpostorBlendMaterial(settings, atlas)
      : createTreeImpostorMaterial(settings, atlas);

  const initial = lighting ?? fallbackLighting();
  if (selection.webgpu) configureNodeLighting(material, atlas, selection.viewBlend, initial);
  else configureShaderLighting(material as THREE.ShaderMaterial, selection.viewBlend, initial);
  return material;
}

export function updateLiveTreeImpostorMaterialLighting(
  material: THREE.Material,
  lighting: EnvironmentLighting,
): boolean {
  if (material instanceof THREE.ShaderMaterial) {
    const uniforms = material.uniforms;
    if (!uniforms.uTreeImpostorSunDirection) return false;
    uniforms.uTreeImpostorSunDirection.value.copy(lighting.sunDirection).normalize();
    uniforms.uTreeImpostorSunColor.value.copy(lighting.sunColor);
    uniforms.uTreeImpostorSkyColor.value.copy(lighting.skyLight);
    uniforms.uTreeImpostorGroundColor.value.copy(lighting.groundLight);
    uniforms.uTreeImpostorAmbientFloor.value = lighting.ambientFloor ?? DEFAULT_AMBIENT_FLOOR;
    return true;
  }

  const uniforms = material.userData[LIVE_LIGHTING_KEY] as NodeLightingUniforms | undefined;
  if (!uniforms) return false;
  uniforms.light.value.copy(lighting.sunDirection).normalize();
  uniforms.sun.value.set(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b);
  uniforms.sky.value.set(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b);
  uniforms.ground.value.set(lighting.groundLight.r, lighting.groundLight.g, lighting.groundLight.b);
  uniforms.ambientFloor.value = lighting.ambientFloor ?? DEFAULT_AMBIENT_FLOOR;
  return true;
}

function configureNodeLighting(
  rawMaterial: THREE.Material,
  atlas: TreeImpostorAtlas,
  viewBlend: boolean,
  lighting: EnvironmentLighting,
): void {
  const material = rawMaterial as NodeMaterialShape;
  const albedo = viewBlend ? blendedNodeAlbedo(atlas) : singleNodeAlbedo(atlas);
  const surfaceNormal = nodeSurfaceNormal(atlas, viewBlend);
  const uniforms = nodeLightingUniforms(lighting);
  const n: TslNode = frontFacing.select(surfaceNormal, surfaceNormal.negate());
  const sun: TslNode = clamp(max(dot(n, uniforms.light), 0), 0, SUN_MAX);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0, 1);
  const hemi: TslNode = mix(uniforms.ground, uniforms.sky, sky);
  const back: TslNode = max(dot(n.negate(), uniforms.light), 0);
  const transmission: TslNode = albedo.mul(uniforms.sun).mul(back).mul(LEAF_TRANSMISSION);
  material.normalNode = surfaceNormal;
  material.colorNode = clamp(
    albedo.mul(hemi.add(uniforms.sun.mul(sun)).add(uniforms.ambientFloor)).add(transmission),
    0,
    1,
  );
  material.userData[LIVE_LIGHTING_KEY] = uniforms;
}

function singleNodeAlbedo(atlas: TreeImpostorAtlas): TslNode {
  const rect: TslNode = attribute("treeImpostorUvRect", "vec4");
  const atlasUv: TslNode = rect.xy.add(uv().mul(rect.zw.sub(rect.xy)));
  return decodeNodeAlbedo(texture(atlas.albedo ?? atlas.texture, atlasUv));
}

function blendedNodeAlbedo(atlas: TreeImpostorAtlas): TslNode {
  const weights: TslNode = attribute("treeImpostorBlendWeights", "vec4");
  const samples = nodeBlendSamples(atlas);
  const coverage = blendedCoverage(samples, weights);
  return samples[0].albedo.mul(samples[0].coverage).mul(weights.x)
    .add(samples[1].albedo.mul(samples[1].coverage).mul(weights.y))
    .add(samples[2].albedo.mul(samples[2].coverage).mul(weights.z))
    .add(samples[3].albedo.mul(samples[3].coverage).mul(weights.w))
    .div(max(coverage, float(MIN_COVERAGE)));
}

function nodeSurfaceNormal(atlas: TreeImpostorAtlas, viewBlend: boolean): TslNode {
  const billboard = nodeBillboardNormal();
  if (!atlas.normalDepth) return billboard;
  const localNormal = viewBlend ? blendedNodeLocalNormal(atlas) : singleNodeLocalNormal(atlas);
  const yaw: TslNode = attribute(TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME, "vec2");
  const rotated = normalize(vec3(
    localNormal.x.mul(yaw.x).add(localNormal.z.mul(yaw.y)),
    localNormal.y,
    localNormal.z.mul(yaw.x).sub(localNormal.x.mul(yaw.y)),
  ));
  return normalize((mix as any)(billboard, rotated, float(NORMAL_DETAIL_WEIGHT)));
}

function singleNodeLocalNormal(atlas: TreeImpostorAtlas): TslNode {
  const rect: TslNode = attribute("treeImpostorUvRect", "vec4");
  const atlasUv: TslNode = rect.xy.add(uv().mul(rect.zw.sub(rect.xy)));
  return normalize(texture(atlas.normalDepth!, atlasUv).xyz.mul(2).sub(1));
}

function blendedNodeLocalNormal(atlas: TreeImpostorAtlas): TslNode {
  const weights: TslNode = attribute("treeImpostorBlendWeights", "vec4");
  const samples = nodeBlendSamples(atlas);
  const coverage = blendedCoverage(samples, weights);
  return normalize(
    samples[0].normal.mul(samples[0].coverage).mul(weights.x)
      .add(samples[1].normal.mul(samples[1].coverage).mul(weights.y))
      .add(samples[2].normal.mul(samples[2].coverage).mul(weights.z))
      .add(samples[3].normal.mul(samples[3].coverage).mul(weights.w))
      .div(max(coverage, float(MIN_COVERAGE))),
  );
}

function nodeBlendSamples(atlas: TreeImpostorAtlas): Array<{ albedo: TslNode; coverage: TslNode; normal: TslNode }> {
  return [0, 1, 2, 3].map((index) => {
    const rect: TslNode = attribute(`treeImpostorUvRect${index}`, "vec4");
    const atlasUv: TslNode = rect.xy.add(uv().mul(rect.zw.sub(rect.xy)));
    const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
    const normal: TslNode = atlas.normalDepth
      ? normalize(texture(atlas.normalDepth, atlasUv).xyz.mul(2).sub(1))
      : vec3(0, 1, 0);
    return { albedo: decodeNodeAlbedo(sample), coverage: sample.w, normal };
  });
}

function blendedCoverage(
  samples: Array<{ coverage: TslNode }>,
  weights: TslNode,
): TslNode {
  return samples[0].coverage.mul(weights.x)
    .add(samples[1].coverage.mul(weights.y))
    .add(samples[2].coverage.mul(weights.z))
    .add(samples[3].coverage.mul(weights.w));
}

function nodeBillboardNormal(): TslNode {
  const worldXZ: TslNode = attribute("treeWorldXZ", "vec2");
  const toCamera: TslNode = vec3(
    cameraPosition.x.sub(worldXZ.x),
    float(0),
    cameraPosition.z.sub(worldXZ.y),
  );
  return dot(toCamera, toCamera)
    .greaterThan(float(0.000001))
    .select(normalize(toCamera), vec3(0, 0, 1));
}

function decodeNodeAlbedo(sample: TslNode): TslNode {
  const encoded: TslNode = clamp(sample.xyz.div(max(sample.w, float(MIN_COVERAGE))), 0, 1);
  return encoded.mul(encoded);
}

function configureShaderLighting(
  material: THREE.ShaderMaterial,
  viewBlend: boolean,
  lighting: EnvironmentLighting,
): void {
  Object.assign(material.uniforms, shaderLightingUniforms(lighting));
  material.vertexShader = addShaderYawBasis(material.vertexShader);
  material.fragmentShader = addShaderLightingUniforms(material.fragmentShader)
    .replace(/vec3 treeImpostorRelight\([\s\S]*?\n\}/, dynamicRelightFunction());
  material.fragmentShader = viewBlend
    ? material.fragmentShader.replace(
        /  if \(hasNormalDepthMap > 0\.5\) \{[\s\S]*?  \}\n  gl_FragColor = vec4\(albedo, coverage\);/,
        `  vec3 packedNormal = vec3(0.5, 0.5, 1.0);\n  if (hasNormalDepthMap > 0.5) {\n    vec3 n0 = texture2D(normalDepthMap, vTreeImpostorUv0).rgb;\n    vec3 n1 = texture2D(normalDepthMap, vTreeImpostorUv1).rgb;\n    vec3 n2 = texture2D(normalDepthMap, vTreeImpostorUv2).rgb;\n    vec3 n3 = texture2D(normalDepthMap, vTreeImpostorUv3).rgb;\n    packedNormal = treeImpostorBlendPackedNormal(n0, n1, n2, n3, coverages, vTreeImpostorBlendWeights, coverage);\n  }\n  albedo = treeImpostorRelight(albedo, packedNormal, vTreeImpostorBillboardNormal, vTreeImpostorYawSinCos, hasNormalDepthMap);\n  gl_FragColor = vec4(albedo, coverage);`,
      )
    : material.fragmentShader.replace(
        /  vec3 albedo = treeImpostorDecodeAlbedo\(color\);\n  if \(hasNormalDepthMap > 0\.5\) \{[\s\S]*?  \}\n  gl_FragColor = vec4\(albedo, color\.a\);/,
        `  vec3 packedNormal = vec3(0.5, 0.5, 1.0);\n  if (hasNormalDepthMap > 0.5) packedNormal = texture2D(normalDepthMap, vTreeImpostorUv).rgb;\n  vec3 albedo = treeImpostorRelight(treeImpostorDecodeAlbedo(color), packedNormal, vTreeImpostorBillboardNormal, vTreeImpostorYawSinCos, hasNormalDepthMap);\n  gl_FragColor = vec4(albedo, color.a);`,
      );
  if (!material.vertexShader.includes("vTreeImpostorYawSinCos = treeImpostorYawSinCos")
    || !material.fragmentShader.includes("uTreeImpostorSunDirection")
    || !material.fragmentShader.includes("vTreeImpostorYawSinCos, hasNormalDepthMap)")
    || material.fragmentShader.includes("normalize(vec3(0.4, 0.85, 0.3))")) {
    throw new Error("tree impostor live-lighting shader transform failed");
  }
  material.needsUpdate = true;
}

function addShaderYawBasis(source: string): string {
  const transformed = source
    .replace(
      "attribute vec2 treeWorldXZ;",
      `attribute vec2 treeWorldXZ;\nattribute vec2 ${TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME};\nvarying vec2 vTreeImpostorYawSinCos;`,
    )
    .replace("void main() {", `void main() {\n  vTreeImpostorYawSinCos = ${TREE_IMPOSTOR_YAW_SIN_COS_ATTRIBUTE_NAME};`);
  if (!transformed.includes("vTreeImpostorYawSinCos = treeImpostorYawSinCos")) {
    throw new Error("tree impostor yaw-basis vertex transform failed");
  }
  return transformed;
}

function addShaderLightingUniforms(source: string): string {
  return source.replace(
    "uniform float alphaTest;",
    `uniform float alphaTest;\nvarying vec2 vTreeImpostorYawSinCos;\nuniform vec3 uTreeImpostorSunDirection;\nuniform vec3 uTreeImpostorSunColor;\nuniform vec3 uTreeImpostorSkyColor;\nuniform vec3 uTreeImpostorGroundColor;\nuniform float uTreeImpostorAmbientFloor;`,
  );
}

function dynamicRelightFunction(): string {
  return `vec3 treeImpostorRelight(vec3 albedo, vec3 packedNormal, vec3 billboardNormal, vec2 yawSinCos, float hasNormalMap) {\n  vec3 localNormal = normalize(packedNormal * 2.0 - 1.0);\n  vec3 capturedNormal = normalize(vec3(\n    localNormal.x * yawSinCos.x + localNormal.z * yawSinCos.y,\n    localNormal.y,\n    localNormal.z * yawSinCos.x - localNormal.x * yawSinCos.y\n  ));\n  vec3 detailedNormal = normalize(mix(normalize(billboardNormal), capturedNormal, TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT));\n  vec3 n0 = normalize(mix(normalize(billboardNormal), detailedNormal, step(0.5, hasNormalMap)));\n  vec3 n = gl_FrontFacing ? n0 : -n0;\n  vec3 sunDir = normalize(uTreeImpostorSunDirection);\n  float sun = clamp(max(dot(n, sunDir), 0.0), 0.0, 0.85);\n  float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);\n  float back = max(dot(-n, sunDir), 0.0);\n  vec3 hemi = mix(uTreeImpostorGroundColor, uTreeImpostorSkyColor, sky);\n  vec3 transmission = albedo * uTreeImpostorSunColor * back * 0.22;\n  return clamp(albedo * (hemi + uTreeImpostorSunColor * sun + vec3(uTreeImpostorAmbientFloor)) + transmission, 0.0, 1.0);\n}`;
}

function nodeLightingUniforms(lighting: EnvironmentLighting): NodeLightingUniforms {
  return {
    light: uniform(lighting.sunDirection.clone().normalize()),
    sun: uniform(colorVector(lighting.sunColor)),
    sky: uniform(colorVector(lighting.skyLight)),
    ground: uniform(colorVector(lighting.groundLight)),
    ambientFloor: uniform(lighting.ambientFloor ?? DEFAULT_AMBIENT_FLOOR),
  };
}

function shaderLightingUniforms(lighting: EnvironmentLighting) {
  return {
    uTreeImpostorSunDirection: { value: lighting.sunDirection.clone().normalize() },
    uTreeImpostorSunColor: { value: lighting.sunColor.clone() },
    uTreeImpostorSkyColor: { value: lighting.skyLight.clone() },
    uTreeImpostorGroundColor: { value: lighting.groundLight.clone() },
    uTreeImpostorAmbientFloor: { value: lighting.ambientFloor ?? DEFAULT_AMBIENT_FLOOR },
  };
}

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(1, 0.96, 0.88),
    skyLight: new THREE.Color(0.42, 0.48, 0.58),
    groundLight: new THREE.Color(0.18, 0.16, 0.13),
    ambientFloor: DEFAULT_AMBIENT_FLOOR,
  };
}

function colorVector(color: THREE.Color): THREE.Vector3 {
  return new THREE.Vector3(color.r, color.g, color.b);
}
