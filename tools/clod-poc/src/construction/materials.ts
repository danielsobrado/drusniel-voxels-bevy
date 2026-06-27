import * as THREE from "three";
import { CONSTRUCTION_MATERIAL_ASSETS, CONSTRUCTION_MATERIAL_OPTIONS as MATERIAL_OPTIONS, type ConstructionMaterialAsset } from "./material_assets.js";
import { CONSTRUCTION_MATERIALS, type ConstructionMaterial } from "./types.js";

const DEFAULT_TEXTURE_REPEAT_U = 1.5;
const DEFAULT_TEXTURE_REPEAT_V = 1.0;
const DEFAULT_TEXTURE_ANISOTROPY = 8;
const DEFAULT_NORMAL_SCALE = 0.75;
const DEFAULT_AO_INTENSITY = 0.85;

interface PbrTextureSet {
  albedo?: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
  ao?: THREE.Texture;
}

export const CONSTRUCTION_MATERIAL_OPTIONS = MATERIAL_OPTIONS;

const cachedPbrTextures = new Map<ConstructionMaterial, PbrTextureSet>();

export function asConstructionMaterial(value: string): ConstructionMaterial | null {
  const normalized = value.trim().toLowerCase();
  return CONSTRUCTION_MATERIALS.includes(normalized as ConstructionMaterial)
    ? normalized as ConstructionMaterial
    : null;
}

export function constructionMaterialLabel(material: ConstructionMaterial): string {
  return CONSTRUCTION_MATERIAL_ASSETS[material]?.label ?? material;
}

function configurePbrTexture(texture: THREE.Texture, asset: ConstructionMaterialAsset, colorSpace: THREE.ColorSpace): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(asset.repeatU ?? DEFAULT_TEXTURE_REPEAT_U, asset.repeatV ?? DEFAULT_TEXTURE_REPEAT_V);
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = DEFAULT_TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
}

function loadPbrTexture(url: string, name: string, asset: ConstructionMaterialAsset, colorSpace: THREE.ColorSpace): THREE.Texture {
  const texture = new THREE.TextureLoader().load(
    url,
    (loadedTexture) => configurePbrTexture(loadedTexture, asset, colorSpace),
    undefined,
    (error) => console.warn(`[construction] failed to load PBR texture ${name}`, error),
  );
  texture.name = name;
  return texture;
}

function pbrTextures(asset: ConstructionMaterialAsset): PbrTextureSet {
  const cached = cachedPbrTextures.get(asset.id);
  if (cached) return cached;

  const textures: PbrTextureSet = {
    albedo: asset.textures.albedo
      ? loadPbrTexture(asset.textures.albedo, `${asset.id}-albedo`, asset, THREE.SRGBColorSpace)
      : undefined,
    normal: asset.textures.normal
      ? loadPbrTexture(asset.textures.normal, `${asset.id}-normal`, asset, THREE.NoColorSpace)
      : undefined,
    roughness: asset.textures.roughness
      ? loadPbrTexture(asset.textures.roughness, `${asset.id}-roughness`, asset, THREE.NoColorSpace)
      : undefined,
    ao: asset.textures.ao
      ? loadPbrTexture(asset.textures.ao, `${asset.id}-ao`, asset, THREE.NoColorSpace)
      : undefined,
  };
  cachedPbrTextures.set(asset.id, textures);
  return textures;
}

export function createConstructionMaterial(material: ConstructionMaterial): THREE.MeshStandardMaterial {
  const asset = CONSTRUCTION_MATERIAL_ASSETS[material] ?? CONSTRUCTION_MATERIAL_ASSETS.wood;
  const textures = pbrTextures(asset);
  const result = new THREE.MeshStandardMaterial({
    name: `construction-${asset.id}`,
    color: textures.albedo ? 0xffffff : asset.color,
    map: textures.albedo,
    normalMap: textures.normal,
    normalScale: textures.normal
      ? new THREE.Vector2(asset.normalScale ?? DEFAULT_NORMAL_SCALE, asset.normalScale ?? DEFAULT_NORMAL_SCALE)
      : undefined,
    roughness: asset.roughness,
    roughnessMap: textures.roughness,
    metalness: asset.metalness,
    aoMap: textures.ao,
    aoMapIntensity: asset.aoIntensity ?? DEFAULT_AO_INTENSITY,
  });
  return result;
}
