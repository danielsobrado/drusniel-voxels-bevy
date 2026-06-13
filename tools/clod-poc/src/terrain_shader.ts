import * as THREE from "three";
import { MAX_TERRAIN_TEXTURES } from "./terrain_textures.js";

function lines(count: number, build: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => build(index)).join("\n");
}

function buildTextureUniformDecls(): string {
  return lines(MAX_TERRAIN_TEXTURES, (i) => `  uniform sampler2D uTerrainTexture${i};`);
}

function buildNormalUniformDecls(): string {
  return lines(MAX_TERRAIN_TEXTURES, (i) => `  uniform sampler2D uTerrainNormal${i};`);
}

function buildPaintFallback(): string {
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
  return lines(MAX_TERRAIN_TEXTURES, (i) => `    ${colors[i] ?? colors[i % 4]}`);
}

function buildSampleTextureSlot(): string {
  const branches = lines(MAX_TERRAIN_TEXTURES, (i) =>
    `    if (slot == ${i}) return triplanarSample(uTerrainTexture${i}, worldPos, uTextureScales[${i}]);`,
  );
  return `  vec3 sampleTextureSlot(int slot, vec3 worldPos) {
${branches}
    return vec3(0.0);
  }`;
}

function buildSampleNormalSlot(): string {
  const branches = lines(MAX_TERRAIN_TEXTURES, (i) =>
    `    if (slot == ${i}) return uNormalMapMask[${i}] > 0.5 ? triplanarNormal(uTerrainNormal${i}, worldPos, uTextureScales[${i}], baseN) : baseN;`,
  );
  return `  vec3 sampleNormalSlot(int slot, vec3 worldPos, vec3 baseN) {
${branches}
    return baseN;
  }`;
}

function buildSampleTerrainNormal(): string {
  const accum = lines(MAX_TERRAIN_TEXTURES, (i) => {
    const active = i === 0 ? "" : `    if (uTerrainTextureCount <= ${i}) return normalize(acc / wsum);\n`;
    const weight = i === 0
      ? "    float w = rangeWeight(height, uTextureRanges[0]);"
      : `    float w = uTerrainTextureCount > ${i} ? rangeWeight(height, uTextureRanges[${i}]) : 0.0;`;
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
      : `    float w = uTerrainTextureCount > ${i} ? rangeWeight(height, uTextureRanges[${i}]) : 0.0;`;
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

function buildPaintFallbackMix(): string {
  return lines(MAX_TERRAIN_TEXTURES, (i) => {
    const prefix = i === 0 ? "      vec3 fb = " : "      fb += ";
    const slot = i + 1;
    const suffix = i === 0
      ? `float(vPaintSlot) == ${slot}.0 ? PAINT_FALLBACK[${i}] : vec3(0.0);`
      : `float(vPaintSlot) == ${slot}.0 ? PAINT_FALLBACK[${i}] : vec3(0.0);`;
    return `${prefix}${suffix}`;
  });
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
  varying float vPaintSlot;

  const vec3 PAINT_FALLBACK[${MAX_TERRAIN_TEXTURES}] = vec3[${MAX_TERRAIN_TEXTURES}](
${buildPaintFallback()}
  );

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
  vec3 triplanarWeights(vec3 worldNormal) {
    vec3 a = abs(worldNormal);
    vec3 w = vec3(pow(a.x, 4.0), pow(a.y, 4.0), pow(a.z, 4.0));
    return w / max(w.x + w.y + w.z, 0.001);
  }
  vec3 triplanarSample(sampler2D tex, vec3 worldPos, float scale) {
    if (!uUseTriplanar) {
      return texture2D(tex, worldPos.xz * scale).rgb;
    }
    vec3 w = triplanarWeights(normalize(vWorldNormal));
    vec3 cy = texture2D(tex, worldPos.yz * scale).rgb;
    vec3 cz = texture2D(tex, worldPos.xz * scale).rgb;
    vec3 cx = texture2D(tex, worldPos.xy * scale).rgb;
    return cy * w.x + cz * w.y + cx * w.z;
  }
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
${buildSampleTextureSlot()}
${buildSampleNormalSlot()}
${buildSampleTerrainNormal()}
${buildSampleTerrainTexture()}
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
    float paint = vPaintSlot > 0.5 ? 1.0 : 0.0;
    vec3 baseColor = uColor;
    if (uUseTexture) {
      vec3 tex = sampleTerrainTexture(vWorldPos);
      if (paint > 0.0) {
        int slot = int(vPaintSlot + 0.5) - 1;
        vec3 painted = sampleTextureSlot(slot, vWorldPos);
        tex = mix(tex, painted, paint);
      }
      baseColor = tex * mix(vec3(1.0), uColor, 0.35);
    } else if (paint > 0.0) {
${buildPaintFallbackMix()}
      baseColor = mix(uColor, fb, paint);
    }
    baseColor = adjustColor(baseColor);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 light = hemi + uSunColor * pow(sun, 1.35);
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
  };
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    uniforms[`uTerrainTexture${i}`] = { value: null };
    uniforms[`uTerrainNormal${i}`] = { value: null };
  }
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
  const scales = mat.uniforms.uTextureScales.value as Float32Array;
  const masks = mat.uniforms.uNormalMapMask.value as Float32Array;
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    const slot = slots[i];
    mat.uniforms[`uTerrainTexture${i}`].value = slot?.texture ?? null;
    mat.uniforms[`uTerrainNormal${i}`].value = slot?.normalTexture ?? null;
    scales[i] = (slot?.scale ?? 1 / 64) * options.textureScale;
    masks[i] = slot?.normalTexture ? 1 : 0;
    (mat.uniforms.uTextureRanges.value as THREE.Vector2[])[i].set(slot?.heightMin ?? 0, slot?.heightMax ?? 0);
  }
}
