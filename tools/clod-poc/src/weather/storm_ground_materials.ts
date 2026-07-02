import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  Fn,
  fract,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { RainWeatherShaderHandle } from "./rain_shader_handle.js";
import { IMPACT_SURFACE_OFFSET } from "./storm_ground_constants.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const FLASH_GLSL = /* glsl */ `
float lightningFlash(float uTime, float uRate, float uIntensity, float vSeed, float vActive) {
  float stormStrength = clamp(uIntensity / 1.6, 0.0, 1.0);
  float eventTime = uTime * uRate * mix(1.05, 1.65, stormStrength) + vSeed * 7.0;
  float localTime = fract(eventTime);
  float cycle = floor(eventTime);
  float gate = smoothstep(mix(0.66, 0.28, stormStrength), 0.98, hash12(vec2(cycle, vSeed)));
  float flashA = 1.0 - smoothstep(0.0, 0.18, localTime);
  float flashB = (1.0 - smoothstep(0.0, 0.08, abs(localTime - 0.24))) * 0.48;
  return max(flashA, flashB) * gate * vActive;
}
`;

const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  return fract(cos(mod(dot(p, vec2(13.9898, 8.141)), 3.14)) * 43758.5453);
}

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 iuv = floor(p);
  vec2 fuv = fract(p);
  vec2 blur = smoothstep(0.0, 1.0, fuv);
  float a = dot(hash22(iuv + vec2(0.0, 0.0)), fuv - vec2(0.0, 0.0));
  float b = dot(hash22(iuv + vec2(1.0, 0.0)), fuv - vec2(1.0, 0.0));
  float c = dot(hash22(iuv + vec2(0.0, 1.0)), fuv - vec2(0.0, 1.0));
  float d = dot(hash22(iuv + vec2(1.0, 1.0)), fuv - vec2(1.0, 1.0));
  return mix(mix(a, b, blur.x), mix(c, d, blur.x), blur.y) + 0.5;
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 8; i++) {
    value += amplitude * noise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

float godotLightningField(vec2 p, float seed, float time, float xSize, float ySize, float width) {
  vec2 modifiedUv = p;
  modifiedUv.y *= ySize;
  modifiedUv.x *= xSize;
  modifiedUv.x -= 0.5;
  modifiedUv += fbm(modifiedUv + vec2(time * 3.0 + seed * 17.0));
  float dist = abs(modifiedUv.x);
  return width / max(dist, 0.012);
}
`;

const STORM_VERTEX = /* glsl */ `
attribute vec3 aLightningCenter;
attribute vec3 aLightningNormal;
attribute vec4 aLightningParams;
varying vec2 vUv;
varying float vSeed;
varying float vActive;

void main() {
  vec3 n = normalize(aLightningNormal);
  vec3 ref = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(ref, n));
  vec3 bitangent = normalize(cross(n, tangent));
  vec3 widthAxis = position.z < 0.5 ? tangent : bitangent;
  float lean = sin(aLightningParams.z * 17.0) * 0.22;
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.24) + widthAxis * lean);
  vec3 worldPosition = aLightningCenter
    + widthAxis * position.x * aLightningParams.y
    + up * position.y * aLightningParams.x;

  vUv = uv;
  vSeed = aLightningParams.z;
  vActive = aLightningParams.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const STORM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uRate;
uniform float uEmissionPower;
uniform vec3 uEffectColor;
uniform vec3 uMainColor;
varying vec2 vUv;
varying float vSeed;
varying float vActive;

${NOISE_GLSL}
${FLASH_GLSL}

void main() {
  float flash = lightningFlash(uTime, uRate, uIntensity, vSeed, vActive);
  if (flash < 0.002) discard;

  vec2 p = 2.0 * vUv - 1.0;
  float field = godotLightningField(p, vSeed, uTime, 1.15, 4.0, 0.055);
  float body = smoothstep(0.72, 2.8, field);
  float glow = smoothstep(0.12, 1.25, field);
  float groundBloom = (1.0 - smoothstep(0.0, 0.17, vUv.y)) * (1.0 - smoothstep(0.0, 0.9, abs(vUv.x * 2.0 - 1.0))) * 0.55;
  float alpha = min((body + glow * 0.42 + groundBloom) * flash * clamp(uIntensity, 0.0, 1.6), 1.0);
  if (alpha < 0.003) discard;

  vec3 color = uEffectColor * uMainColor * (body * 2.5 + glow * 0.95 + groundBloom) * uEmissionPower;
  gl_FragColor = vec4(color, alpha);
}
`;

