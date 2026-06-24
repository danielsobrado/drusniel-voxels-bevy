import * as THREE from "three";
import { MAX_TERRAIN_TEXTURES } from "./terrain_textures.js";

function lines(count: number, build: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => build(index)).join("\n");
}

// Albedo + normal are packed into two layered textures (one layer per material slot)
// rather than one sampler2D per slot. A fragment shader can only bind ~16 samplers, so
// 16 slots * 2 maps = 32 individual samplers would fail to link; two array samplers fit.
function buildTextureUniformDecls(): string {
  return "  uniform sampler2DArray uTerrainAlbedoArray;";
}

function buildNormalUniformDecls(): string {
  return "  uniform sampler2DArray uTerrainNormalArray;";
}

function buildProceduralUniformDecls(): string {
  return `  uniform bool uUseProceduralTerrain;
  uniform sampler2D uProceduralNoiseA;
  uniform sampler2D uProceduralNoiseB;
  uniform int uProceduralDebugMode;
  uniform float uProceduralMicroFadeStart;
  uniform float uProceduralMicroFadeEnd;
  uniform float uProceduralLodBias;
  uniform vec4 uProceduralScales;
  uniform vec4 uProceduralSnowMask;
  uniform vec4 uProceduralWetMask;
  uniform vec4 uProceduralSlopeMasks;
  uniform vec4 uProceduralTintStrengths;
  uniform vec4 uProceduralMaterialRoughness;
  uniform vec3 uProceduralMossTint;
  uniform vec3 uProceduralGravelTint;
  uniform vec3 uProceduralWetTint;
  uniform vec3 uProceduralSnowTint;`;
}

function buildPaintFallbackFn(): string {
  const colors = [
    "vec3(0.42, 0.58, 0.30)", "vec3(0.55, 0.52, 0.50)",
    "vec3(0.85, 0.78, 0.55)", "vec3(0.96, 0.97, 1.00)",
    "vec3(0.62, 0.48, 0.36)", "vec3(0.72, 0.70, 0.68)",
    "vec3(0.38, 0.52, 0.44)", "vec3(0.78, 0.74, 0.62)",
    "vec3(0.50, 0.56, 0.64)", "vec3(0.66, 0.58, 0.52)",
    "vec3(0.44, 0.46, 0.50)", "vec3(0.58, 0.62, 0.48)",
    "vec3(0.74, 0.66, 0.58)", "vec3(0.52, 0.44, 0.40)",
    "vec3(0.68, 0.72, 0.76)", "vec3(0.82, 0.80, 0.74)",
  ];
  // Expose per-slot fallback colours through a function rather than a `const vec3[]`
  // constructor with initializer (cleaner and avoids array-init pitfalls).
  const branches = lines(
    MAX_TERRAIN_TEXTURES,
    (i) => `    if (slot == ${i}) return ${colors[i] ?? colors[i % 4]};`,
  );
  return `  vec3 paintFallbackColor(int slot) {
${branches}
    return vec3(0.0);
  }`;
}

// ES 3.00 allows a dynamic layer index into a texture array (a dynamic index into an
// array of samplers is NOT allowed), so these collapse to a single sampled layer.
function buildSampleTextureSlot(): string {
  return `  vec3 sampleTextureSlot(int slot, vec3 worldPos) {
    return triplanarSample(float(slot), worldPos, uTextureScales[slot]);
  }`;
}

function buildSamplePaintTextureSlot(): string {
  return `  vec3 samplePaintTextureSlot(int slot, vec3 worldPos) {
    return texture(uTerrainAlbedoArray, vec3(worldPos.xz * uTextureScales[slot], float(slot))).rgb;
  }`;
}

function buildSampleNormalSlot(): string {
  return `  vec3 sampleNormalSlot(int slot, vec3 worldPos, vec3 baseN) {
    return uNormalMapMask[slot] > 0.5 ? triplanarNormal(float(slot), worldPos, uTextureScales[slot], baseN) : baseN;
  }`;
}

