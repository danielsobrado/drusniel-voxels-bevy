import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
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
import { Rng, hashCombine, hashString } from "../core/seed.js";
import type { RainWeatherSamplers, StormWeatherSettings, StormWeatherStats } from "./rain.js";
import type { RainWeatherShaderHandle } from "./rainShaderMaterial.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface StrikeBuffers {
  center: Float32Array;
  normal: Float32Array;
  params: Float32Array;
}

export interface StormLightningOptions {
  scene: THREE.Scene;
  isWebGpu: boolean;
  samplers: RainWeatherSamplers;
  worldCells: number;
  seed?: number;
}

const STRIKE_COUNT = 32;
const STRIKE_AREA = 48;
const REPOSITION_DISTANCE = 8;
const SURFACE_OFFSET = 0.09;
const IMPACT_SURFACE_OFFSET = 0.045;
const WATER_DEPTH_EPSILON = 0.035;
const WATER_MASK_EPSILON = 0.05;
const DEFAULT_SEED = 0x57a4d0c7;

export class StormLightningSystem {
  private readonly group = new THREE.Group();
  private readonly strikeMaterial: RainWeatherShaderHandle;
  private readonly impactMaterial: RainWeatherShaderHandle;
  private readonly strikeMesh: THREE.Mesh;
  private readonly impactMesh: THREE.Mesh;
  private readonly buffers: StrikeBuffers;
  private readonly samplers: RainWeatherSamplers;
  private readonly worldCells: number;
  private readonly seed: number;
  private readonly placementCenter = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private settings = { enabled: false, intensity: 1 };