const IMPACT_VERTEX = /* glsl */ `
uniform float uTime;
attribute vec3 aLightningCenter;
attribute vec3 aLightningNormal;
attribute vec4 aLightningParams;
varying vec2 vLocal;
varying float vSeed;
varying float vActive;
varying float vRoot;

void main() {
  vec3 n = normalize(aLightningNormal);
  vec3 ref = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(ref, n));
  vec3 bitangent = normalize(cross(n, tangent));
  float root = position.z;
  float angle = root * 1.0471975512 + aLightningParams.z * 6.28318530718;
  vec3 radial = normalize(tangent * cos(angle) + bitangent * sin(angle));
  vec3 rootUp = normalize(n * 0.52 + radial * 0.9);
  vec3 side = normalize(cross(rootUp, n));
  float length = aLightningParams.y * 3.4 + 1.6;
  float width = aLightningParams.y * 0.34 + 0.055;
  float taper = 1.0 - position.y * 0.74;
  float bend = sin(position.y * 5.6 + aLightningParams.z * 31.0 + root * 3.1 + uTime * 4.0) * 0.16 * position.y;
  vec3 worldPosition = aLightningCenter
    + radial * position.y * length * 0.78
    + n * position.y * length * 0.54
    + side * position.x * width * taper
    + side * bend
    + n * ${IMPACT_SURFACE_OFFSET.toFixed(3)};

  vLocal = vec2(position.x, position.y);
  vSeed = aLightningParams.z;
  vActive = aLightningParams.w;
  vRoot = root;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const IMPACT_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uRate;
uniform float uEmissionPower;
uniform vec3 uEffectColor;
uniform vec3 uMainColor;
varying vec2 vLocal;
varying float vSeed;
varying float vActive;
varying float vRoot;

${NOISE_GLSL}
${FLASH_GLSL}

void main() {
  float flash = lightningFlash(uTime, uRate, uIntensity, vSeed, vActive);
  if (flash < 0.002) discard;

  vec2 p = vec2(vLocal.x, vLocal.y * 2.0 - 1.0);
  float field = godotLightningField(p, vSeed + vRoot * 0.17, uTime, 1.75, 2.85, 0.05);
  float body = smoothstep(0.62, 2.55, field);
  float glow = smoothstep(0.1, 1.18, field);
  float fadeTip = 1.0 - smoothstep(0.58, 1.0, vLocal.y);
  float baseBloom = (1.0 - smoothstep(0.0, 0.23, vLocal.y)) * (1.0 - smoothstep(0.0, 0.92, abs(vLocal.x))) * 0.65;
  float alpha = min((body + glow * 0.5) * fadeTip + baseBloom, 1.0) * flash * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.003) discard;

  vec3 color = uEffectColor * uMainColor * (body * 2.45 + glow * 1.08 + baseBloom * 1.35) * uEmissionPower;
  gl_FragColor = vec4(color, min(alpha, 1.0));
}
`;

export function createStormGroundShaderMaterial(): RainWeatherShaderHandle {
  return createCommonShaderMaterial("weather-storm-ground-shader", STORM_VERTEX, STORM_FRAGMENT, 3.2);
}

export function createStormGroundImpactShaderMaterial(): RainWeatherShaderHandle {
  return createCommonShaderMaterial("weather-storm-impact-roots-shader", IMPACT_VERTEX, IMPACT_FRAGMENT, 3.0);
}

function createCommonShaderMaterial(name: string, vertexShader: string, fragmentShader: string, emissionPower: number): RainWeatherShaderHandle {
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uRate: { value: 0.78 },
    uEmissionPower: { value: emissionPower },
    uEffectColor: { value: new THREE.Color(0.55, 0.62, 1.0) },
    uMainColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.name = name;
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: () => undefined,
    setWind: () => undefined,
    dispose: () => { material.dispose(); },
  };
}

