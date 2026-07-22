import { GRASS_SHARED_BASE_LINEAR } from "../../grass/grass_palette.js";

export const TERRAIN_SHADER_FUNCTIONS = `
float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    total += valueNoise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

float farTerrainHeight(vec2 worldXZ) {
  vec2 p = worldXZ * 0.00225;
  float continent = fbm(p * 0.55) - 0.38;
  float hills = fbm(p * 4.0) * 28.0;
  float ridges = abs(fbm(p * 9.0) - 0.5) * 34.0;
  float coast = smoothstep(-0.08, 0.24, continent);
  return mix(-10.0, hills + ridges - 16.0, coast);
}

vec3 farTerrainBaseColor(float height, vec3 normal) {
  float slope = 1.0 - saturate(normal.y);
  if (height <= 0.25) return vec3(0.07, 0.18, 0.25);
  if (height < 4.0) return vec3(0.42, 0.36, 0.20);
  vec3 grass = vec3(${GRASS_SHARED_BASE_LINEAR.join(", ")});
  vec3 rock = vec3(0.35, 0.34, 0.30);
  vec3 highland = vec3(0.32, 0.36, 0.24);
  vec3 color = mix(grass, rock, smoothstep(0.32, 0.72, slope));
  return mix(color, highland, smoothstep(56.0, 180.0, height) * 0.35);
}
`;

export const VERTEX_SHADER = `
uniform vec2 uRingOrigin;
uniform float uCellSize;
uniform float uHeightScale;
uniform float uYOffset;
uniform vec2 uCameraXZ;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistance;

${TERRAIN_SHADER_FUNCTIONS}

void main() {
  vec2 worldXZ = uRingOrigin + position.xz * uCellSize;
  float rawHeight = farTerrainHeight(worldXZ);
  float height = rawHeight * uHeightScale + uYOffset;

  float sampleStep = max(uCellSize, 1.0);
  float hL = farTerrainHeight(worldXZ - vec2(sampleStep, 0.0)) * uHeightScale + uYOffset;
  float hR = farTerrainHeight(worldXZ + vec2(sampleStep, 0.0)) * uHeightScale + uYOffset;
  float hD = farTerrainHeight(worldXZ - vec2(0.0, sampleStep)) * uHeightScale + uYOffset;
  float hU = farTerrainHeight(worldXZ + vec2(0.0, sampleStep)) * uHeightScale + uYOffset;
  vec3 dx = vec3(2.0 * sampleStep, hR - hL, 0.0);
  vec3 dz = vec3(0.0, hU - hD, 2.0 * sampleStep);

  vWorldXZ = worldXZ;
  vHeight = height;
  vDistance = length(worldXZ - uCameraXZ);
  vWorldNormal = normalize(cross(dz, dx));

  vec4 worldPosition = vec4(worldXZ.x, height, worldXZ.y, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const FRAGMENT_SHADER = `
precision highp float;

uniform float uSeaLevel;
uniform int uDebugMode;
uniform float uClipInnerRadius;
uniform float uClipOuterRadius;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistance;

${TERRAIN_SHADER_FUNCTIONS}

vec3 tonemapFarTerrain(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(0.92));
}

void main() {
  if (vDistance < uClipInnerRadius || vDistance > uClipOuterRadius) discard;

  vec3 normal = normalize(vWorldNormal);
  vec3 sunDir = normalize(vec3(0.38, 0.82, 0.34));
  float directLight = saturate(dot(normal, sunDir));
  float ambientLight = 0.34 + 0.24 * saturate(normal.y);
  float slope = 1.0 - saturate(normal.y);
  float elevation = saturate((vHeight + 48.0) / 220.0);

  vec3 baseColor = farTerrainBaseColor(vHeight - uSeaLevel, normal);
  vec3 shadedColor = mix(baseColor, vec3(0.44, 0.43, 0.38), slope * 0.22);
  shadedColor = mix(shadedColor, vec3(0.42, 0.46, 0.33), elevation * 0.18);
  shadedColor *= ambientLight + directLight * 0.78;

  if (vHeight <= uSeaLevel + 0.25) {
    float waterDepthHint = saturate((uSeaLevel + 16.0 - vHeight) / 32.0);
    vec3 waterColor = mix(vec3(0.06, 0.16, 0.23), vec3(0.10, 0.28, 0.38), 1.0 - waterDepthHint);
    shadedColor = mix(shadedColor, waterColor, 0.72);
  }

  float horizonFog = smoothstep(uClipOuterRadius * 0.55, uClipOuterRadius, vDistance);
  shadedColor = mix(shadedColor, vec3(0.46, 0.52, 0.50), horizonFog * 0.36);

  if (uDebugMode == 1) {
    shadedColor = farTerrainBaseColor(vHeight - uSeaLevel, vec3(0.0, 1.0, 0.0));
  } else if (uDebugMode == 2) {
    shadedColor = vec3(saturate((vHeight + 64.0) / 256.0));
  } else if (uDebugMode == 3) {
    float ringEdge = min(abs(vDistance - uClipInnerRadius), abs(vDistance - uClipOuterRadius));
    float edgeLine = 1.0 - smoothstep(0.0, 16.0, ringEdge);
    shadedColor = mix(vec3(0.05, 0.35, 0.95), vec3(1.0, 0.82, 0.18), edgeLine);
  }

  gl_FragColor = vec4(tonemapFarTerrain(shadedColor), 1.0);
}
`;