function buildSampleTerrainNormal(): string {
  const accum = lines(MAX_TERRAIN_TEXTURES, (i) => {
    const active = i === 0 ? "" : `    if (uTerrainTextureCount <= ${i}) return normalize(acc / wsum);\n`;
    const weight = i === 0
      ? "    float w = rangeWeight(height, uTextureRanges[0]);"
      : `    w = uTerrainTextureCount > ${i} ? rangeWeight(height, uTextureRanges[${i}]) : 0.0;`;
    return `${active}    vec3 n${i} = sampleNormalSlot(${i}, worldPos, baseN);
${weight}
    acc += n${i} * w;
    wsum += w;`;
  });
  return `  vec3 sampleTerrainNormal(vec3 worldPos, vec3 baseN) {
    float height = worldPos.y;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${accum}
    if (wsum > 0.0) return normalize(acc / wsum);
    return baseN;
  }`;
}

function buildSampleTerrainTexture(): string {
  const accum = lines(MAX_TERRAIN_TEXTURES, (i) => {
    const active = i === 0 ? "" : `    if (uTerrainTextureCount <= ${i}) {
      if (wsum > 0.0) return acc / wsum;
      return nearest;
    }
`;
    const weight = i === 0
      ? "    float w = rangeWeight(height, uTextureRanges[0]);"
      : `    w = uTerrainTextureCount > ${i} ? rangeWeight(height, uTextureRanges[${i}]) : 0.0;`;
    const nearest = i === 0
      ? "    vec3 nearest = t0;\n    float best = centerDistance(height, uTextureRanges[0]);"
      : `    if (uTerrainTextureCount > ${i} && centerDistance(height, uTextureRanges[${i}]) < best) {
      nearest = t${i};
      best = centerDistance(height, uTextureRanges[${i}]);
    }`;
    return `${active}    vec3 t${i} = sampleTextureSlot(${i}, worldPos);
${weight}
    acc += t${i} * w;
    wsum += w;
${nearest}`;
  });
  return `  vec3 sampleTerrainTexture(vec3 worldPos) {
    float height = worldPos.y;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${accum}
    if (wsum > 0.0) return acc / wsum;
    return nearest;
  }`;
}

// Painted terrain blends up to 4 (slot, weight) channels carried per vertex (vPaintSlots /
// vPaintWeights, matching terrain.ts PAINT_BLEND_CHANNELS = 4). The interpolated weights give
// a smooth fade into natural terrain and a smooth blend between painted materials.
const PAINT_CHANNELS = ["x", "y", "z", "w"] as const;

function buildPaintedAlbedo(): string {
  const body = PAINT_CHANNELS.map(
    (c) => `    if (vPaintWeights.${c} > 0.0 && vPaintSlots.${c} > -0.5) {
      acc += samplePaintTextureSlot(int(vPaintSlots.${c} + 0.5), worldPos) * vPaintWeights.${c};
      wsum += vPaintWeights.${c};
    }`,
  ).join("\n");
  return `  vec3 blendPaintedAlbedo(vec3 worldPos) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${body}
    return wsum > 0.0 ? acc / wsum : vec3(0.0);
  }`;
}

function buildPaintedNormal(): string {
  const body = PAINT_CHANNELS.map(
    (c) => `    if (vPaintWeights.${c} > 0.0 && vPaintSlots.${c} > -0.5) {
      acc += sampleNormalSlot(int(vPaintSlots.${c} + 0.5), worldPos, baseN) * vPaintWeights.${c};
      wsum += vPaintWeights.${c};
    }`,
  ).join("\n");
  return `  vec3 blendPaintedNormal(vec3 worldPos, vec3 baseN) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${body}
    return wsum > 0.0 ? normalize(acc / wsum) : baseN;
  }`;
}

