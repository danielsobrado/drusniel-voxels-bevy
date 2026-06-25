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

interface LightningBuffers {
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

const LIGHTNING_STRIKE_COUNT = 18;
const LIGHTNING_AREA = 58;
const LIGHTNING_REPOSITION_DISTANCE = 14;
const LIGHTNING_GROUND_OFFSET = 0.09;
const WATER_DEPTH_EPSILON = 0.035;
const WATER_MASK_EPSILON = 0.05;
const DEFAULT_STORM_SEED = 0x57a4d0c7;

export class StormLightningSystem {
  private readonly group = new THREE.Group();
  private readonly material: RainWeatherShaderHandle;
  private readonly mesh: THREE.Mesh;
  private readonly buffers: LightningBuffers;
  private readonly samplers: RainWeatherSamplers;
  private readonly worldCells: number;
  private readonly seed: number;
  private readonly placementCenter = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private settings = { enabled: false, intensity: 1 };

  constructor(options: StormLightningOptions) {
    this.samplers = options.samplers;
    this.worldCells = options.worldCells;
    this.seed = options.seed ?? DEFAULT_STORM_SEED;
    this.group.name = "weather-storm";
    this.group.visible = this.settings.enabled;

    this.material = options.isWebGpu ? createStormNodeMaterial() : createStormShaderMaterial();
    const lightning = createStormLightningGeometry(LIGHTNING_STRIKE_COUNT);
    this.buffers = lightning.buffers;
    this.mesh = new THREE.Mesh(lightning.geometry, this.material.material);
    this.mesh.name = "weather-storm-ground-lightning";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 96;

    this.group.add(this.mesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: StormWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    this.material.setIntensity(this.settings.intensity);
  }

  update(deltaSeconds: number, elapsedSeconds: number, focus: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.material.setTime(elapsedSeconds);
    if (
      !Number.isFinite(this.placementCenter.x) ||
      this.placementCenter.distanceToSquared(focus) > LIGHTNING_REPOSITION_DISTANCE * LIGHTNING_REPOSITION_DISTANCE
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
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private repositionStrikes(focus: THREE.Vector3): void {
    const cellX = Math.floor(focus.x / LIGHTNING_REPOSITION_DISTANCE);
    const cellZ = Math.floor(focus.z / LIGHTNING_REPOSITION_DISTANCE);
    const seed = hashCombine(hashCombine(this.seed, cellX >>> 0), cellZ >>> 0);
    const rng = new Rng(hashCombine(seed, hashString("storm-ground-strikes")));
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
      this.buffers.params[p] = rng.range(10.0, 27.0);
      this.buffers.params[p + 1] = rng.range(0.045, 0.14);
      this.buffers.params[p + 2] = rng.float();
      this.buffers.params[p + 3] = 1;
    }

    this.markAttributesDirty();
  }

  private findStrikePoint(rng: Rng, focus: THREE.Vector3): { x: number; y: number; z: number; normal: THREE.Vector3 } | null {
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = THREE.MathUtils.clamp(focus.x + rng.range(-LIGHTNING_AREA * 0.5, LIGHTNING_AREA * 0.5), 0, this.worldCells);
      const z = THREE.MathUtils.clamp(focus.z + rng.range(-LIGHTNING_AREA * 0.5, LIGHTNING_AREA * 0.5), 0, this.worldCells);
      const water = this.samplers.waterSample(x, z);
      const isWater = water.depth > WATER_DEPTH_EPSILON && water.bodyMask > WATER_MASK_EPSILON;
      if (isWater) continue;

      const [nx, ny, nz] = this.samplers.surfaceNormal(x, z);
      const normal = new THREE.Vector3(nx, ny, nz);
      if (normal.lengthSq() < 0.000001) normal.set(0, 1, 0);
      else normal.normalize();
      return { x, y: this.samplers.surfaceHeight(x, z) + LIGHTNING_GROUND_OFFSET, z, normal };
    }
    return null;
  }

  private markAttributesDirty(): void {
    for (const key of ["aLightningCenter", "aLightningNormal", "aLightningParams"]) {
      const attr = this.mesh.geometry.getAttribute(key);
      if (attr) attr.needsUpdate = true;
    }
  }
}

function createStormLightningGeometry(count: number): { geometry: THREE.InstancedBufferGeometry; buffers: LightningBuffers } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0,
    1, 0, 0,
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
  geometry.instanceCount = count;

  const buffers: LightningBuffers = {
    center: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    params: new Float32Array(count * 4),
  };
  for (let i = 0; i < count; i++) buffers.normal[i * 3 + 1] = 1;
  geometry.setAttribute("aLightningCenter", new THREE.InstancedBufferAttribute(buffers.center, 3));
  geometry.setAttribute("aLightningNormal", new THREE.InstancedBufferAttribute(buffers.normal, 3));
  geometry.setAttribute("aLightningParams", new THREE.InstancedBufferAttribute(buffers.params, 4));
  return { geometry, buffers };
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
  float lean = sin(aLightningParams.z * 17.0) * 0.18;
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.42) + tangent * lean);
  vec3 worldPosition = aLightningCenter
    + tangent * position.x * aLightningParams.y
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

