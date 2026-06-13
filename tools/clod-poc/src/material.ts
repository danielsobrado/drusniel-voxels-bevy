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
  attribute vec4 material;       // per-vertex paint: one-hot texture slot, or all-zero for natural terrain
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vMaterial;
  void main() {
    vWorldPos = position;
    vWorldNormal = normal;
    vMaterial = material;
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
  uniform bool uUseTriplanar;
  uniform int uTerrainTextureCount;
  uniform sampler2D uTerrainTexture0;
  uniform sampler2D uTerrainTexture1;
  uniform sampler2D uTerrainTexture2;
  uniform sampler2D uTerrainTexture3;
  uniform bool uUseNormalMap;
  uniform float uNormalIntensity;
  uniform float uRoughness;
  uniform float uMetalness;
  uniform vec4 uNormalMapMask;   // per-slot 1.0 when a normal map is loaded
  uniform sampler2D uTerrainNormal0;
  uniform sampler2D uTerrainNormal1;
  uniform sampler2D uTerrainNormal2;
  uniform sampler2D uTerrainNormal3;
  uniform vec4 uTextureScales;
  uniform bool uTextureBlendBands;
  uniform float uTextureBlendWidth;
  uniform vec2 uTextureRange0;
  uniform vec2 uTextureRange1;
  uniform vec2 uTextureRange2;
  uniform vec2 uTextureRange3;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vMaterial;

  // Fallback tints for painted deposits when no terrain textures are loaded — one per slot
  // (low / mid-low / mid-high / high), so the chosen material is still visible.
  const vec3 PAINT_FALLBACK[4] = vec3[4](
    vec3(0.42, 0.58, 0.30), vec3(0.55, 0.52, 0.50),
    vec3(0.85, 0.78, 0.55), vec3(0.96, 0.97, 1.00)
  );

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
  // Triplanar mapping ported from the engine shader
  // (assets/shaders/triplanar_terrain.wgsl). Mirrors triplanar_weights():
  // pow(abs(normal), blend_sharpness) normalized. blend_sharpness = 4.0 (engine default).
  vec3 triplanarWeights(vec3 worldNormal) {
    vec3 a = abs(worldNormal);
    vec3 w = vec3(pow(a.x, 4.0), pow(a.y, 4.0), pow(a.z, 4.0));
    return w / max(w.x + w.y + w.z, 0.001);
  }
  // Mirrors sample_albedo_tp()'s three-plane projection: yz -> w.x, xz -> w.y, xy -> w.z.
  // Engine compute_uv divides world coords by tex_scale; uTextureScales holds the
  // reciprocal here, so the multiply matches.
  vec3 triplanarSample(sampler2D tex, vec3 worldPos, float scale) {
    if (!uUseTriplanar) {
      // Planar (top-down) projection — stretches on vertical faces; kept for comparison.
      return texture2D(tex, worldPos.xz * scale).rgb;
    }
    vec3 w = triplanarWeights(normalize(vWorldNormal));
    vec3 cy = texture2D(tex, worldPos.yz * scale).rgb;
    vec3 cz = texture2D(tex, worldPos.xz * scale).rgb;
    vec3 cx = texture2D(tex, worldPos.xy * scale).rgb;
    return cy * w.x + cz * w.y + cx * w.z;
  }
  // Normal-map path ported from the engine shader: unpack_normal() + reorient_normal()
  // + the three-plane blend in sample_normal_tp(). Reorient swizzles the tangent normal
  // into world space per projection axis, keyed by the sign of the geometric normal.
  vec3 unpackNormalMap(vec3 s) { return normalize(s * 2.0 - 1.0); }
  vec3 reorientNormal(vec3 tn, vec3 wn, int axis) {
    vec3 n = normalize(vec3(tn.xy * uNormalIntensity, tn.z));
    if (axis == 0) return normalize(vec3(n.z * sign(wn.x), n.y, n.x));
    if (axis == 1) return normalize(vec3(n.x, n.z * sign(wn.y), n.y));
    return normalize(vec3(n.x, n.y, n.z * sign(wn.z)));
  }
  vec3 triplanarNormal(sampler2D nmap, vec3 worldPos, float scale, vec3 wn) {
    vec3 w = triplanarWeights(wn);
    vec3 n0 = reorientNormal(unpackNormalMap(texture2D(nmap, worldPos.yz * scale).rgb), wn, 0);
    vec3 n1 = reorientNormal(unpackNormalMap(texture2D(nmap, worldPos.xz * scale).rgb), wn, 1);
    vec3 n2 = reorientNormal(unpackNormalMap(texture2D(nmap, worldPos.xy * scale).rgb), wn, 2);
    return normalize(n0 * w.x + n1 * w.y + n2 * w.z);
  }
  // Blend per-slot normal maps by the same height bands as the albedo. Slots without a
  // normal map (mask 0) contribute the geometric normal so they stay flat-shaded.
  vec3 sampleTerrainNormal(vec3 worldPos, vec3 baseN) {
    float height = worldPos.y;
    vec3 n0 = uNormalMapMask.x > 0.5 ? triplanarNormal(uTerrainNormal0, worldPos, uTextureScales.x, baseN) : baseN;
    if (uTerrainTextureCount <= 1) return n0;
    vec3 n1 = uNormalMapMask.y > 0.5 ? triplanarNormal(uTerrainNormal1, worldPos, uTextureScales.y, baseN) : baseN;
    vec3 n2 = uNormalMapMask.z > 0.5 ? triplanarNormal(uTerrainNormal2, worldPos, uTextureScales.z, baseN) : baseN;
    vec3 n3 = uNormalMapMask.w > 0.5 ? triplanarNormal(uTerrainNormal3, worldPos, uTextureScales.w, baseN) : baseN;
    float w0 = rangeWeight(height, uTextureRange0);
    float w1 = uTerrainTextureCount > 1 ? rangeWeight(height, uTextureRange1) : 0.0;
    float w2 = uTerrainTextureCount > 2 ? rangeWeight(height, uTextureRange2) : 0.0;
    float w3 = uTerrainTextureCount > 3 ? rangeWeight(height, uTextureRange3) : 0.0;
    float wsum = w0 + w1 + w2 + w3;
    if (wsum > 0.0) return normalize((n0 * w0 + n1 * w1 + n2 * w2 + n3 * w3) / wsum);
    return baseN;
  }
  vec3 sampleTerrainTexture(vec3 worldPos) {
    float height = worldPos.y;
    vec3 t0 = triplanarSample(uTerrainTexture0, worldPos, uTextureScales.x);
    if (uTerrainTextureCount <= 1) return t0;

    vec3 t1 = triplanarSample(uTerrainTexture1, worldPos, uTextureScales.y);
    vec3 t2 = triplanarSample(uTerrainTexture2, worldPos, uTextureScales.z);
    vec3 t3 = triplanarSample(uTerrainTexture3, worldPos, uTextureScales.w);

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
    if (uUseNormalMap && uTerrainTextureCount > 0) {
      n = sampleTerrainNormal(vWorldPos, n);
    }
    float sun = max(dot(n, normalize(uLight)), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    float paint = clamp(vMaterial.x + vMaterial.y + vMaterial.z + vMaterial.w, 0.0, 1.0);
    vec3 baseColor = uColor;
    if (uUseTexture) {
      vec3 tex = sampleTerrainTexture(vWorldPos);
      if (paint > 0.0) {
        // painted deposit: force the chosen texture slot instead of the height band
        vec3 painted = vMaterial.x * triplanarSample(uTerrainTexture0, vWorldPos, uTextureScales.x)
                     + vMaterial.y * triplanarSample(uTerrainTexture1, vWorldPos, uTextureScales.y)
                     + vMaterial.z * triplanarSample(uTerrainTexture2, vWorldPos, uTextureScales.z)
                     + vMaterial.w * triplanarSample(uTerrainTexture3, vWorldPos, uTextureScales.w);
        tex = mix(tex, painted, paint);
      }
      baseColor = tex * mix(vec3(1.0), uColor, 0.35);
    } else if (paint > 0.0) {
      // no textures loaded: tint the deposit by its slot's fallback colour so it still reads
      vec3 fb = vMaterial.x * PAINT_FALLBACK[0] + vMaterial.y * PAINT_FALLBACK[1]
              + vMaterial.z * PAINT_FALLBACK[2] + vMaterial.w * PAINT_FALLBACK[3];
      baseColor = mix(uColor, fb, paint);
    }
    baseColor = adjustColor(baseColor);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 light = hemi + uSunColor * pow(sun, 1.35);
    // Simplified roughness/metalness specular. The engine drives full PBR; here a
    // Blinn-Phong lobe maps roughness -> highlight tightness/strength, and metalness
    // tints the highlight with albedo while suppressing diffuse (conductor look).
    float rough = clamp(uRoughness, 0.04, 1.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 halfVec = normalize(normalize(uLight) + viewDir);
    float shininess = mix(128.0, 4.0, rough);
    float spec = pow(max(dot(n, halfVec), 0.0), shininess) * (1.0 - rough) * sun;
    vec3 specColor = mix(vec3(1.0), baseColor, uMetalness);
    vec3 diffuse = baseColor * light * (1.0 - 0.85 * uMetalness);
    gl_FragColor = vec4(diffuse + uSunColor * spec * specColor, 1.0);
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
      uUseTriplanar: { value: true },
      uTerrainTextureCount: { value: 0 },
      uTerrainTexture0: { value: null },
      uTerrainTexture1: { value: null },
      uTerrainTexture2: { value: null },
      uTerrainTexture3: { value: null },
      uUseNormalMap: { value: false },
      uNormalIntensity: { value: 1.0 },
      uRoughness: { value: 0.9 },
      uMetalness: { value: 0.0 },
      uNormalMapMask: { value: new THREE.Vector4(0, 0, 0, 0) },
      uTerrainNormal0: { value: null },
      uTerrainNormal1: { value: null },
      uTerrainNormal2: { value: null },
      uTerrainNormal3: { value: null },
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