function hash12Node(p: TslNode): TslNode {
  return fract(sin(dot(p, vec2(13.9898, 8.141))).mul(43758.5453));
}

function flashNode(uTime: TslNode, uRate: TslNode, uIntensity: TslNode, params: TslNode): TslNode {
  const stormStrength: TslNode = clamp(uIntensity.div(1.6), 0.0, 1.0);
  const eventTime: TslNode = uTime.mul(uRate).mul(mix(1.05, 1.65, stormStrength)).add(params.z.mul(7.0));
  const localTime: TslNode = fract(eventTime);
  const cycle: TslNode = floor(eventTime);
  const gate: TslNode = smoothstep(mix(0.66, 0.28, stormStrength), 0.98, hash12Node(vec2(cycle, params.z)));
  return max(
    float(1).sub(smoothstep(0.0, 0.18, localTime)),
    float(1).sub(smoothstep(0.0, 0.08, abs(localTime.sub(0.24)))).mul(0.48),
  ).mul(gate).mul(params.w);
}

export function createStormGroundNodeMaterial(): RainWeatherShaderHandle {
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uRate = uniform(0.78) as TslNode;
  const uEmissionPower = uniform(3.2) as TslNode;
  const uEffectColor = uniform(new THREE.Color(0.55, 0.62, 1.0)) as TslNode;
  const uMainColor = uniform(new THREE.Color(1.0, 1.0, 1.0)) as TslNode;

  const aCenter: TslNode = attribute("aLightningCenter", "vec3");
  const aNormal: TslNode = attribute("aLightningNormal", "vec3");
  const aParams: TslNode = attribute("aLightningParams", "vec4");
  const pos: TslNode = positionGeometry;
  const n: TslNode = normalize(aNormal);
  const ref: TslNode = abs(n.y).lessThan(0.95).select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0));
  const tangent: TslNode = normalize(cross(ref, n));
  const bitangent: TslNode = normalize(cross(n, tangent));
  const widthAxis: TslNode = pos.z.lessThan(0.5).select(tangent, bitangent);
  const up: TslNode = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.24).add(widthAxis.mul(sin(aParams.z.mul(17.0)).mul(0.22))));
  const worldPosition: TslNode = aCenter.add(widthAxis.mul(pos.x).mul(aParams.y)).add(up.mul(pos.y).mul(aParams.x));

  const fragment = Fn(() => {
    const p: TslNode = uv();
    const flash: TslNode = flashNode(uTime, uRate, uIntensity, aParams);
    flash.lessThan(0.002).discard();

    const x: TslNode = p.x.mul(2.0).sub(1.0);
    const y: TslNode = p.y;
    const centerLine: TslNode = sin(y.mul(13.0).add(aParams.z.mul(41.0)).add(uTime.mul(3.0))).mul(0.2)
      .add(sin(y.mul(31.0).add(aParams.z.mul(17.0)).add(uTime.mul(1.7))).mul(0.11))
      .mul(mix(0.35, 1.0, y));
    const dist: TslNode = abs(x.sub(centerLine));
    const body: TslNode = float(1).sub(smoothstep(0.0, 0.12, dist));
    const glow: TslNode = float(1).sub(smoothstep(0.08, 0.64, dist));
    const ground: TslNode = float(1).sub(smoothstep(0.0, 0.17, y))
      .mul(float(1).sub(smoothstep(0.0, 0.9, abs(x))))
      .mul(0.55);
    const alpha: TslNode = min(body.add(glow.mul(0.42)).add(ground).mul(flash).mul(clamp(uIntensity, 0.0, 1.6)), 1.0);
    alpha.lessThan(0.003).discard();

    const brightness: TslNode = body.mul(2.5).add(glow.mul(0.95)).add(ground);
    return vec4(uEffectColor.mul(uMainColor).mul(brightness).mul(uEmissionPower), alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-storm-ground-node";
  material.positionNode = worldPosition;
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;

  return {
    material,
    setTime: (time) => { uTime.value = time; },
    setIntensity: (intensity) => { uIntensity.value = intensity; },
    setCenter: () => undefined,
    setWind: () => undefined,
    dispose: () => { material.dispose(); },
  };
}

export function createStormGroundImpactNodeMaterial(): RainWeatherShaderHandle {
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uRate = uniform(0.78) as TslNode;
  const uEmissionPower = uniform(3.0) as TslNode;
  const uEffectColor = uniform(new THREE.Color(0.55, 0.62, 1.0)) as TslNode;
  const uMainColor = uniform(new THREE.Color(1.0, 1.0, 1.0)) as TslNode;

  const aCenter: TslNode = attribute("aLightningCenter", "vec3");
  const aNormal: TslNode = attribute("aLightningNormal", "vec3");
  const aParams: TslNode = attribute("aLightningParams", "vec4");
  const pos: TslNode = positionGeometry;
  const n: TslNode = normalize(aNormal);
  const ref: TslNode = abs(n.y).lessThan(0.95).select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0));
  const tangent: TslNode = normalize(cross(ref, n));
  const bitangent: TslNode = normalize(cross(n, tangent));
  const angle: TslNode = pos.z.mul(1.0471975512).add(aParams.z.mul(6.28318530718));
  const radial: TslNode = normalize(tangent.mul(cos(angle)).add(bitangent.mul(sin(angle))));
  const rootUp: TslNode = normalize(n.mul(0.52).add(radial.mul(0.9)));
  const side: TslNode = normalize(cross(rootUp, n));
  const length: TslNode = aParams.y.mul(3.4).add(1.6);
  const width: TslNode = aParams.y.mul(0.34).add(0.055);
  const taper: TslNode = float(1).sub(pos.y.mul(0.74));
  const bend: TslNode = sin(pos.y.mul(5.6).add(aParams.z.mul(31.0)).add(pos.z.mul(3.1)).add(uTime.mul(4.0))).mul(0.16).mul(pos.y);
  const local: TslNode = vec2(pos.x, pos.y);
  const worldPosition: TslNode = aCenter
    .add(radial.mul(pos.y).mul(length).mul(0.78))
    .add(n.mul(pos.y).mul(length).mul(0.54))
    .add(side.mul(pos.x).mul(width).mul(taper))
    .add(side.mul(bend))
    .add(n.mul(IMPACT_SURFACE_OFFSET));

  const fragment = Fn(() => {
    const flash: TslNode = flashNode(uTime, uRate, uIntensity, aParams);
    flash.lessThan(0.002).discard();

    const x: TslNode = local.x;
    const y: TslNode = local.y;
    const centerLine: TslNode = sin(y.mul(10.0).add(aParams.z.mul(41.0)).add(pos.z.mul(3.1)).add(uTime.mul(3.5))).mul(0.15).mul(y);
    const dist: TslNode = abs(x.sub(centerLine));
    const body: TslNode = float(1).sub(smoothstep(0.0, 0.16, dist));
    const glow: TslNode = float(1).sub(smoothstep(0.08, 0.7, dist));
    const fadeTip: TslNode = float(1).sub(smoothstep(0.58, 1.0, y));
    const baseBloom: TslNode = float(1).sub(smoothstep(0.0, 0.23, y))
      .mul(float(1).sub(smoothstep(0.0, 0.92, abs(x))))
      .mul(0.65);
    const alpha: TslNode = min(body.add(glow.mul(0.5)).mul(fadeTip).add(baseBloom), 1.0)
      .mul(flash)
      .mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.003).discard();

    const brightness: TslNode = body.mul(2.45).add(glow.mul(1.08)).add(baseBloom.mul(1.35));
    return vec4(uEffectColor.mul(uMainColor).mul(brightness).mul(uEmissionPower), min(alpha, 1.0));
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-storm-impact-roots-node";
  material.positionNode = worldPosition;
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;

  return {
    material,
    setTime: (time) => { uTime.value = time; },
    setIntensity: (intensity) => { uIntensity.value = intensity; },
    setCenter: () => undefined,
    setWind: () => undefined,
    dispose: () => { material.dispose(); },
  };
}
