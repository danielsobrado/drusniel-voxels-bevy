import * as THREE from "three";
import { resolveTerrainTextureScale } from "./material/terrain_texture_scale.js";
import { MAX_TERRAIN_TEXTURES } from "./terrain_textures.js";

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
  const procedural = options.procedural?.enabled === true;
  for (let i = 0; i < MAX_TERRAIN_TEXTURES; i++) {
    const slot = slots[i];
    scales[i] = resolveTerrainTextureScale(slot?.scale ?? 1 / 64, options.textureScale, procedural);
    masks[i] = options.procedural?.normalMapMask?.[i] ?? (slot?.normalTexture ? 1 : 0);
    (mat.uniforms.uTextureRanges.value as THREE.Vector2[])[i].set(slot?.heightMin ?? 0, slot?.heightMax ?? 0);
  }
}
