// Dithered (screen-door) crossfade material. Plan §4.2.
//
// Topology-changing decimation can't geomorph cheaply, so the PoC crossfades with a
// screen-door dither over `crossfade_frames` when the cut changes. Our terrain meshes
// carry WORLD-space normals, so lighting uses them directly (no normalMatrix).

import * as THREE from "three";

export interface TerrainColorAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export const DEFAULT_TERRAIN_COLOR_ADJUSTMENTS: TerrainColorAdjustments = {
  brightness: 1.0,
  contrast: 1.0,
  saturation: 1.0,
  warmth: 0.0,
};

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vWorldPos = position;
    vWorldNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  uniform float uFade;   // 0 = fully dithered out, 1 = fully visible
  uniform bool uDither;
  uniform bool uNormalColor;
  uniform bool uNormalDivergence;
  uniform float uDivergenceGain;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uWarmth;
  uniform bool uUseTexture;
  uniform int uTerrainTextureCount;
  uniform sampler2D uTerrainTexture0;
  uniform sampler2D uTerrainTexture1;
  uniform sampler2D uTerrainTexture2;
  uniform sampler2D uTerrainTexture3;
  uniform vec4 uTextureScales;
  uniform bool uTextureBlendBands;
  uniform float uTextureBlendWidth;
  uniform vec2 uTextureRange0;
  uniform vec2 uTextureRange1;
  uniform vec2 uTextureRange2;
  uniform vec2 uTextureRange3;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  // interleaved-gradient noise — cheap stable screen-door threshold
  float ign(vec2 p) {
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  }
  float rangeWeight(float height, vec2 range) {
    if (!uTextureBlendBands) {
      return step(range.x, height) * step(height, range.y);
    }
    float width = max(uTextureBlendWidth, 0.0001);
    float aboveLow = smoothstep(range.x - width, range.x + width, height);
    float belowHigh = 1.0 - smoothstep(range.y - width, range.y + width, height);
    return aboveLow * belowHigh;
  }
  float centerDistance(float height, vec2 range) {
    return abs(height - (range.x + range.y) * 0.5);
  }
  vec3 sampleTerrainTexture(vec3 worldPos) {
    float height = worldPos.y;
    vec3 t0 = texture2D(uTerrainTexture0, worldPos.xz * uTextureScales.x).rgb;
    if (uTerrainTextureCount <= 1) return t0;

    vec3 t1 = texture2D(uTerrainTexture1, worldPos.xz * uTextureScales.y).rgb;
    vec3 t2 = texture2D(uTerrainTexture2, worldPos.xz * uTextureScales.z).rgb;
    vec3 t3 = texture2D(uTerrainTexture3, worldPos.xz * uTextureScales.w).rgb;

    float w0 = rangeWeight(height, uTextureRange0);
    float w1 = uTerrainTextureCount > 1 ? rangeWeight(height, uTextureRange1) : 0.0;
    float w2 = uTerrainTextureCount > 2 ? rangeWeight(height, uTextureRange2) : 0.0;
    float w3 = uTerrainTextureCount > 3 ? rangeWeight(height, uTextureRange3) : 0.0;
    float wsum = w0 + w1 + w2 + w3;
    if (wsum > 0.0) return (t0 * w0 + t1 * w1 + t2 * w2 + t3 * w3) / wsum;

    vec3 nearest = t0;
    float best = centerDistance(height, uTextureRange0);
    if (uTerrainTextureCount > 1 && centerDistance(height, uTextureRange1) < best) {
      nearest = t1;
      best = centerDistance(height, uTextureRange1);
    }
    if (uTerrainTextureCount > 2 && centerDistance(height, uTextureRange2) < best) {
      nearest = t2;
      best = centerDistance(height, uTextureRange2);
    }
    if (uTerrainTextureCount > 3 && centerDistance(height, uTextureRange3) < best) nearest = t3;
    return nearest;
  }
  vec3 adjustColor(vec3 color) {
    color *= uBrightness;

    color = (color - 0.5) * uContrast + 0.5;

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);

    vec3 warm = vec3(1.0 + uWarmth * 0.16, 1.0 + uWarmth * 0.05, 1.0 - uWarmth * 0.12);
    color *= warm;

    return max(color, vec3(0.0));
  }
  void main() {
    if (uDither && ign(gl_FragCoord.xy) > uFade) discard;
    if (uNormalDivergence) {
      vec3 gN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      float div = 1.0 - abs(dot(normalize(vWorldNormal), gN));
      gl_FragColor = vec4(vec3(div * uDivergenceGain), 1.0);
      return;
    }
    if (uNormalColor) {
      gl_FragColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
      return;
    }
    vec3 n = normalize(vWorldNormal);
    float sun = max(dot(n, normalize(uLight)), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 baseColor = uColor;
    if (uUseTexture) {
      vec3 tex = sampleTerrainTexture(vWorldPos);
      baseColor = tex * mix(vec3(1.0), uColor, 0.35);
    }
    baseColor = adjustColor(baseColor);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 light = hemi + uSunColor * pow(sun, 1.35);
    gl_FragColor = vec4(baseColor * light, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createTerrainMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uLight: { value: new THREE.Vector3(-0.35, 0.82, 0.45).normalize() },
      uSunColor: { value: new THREE.Color(0.95, 0.86, 0.68) },
      uSkyLight: { value: new THREE.Color(0.42, 0.48, 0.58) },
      uGroundLight: { value: new THREE.Color(0.18, 0.16, 0.13) },
      uFade: { value: 1 },
      uDither: { value: false },
      uNormalColor: { value: false },
      uNormalDivergence: { value: false },
      uDivergenceGain: { value: 8.0 },
      uBrightness: { value: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness },
      uContrast: { value: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast },
      uSaturation: { value: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation },
      uWarmth: { value: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth },
      uUseTexture: { value: false },
      uTerrainTextureCount: { value: 0 },
      uTerrainTexture0: { value: null },
      uTerrainTexture1: { value: null },
      uTerrainTexture2: { value: null },
      uTerrainTexture3: { value: null },
      uTextureScales: { value: new THREE.Vector4(1 / 64, 1 / 64, 1 / 64, 1 / 64) },
      uTextureBlendBands: { value: false },
      uTextureBlendWidth: { value: 6 },
      uTextureRange0: { value: new THREE.Vector2(14, 42) },
      uTextureRange1: { value: new THREE.Vector2(42, 70) },
      uTextureRange2: { value: new THREE.Vector2(70, 94) },
      uTextureRange3: { value: new THREE.Vector2(94, 118) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

export function applyTerrainColorAdjustments(
  material: THREE.ShaderMaterial,
  adjustments: TerrainColorAdjustments,
): void {
  material.uniforms.uBrightness.value = adjustments.brightness;
  material.uniforms.uContrast.value = adjustments.contrast;
  material.uniforms.uSaturation.value = adjustments.saturation;
  material.uniforms.uWarmth.value = adjustments.warmth;
}