  constructor(options: StormLightningOptions) {
    this.samplers = options.samplers;
    this.worldCells = options.worldCells;
    this.seed = options.seed ?? DEFAULT_SEED;
    this.group.name = "weather-storm";
    this.group.visible = this.settings.enabled;

    this.strikeMaterial = options.isWebGpu ? createStormNodeMaterial() : createStormShaderMaterial();
    this.impactMaterial = options.isWebGpu ? createImpactNodeMaterial() : createImpactShaderMaterial();
    const strikes = createStrikeGeometry(STRIKE_COUNT);
    this.buffers = strikes.buffers;
    this.strikeMesh = new THREE.Mesh(strikes.geometry, this.strikeMaterial.material);
    this.strikeMesh.name = "weather-storm-ground-lightning";
    this.strikeMesh.frustumCulled = false;
    this.strikeMesh.renderOrder = 96;

    this.impactMesh = new THREE.Mesh(createImpactGeometry(this.buffers), this.impactMaterial.material);
    this.impactMesh.name = "weather-storm-surface-impact";
    this.impactMesh.frustumCulled = false;
    this.impactMesh.renderOrder = 95;

    this.group.add(this.impactMesh, this.strikeMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: StormWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    for (const material of [this.strikeMaterial, this.impactMaterial]) {
      material.setIntensity(this.settings.intensity);
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number, focus: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.strikeMaterial.setTime(elapsedSeconds);
    this.impactMaterial.setTime(elapsedSeconds);
    if (
      !Number.isFinite(this.placementCenter.x) ||
      this.placementCenter.distanceToSquared(focus) > REPOSITION_DISTANCE * REPOSITION_DISTANCE
    ) {
      this.placementCenter.copy(focus);
      this.repositionStrikes(focus);
    }
  }

  getStats(): StormWeatherStats {
    return { active: this.group.visible };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.strikeMesh.geometry.dispose();
    this.impactMesh.geometry.dispose();
    this.strikeMaterial.dispose();
    this.impactMaterial.dispose();
  }

  private repositionStrikes(focus: THREE.Vector3): void {
    const cellX = Math.floor(focus.x / REPOSITION_DISTANCE);
    const cellZ = Math.floor(focus.z / REPOSITION_DISTANCE);
    const seed = hashCombine(hashCombine(this.seed, cellX >>> 0), cellZ >>> 0);
    const rng = new Rng(hashCombine(seed, hashString("storm-visible-strikes")));
    const count = this.buffers.params.length / 4;

    for (let i = 0; i < count; i++) {
      const point = this.findStrikePoint(rng, focus);
      const c = i * 3;
      const p = i * 4;
      if (!point) {
        this.buffers.center[c] = focus.x;
        this.buffers.center[c + 1] = focus.y;
        this.buffers.center[c + 2] = focus.z;
        this.buffers.normal[c] = 0;
        this.buffers.normal[c + 1] = 1;
        this.buffers.normal[c + 2] = 0;
        this.buffers.params[p] = 0;
        this.buffers.params[p + 1] = 0;
        this.buffers.params[p + 2] = rng.float();
        this.buffers.params[p + 3] = 0;
        continue;
      }

      this.buffers.center[c] = point.x;
      this.buffers.center[c + 1] = point.y;
      this.buffers.center[c + 2] = point.z;
      this.buffers.normal[c] = point.normal.x;
      this.buffers.normal[c + 1] = point.normal.y;
      this.buffers.normal[c + 2] = point.normal.z;
      this.buffers.params[p] = rng.range(12.0, 30.0);
      this.buffers.params[p + 1] = rng.range(0.34, 0.82);
      this.buffers.params[p + 2] = rng.float();
      this.buffers.params[p + 3] = 1;
    }

    this.markAttributesDirty();
  }

  private findStrikePoint(rng: Rng, focus: THREE.Vector3): { x: number; y: number; z: number; normal: THREE.Vector3 } | null {
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = THREE.MathUtils.clamp(focus.x + rng.range(-STRIKE_AREA * 0.5, STRIKE_AREA * 0.5), 0, this.worldCells);
      const z = THREE.MathUtils.clamp(focus.z + rng.range(-STRIKE_AREA * 0.5, STRIKE_AREA * 0.5), 0, this.worldCells);
      const water = this.samplers.waterSample(x, z);
      const isWater = water.depth > WATER_DEPTH_EPSILON && water.bodyMask > WATER_MASK_EPSILON;
      if (isWater) {
        return { x, y: water.waterY + SURFACE_OFFSET, z, normal: new THREE.Vector3(0, 1, 0) };
      }

      const [nx, ny, nz] = this.samplers.surfaceNormal(x, z);
      const normal = new THREE.Vector3(nx, ny, nz);
      if (normal.lengthSq() < 0.000001) normal.set(0, 1, 0);
      else normal.normalize();
      return { x, y: this.samplers.surfaceHeight(x, z) + SURFACE_OFFSET, z, normal };
    }
    return null;
  }

  private markAttributesDirty(): void {
    for (const geometry of [this.strikeMesh.geometry, this.impactMesh.geometry]) {
      for (const key of ["aLightningCenter", "aLightningNormal", "aLightningParams"]) {
        const attr = geometry.getAttribute(key);
        if (attr) attr.needsUpdate = true;
      }
    }
  }
}

function createStrikeGeometry(count: number): { geometry: THREE.InstancedBufferGeometry; buffers: StrikeBuffers } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0,
    1, 0, 0,
    -1, 1, 0,
    1, 1, 0,
    -1, 0, 1,
    1, 0, 1,
    -1, 1, 1,
    1, 1, 1,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0, 1, 2,
    2, 1, 3,
    4, 5, 6,
    6, 5, 7,
  ]), 1));
  geometry.instanceCount = count;

  const buffers: StrikeBuffers = {
    center: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    params: new Float32Array(count * 4),
  };
  for (let i = 0; i < count; i++) buffers.normal[i * 3 + 1] = 1;
  setStrikeAttributes(geometry, buffers);
  return { geometry, buffers };
}

function createImpactGeometry(buffers: StrikeBuffers): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    1, 1, 0,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  geometry.instanceCount = buffers.params.length / 4;
  setStrikeAttributes(geometry, buffers);
  return geometry;
}

