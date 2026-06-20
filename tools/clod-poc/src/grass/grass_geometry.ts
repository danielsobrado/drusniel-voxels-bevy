import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import {
  BLADE_ROWS,
  TWO_PI,
  grassRowsForSegments,
  type GrassLighting,
  type GrassSettings,
  type GrassShaderMode,
  type GrassTier,
} from "./grass_config.js";
import type { GrassBladeInstance } from "./grass_cpu_patch.js";
import type { GrassRingInstanceBuffers } from "./grass_gpu_ring.js";
import { grassFadeDistance } from "./grass_math.js";

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aWidthScale;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float bend = uv.y * uv.y;
    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.071 + aOffset.z * 0.053;
    vec2 lateralWind = vec2(sin(windTime), cos(windTime * 0.83 + aPhase * 0.37));
    vec2 wind = normalize(uWindDirection + lateralWind * 0.35);
    wind *= uWindStrength * aHeight * bend;

    vec3 localPosition = vec3(position.x * uBladeWidth * aWidthScale, position.y * aHeight, position.z * uBladeWidth * aWidthScale);
    localPosition.xz += wind;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(
      normal.x - wind.x * 0.35,
      normal.y + bend * 0.16,
      normal.z - wind.y * 0.35
    ));
    vWorldNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    vWorldPos = aOffset + rotatedPosition;
    vUv = uv;
    vColorMix = aColorMix;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 darkGreen = vec3(0.035, 0.12, 0.025);
    vec3 midGreen = vec3(0.12, 0.34, 0.055);
    vec3 tipGreen = vec3(0.34, 0.56, 0.12);
    vec3 dryGrass = vec3(0.52, 0.42, 0.12);
    vec3 grassColor = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, vUv.y));
    grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, vUv.y));
    grassColor = mix(grassColor, dryGrass, vColorMix * 0.58);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float back = max(dot(-n, lightDirection), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * pow(sun, 1.25);
    vec3 transmission = vec3(0.46, 0.55, 0.12) * back * (0.16 + vUv.y * 0.5);
    gl_FragColor = vec4(grassColor * (hemi + direct) + transmission * grassColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const TERRAIN_PATCH_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform vec2 uWindDirection;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uNearDistance;
  uniform float uMidDistance;
  uniform float uFadeDistance;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aEdgeFade;
  attribute float aNormalY;
  attribute float aWidthScale;
  attribute vec3 aTerrainNormal;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;

  void main() {
    float dist = distance(cameraPosition.xz, aOffset.xz);
    float farFade = 1.0 - smoothstep(uFadeDistance * 0.9, uFadeDistance, dist);
    float nearWeight = 1.0 - smoothstep(uNearDistance * 0.75, uNearDistance, dist);
    float heightFactor = uv.y * uv.y;
    float edge = clamp(aEdgeFade, 0.0, 1.0);
    vec3 terrainNormal = normalize(aTerrainNormal);
    float slope = smoothstep(0.55, 0.96, terrainNormal.y);
    float bendPower = heightFactor * edge * (0.55 + nearWeight * 0.45);

    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.049 + aOffset.z * 0.037;
    vec2 lateralWind = vec2(
      sin(windTime),
      sin(windTime * 0.61 + aOffset.z * 0.021)
    );
    vec2 wind = normalize(uWindDirection + lateralWind * 0.35) * uWindStrength * aHeight * bendPower;

    float edgeHeight = mix(0.35, 1.0, edge);
    float slopeHeight = mix(0.55, 1.0, slope);
    float widthTaper = mix(1.35, 0.85, uv.y);
    vec3 localPosition = vec3(
      position.x * uBladeWidth * widthTaper * aWidthScale,
      position.y * aHeight * edgeHeight * slopeHeight,
      position.z * uBladeWidth * widthTaper * aWidthScale
    );
    localPosition.xz += wind;
    localPosition.y -= length(wind) * 0.08 * heightFactor;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(
      normal.x - wind.x * 0.28,
      normal.y + 0.18 + uv.y * 0.28,
      normal.z - wind.y * 0.24
    ));
    vec3 bladeNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    float terrainNormalPull = smoothstep(0.18, 1.0, uv.y) * 0.35;
    vWorldNormal = normalize(mix(bladeNormal, terrainNormal, terrainNormalPull));
    vUv = uv;
    vColorMix = aColorMix;
    vEdgeFade = edge;
    vDistanceFade = farFade;
    gl_Position = projectionMatrix * viewMatrix * vec4(aOffset + rotatedPosition, 1.0);
  }
`;

const TERRAIN_PATCH_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;
  uniform float uAlphaToCoverage;

  // Ordered-dither fallback (used when alpha-to-coverage is off). Recursive 2x2 -> 4x4 Bayer
  // matrix in [0,1), no array indexing so it stays WebGL1-safe.
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(a * 0.5) * 0.25 + bayer2(a);
  }

  void main() {
    // Soft coverage from the distance + edge fades. Both paths stay in the OPAQUE pass
    // (early-Z, no blended overdraw): alpha-to-coverage emits coverage as alpha so the MSAA
    // hardware builds a smooth sample mask; the fallback is an ordered screen-door cutout.
    float coverage = smoothstep(0.0, 0.08, vDistanceFade) * smoothstep(0.08, 0.45, vEdgeFade);
    bool a2c = uAlphaToCoverage > 0.5;
    float cutoff = a2c ? 0.003 : bayer4(gl_FragCoord.xy);
    if (coverage < cutoff) discard;

    vec3 base = vec3(0.04, 0.16, 0.035);
    vec3 mid = vec3(0.16, 0.36, 0.075);
    vec3 tip = vec3(0.43, 0.58, 0.16);
    vec3 dry = vec3(0.48, 0.38, 0.11);
    vec3 color = mix(base, mid, smoothstep(0.0, 0.7, vUv.y));
    color = mix(color, tip, smoothstep(0.62, 1.0, vUv.y));
    color = mix(color, dry, vColorMix * 0.42);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float wrap = clamp(dot(n, lightDirection) * 0.45 + 0.55, 0.0, 1.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * (sun * 0.65 + wrap * 0.28);
    vec3 transmission = vec3(0.42, 0.52, 0.12) * max(dot(-n, lightDirection), 0.0) * (0.14 + vUv.y * 0.42);
    gl_FragColor = vec4(color * (hemi + direct) + transmission * color, a2c ? coverage : 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;


export interface GrassGeometryOptions {
  mode: GrassShaderMode;
  tier: GrassTier;
  crossed?: boolean;
  settings?: GrassSettings;
}

export type GrassGeometryBuilder = (
  instances: readonly GrassBladeInstance[],
  options: GrassGeometryOptions,
) => THREE.InstancedBufferGeometry;

export interface GrassMaterialHandle {
  material: THREE.Material;
  setTime?(timeSeconds: number): void;
  setFadeCenter?(x: number, z: number): void;
  updateSettings?(settings: GrassSettings): void;
  updateLighting?(lighting: GrassLighting): void;
  dispose?(): void;
}

export type GrassMaterialFactory = (
  settings: GrassSettings,
  lighting: GrassLighting,
  ringInstanceBuffers?: GrassRingInstanceBuffers,
) => GrassMaterialHandle;

interface GrassShaderDefinition {
  vertexShader: string;
  fragmentShader: string;
  patchStyle: "classic" | "terrain-patch";
  usesTerrainPatchPlacement: boolean;
}

const GRASS_SHADER_DEFINITIONS: Record<GrassShaderMode, GrassShaderDefinition> = {
  "terrain-patch-v2": {
    vertexShader: TERRAIN_PATCH_VERTEX_SHADER,
    fragmentShader: TERRAIN_PATCH_FRAGMENT_SHADER,
    patchStyle: "terrain-patch",
    usesTerrainPatchPlacement: true,
  },
  "webgpu-ring-v1": {
    vertexShader: TERRAIN_PATCH_VERTEX_SHADER,
    fragmentShader: TERRAIN_PATCH_FRAGMENT_SHADER,
    patchStyle: "terrain-patch",
    usesTerrainPatchPlacement: true,
  },
  classic: {
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    patchStyle: "classic",
    usesTerrainPatchPlacement: false,
  },
};

export function grassShaderDefinition(mode: GrassShaderMode): GrassShaderDefinition {
  return GRASS_SHADER_DEFINITIONS[mode];
}

// Each blade is one or more vertical quad strips ("planes"). The base plane spans X and
// faces +Z; the crossed plane spans Z and faces +X, so a near-facing surface exists at any
// view angle (fixes edge-on thinning of a single plane). Both planes share the same vertical
// bend axis, so the vertex shader animates them identically. Per-vertex `normal` lets the
// shader light/orient each plane correctly instead of assuming a single +Z facing.
const BLADE_PLANES = {
  single: [{ axis: "x", normal: [0, 0, 1] }],
  crossed: [
    { axis: "x", normal: [0, 0, 1] },
    { axis: "z", normal: [1, 0, 0] },
  ],
} as const;

export function createBladeGeometry(
  rows: readonly (readonly [number, number])[] = BLADE_ROWS,
  crossed = false,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const plane of crossed ? BLADE_PLANES.crossed : BLADE_PLANES.single) {
    const base = positions.length / 3;
    for (const [y, halfWidth] of rows) {
      if (plane.axis === "x") {
        positions.push(-halfWidth, y, 0, halfWidth, y, 0);
      } else {
        positions.push(0, y, -halfWidth, 0, y, halfWidth);
      }
      uvs.push(0, y, 1, y);
      normals.push(...plane.normal, ...plane.normal);
    }
    for (let row = 0; row < rows.length - 1; row++) {
      const lower = base + row * 2;
      const upper = lower + 2;
      indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createGrassTuftGeometry(widthOrSettings: number | GrassSettings = 1): THREE.BufferGeometry {
  const width = typeof widthOrSettings === "number"
    ? widthOrSettings
    : widthOrSettings.blade.farTuftWidthM / Math.max(widthOrSettings.blade.widthM, 0.001);
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 3; blade++) {
    const yaw = blade * 1.92 + 0.4;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const base = positions.length / 3;
    for (const [x, y] of [[-width, 0], [width, 0], [width * 0.55, 1], [-width * 0.55, 1]] as const) {
      positions.push(x * cosYaw, y, x * sinYaw);
      const side = x < 0 ? -1 : 1;
      normals.push(
        -sinYaw * 0.62 + side * 0.38 * cosYaw,
        0.42,
        cosYaw * 0.62 + side * 0.38 * sinYaw,
      );
      uvs.push(x < 0 ? 0 : 1, y);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function makeDeterministicRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createGrassBladeClumpGeometry(
  blades: number,
  rows: readonly (readonly [number, number])[],
  seed: number,
): THREE.BufferGeometry {
  const random = makeDeterministicRandom(seed + blades * 97 + rows.length * 17);
  const source = createBladeGeometry(rows, false);
  const sourcePosition = source.getAttribute("position");
  const sourceNormal = source.getAttribute("normal");
  const sourceUv = source.getAttribute("uv");
  const sourceIndex = source.getIndex();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let blade = 0; blade < blades; blade++) {
    const yaw = random() * TWO_PI;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const offsetX = (random() - 0.5) * 0.18;
    const offsetZ = (random() - 0.5) * 0.18;
    const heightScale = 0.62 + random() * 0.7;
    const widthScale = 0.82 + random() * 0.55;
    const lean = (random() - 0.5) * 0.34;
    const baseVertex = positions.length / 3;

    for (let i = 0; i < sourcePosition.count; i++) {
      const x = sourcePosition.getX(i) * widthScale;
      const y = sourcePosition.getY(i) * heightScale;
      const z = sourcePosition.getZ(i);
      const shearX = x + lean * y;
      positions.push(
        shearX * cosYaw + z * sinYaw + offsetX,
        y,
        z * cosYaw - shearX * sinYaw + offsetZ,
      );
      normals.push(
        sourceNormal.getX(i) * cosYaw + sourceNormal.getZ(i) * sinYaw,
        sourceNormal.getY(i),
        sourceNormal.getZ(i) * cosYaw - sourceNormal.getX(i) * sinYaw,
      );
      uvs.push(sourceUv.getX(i), sourceUv.getY(i));
    }

    if (sourceIndex) {
      for (let i = 0; i < sourceIndex.count; i++) indices.push(baseVertex + sourceIndex.getX(i));
    }
  }

  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function createGrassClumpGeometry(
  bladesPerInstance: number,
  segments: number,
  settings: GrassSettings,
): THREE.BufferGeometry {
  return createGrassBladeClumpGeometry(
    bladesPerInstance,
    grassRowsForSegments(segments),
    settings.seed + bladesPerInstance * 409 + segments * 37,
  );
}

export function createGrassMaterial(
  settings: GrassSettings,
  lighting: GrassLighting,
  shaderMode: GrassShaderMode,
): THREE.ShaderMaterial {
  const shader = grassShaderDefinition(shaderMode);
  const useAlphaToCoverage = shader.patchStyle === "terrain-patch" && settings.alphaToCoverage;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBladeWidth: { value: settings.bladeWidth },
      uWindDirection: { value: new THREE.Vector2(settings.wind.direction[0], settings.wind.direction[1]) },
      uWindStrength: { value: settings.windStrength },
      uWindSpeed: { value: settings.windSpeed },
      uNearDistance: { value: settings.distance * settings.lod.nearFraction },
      uMidDistance: { value: settings.distance * settings.lod.midFraction },
      uFadeDistance: { value: grassFadeDistance(settings) },
      uLight: { value: lighting.light.clone() },
      uSunColor: { value: lighting.sunColor.clone() },
      uSkyLight: { value: lighting.skyLight.clone() },
      uGroundLight: { value: lighting.groundLight.clone() },
      uAlphaToCoverage: { value: useAlphaToCoverage ? 1 : 0 },
    },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    side: THREE.DoubleSide,
    // Both modes stay opaque (no alpha blending => depth-write + early-Z, no overdraw
    // blow-up). terrain-patch-v2 fades either via hardware alpha-to-coverage (smooth, needs
    // an MSAA target) or the ordered-dither cutout fallback; classic is fully solid.
    transparent: false,
    depthWrite: true,
    alphaToCoverage: useAlphaToCoverage,
    toneMapped: true,
  });
}

export function cloneLighting(lighting: GrassLighting): GrassLighting {
  return {
    light: lighting.light.clone(),
    sunColor: lighting.sunColor.clone(),
    skyLight: lighting.skyLight.clone(),
    groundLight: lighting.groundLight.clone(),
  };
}

export function populateGrassGeometry(
  geometry: THREE.InstancedBufferGeometry,
  bladeGeometry: THREE.BufferGeometry,
  footprint: PageFootprint,
  instances: readonly GrassBladeInstance[],
  settings: GrassSettings,
): void {
    geometry.setAttribute("position", bladeGeometry.getAttribute("position"));
    geometry.setAttribute("uv", bladeGeometry.getAttribute("uv"));
    geometry.setAttribute("normal", bladeGeometry.getAttribute("normal"));
    geometry.setIndex(bladeGeometry.getIndex());

    const offsets = new Float32Array(instances.length * 3);
    const heights = new Float32Array(instances.length);
    const rotations = new Float32Array(instances.length);
    const phases = new Float32Array(instances.length);
    const colorMixes = new Float32Array(instances.length);
    const edgeFades = new Float32Array(instances.length);
    const normalYs = new Float32Array(instances.length);
    const terrainNormals = new Float32Array(instances.length * 3);
    const widthScales = new Float32Array(instances.length);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index];
      offsets.set(instance.offset, index * 3);
      heights[index] = instance.height;
      rotations[index] = instance.rotationY;
      phases[index] = instance.phase;
      colorMixes[index] = instance.colorMix;
      edgeFades[index] = instance.edgeFade;
      normalYs[index] = instance.normalY;
      terrainNormals.set(instance.terrainNormal, index * 3);
      widthScales[index] = instance.widthScale ?? 1;
      minY = Math.min(minY, instance.offset[1]);
      maxY = Math.max(maxY, instance.offset[1] + instance.height);
    }
    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute("aHeight", new THREE.InstancedBufferAttribute(heights, 1));
    geometry.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rotations, 1));
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(colorMixes, 1));
    geometry.setAttribute("aEdgeFade", new THREE.InstancedBufferAttribute(edgeFades, 1));
    geometry.setAttribute("aNormalY", new THREE.InstancedBufferAttribute(normalYs, 1));
    geometry.setAttribute("aTerrainNormal", new THREE.InstancedBufferAttribute(terrainNormals, 3));
    geometry.setAttribute("aWidthScale", new THREE.InstancedBufferAttribute(widthScales, 1));
    geometry.instanceCount = instances.length;

    const margin = settings.bladeWidth
      + settings.bladeHeight * (1 + settings.bladeHeightVariation) * settings.windStrength * 2;
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(footprint.minX - margin, minY, footprint.minZ - margin),
      new THREE.Vector3(footprint.maxX + margin, maxY, footprint.maxZ + margin),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  }
