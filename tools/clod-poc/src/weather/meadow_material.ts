import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute, clamp, dot, float, floor, Fn, fract, length, max, mix,
  positionGeometry, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from "three/tsl";
import { Rng, hashCombine, hashString } from "../core/seed.js";
import type { RainWeatherShaderHandle } from "./rainShaderMaterial.js";
import type { MeadowBandOptions } from "./meadow_types.js";
import {
  DEFAULT_MEADOW_WEATHER_SETTINGS, MEADOW_BOUNDS_RADIUS, MEADOW_FAR_COUNT,
  MEADOW_MID_COUNT, MEADOW_NEAR_COUNT, MEADOW_PARTICLE_COUNT, MEADOW_RING_RADIUS,
} from "./meadow_defaults.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

function writeMeadowBand(options: MeadowBandOptions): void {
  const { rng, offset, shape } = options;
  for (let i = 0; i < options.count; i++) {
    const radius = Math.sqrt(rng.float()) * options.radius;
    const angle = rng.range(0, Math.PI * 2);
    const o = (options.start + i) * 4;
    offset[o] = Math.cos(angle) * radius;
    offset[o + 1] = Math.sin(angle) * radius;
    offset[o + 2] = rng.range(options.yMin, options.yMax);
    offset[o + 3] = options.radius * 2;
    shape[o] = rng.range(options.sizeMin, options.sizeMax);
    shape[o + 1] = rng.range(options.opacityMin, options.opacityMax);
    shape[o + 2] = rng.range(options.speedMin, options.speedMax);
    shape[o + 3] = rng.float() * 1000;
  }
}

export function createMeadowGeometry(seed: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0,
    0, -1, -1, 0, -1, 1, 0, 1, -1, 0, 1, 1,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7,
  ]), 1));
  geometry.instanceCount = MEADOW_PARTICLE_COUNT;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), MEADOW_BOUNDS_RADIUS);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-MEADOW_BOUNDS_RADIUS, -3, -MEADOW_BOUNDS_RADIUS),
    new THREE.Vector3(MEADOW_BOUNDS_RADIUS, MEADOW_BOUNDS_RADIUS, MEADOW_BOUNDS_RADIUS),
  );
  const offset = new Float32Array(MEADOW_PARTICLE_COUNT * 4);
  const shape = new Float32Array(MEADOW_PARTICLE_COUNT * 4);
  const rng = new Rng(hashCombine(seed, hashString("meadow-pollen")));
  writeMeadowBand({ rng, offset, shape, start: 0, count: MEADOW_NEAR_COUNT, radius: 24, yMin: -0.35, yMax: 4.8, speedMin: 0.09, speedMax: 0.34, sizeMin: 0.035, sizeMax: 0.1, opacityMin: 0.1, opacityMax: 0.3 });
  writeMeadowBand({ rng, offset, shape, start: MEADOW_NEAR_COUNT, count: MEADOW_MID_COUNT, radius: 34, yMin: -0.15, yMax: 6.8, speedMin: 0.06, speedMax: 0.24, sizeMin: 0.025, sizeMax: 0.075, opacityMin: 0.06, opacityMax: 0.2 });
  writeMeadowBand({ rng, offset, shape, start: MEADOW_NEAR_COUNT + MEADOW_MID_COUNT, count: MEADOW_FAR_COUNT, radius: MEADOW_RING_RADIUS, yMin: 0.0, yMax: 8.6, speedMin: 0.035, speedMax: 0.16, sizeMin: 0.018, sizeMax: 0.05, opacityMin: 0.03, opacityMax: 0.12 });
  geometry.setAttribute("aMeadowOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geometry.setAttribute("aMeadowShape", new THREE.InstancedBufferAttribute(shape, 4));
  return geometry;
}

const MEADOW_NOISE_GLSL = `float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0; float amplitude = 0.5;
  for (int i = 0; i < 5; i++) { value += amplitude * valueNoise(p); p *= 2.02; amplitude *= 0.5; }
  return value;
}`;