function buildPaintedFallback(): string {
  const body = PAINT_CHANNELS.map(
    (c) => `    if (vPaintWeights.${c} > 0.0 && vPaintSlots.${c} > -0.5) {
      acc += paintFallbackColor(int(vPaintSlots.${c} + 0.5)) * vPaintWeights.${c};
      wsum += vPaintWeights.${c};
    }`,
  ).join("\n");
  return `  vec3 blendPaintedFallback() {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
${body}
    return wsum > 0.0 ? acc / wsum : vec3(0.0);
  }`;
}

export function buildTerrainFragmentShader(): string {
  return /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  uniform float uFade;
  uniform bool uDither;
  uniform bool uFadeIn;
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
${buildTextureUniformDecls()}
${buildProceduralUniformDecls()}
  uniform bool uUseNormalMap;
  uniform float uNormalIntensity;
  uniform float uRoughness;
  uniform float uMetalness;
  uniform float uNormalMapMask[${MAX_TERRAIN_TEXTURES}];
${buildNormalUniformDecls()}
  uniform float uTextureScales[${MAX_TERRAIN_TEXTURES}];
  uniform bool uTextureBlendBands;
  uniform float uTextureBlendWidth;
  uniform vec2 uTextureRanges[${MAX_TERRAIN_TEXTURES}];
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec4 vPaintSlots;
  varying vec4 vPaintWeights;

${buildPaintFallbackFn()}

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
  vec4 proceduralNoiseA(vec3 worldPos, float scale) {
    return texture(uProceduralNoiseA, worldPos.xz / max(scale, 0.001));
  }
  vec4 proceduralNoiseB(vec3 worldPos, float scale) {
    return texture(uProceduralNoiseB, worldPos.xz / max(scale, 0.001));
  }
  float proceduralMicroWeight(vec3 worldPos) {
    if (!uUseProceduralTerrain) return 1.0;
    float dist = length(cameraPosition - worldPos) + max(uProceduralLodBias, 0.0);
    return 1.0 - smoothstep(uProceduralMicroFadeStart, max(uProceduralMicroFadeEnd, uProceduralMicroFadeStart + 0.001), dist);
  }
  vec3 proceduralMacroTint(vec3 baseColor, vec3 worldPos, vec3 normalWs) {
    vec4 na = proceduralNoiseA(worldPos, uProceduralScales.x);
    vec4 nb = proceduralNoiseB(worldPos, uProceduralScales.y);
    float macroMix = na.r * 0.65 + na.g * 0.35;
    float upness = clamp(normalWs.y * 0.5 + 0.5, 0.0, 1.0);
    float slope = clamp(1.0 - upness, 0.0, 1.0);
    vec3 tinted = baseColor * (1.0 + (macroMix - 0.5) * 0.16);
    float snowMask = smoothstep(uProceduralSnowMask.x, uProceduralSnowMask.y, worldPos.y) * smoothstep(uProceduralSnowMask.z, uProceduralSnowMask.w, upness);
    float mossMask = smoothstep(uProceduralSlopeMasks.x, uProceduralSlopeMasks.y, upness) * nb.a;
    float gravelMask = smoothstep(uProceduralSlopeMasks.z, uProceduralSlopeMasks.w, slope);
    float wetMask = (1.0 - smoothstep(uProceduralWetMask.x, uProceduralWetMask.y, worldPos.y)) * smoothstep(uProceduralWetMask.z, uProceduralWetMask.w, upness);
    tinted = mix(tinted, uProceduralSnowTint, snowMask * uProceduralTintStrengths.x);
    tinted = mix(tinted, uProceduralMossTint, mossMask * uProceduralTintStrengths.y);
    tinted = mix(tinted, uProceduralGravelTint, gravelMask * uProceduralTintStrengths.z);
    tinted = mix(tinted, uProceduralWetTint, wetMask * uProceduralTintStrengths.w);
    return max(tinted, vec3(0.0));
  }
  float proceduralRoughness(vec3 worldPos, vec4 weights) {
    float base = uRoughness;
    if (uTerrainTextureCount > 0 && dot(weights, vec4(1.0)) > 0.001) {
      base = clamp(
        dot(weights, uProceduralMaterialRoughness),
        0.04,
        1.0
      );
    }
    float wet = 1.0 - smoothstep(uProceduralWetMask.x, uProceduralWetMask.y, worldPos.y);
    return mix(base, uProceduralScales.w, wet * 0.45);
  }
  vec3 proceduralDebugColor(vec3 worldPos, vec3 normalWs, vec4 paintWeights, vec3 litNormal, float roughness) {
    if (uProceduralDebugMode == 1) {
      float m = proceduralNoiseA(worldPos, uProceduralScales.x).r;
      return vec3(m);
    }
    if (uProceduralDebugMode == 2) {
      return vec3(paintWeights.x + paintWeights.y * 0.25, paintWeights.z, paintWeights.w);
    }
    if (uProceduralDebugMode == 3) {
      float height = worldPos.y;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < ${MAX_TERRAIN_TEXTURES}; i++) {
        if (i >= uTerrainTextureCount) break;
        float w = rangeWeight(height, uTextureRanges[i]);
        acc += paintFallbackColor(i) * w;
        wsum += w;
      }
      return wsum > 0.0 ? acc / wsum : vec3(0.0);
    }
    if (uProceduralDebugMode == 4) {
      return vec3(proceduralMicroWeight(worldPos));
    }
    if (uProceduralDebugMode == 5) {
      return vec3(roughness);
    }
    if (uProceduralDebugMode == 6) {
      return uColor;
    }
    if (uProceduralDebugMode == 7) {
      vec3 gN = normalize(cross(dFdx(worldPos), dFdy(worldPos)));
      float stress = 1.0 - abs(dot(normalize(litNormal), gN));
      return vec3(stress * 8.0);
    }
    return vec3(-1.0);
  }
  vec3 triplanarWeights(vec3 worldNormal) {
    vec3 a = abs(worldNormal);
    vec3 w = vec3(pow(a.x, 4.0), pow(a.y, 4.0), pow(a.z, 4.0));
    return w / max(w.x + w.y + w.z, 0.001);
  }
  vec3 triplanarSample(float layer, vec3 worldPos, float scale) {
    if (!uUseTriplanar) {
      return texture(uTerrainAlbedoArray, vec3(worldPos.xz * scale, layer)).rgb;
    }
    vec3 w = triplanarWeights(normalize(vWorldNormal));
    vec3 cy = texture(uTerrainAlbedoArray, vec3(worldPos.yz * scale, layer)).rgb;
    vec3 cz = texture(uTerrainAlbedoArray, vec3(worldPos.xz * scale, layer)).rgb;
    vec3 cx = texture(uTerrainAlbedoArray, vec3(worldPos.xy * scale, layer)).rgb;
    return cy * w.x + cz * w.y + cx * w.z;
  }
  vec3 unpackNormalMap(vec3 s) { return normalize(s * 2.0 - 1.0); }
  vec3 reorientNormal(vec3 tn, vec3 wn, int axis) {
    vec3 n = normalize(vec3(tn.xy * uNormalIntensity, tn.z));
    if (axis == 0) return normalize(vec3(n.z * sign(wn.x), n.y, n.x));
    if (axis == 1) return normalize(vec3(n.x, n.z * sign(wn.y), n.y));
    return normalize(vec3(n.x, n.y, n.z * sign(wn.z)));
  }
  vec3 triplanarNormal(float layer, vec3 worldPos, float scale, vec3 wn) {
    vec3 w = triplanarWeights(wn);
    vec3 n0 = reorientNormal(unpackNormalMap(texture(uTerrainNormalArray, vec3(worldPos.yz * scale, layer)).rgb), wn, 0);
    vec3 n1 = reorientNormal(unpackNormalMap(texture(uTerrainNormalArray, vec3(worldPos.xz * scale, layer)).rgb), wn, 1);
    vec3 n2 = reorientNormal(unpackNormalMap(texture(uTerrainNormalArray, vec3(worldPos.xy * scale, layer)).rgb), wn, 2);
    return normalize(n0 * w.x + n1 * w.y + n2 * w.z);
  }
