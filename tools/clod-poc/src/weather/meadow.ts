import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  mix,
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
import type { RainWeatherShaderHandle } from "./rainShaderMaterial.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface MeadowWeatherSettings {
  enabled: boolean;
  intensity: number;
  windX: number;
  windZ: number;
}

export interface MeadowWeatherStats {
  particles: number;
}

export interface MeadowWeatherOptions {
  scene: THREE.Scene;
  isWebGpu: boolean;
  seed?: number;
}

interface MeadowBandOptions {
  rng: Rng;
  offset: Float32Array;
  shape: Float32Array;
  start: number;
  count: number;
  area: number;
  yMin: number;
  yMax: number;
  speedMin: number;
  speedMax: number;
  sizeMin: number;
  sizeMax: number;
  opacityMin: number;
  opacityMax: number;
}

const MEADOW_PARTICLE_COUNT = 6200;
const MEADOW_NEAR_COUNT = 2600;
const MEADOW_MID_COUNT = 2200;
const MEADOW_FAR_COUNT = 1400;

export const DEFAULT_MEADOW_WEATHER_SETTINGS: MeadowWeatherSettings = {
  enabled: false,
  intensity: 0.85,
  windX: -0.42,
  windZ: 0.18,
};

export class MeadowWeatherSystem {
  private readonly group = new THREE.Group();
  private readonly meadowMaterial: RainWeatherShaderHandle;
  private readonly meadowMesh: THREE.Mesh;
  private readonly center = new THREE.Vector3();
  private settings = { ...DEFAULT_MEADOW_WEATHER_SETTINGS };

  constructor(options: MeadowWeatherOptions) {
    this.group.name = "weather-meadow";
    this.group.visible = this.settings.enabled;

    this.meadowMaterial = options.isWebGpu ? createMeadowNodeMaterial() : createMeadowShaderMaterial();
    this.meadowMesh = new THREE.Mesh(createMeadowGeometry(options.seed ?? 0x6d3a8f21), this.meadowMaterial.material);
    this.meadowMesh.name = "weather-meadow-pollen";
    this.meadowMesh.frustumCulled = false;
    this.meadowMesh.renderOrder = 43;

    this.group.add(this.meadowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }

  applySettings(settings: MeadowWeatherSettings): void {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
      windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
      windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5),
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 0.001;
    this.meadowMaterial.setIntensity(this.settings.intensity);
    this.meadowMaterial.setWind(this.settings.windX, this.settings.windZ);
  }

  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3): void {
    void deltaSeconds;
    if (!this.group.visible) return;

    this.center.copy(cameraPosition);
    this.meadowMaterial.setCenter(this.center);
    this.meadowMaterial.setTime(elapsedSeconds);
  }

  getStats(): MeadowWeatherStats {
    return { particles: this.group.visible ? MEADOW_PARTICLE_COUNT : 0 };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.meadowMesh.geometry.dispose();
    this.meadowMaterial.dispose();
  }
}

function createMeadowGeometry(seed: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    1, 1, 0,
    0, -1, -1,
    0, -1, 1,
    0, 1, -1,
    0, 1, 1,
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
    0, 1, 2, 2, 1, 3,
    4, 5, 6, 6, 5, 7,
  ]), 1));
  geometry.instanceCount = MEADOW_PARTICLE_COUNT;

  const offset = new Float32Array(MEADOW_PARTICLE_COUNT * 4);
  const shape = new Float32Array(MEADOW_PARTICLE_COUNT * 4);
  const rng = new Rng(hashCombine(seed, hashString("meadow-pollen")));
  writeMeadowBand({ rng, offset, shape, start: 0, count: MEADOW_NEAR_COUNT, area: 28, yMin: -1.25, yMax: 4.4, speedMin: 0.07, speedMax: 0.28, sizeMin: 0.018, sizeMax: 0.07, opacityMin: 0.065, opacityMax: 0.22 });
  writeMeadowBand({ rng, offset, shape, start: MEADOW_NEAR_COUNT, count: MEADOW_MID_COUNT, area: 48, yMin: -0.9, yMax: 6.6, speedMin: 0.045, speedMax: 0.2, sizeMin: 0.012, sizeMax: 0.052, opacityMin: 0.038, opacityMax: 0.16 });
  writeMeadowBand({ rng, offset, shape, start: MEADOW_NEAR_COUNT + MEADOW_MID_COUNT, count: MEADOW_FAR_COUNT, area: 72, yMin: -0.45, yMax: 8.6, speedMin: 0.025, speedMax: 0.14, sizeMin: 0.008, sizeMax: 0.034, opacityMin: 0.022, opacityMax: 0.095 });
  geometry.setAttribute("aMeadowOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geometry.setAttribute("aMeadowShape", new THREE.InstancedBufferAttribute(shape, 4));
  return geometry;
}

