import * as THREE from "three";
import {
  attribute,
  clamp,
  dot,
  float,
  frontFacing,
  max,
  mix,
  texture,
  uniform,
  uv,
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
  const normal = material.normalNode;
  if (!normal) throw new Error("tree impostor node material does not expose a surface normal");

  const albedo = viewBlend ? blendedNodeAlbedo(atlas) : singleNodeAlbedo(atlas);
  const uniforms = nodeLightingUniforms(lighting);
  const n: TslNode = frontFacing.select(normal, normal.negate());
  const sun: TslNode = clamp(max(dot(n, uniforms.light), 0), 0, SUN_MAX);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0, 1);
  const hemi: TslNode = mix(uniforms.ground, uniforms.sky, sky);
  const back: TslNode = max(dot(n.negate(), uniforms.light), 0);
  const transmission: TslNode = albedo.mul(uniforms.sun).mul(back).mul(LEAF_TRANSMISSION);
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
  const samples = [0, 1, 2, 3].map((index) => {
    const rect: TslNode = attribute(`treeImpostorUvRect${index}`, "vec4");
    const atlasUv: TslNode = rect.xy.add(uv().mul(rect.zw.sub(rect.xy)));
    const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
    return { albedo: decodeNodeAlbedo(sample), coverage: sample.w };
  });
  const coverage = samples[0].coverage.mul(weights.x)
    .add(samples[1].coverage.mul(weights.y))
    .add(samples[2].coverage.mul(weights.z))
    .add(samples[3].coverage.mul(weights.w));
  return samples[0].albedo.mul(samples[0].coverage).mul(weights.x)
    .add(samples[1].albedo.mul(samples[1].coverage).mul(weights.y))
    .add(samples[2].albedo.mul(samples[2].coverage).mul(weights.z))
    .add(samples[3].albedo.mul(samples[3].coverage).mul(weights.w))
    .div(max(coverage, float(MIN_COVERAGE)));
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
  material.fragmentShader = addShaderLightingUniforms(material.fragmentShader)
    .replace(/vec3 treeImpostorRelight\([\s\S]*?\n\}/, dynamicRelightFunction());
  material.fragmentShader = viewBlend
    ? material.fragmentShader.replace(
        /  if \(hasNormalDepthMap > 0\.5\) \{[\s\S]*?  \}\n  gl_FragColor = vec4\(albedo, coverage\);/,
        `  vec3 packedNormal = vec3(0.5, 0.5, 1.0);\n  if (hasNormalDepthMap > 0.5) {\n    vec3 n0 = texture2D(normalDepthMap, vTreeImpostorUv0).rgb;\n    vec3 n1 = texture2D(normalDepthMap, vTreeImpostorUv1).rgb;\n    vec3 n2 = texture2D(normalDepthMap, vTreeImpostorUv2).rgb;\n    vec3 n3 = texture2D(normalDepthMap, vTreeImpostorUv3).rgb;\n    packedNormal = treeImpostorBlendPackedNormal(n0, n1, n2, n3, coverages, vTreeImpostorBlendWeights, coverage);\n  }\n  albedo = treeImpostorRelight(albedo, packedNormal, vTreeImpostorBillboardNormal, hasNormalDepthMap);\n  gl_FragColor = vec4(albedo, coverage);`,
      )
    : material.fragmentShader.replace(
        /  vec3 albedo = treeImpostorDecodeAlbedo\(color\);\n  if \(hasNormalDepthMap > 0\.5\) \{[\s\S]*?  \}\n  gl_FragColor = vec4\(albedo, color\.a\);/,
        `  vec3 packedNormal = vec3(0.5, 0.5, 1.0);\n  if (hasNormalDepthMap > 0.5) packedNormal = texture2D(normalDepthMap, vTreeImpostorUv).rgb;\n  vec3 albedo = treeImpostorRelight(treeImpostorDecodeAlbedo(color), packedNormal, vTreeImpostorBillboardNormal, hasNormalDepthMap);\n  gl_FragColor = vec4(albedo, color.a);`,
      );
  if (!material.fragmentShader.includes("uTreeImpostorSunDirection")
    || !material.fragmentShader.includes("hasNormalDepthMap);")
    || material.fragmentShader.includes("normalize(vec3(0.4, 0.85, 0.3))")) {
    throw new Error("tree impostor live-lighting shader transform failed");
  }
  material.needsUpdate = true;
}

function addShaderLightingUniforms(source: string): string {
  return source.replace(
    "uniform float alphaTest;",
    `uniform float alphaTest;\nuniform vec3 uTreeImpostorSunDirection;\nuniform vec3 uTreeImpostorSunColor;\nuniform vec3 uTreeImpostorSkyColor;\nuniform vec3 uTreeImpostorGroundColor;\nuniform float uTreeImpostorAmbientFloor;`,
  );
}

function dynamicRelightFunction(): string {
  return `vec3 treeImpostorRelight(vec3 albedo, vec3 packedNormal, vec3 billboardNormal, float hasNormalMap) {\n  vec3 capturedNormal = normalize(packedNormal * 2.0 - 1.0);\n  vec3 detailedNormal = normalize(mix(normalize(billboardNormal), capturedNormal, TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT));\n  vec3 n0 = normalize(mix(normalize(billboardNormal), detailedNormal, step(0.5, hasNormalMap)));\n  vec3 n = gl_FrontFacing ? n0 : -n0;\n  vec3 sunDir = normalize(uTreeImpostorSunDirection);\n  float sun = clamp(max(dot(n, sunDir), 0.0), 0.0, 0.85);\n  float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);\n  float back = max(dot(-n, sunDir), 0.0);\n  vec3 hemi = mix(uTreeImpostorGroundColor, uTreeImpostorSkyColor, sky);\n  vec3 transmission = albedo * uTreeImpostorSunColor * back * 0.22;\n  return clamp(albedo * (hemi + uTreeImpostorSunColor * sun + vec3(uTreeImpostorAmbientFloor)) + transmission, 0.0, 1.0);\n}`;
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
