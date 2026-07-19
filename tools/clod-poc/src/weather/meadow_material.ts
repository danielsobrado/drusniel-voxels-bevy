import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute, clamp, dot, float, floor, Fn, fract, length, max, mix, normalize,
  positionGeometry, pow, sin, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4,
} from "three/tsl";
import { Rng, hashCombine, hashString } from "../core/seed.js";
import { getSunLightGpuAtlas } from "../terrain/sun_visibility/sun_light_gpu_atlas.js";
import type {
  MeadowBandOptions,
  MeadowWeatherEnvironment,
  MeadowWeatherMaterialHandle,
} from "./meadow_types.js";
import type { SunbeamMoteRuntimeSettings } from "./sunbeam_mote_runtime.js";
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
    new THREE.Vector3(-MEADOW_BOUNDS_RADIUS, -12, -MEADOW_BOUNDS_RADIUS),
    new THREE.Vector3(MEADOW_BOUNDS_RADIUS, 18, MEADOW_BOUNDS_RADIUS),
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
uniform float uSpawnRadiusM; uniform float uFadeStartM; uniform float uFadeEndM;
varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vGlow; varying vec3 vWorldPosition;
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
  float radiusScale = uSpawnRadiusM / ${MEADOW_RING_RADIUS.toFixed(1)};
  vec2 local = wrapped * radiusScale + vec2(curlX, curlZ) * mix(0.45, 1.65, clamp(uIntensity / 1.6, 0.0, 1.0));
  float ringFade = 1.0 - smoothstep(uFadeStartM, max(uFadeStartM + 0.001, uFadeEndM), length(local));
  vec3 center = vec3(local.x, aMeadowOffset.z + lift * 0.75 + hover, local.y);
  vec3 localPosition = center + side * position.x * aMeadowShape.x + vec3(0.0, position.y * aMeadowShape.x, 0.0) + windDir * position.z * aMeadowShape.x * 0.8;
  float wave = smoothstep(0.15, 0.95, fbm(noiseUv * 1.3 + 5.0));
  vUv = uv; vSeed = aMeadowShape.w; vGlow = wave; vWorldPosition = uAnchor + center;
  vAlpha = aMeadowShape.y * ringFade * mix(0.75, 1.45, wave);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}`;

const MEADOW_FRAGMENT = `uniform sampler2D uSunVisibilityAtlas;
uniform vec3 uCameraPosition; uniform vec3 uSunDirection; uniform vec3 uWarmColor; uniform vec3 uColdColor;
uniform float uSunVisibilityOriginX; uniform float uSunVisibilityOriginZ; uniform float uSunVisibilityWorldSize; uniform float uSunVisibilityValid;
uniform float uVisibilityStart; uniform float uVisibilityEnd; uniform float uDensity; uniform float uOpacity;
uniform float uIntensity; uniform float uStrength; uniform float uForwardScatterPower; uniform float uMistFloor;
uniform float uVisualAmount; uniform float uColdBlend; uniform float uLocalMist;
varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vGlow; varying vec3 vWorldPosition;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float d = length(p); if (d > 1.05) discard;
  float densityRoll = fract(sin(vSeed * 91.731 + 17.17) * 43758.5453123); if (densityRoll > uDensity) discard;
  vec2 rawUv = (vWorldPosition.xz - vec2(uSunVisibilityOriginX, uSunVisibilityOriginZ)) / max(uSunVisibilityWorldSize, 0.001);
  float inside = step(0.0, rawUv.x) * step(rawUv.x, 1.0) * step(0.0, rawUv.y) * step(rawUv.y, 1.0) * uSunVisibilityValid;
  float visibility = smoothstep(uVisibilityStart, max(uVisibilityStart + 0.001, uVisibilityEnd), texture2D(uSunVisibilityAtlas, clamp(rawUv, 0.0, 1.0)).r) * inside;
  vec3 toCamera = normalize(uCameraPosition - vWorldPosition);
  float forwardScatter = pow(max(dot(toCamera, -normalize(uSunDirection)), 0.0), max(1.0, uForwardScatterPower));
  float localMist = mix(uMistFloor, 1.0, clamp(uLocalMist, 0.0, 1.0));
  vec2 q = vUv * 2.0 - 1.0; float core = 1.0 - smoothstep(0.08, 0.58, length(q));
  float halo = 1.0 - smoothstep(0.18, 1.02, length(q));
  float mote = 0.78 + 0.22 * sin(vSeed * 13.7 + q.x * 19.0 + q.y * 23.0);
  float alpha = (core * 0.72 + halo * 0.34) * mote * vAlpha * uOpacity * clamp(uIntensity, 0.0, 1.6)
    * uStrength * uVisualAmount * visibility * forwardScatter * localMist;
  if (alpha < 0.006) discard;
  vec3 color = mix(uWarmColor, uColdColor, clamp(uColdBlend, 0.0, 1.0));
  gl_FragColor = vec4(mix(color, vec3(1.0), vGlow * 0.12), alpha);
}`;

export function createMeadowShaderMaterial(): MeadowWeatherMaterialHandle {
  const atlas = getSunLightGpuAtlas();
  const moteDefaults = DEFAULT_MEADOW_WEATHER_SETTINGS.motes;
  const uniforms = {
    uAnchor: { value: new THREE.Vector3() }, uTime: { value: 0 }, uIntensity: { value: 1 },
    uWindX: { value: DEFAULT_MEADOW_WEATHER_SETTINGS.windX }, uWindZ: { value: DEFAULT_MEADOW_WEATHER_SETTINGS.windZ },
    uSpawnRadiusM: { value: moteDefaults.spawnRadiusM }, uFadeStartM: { value: moteDefaults.fadeStartM }, uFadeEndM: { value: moteDefaults.fadeEndM },
    uSunVisibilityAtlas: { value: atlas.texture }, uSunVisibilityOriginX: { value: atlas.originX }, uSunVisibilityOriginZ: { value: atlas.originZ },
    uSunVisibilityWorldSize: { value: atlas.worldSize }, uSunVisibilityValid: { value: atlas.valid },
    uVisibilityStart: { value: moteDefaults.visibilityStart }, uVisibilityEnd: { value: moteDefaults.visibilityEnd },
    uDensity: { value: moteDefaults.density }, uOpacity: { value: moteDefaults.opacity }, uStrength: { value: moteDefaults.strength },
    uForwardScatterPower: { value: moteDefaults.forwardScatterPower }, uMistFloor: { value: moteDefaults.mistFloor },
    uCameraPosition: { value: new THREE.Vector3() }, uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uVisualAmount: { value: 0 }, uColdBlend: { value: 0 }, uLocalMist: { value: 0 },
    uWarmColor: { value: new THREE.Color().setRGB(...moteDefaults.warmColorRgb) },
    uColdColor: { value: new THREE.Color().setRGB(...moteDefaults.coldColorRgb) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: MEADOW_VERTEX, fragmentShader: MEADOW_FRAGMENT,
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  material.name = "weather-sunbeam-motes-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uAnchor.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    setMoteSettings: (settings) => applyShaderSettings(uniforms, settings),
    setEnvironment: (environment) => applyShaderEnvironment(uniforms, environment),
    setSunVisibilityAtlas: (originX, originZ, worldSize, valid) => {
      uniforms.uSunVisibilityOriginX.value = originX;
      uniforms.uSunVisibilityOriginZ.value = originZ;
      uniforms.uSunVisibilityWorldSize.value = Math.max(0.001, worldSize);
      uniforms.uSunVisibilityValid.value = valid;
    },
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

export function createMeadowNodeMaterial(): MeadowWeatherMaterialHandle {
  const atlas = getSunLightGpuAtlas();
  const defaults = DEFAULT_MEADOW_WEATHER_SETTINGS.motes;
  const uAnchor = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(DEFAULT_MEADOW_WEATHER_SETTINGS.windX) as TslNode;
  const uWindZ = uniform(DEFAULT_MEADOW_WEATHER_SETTINGS.windZ) as TslNode;
  const uSpawnRadiusM = uniform(defaults.spawnRadiusM) as TslNode;
  const uFadeStartM = uniform(defaults.fadeStartM) as TslNode;
  const uFadeEndM = uniform(defaults.fadeEndM) as TslNode;
  const uVisibilityStart = uniform(defaults.visibilityStart) as TslNode;
  const uVisibilityEnd = uniform(defaults.visibilityEnd) as TslNode;
  const uDensity = uniform(defaults.density) as TslNode;
  const uOpacity = uniform(defaults.opacity) as TslNode;
  const uStrength = uniform(defaults.strength) as TslNode;
  const uForwardScatterPower = uniform(defaults.forwardScatterPower) as TslNode;
  const uMistFloor = uniform(defaults.mistFloor) as TslNode;
  const uCameraPosition = uniform(new THREE.Vector3()) as TslNode;
  const uSunDirection = uniform(new THREE.Vector3(0, 1, 0)) as TslNode;
  const uVisualAmount = uniform(0) as TslNode;
  const uColdBlend = uniform(0) as TslNode;
  const uLocalMist = uniform(0) as TslNode;
  const uWarmColor = uniform(new THREE.Color().setRGB(...defaults.warmColorRgb)) as TslNode;
  const uColdColor = uniform(new THREE.Color().setRGB(...defaults.coldColorRgb)) as TslNode;
  const uAtlasOriginX = uniform(atlas.originX) as TslNode;
  const uAtlasOriginZ = uniform(atlas.originZ) as TslNode;
  const uAtlasWorldSize = uniform(atlas.worldSize) as TslNode;
  const uAtlasValid = uniform(atlas.valid) as TslNode;
  const aOffset: TslNode = attribute("aMeadowOffset", "vec4");
  const aShape: TslNode = attribute("aMeadowShape", "vec4");
  const pos: TslNode = positionGeometry;
  const windBase: TslNode = vec2(uWindX, uWindZ);
  const windLength: TslNode = max(length(vec3(uWindX, 0, uWindZ)), 0.001);
  const windDir2: TslNode = windBase.div(windLength);
  const windDir: TslNode = vec3(windDir2.x, 0, windDir2.y);
  const side: TslNode = vec3(windDir.z.mul(-1), 0, windDir.x);
  const area: TslNode = max(aOffset.w, 1);
  const travel: TslNode = uTime.mul(aShape.z).mul(float(1.55).add(windLength.mul(0.32))).mul(max(uIntensity, 0.05)).mul(8);
  const wrapped: TslNode = fract(aOffset.xy.add(windDir2.mul(travel)).div(area).add(0.5)).mul(area).sub(area.mul(0.5));
  const worldNoise: TslNode = wrapped.add(vec2(uAnchor.x, uAnchor.z));
  const noiseUv: TslNode = worldNoise.mul(0.04).add(vec2(aShape.w.mul(0.002), uTime.mul(0.07)));
  const curlX: TslNode = fbmNode(noiseUv).sub(0.5);
  const curlZ: TslNode = fbmNode(vec2(noiseUv.y.add(19.1), noiseUv.x.sub(7.3))).sub(0.5);
  const lift: TslNode = fbmNode(noiseUv.mul(1.7).add(vec2(23, 11))).sub(0.5);
  const hover: TslNode = sin(uTime.mul(float(0.28).add(aShape.w.mul(0.00035))).add(aShape.w)).mul(0.22);
  const radiusScale: TslNode = uSpawnRadiusM.div(MEADOW_RING_RADIUS);
  const local: TslNode = wrapped.mul(radiusScale).add(vec2(curlX, curlZ).mul(mix(0.45, 1.65, clamp(uIntensity.div(1.6), 0, 1))));
  const ringDistance: TslNode = length(vec3(local.x, 0, local.y));
  const ringFade: TslNode = float(1).sub(smoothstep(uFadeStartM, max(uFadeStartM.add(0.001), uFadeEndM), ringDistance));
  const center: TslNode = vec3(local.x, aOffset.z.add(lift.mul(0.75)).add(hover), local.y);
  const localPosition: TslNode = center.add(side.mul(pos.x).mul(aShape.x)).add(vec3(0, pos.y.mul(aShape.x), 0)).add(windDir.mul(pos.z).mul(aShape.x).mul(0.8));
  const worldCenter: TslNode = uAnchor.add(center);
  const wave: TslNode = smoothstep(0.15, 0.95, fbmNode(noiseUv.mul(1.3).add(vec2(5, 5))));
  const fragment = Fn(() => {
    const p: TslNode = uv().mul(2).sub(1);
    const d: TslNode = length(vec3(p.x, p.y, 0));
    d.greaterThan(1.05).discard();
    const densityRoll: TslNode = fract(sin(aShape.w.mul(91.731).add(17.17)).mul(43758.5453123));
    densityRoll.greaterThan(uDensity).discard();
    const rawUv: TslNode = vec2(
      worldCenter.x.sub(uAtlasOriginX).div(max(uAtlasWorldSize, 0.001)),
      worldCenter.z.sub(uAtlasOriginZ).div(max(uAtlasWorldSize, 0.001)),
    );
    const atlasUv: TslNode = vec2(clamp(rawUv.x, 0, 1), clamp(rawUv.y, 0, 1));
    const inside: TslNode = step(0, rawUv.x).mul(step(rawUv.x, 1)).mul(step(0, rawUv.y)).mul(step(rawUv.y, 1)).mul(uAtlasValid);
    const visibility: TslNode = smoothstep(uVisibilityStart, max(uVisibilityStart.add(0.001), uVisibilityEnd), texture(atlas.texture, atlasUv).r).mul(inside);
    const toCamera: TslNode = normalize(uCameraPosition.sub(worldCenter));
    const forwardScatter: TslNode = pow(max(dot(toCamera, normalize(uSunDirection.mul(-1))), 0), max(uForwardScatterPower, 1));
    const localMist: TslNode = mix(uMistFloor, 1, clamp(uLocalMist, 0, 1));
    const core: TslNode = float(1).sub(smoothstep(0.08, 0.58, d));
    const halo: TslNode = float(1).sub(smoothstep(0.18, 1.02, d));
    const mote: TslNode = float(0.78).add(sin(aShape.w.mul(13.7).add(p.x.mul(19)).add(p.y.mul(23))).mul(0.22));
    const alpha: TslNode = core.mul(0.72).add(halo.mul(0.34)).mul(mote).mul(aShape.y).mul(ringFade)
      .mul(mix(0.75, 1.45, wave)).mul(uOpacity).mul(clamp(uIntensity, 0, 1.6)).mul(uStrength)
      .mul(uVisualAmount).mul(visibility).mul(forwardScatter).mul(localMist);
    alpha.lessThan(0.006).discard();
    const color: TslNode = mix(uWarmColor, uColdColor, clamp(uColdBlend, 0, 1));
    return vec4(mix(color, vec3(1, 1, 1), wave.mul(0.12)), alpha);
  });
  const material = new MeshBasicNodeMaterial();
  material.name = "weather-sunbeam-motes-node";
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
    setMoteSettings: (settings) => {
      uSpawnRadiusM.value = settings.spawnRadiusM; uFadeStartM.value = settings.fadeStartM; uFadeEndM.value = settings.fadeEndM;
      uVisibilityStart.value = settings.visibilityStart; uVisibilityEnd.value = settings.visibilityEnd;
      uDensity.value = settings.density; uOpacity.value = settings.opacity; uStrength.value = settings.strength;
      uForwardScatterPower.value = settings.forwardScatterPower; uMistFloor.value = settings.mistFloor;
      uWarmColor.value.setRGB(...settings.warmColorRgb); uColdColor.value.setRGB(...settings.coldColorRgb);
    },
    setEnvironment: (environment) => {
      uCameraPosition.value.copy(environment.cameraPosition); uSunDirection.value.copy(environment.sunDirection).normalize();
      uVisualAmount.value = environment.amount; uColdBlend.value = environment.coldBlend; uLocalMist.value = environment.localMist;
    },
    setSunVisibilityAtlas: (originX, originZ, worldSize, valid) => {
      uAtlasOriginX.value = originX; uAtlasOriginZ.value = originZ; uAtlasWorldSize.value = Math.max(0.001, worldSize); uAtlasValid.value = valid;
    },
    dispose: () => { material.dispose(); },
  };
}

interface ShaderUniforms {
  [key: string]: { value: any };
}

function applyShaderSettings(uniforms: ShaderUniforms, settings: SunbeamMoteRuntimeSettings): void {
  uniforms.uSpawnRadiusM.value = settings.spawnRadiusM;
  uniforms.uFadeStartM.value = settings.fadeStartM;
  uniforms.uFadeEndM.value = settings.fadeEndM;
  uniforms.uVisibilityStart.value = settings.visibilityStart;
  uniforms.uVisibilityEnd.value = settings.visibilityEnd;
  uniforms.uDensity.value = settings.density;
  uniforms.uOpacity.value = settings.opacity;
  uniforms.uStrength.value = settings.strength;
  uniforms.uForwardScatterPower.value = settings.forwardScatterPower;
  uniforms.uMistFloor.value = settings.mistFloor;
  uniforms.uWarmColor.value.setRGB(...settings.warmColorRgb);
  uniforms.uColdColor.value.setRGB(...settings.coldColorRgb);
}

function applyShaderEnvironment(uniforms: ShaderUniforms, environment: MeadowWeatherEnvironment): void {
  uniforms.uCameraPosition.value.copy(environment.cameraPosition);
  uniforms.uSunDirection.value.copy(environment.sunDirection).normalize();
  uniforms.uVisualAmount.value = environment.amount;
  uniforms.uColdBlend.value = environment.coldBlend;
  uniforms.uLocalMist.value = environment.localMist;
}