function writeMeadowBand(options: MeadowBandOptions): void {
  const { rng, offset, shape } = options;
  for (let i = 0; i < options.count; i++) {
    const o = (options.start + i) * 4;
    offset[o] = rng.range(-options.area * 0.5, options.area * 0.5);
    offset[o + 1] = rng.float();
    offset[o + 2] = rng.range(options.yMin, options.yMax);
    offset[o + 3] = options.area;
    shape[o] = rng.range(options.sizeMin, options.sizeMax);
    shape[o + 1] = rng.range(options.opacityMin, options.opacityMax);
    shape[o + 2] = rng.range(options.speedMin, options.speedMax);
    shape[o + 3] = rng.float() * 1000;
  }
}

const MEADOW_NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * valueNoise(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}
`;

const MEADOW_VERTEX = /* glsl */ `
attribute vec4 aMeadowOffset;
attribute vec4 aMeadowShape;
uniform vec3 uCenter;
uniform float uTime;
uniform float uIntensity;
uniform float uWindX;
uniform float uWindZ;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vGlow;

${MEADOW_NOISE_GLSL}

void main() {
  vec3 windBase = vec3(uWindX, 0.0, uWindZ);
  float windLength = max(length(windBase), 0.001);
  vec3 windDir = windBase / windLength;
  vec3 side = vec3(-windDir.z, 0.0, windDir.x);
  float travel = fract(aMeadowOffset.y + uTime * aMeadowShape.z * max(uIntensity, 0.05) / max(aMeadowOffset.w, 0.001));
  float along = (0.5 - travel) * aMeadowOffset.w;
  vec2 noiseUv = vec2(along * 0.045 + aMeadowShape.w * 0.002, uTime * 0.13 + aMeadowOffset.x * 0.03);
  float curlX = fbm(noiseUv) - 0.5;
  float curlZ = fbm(noiseUv.yx + vec2(19.1, -7.3)) - 0.5;
  float lift = fbm(noiseUv * 1.7 + vec2(23.0, 11.0)) - 0.5;
  float hover = sin(uTime * (0.22 + aMeadowShape.w * 0.0003) + aMeadowShape.w) * 0.24;
  vec3 center = uCenter
    + windDir * (along * 0.82 + curlZ * 1.5)
    + side * (aMeadowOffset.x + curlX * 2.2)
    + vec3(0.0, aMeadowOffset.z + lift * 0.85 + hover, 0.0);
  vec3 worldPosition = center
    + side * position.x * aMeadowShape.x
    + vec3(0.0, position.y * aMeadowShape.x, 0.0)
    + windDir * position.z * aMeadowShape.x * 0.8;
  float wave = smoothstep(0.15, 0.95, fbm(noiseUv * 1.3 + 5.0));
  vUv = uv;
  vSeed = aMeadowShape.w;
  vGlow = wave;
  vAlpha = aMeadowShape.y
    * mix(0.55, 1.25, wave)
    * smoothstep(0.02, 0.14, travel)
    * (1.0 - smoothstep(0.86, 1.0, travel));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const MEADOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vGlow;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.05) discard;
  float core = 1.0 - smoothstep(0.08, 0.58, d);
  float halo = 1.0 - smoothstep(0.18, 1.02, d);
  float mote = 0.78 + 0.22 * sin(vSeed * 13.7 + p.x * 19.0 + p.y * 23.0);
  float alpha = (core * 0.72 + halo * 0.34) * mote * vAlpha * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.006) discard;
  vec3 warm = vec3(1.0, 0.9, 0.45);
  vec3 green = vec3(0.66, 0.96, 0.62);
  vec3 color = mix(uColor, mix(warm, green, 0.28), vGlow * 0.45);
  gl_FragColor = vec4(color, alpha);
}
`;

function createMeadowShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uWindX: { value: DEFAULT_MEADOW_WEATHER_SETTINGS.windX },
    uWindZ: { value: DEFAULT_MEADOW_WEATHER_SETTINGS.windZ },
    uColor: { value: new THREE.Color(0xf6e8a3) },
    uOpacity: { value: 0.92 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: MEADOW_VERTEX,
    fragmentShader: MEADOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.name = "weather-meadow-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}

function hash21Node(p: TslNode): TslNode {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123));
}

function valueNoiseNode(p: TslNode): TslNode {
  const i: TslNode = floor(p);
  const f: TslNode = fract(p);
  const u: TslNode = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  const a: TslNode = hash21Node(i);
  const b: TslNode = hash21Node(i.add(vec2(1.0, 0.0)));
  const c: TslNode = hash21Node(i.add(vec2(0.0, 1.0)));
  const d: TslNode = hash21Node(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

function fbmNode(p: TslNode): TslNode {
  const amp0: TslNode = float(0.5);
  const v0: TslNode = amp0.mul(valueNoiseNode(p));
  const p1: TslNode = p.mul(2.02);
  const amp1: TslNode = amp0.mul(0.5);
  const v1: TslNode = v0.add(amp1.mul(valueNoiseNode(p1)));
  const p2: TslNode = p1.mul(2.02);
  const amp2: TslNode = amp1.mul(0.5);
  const v2: TslNode = v1.add(amp2.mul(valueNoiseNode(p2)));
  const p3: TslNode = p2.mul(2.02);
  const amp3: TslNode = amp2.mul(0.5);
  const v3: TslNode = v2.add(amp3.mul(valueNoiseNode(p3)));
  const p4: TslNode = p3.mul(2.02);
  const amp4: TslNode = amp3.mul(0.5);
  return v3.add(amp4.mul(valueNoiseNode(p4)));
}

function createMeadowNodeMaterial(): RainWeatherShaderHandle {
  const uCenter = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(DEFAULT_MEADOW_WEATHER_SETTINGS.windX) as TslNode;
  const uWindZ = uniform(DEFAULT_MEADOW_WEATHER_SETTINGS.windZ) as TslNode;
  const uColor = uniform(new THREE.Color(0xf6e8a3)) as TslNode;
  const uOpacity = uniform(0.92) as TslNode;

  const aOffset: TslNode = attribute("aMeadowOffset", "vec4");
  const aShape: TslNode = attribute("aMeadowShape", "vec4");
  const pos: TslNode = positionGeometry;
  const windBase: TslNode = vec3(uWindX, 0.0, uWindZ);
  const windLength: TslNode = max(length(windBase), 0.001);
  const windDir: TslNode = windBase.div(windLength);
  const side: TslNode = vec3(windDir.z.mul(-1.0), 0.0, windDir.x);
  const travel: TslNode = fract(aOffset.y.add(uTime.mul(aShape.z).mul(max(uIntensity, 0.05)).div(max(aOffset.w, 0.001))));
  const along: TslNode = float(0.5).sub(travel).mul(aOffset.w);
  const noiseUv: TslNode = vec2(along.mul(0.045).add(aShape.w.mul(0.002)), uTime.mul(0.13).add(aOffset.x.mul(0.03)));
  const curlX: TslNode = fbmNode(noiseUv).sub(0.5);
  const curlZ: TslNode = fbmNode(vec2(noiseUv.y.add(19.1), noiseUv.x.sub(7.3))).sub(0.5);
  const lift: TslNode = fbmNode(noiseUv.mul(1.7).add(vec2(23.0, 11.0))).sub(0.5);
  const hover: TslNode = sin(uTime.mul(float(0.22).add(aShape.w.mul(0.0003))).add(aShape.w)).mul(0.24);
  const center: TslNode = uCenter
    .add(windDir.mul(along.mul(0.82).add(curlZ.mul(1.5))))
    .add(side.mul(aOffset.x.add(curlX.mul(2.2))))
    .add(vec3(0.0, aOffset.z.add(lift.mul(0.85)).add(hover), 0.0));
  const worldPosition: TslNode = center
    .add(side.mul(pos.x).mul(aShape.x))
    .add(vec3(0.0, pos.y.mul(aShape.x), 0.0))
    .add(windDir.mul(pos.z).mul(aShape.x).mul(0.8));
  const wave: TslNode = smoothstep(0.15, 0.95, fbmNode(noiseUv.mul(1.3).add(vec2(5.0, 5.0))));

  const fragment = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const d: TslNode = length(vec3(p.x, p.y, 0.0));
    d.greaterThan(1.05).discard();
    const core: TslNode = float(1).sub(smoothstep(0.08, 0.58, d));
    const halo: TslNode = float(1).sub(smoothstep(0.18, 1.02, d));
    const mote: TslNode = float(0.78).add(sin(aShape.w.mul(13.7).add(p.x.mul(19.0)).add(p.y.mul(23.0))).mul(0.22));
    const fade: TslNode = smoothstep(0.02, 0.14, travel).mul(float(1).sub(smoothstep(0.86, 1.0, travel)));
    const alpha: TslNode = core.mul(0.72).add(halo.mul(0.34))
      .mul(mote).mul(aShape.y).mul(fade).mul(mix(0.55, 1.25, wave)).mul(uOpacity).mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.006).discard();
    const warm: TslNode = vec3(1.0, 0.9, 0.45);
    const green: TslNode = vec3(0.66, 0.96, 0.62);
    return vec4(mix(uColor, mix(warm, green, 0.28), wave.mul(0.45)), alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-meadow-node";
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
    setCenter: (centerValue) => { uCenter.value.copy(centerValue); },
    setWind: (x, z) => { uWindX.value = x; uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}