const MEADOW_VERTEX = `attribute vec4 aMeadowOffset;
attribute vec4 aMeadowShape;
uniform vec3 uAnchor; uniform float uTime; uniform float uIntensity; uniform float uWindX; uniform float uWindZ;
varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vGlow;
${MEADOW_NOISE_GLSL}
void main() {
  vec2 windBase = vec2(uWindX, uWindZ); float windLength = max(length(windBase), 0.001);
  vec2 windDir2 = windBase / windLength; vec3 windDir = vec3(windDir2.x, 0.0, windDir2.y);
  vec3 side = vec3(-windDir.z, 0.0, windDir.x); float area = max(aMeadowOffset.w, 1.0);
  float travel = uTime * aMeadowShape.z * (1.55 + windLength * 0.32) * max(uIntensity, 0.05) * 8.0;
  vec2 baseLocal = aMeadowOffset.xy;
  vec2 wrapped = fract((baseLocal + windDir2 * travel) / area + 0.5) * area - area * 0.5;
  vec2 worldNoise = wrapped + uAnchor.xz;
  vec2 noiseUv = worldNoise * 0.04 + vec2(aMeadowShape.w * 0.002, uTime * 0.07);
  float curlX = fbm(noiseUv) - 0.5; float curlZ = fbm(noiseUv.yx + vec2(19.1, -7.3)) - 0.5;
  float lift = fbm(noiseUv * 1.7 + vec2(23.0, 11.0)) - 0.5;
  float hover = sin(uTime * (0.28 + aMeadowShape.w * 0.00035) + aMeadowShape.w) * 0.22;
  float ringFade = 1.0 - smoothstep(34.0, 42.0, length(wrapped));
  vec2 local = wrapped + vec2(curlX, curlZ) * mix(0.45, 1.65, clamp(uIntensity / 1.6, 0.0, 1.0));
  vec3 center = vec3(local.x, aMeadowOffset.z + lift * 0.75 + hover, local.y);
  vec3 localPosition = center + side * position.x * aMeadowShape.x + vec3(0.0, position.y * aMeadowShape.x, 0.0) + windDir * position.z * aMeadowShape.x * 0.8;
  float wave = smoothstep(0.15, 0.95, fbm(noiseUv * 1.3 + 5.0));
  vUv = uv; vSeed = aMeadowShape.w; vGlow = wave;
  vAlpha = aMeadowShape.y * ringFade * mix(0.75, 1.45, wave);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}`;

const MEADOW_FRAGMENT = `uniform vec3 uColor; uniform float uOpacity; uniform float uIntensity;
varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vGlow;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float d = length(p); if (d > 1.05) discard;
  float core = 1.0 - smoothstep(0.08, 0.58, d); float halo = 1.0 - smoothstep(0.18, 1.02, d);
  float mote = 0.78 + 0.22 * sin(vSeed * 13.7 + p.x * 19.0 + p.y * 23.0);
  float alpha = (core * 0.72 + halo * 0.34) * mote * vAlpha * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.006) discard;
  vec3 warm = vec3(0.85, 0.75, 0.45); vec3 green = vec3(0.5, 0.65, 0.38);
  gl_FragColor = vec4(mix(uColor, mix(warm, green, 0.35), vGlow * 0.35), alpha);
}`;

export function createMeadowShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uAnchor: { value: new THREE.Vector3() },
    uTime: { value: 0 }, uIntensity: { value: 1 },
    uWindX: { value: DEFAULT_MEADOW_WEATHER_SETTINGS.windX },
    uWindZ: { value: DEFAULT_MEADOW_WEATHER_SETTINGS.windZ },
    uColor: { value: new THREE.Color(0x9e8b5e) }, uOpacity: { value: 0.8 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: MEADOW_VERTEX, fragmentShader: MEADOW_FRAGMENT,
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  material.name = "weather-meadow-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uAnchor.value.copy(center); },
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
  return mix(mix(hash21Node(i), hash21Node(i.add(vec2(1.0, 0.0))), u.x), mix(hash21Node(i.add(vec2(0.0, 1.0))), hash21Node(i.add(vec2(1.0, 1.0))), u.x), u.y);
}

function fbmNode(p: TslNode): TslNode {
  let v: TslNode = float(0);
  let amp: TslNode = float(0.5);
  let u: TslNode = p;
  for (let i = 0; i < 5; i++) {
    v = v.add(amp.mul(valueNoiseNode(u)));
    u = u.mul(2.02);
    amp = amp.mul(0.5);
  }
  return v;
}