void main() {
  float stormStrength = clamp(uIntensity / 1.6, 0.0, 1.0);
  float eventTime = uTime * uRate * mix(0.72, 1.35, stormStrength) + vSeed;
  float localTime = fract(eventTime);
  float cycle = floor(eventTime);
  float gate = smoothstep(mix(0.94, 0.78, stormStrength), 0.995, hash12(vec2(cycle, vSeed)));
  float flash = max(1.0 - smoothstep(0.0, 0.055, localTime), (1.0 - smoothstep(0.0, 0.035, abs(localTime - 0.11))) * 0.45) * gate * vActive;
  if (flash < 0.002) discard;

  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;
  float centerLine = (sin(y * 13.0 + vSeed * 41.0) * 0.16 + sin(y * 31.0 + vSeed * 17.0) * 0.07) * mix(0.35, 1.0, y);
  float dist = abs(x - centerLine);
  float core = 1.0 - smoothstep(0.0, 0.035, dist);
  float glow = 1.0 - smoothstep(0.03, 0.34, dist);
  float branchSeed = sin(y * 23.0 + vSeed * 97.0) * 0.5 + 0.5;
  float branchMask = smoothstep(0.82, 0.98, branchSeed) * smoothstep(0.2, 0.82, y);
  float branch = (1.0 - smoothstep(0.015, 0.085, abs(x - centerLine - (branchSeed - 0.5) * 0.58))) * branchMask * 0.42;
  float ground = (1.0 - smoothstep(0.0, 0.12, y)) * (1.0 - smoothstep(0.0, 0.62, abs(x))) * 0.38;

  float alpha = min((core + glow * 0.25 + branch + ground) * flash * clamp(uIntensity, 0.0, 1.6), 1.0);
  if (alpha < 0.003) discard;

  vec3 color = uEffectColor * uMainColor * (core * 1.9 + glow * 0.7 + branch * 1.4 + ground * 0.8) * uEmissionPower;
  gl_FragColor = vec4(color, alpha);
}
`;

function createStormShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uRate: { value: 0.22 },
    uEmissionPower: { value: 2.4 },
    uEffectColor: { value: new THREE.Color(0.55, 0.62, 1.0) },
    uMainColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STORM_VERTEX,
    fragmentShader: STORM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.name = "weather-storm-ground-shader";
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

function createStormNodeMaterial(): RainWeatherShaderHandle {
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uRate = uniform(0.22) as TslNode;
  const uEmissionPower = uniform(2.4) as TslNode;
  const uEffectColor = uniform(new THREE.Color(0.55, 0.62, 1.0)) as TslNode;
  const uMainColor = uniform(new THREE.Color(1.0, 1.0, 1.0)) as TslNode;

  const aCenter: TslNode = attribute("aLightningCenter", "vec3");
  const aNormal: TslNode = attribute("aLightningNormal", "vec3");
  const aParams: TslNode = attribute("aLightningParams", "vec4");
  const pos: TslNode = positionGeometry;
  const n: TslNode = normalize(aNormal);
  const ref: TslNode = abs(n.y).lessThan(0.95).select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0));
  const tangent: TslNode = normalize(cross(ref, n));
  const up: TslNode = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.42).add(tangent.mul(sin(aParams.z.mul(17.0)).mul(0.18))));
  const worldPosition: TslNode = aCenter.add(tangent.mul(pos.x).mul(aParams.y)).add(up.mul(pos.y).mul(aParams.x));

  const fragment = Fn(() => {
    const p: TslNode = uv();
    const stormStrength: TslNode = clamp(uIntensity.div(1.6), 0.0, 1.0);
    const eventTime: TslNode = uTime.mul(uRate).mul(mix(0.72, 1.35, stormStrength)).add(aParams.z);
    const localTime: TslNode = fract(eventTime);
    const cycle: TslNode = floor(eventTime);
    const gate: TslNode = smoothstep(mix(0.94, 0.78, stormStrength), 0.995, hash12Node(vec2(cycle, aParams.z)));
    const flash: TslNode = max(
      float(1).sub(smoothstep(0.0, 0.055, localTime)),
      float(1).sub(smoothstep(0.0, 0.035, abs(localTime.sub(0.11)))).mul(0.45),
    ).mul(gate).mul(aParams.w);
    flash.lessThan(0.002).discard();

    const x: TslNode = p.x.mul(2.0).sub(1.0);
    const y: TslNode = p.y;
    const centerLine: TslNode = sin(y.mul(13.0).add(aParams.z.mul(41.0))).mul(0.16)
      .add(sin(y.mul(31.0).add(aParams.z.mul(17.0))).mul(0.07))
      .mul(mix(0.35, 1.0, y));
    const dist: TslNode = abs(x.sub(centerLine));
    const core: TslNode = float(1).sub(smoothstep(0.0, 0.035, dist));
    const glow: TslNode = float(1).sub(smoothstep(0.03, 0.34, dist));
    const branchSeed: TslNode = sin(y.mul(23.0).add(aParams.z.mul(97.0))).mul(0.5).add(0.5);
    const branchMask: TslNode = smoothstep(0.82, 0.98, branchSeed).mul(smoothstep(0.2, 0.82, y));
    const branch: TslNode = float(1).sub(smoothstep(0.015, 0.085, abs(x.sub(centerLine).sub(branchSeed.sub(0.5).mul(0.58)))))
      .mul(branchMask)
      .mul(0.42);
    const ground: TslNode = float(1).sub(smoothstep(0.0, 0.12, y))
      .mul(float(1).sub(smoothstep(0.0, 0.62, abs(x))))
      .mul(0.38);
    const alpha: TslNode = min(core.add(glow.mul(0.25)).add(branch).add(ground).mul(flash).mul(clamp(uIntensity, 0.0, 1.6)), 1.0);
    alpha.lessThan(0.003).discard();

    const brightness: TslNode = core.mul(1.9).add(glow.mul(0.7)).add(branch.mul(1.4)).add(ground.mul(0.8));
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