function setStrikeAttributes(geometry: THREE.InstancedBufferGeometry, buffers: StrikeBuffers): void {
  geometry.setAttribute("aLightningCenter", new THREE.InstancedBufferAttribute(buffers.center, 3));
  geometry.setAttribute("aLightningNormal", new THREE.InstancedBufferAttribute(buffers.normal, 3));
  geometry.setAttribute("aLightningParams", new THREE.InstancedBufferAttribute(buffers.params, 4));
}

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

void main() {
  float stormStrength = clamp(uIntensity / 1.6, 0.0, 1.0);
  float eventTime = uTime * uRate * mix(1.05, 1.65, stormStrength) + vSeed * 7.0;
  float localTime = fract(eventTime);
  float cycle = floor(eventTime);
  float gate = smoothstep(mix(0.66, 0.28, stormStrength), 0.98, hash12(vec2(cycle, vSeed)));
  float flashA = 1.0 - smoothstep(0.0, 0.18, localTime);
  float flashB = (1.0 - smoothstep(0.0, 0.08, abs(localTime - 0.24))) * 0.48;
  float flash = max(flashA, flashB) * gate * vActive;
  if (flash < 0.002) discard;

  vec2 modifiedUv = 2.0 * vUv - 1.0;
  modifiedUv.y *= 4.0;
  modifiedUv.x *= 1.15;
  modifiedUv.x -= 0.5;
  modifiedUv += fbm(modifiedUv + vec2(uTime * 3.0 + vSeed * 17.0));

  float dist = abs(modifiedUv.x);
  float godotCore = 0.055 / max(dist, 0.012);
  float body = smoothstep(0.72, 2.8, godotCore);
  float glow = smoothstep(0.12, 1.25, godotCore);
  float groundBloom = (1.0 - smoothstep(0.0, 0.17, vUv.y)) * (1.0 - smoothstep(0.0, 0.9, abs(vUv.x * 2.0 - 1.0))) * 0.55;
  float alpha = min((body + glow * 0.42 + groundBloom) * flash * clamp(uIntensity, 0.0, 1.6), 1.0);
  if (alpha < 0.003) discard;

  vec3 color = uEffectColor * uMainColor * (body * 2.5 + glow * 0.95 + groundBloom) * uEmissionPower;
  gl_FragColor = vec4(color, alpha);
}
`;

const IMPACT_VERTEX = /* glsl */ `
attribute vec3 aLightningCenter;
attribute vec3 aLightningNormal;
attribute vec4 aLightningParams;
varying vec2 vLocal;
varying float vSeed;
varying float vActive;

void main() {
  vec3 n = normalize(aLightningNormal);
  vec3 ref = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(ref, n));
  vec3 bitangent = normalize(cross(n, tangent));
  float radius = aLightningParams.y * 5.2 + 0.45;
  vec3 worldPosition = aLightningCenter
    + (tangent * position.x + bitangent * position.y) * radius
    + n * ${IMPACT_SURFACE_OFFSET.toFixed(3)};

  vLocal = position.xy;
  vSeed = aLightningParams.z;
  vActive = aLightningParams.w;
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

float hash12(vec2 p) {
  return fract(cos(mod(dot(p, vec2(13.9898, 8.141)), 3.14)) * 43758.5453);
}