export function createMeadowNodeMaterial(): RainWeatherShaderHandle {
  const uAnchor = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(DEFAULT_MEADOW_WEATHER_SETTINGS.windX) as TslNode;
  const uWindZ = uniform(DEFAULT_MEADOW_WEATHER_SETTINGS.windZ) as TslNode;
  const uColor = uniform(new THREE.Color(0x9e8b5e)) as TslNode;
  const uOpacity = uniform(0.8) as TslNode;
  const aOffset: TslNode = attribute("aMeadowOffset", "vec4");
  const aShape: TslNode = attribute("aMeadowShape", "vec4");
  const pos: TslNode = positionGeometry;
  const windBase: TslNode = vec2(uWindX, uWindZ);
  const windLength: TslNode = max(length(vec3(uWindX, 0.0, uWindZ)), 0.001);
  const windDir2: TslNode = windBase.div(windLength);
  const windDir: TslNode = vec3(windDir2.x, 0.0, windDir2.y);
  const side: TslNode = vec3(windDir.z.mul(-1.0), 0.0, windDir.x);
  const area: TslNode = max(aOffset.w, 1.0);
  const travel: TslNode = uTime.mul(aShape.z).mul(float(1.55).add(windLength.mul(0.32))).mul(max(uIntensity, 0.05)).mul(8.0);
  const wrapped: TslNode = fract(aOffset.xy.add(windDir2.mul(travel)).div(area).add(0.5)).mul(area).sub(area.mul(0.5));
  const worldNoise: TslNode = wrapped.add(vec2(uAnchor.x, uAnchor.z));
  const noiseUv: TslNode = worldNoise.mul(0.04).add(vec2(aShape.w.mul(0.002), uTime.mul(0.07)));
  const curlX: TslNode = fbmNode(noiseUv).sub(0.5);
  const curlZ: TslNode = fbmNode(vec2(noiseUv.y.add(19.1), noiseUv.x.sub(7.3))).sub(0.5);
  const lift: TslNode = fbmNode(noiseUv.mul(1.7).add(vec2(23.0, 11.0))).sub(0.5);
  const hover: TslNode = sin(uTime.mul(float(0.28).add(aShape.w.mul(0.00035))).add(aShape.w)).mul(0.22);
  const ringDistance: TslNode = length(vec3(wrapped.x, 0.0, wrapped.y));
  const ringFade: TslNode = float(1).sub(smoothstep(34.0, 42.0, ringDistance));
  const local: TslNode = wrapped.add(vec2(curlX, curlZ).mul(mix(0.45, 1.65, clamp(uIntensity.div(1.6), 0.0, 1.0))));
  const center: TslNode = vec3(local.x, aOffset.z.add(lift.mul(0.75)).add(hover), local.y);
  const localPosition: TslNode = center.add(side.mul(pos.x).mul(aShape.x)).add(vec3(0.0, pos.y.mul(aShape.x), 0.0)).add(windDir.mul(pos.z).mul(aShape.x).mul(0.8));
  const wave: TslNode = smoothstep(0.15, 0.95, fbmNode(noiseUv.mul(1.3).add(vec2(5.0, 5.0))));
  const fragment = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const d: TslNode = length(vec3(p.x, p.y, 0.0));
    d.greaterThan(1.05).discard();
    const core: TslNode = float(1).sub(smoothstep(0.08, 0.58, d));
    const halo: TslNode = float(1).sub(smoothstep(0.18, 1.02, d));
    const mote: TslNode = float(0.78).add(sin(aShape.w.mul(13.7).add(p.x.mul(19.0)).add(p.y.mul(23.0))).mul(0.22));
    const alpha: TslNode = core.mul(0.72).add(halo.mul(0.34)).mul(mote).mul(aShape.y).mul(ringFade).mul(mix(0.75, 1.45, wave)).mul(uOpacity).mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.006).discard();
    return vec4(mix(uColor, mix(vec3(0.85, 0.75, 0.45), vec3(0.5, 0.65, 0.38), 0.35), wave.mul(0.35)), alpha);
  });
  const material = new MeshBasicNodeMaterial();
  material.name = "weather-meadow-node";
  material.positionNode = localPosition;
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
    setCenter: (centerValue) => { uAnchor.value.copy(centerValue); },
    setWind: (x, z) => { uWindX.value = x; uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}