${buildSampleTextureSlot()}
${buildSamplePaintTextureSlot()}
${buildSampleNormalSlot()}
${buildSampleTerrainNormal()}
${buildSampleTerrainTexture()}
${buildPaintedAlbedo()}
${buildPaintedNormal()}
${buildPaintedFallback()}
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
    if (uDither) {
      float n = ign(gl_FragCoord.xy);
      if (uFadeIn) {
        if (n > uFade) discard;
      } else {
        if (n <= 1.0 - uFade) discard;
      }
    }
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
    vec3 geomN = normalize(vWorldNormal);
    vec3 n = geomN;
    float paint = clamp(dot(vPaintWeights, vec4(1.0)), 0.0, 1.0);
    if (uUseNormalMap && uTerrainTextureCount > 0) {
      vec3 detailN = sampleTerrainNormal(vWorldPos, n);
      if (paint > 0.0) {
        detailN = mix(detailN, blendPaintedNormal(vWorldPos, geomN), paint);
      }
      n = normalize(mix(geomN, detailN, proceduralMicroWeight(vWorldPos)));
    }
    float sun = max(dot(n, normalize(uLight)), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 baseColor = uColor;
    if (uUseTexture) {
      vec3 tex = sampleTerrainTexture(vWorldPos);
      if (uUseProceduralTerrain) {
        tex = proceduralMacroTint(tex, vWorldPos, n);
      }
      if (paint > 0.0) {
        tex = mix(tex, blendPaintedAlbedo(vWorldPos), paint);
      }
      baseColor = tex * mix(vec3(1.0), uColor, 0.35);
    } else if (paint > 0.0) {
      baseColor = mix(uColor, blendPaintedFallback(), paint);
    }
    baseColor = adjustColor(baseColor);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 light = hemi + uSunColor * pow(sun, 1.35);
    float rough = clamp(uRoughness, 0.04, 1.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 halfVec = normalize(normalize(uLight) + viewDir);
    if (uUseProceduralTerrain) {
      rough = proceduralRoughness(vWorldPos, vPaintWeights);
      vec3 debugColor = proceduralDebugColor(vWorldPos, n, vPaintWeights, n, rough);
      if (debugColor.x >= 0.0) {
        gl_FragColor = vec4(debugColor, 1.0);
        return;
      }
    }
    float shininess = mix(128.0, 4.0, rough);
    float spec = pow(max(dot(n, halfVec), 0.0), shininess) * (1.0 - rough) * sun;
    vec3 specColor = mix(vec3(1.0), baseColor, uMetalness);
    vec3 diffuse = baseColor * light * (1.0 - 0.85 * uMetalness);
    gl_FragColor = vec4(diffuse + uSunColor * spec * specColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

export function createTerrainTextureUniforms(): Record<string, { value: unknown }> {
  const uniforms: Record<string, { value: unknown }> = {
    uColor: { value: new THREE.Color(0xb9c0c8) },
    uLight: { value: new THREE.Vector3(-0.35, 0.82, 0.45).normalize() },
    uSunColor: { value: new THREE.Color(0.95, 0.86, 0.68) },
    uSkyLight: { value: new THREE.Color(0.42, 0.48, 0.58) },
    uGroundLight: { value: new THREE.Color(0.18, 0.16, 0.13) },
    uFade: { value: 1 },
    uDither: { value: false },
    uFadeIn: { value: true },
    uNormalColor: { value: false },
    uNormalDivergence: { value: false },
    uDivergenceGain: { value: 8.0 },
    uBrightness: { value: 1.0 },
    uContrast: { value: 1.0 },
    uSaturation: { value: 1.0 },
    uWarmth: { value: 0.0 },
    uUseTexture: { value: false },
    uUseTriplanar: { value: true },
    uTerrainTextureCount: { value: 0 },
    uUseProceduralTerrain: { value: false },
    uProceduralNoiseA: { value: null },
    uProceduralNoiseB: { value: null },
    uProceduralDebugMode: { value: 0 },
    uProceduralMicroFadeStart: { value: 45 },
    uProceduralMicroFadeEnd: { value: 85 },
    uProceduralLodBias: { value: 0 },
    uProceduralScales: { value: new THREE.Vector4(50, 4, 16, 0.35) },
    uProceduralSnowMask: { value: new THREE.Vector4(76, 130, 0.58, 0.92) },
    uProceduralWetMask: { value: new THREE.Vector4(18, 28, 0.42, 0.86) },
    uProceduralSlopeMasks: { value: new THREE.Vector4(0.55, 0.92, 0.28, 0.72) },
    uProceduralTintStrengths: { value: new THREE.Vector4(0.22, 0.08, 0.10, 0.20) },
    uProceduralMaterialRoughness: { value: new THREE.Vector4(0.85, 0.78, 0.95, 0.92) },
    uProceduralMossTint: { value: new THREE.Vector3(0.18, 0.32, 0.13) },
    uProceduralGravelTint: { value: new THREE.Vector3(0.42, 0.41, 0.39) },
    uProceduralWetTint: { value: new THREE.Vector3(0.18, 0.15, 0.12) },
    uProceduralSnowTint: { value: new THREE.Vector3(0.86, 0.89, 0.90) },
    uUseNormalMap: { value: false },
    uNormalIntensity: { value: 1.0 },
    uRoughness: { value: 0.9 },
    uMetalness: { value: 0.0 },
    uNormalMapMask: { value: new Float32Array(MAX_TERRAIN_TEXTURES) },
    uTextureScales: { value: new Float32Array(MAX_TERRAIN_TEXTURES).fill(1 / 64) },
    uTextureBlendBands: { value: false },
    uTextureBlendWidth: { value: 6 },
    uTextureRanges: {
      value: Array.from({ length: MAX_TERRAIN_TEXTURES }, () => new THREE.Vector2(0, 0)),
    },
    // Layered albedo/normal textures (one layer per slot); null binds three.js' empty
    // array texture, which is safe to sample.
    uTerrainAlbedoArray: { value: null },
    uTerrainNormalArray: { value: null },
  };
  return uniforms;
}

export interface TerrainTextureSlotUniform {
  texture: THREE.Texture | null;
  normalTexture: THREE.Texture | null;
  scale: number;
  heightMin: number;
  heightMax: number;
}

export function applyTerrainTextureUniforms(
  mat: THREE.ShaderMaterial,
  slots: readonly TerrainTextureSlotUniform[],
  options: {
    enabled: boolean;
    triplanar: boolean;
    normalMap: boolean;
    normalIntensity: number;
    roughness: number;
    metalness: number;
    textureScale: number;
    blendBands: boolean;
    blendWidth: number;
    albedoArray: THREE.DataArrayTexture | null;
    normalArray: THREE.DataArrayTexture | null;
    procedural?: {
      enabled: boolean;
      noiseA: THREE.Texture | null;
      noiseB: THREE.Texture | null;
      debugMode: number;
      microFadeStart: number;
      microFadeEnd: number;
      lodBias: number;
      scales?: readonly number[];
      snowMask?: readonly number[];
      wetMask?: readonly number[];
      slopeMasks?: readonly number[];
      tintStrengths?: readonly number[];
      materialRoughness?: readonly number[];
      mossTint?: readonly number[];
      gravelTint?: readonly number[];
      wetTint?: readonly number[];
      snowTint?: readonly number[];
      normalMapMask?: Float32Array | readonly number[];
    };
    painted?: boolean;
  },
): void {
  mat.uniforms.uUseTexture.value = options.enabled;
  mat.uniforms.uUseTriplanar.value = options.triplanar;
  mat.uniforms.uUseNormalMap.value = options.normalMap;
  mat.uniforms.uNormalIntensity.value = options.normalIntensity;
  mat.uniforms.uRoughness.value = options.roughness;
  mat.uniforms.uMetalness.value = options.metalness;
  mat.uniforms.uTerrainTextureCount.value = slots.length;
  mat.uniforms.uTextureBlendBands.value = options.blendBands;
  mat.uniforms.uTextureBlendWidth.value = options.blendWidth;
  mat.uniforms.uTerrainAlbedoArray.value = options.albedoArray;
  mat.uniforms.uTerrainNormalArray.value = options.normalArray;
  mat.uniforms.uUseProceduralTerrain.value = options.procedural?.enabled ?? false;
  mat.uniforms.uProceduralNoiseA.value = options.procedural?.noiseA ?? null;
  mat.uniforms.uProceduralNoiseB.value = options.procedural?.noiseB ?? null;
  mat.uniforms.uProceduralDebugMode.value = options.procedural?.debugMode ?? 0;
  mat.uniforms.uProceduralMicroFadeStart.value = options.procedural?.microFadeStart ?? 45;
  mat.uniforms.uProceduralMicroFadeEnd.value = options.procedural?.microFadeEnd ?? 85;
  mat.uniforms.uProceduralLodBias.value = options.procedural?.lodBias ?? 0;
  const p = options.procedural;
  (mat.uniforms.uProceduralScales.value as THREE.Vector4).fromArray(p?.scales ?? [50, 4, 16, 0.35]);
  (mat.uniforms.uProceduralSnowMask.value as THREE.Vector4).fromArray(p?.snowMask ?? [76, 130, 0.58, 0.92]);
  (mat.uniforms.uProceduralWetMask.value as THREE.Vector4).fromArray(p?.wetMask ?? [18, 28, 0.42, 0.86]);
  (mat.uniforms.uProceduralSlopeMasks.value as THREE.Vector4).fromArray(p?.slopeMasks ?? [0.55, 0.92, 0.28, 0.72]);
  (mat.uniforms.uProceduralTintStrengths.value as THREE.Vector4).fromArray(p?.tintStrengths ?? [0.22, 0.08, 0.10, 0.20]);
  (mat.uniforms.uProceduralMaterialRoughness.value as THREE.Vector4).fromArray(p?.materialRoughness ?? [0.85, 0.78, 0.95, 0.92]);
  (mat.uniforms.uProceduralMossTint.value as THREE.Vector3).fromArray(p?.mossTint ?? [0.18, 0.32, 0.13]);
  (mat.uniforms.uProceduralGravelTint.value as THREE.Vector3).fromArray(p?.gravelTint ?? [0.42, 0.41, 0.39]);
  (mat.uniforms.uProceduralWetTint.value as THREE.Vector3).fromArray(p?.wetTint ?? [0.18, 0.15, 0.12]);
  (mat.uniforms.uProceduralSnowTint.value as THREE.Vector3).fromArray(p?.snowTint ?? [0.86, 0.89, 0.90]);
  const scales = mat.uniforms.uTextureScales.value as Float32Array;
  const masks = mat.uniforms.uNormalMapMask.value as Float32Array;
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    const slot = slots[i];
    scales[i] = (slot?.scale ?? 1 / 64) * options.textureScale;
    masks[i] = options.procedural?.normalMapMask?.[i] ?? (slot?.normalTexture ? 1 : 0);
    (mat.uniforms.uTextureRanges.value as THREE.Vector2[])[i].set(slot?.heightMin ?? 0, slot?.heightMax ?? 0);
  }
}