void main() {
  float r = length(vLocal);
  if (r > 1.05) discard;

  float stormStrength = clamp(uIntensity / 1.6, 0.0, 1.0);
  float eventTime = uTime * uRate * mix(1.05, 1.65, stormStrength) + vSeed * 7.0;
  float localTime = fract(eventTime);
  float cycle = floor(eventTime);
  float gate = smoothstep(mix(0.66, 0.28, stormStrength), 0.98, hash12(vec2(cycle, vSeed)));
  float flashA = 1.0 - smoothstep(0.0, 0.18, localTime);
  float flashB = (1.0 - smoothstep(0.0, 0.08, abs(localTime - 0.24))) * 0.48;
  float flash = max(flashA, flashB) * gate * vActive;
  if (flash < 0.002) discard;

  float ringRadius = mix(0.22, 0.72, smoothstep(0.0, 0.24, localTime));
  float center = 1.0 - smoothstep(0.0, 0.2, r);
  float ring = 1.0 - smoothstep(0.025, 0.085, abs(r - ringRadius));
  float bloom = 1.0 - smoothstep(0.18, 1.0, r);
  float axis = min(abs(vLocal.x), abs(vLocal.y));
  float diag = min(abs(vLocal.x + vLocal.y), abs(vLocal.x - vLocal.y)) * 0.72;
  float spokes = (1.0 - smoothstep(0.018, 0.11, min(axis, diag))) * smoothstep(0.1, 0.55, r) * (1.0 - smoothstep(0.62, 1.0, r));

  float alpha = min((center * 0.92 + ring * 0.74 + bloom * 0.45 + spokes * 0.32) * flash * clamp(uIntensity, 0.0, 1.6), 1.0);
  if (alpha < 0.003) discard;

  vec3 color = uEffectColor * uMainColor * (center * 2.1 + ring * 1.35 + bloom * 0.92 + spokes * 0.75) * uEmissionPower;
  gl_FragColor = vec4(color, alpha);
}
`;

function createStormShaderMaterial(): RainWeatherShaderHandle {
  return createCommonShaderMaterial("weather-storm-ground-shader", STORM_VERTEX, STORM_FRAGMENT, 3.2);
}

function createImpactShaderMaterial(): RainWeatherShaderHandle {
  return createCommonShaderMaterial("weather-storm-impact-shader", IMPACT_VERTEX, IMPACT_FRAGMENT, 2.7);
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

function createStormNodeMaterial(): RainWeatherShaderHandle {
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

function createImpactNodeMaterial(): RainWeatherShaderHandle {
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uRate = uniform(0.78) as TslNode;
  const uEmissionPower = uniform(2.7) as TslNode;
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
  const radius: TslNode = aParams.y.mul(5.2).add(0.45);
  const local: TslNode = vec2(pos.x, pos.y);
  const worldPosition: TslNode = aCenter
    .add(tangent.mul(pos.x).add(bitangent.mul(pos.y)).mul(radius))
    .add(n.mul(IMPACT_SURFACE_OFFSET));

  const fragment = Fn(() => {
    const flash: TslNode = flashNode(uTime, uRate, uIntensity, aParams);
    flash.lessThan(0.002).discard();

    const r2: TslNode = dot(local, local);
    r2.greaterThan(1.1025).discard();
    const eventTime: TslNode = uTime.mul(uRate).add(aParams.z.mul(7.0));
    const localTime: TslNode = fract(eventTime);
    const ringRadius2: TslNode = mix(0.048, 0.52, smoothstep(0.0, 0.24, localTime));
    const center: TslNode = float(1).sub(smoothstep(0.0, 0.04, r2));
    const ring: TslNode = float(1).sub(smoothstep(0.002, 0.08, abs(r2.sub(ringRadius2))));
    const bloom: TslNode = float(1).sub(smoothstep(0.03, 1.0, r2));
    const axis: TslNode = min(abs(local.x), abs(local.y));
    const diag: TslNode = min(abs(local.x.add(local.y)), abs(local.x.sub(local.y))).mul(0.72);
    const spokes: TslNode = float(1).sub(smoothstep(0.018, 0.11, min(axis, diag)))
      .mul(smoothstep(0.01, 0.3, r2))
      .mul(float(1).sub(smoothstep(0.38, 1.0, r2)));
    const alpha: TslNode = min(center.mul(0.92).add(ring.mul(0.74)).add(bloom.mul(0.45)).add(spokes.mul(0.32))
      .mul(flash).mul(clamp(uIntensity, 0.0, 1.6)), 1.0);
    alpha.lessThan(0.003).discard();

    const brightness: TslNode = center.mul(2.1).add(ring.mul(1.35)).add(bloom.mul(0.92)).add(spokes.mul(0.75));
    return vec4(uEffectColor.mul(uMainColor).mul(brightness).mul(uEmissionPower), alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-storm-impact-node";
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
