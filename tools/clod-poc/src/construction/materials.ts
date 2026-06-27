import * as THREE from "three";
import woodAoUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_AmbientOcclusion.jpg?url";
import woodAlbedoUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_Color.jpg?url";
import woodNormalUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_NormalGL.jpg?url";
import woodRoughnessUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_Roughness.jpg?url";
import type { ConstructionMaterial } from "./types.js";

const WOOD_TEXTURE_REPEAT_U = 1.5;
const WOOD_TEXTURE_REPEAT_V = 1.0;
const WOOD_TEXTURE_ANISOTROPY = 8;
const WOOD_NORMAL_SCALE = 0.75;
const WOOD_AO_INTENSITY = 0.85;

const DEFAULT_MATERIAL_COLORS: Record<ConstructionMaterial, number> = {
  wood: 0x9a673a,
  stone: 0x7f858c,
  metal: 0x777f8a,
  thatch: 0xb59b52,
};

interface WoodPbrTextureSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  ao: THREE.Texture;
}

let cachedWoodPbrTextures: WoodPbrTextureSet | null = null;

function configureWoodTexture(texture: THREE.Texture, colorSpace: THREE.ColorSpace): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(WOOD_TEXTURE_REPEAT_U, WOOD_TEXTURE_REPEAT_V);
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = WOOD_TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
}

function loadWoodTexture(url: string, name: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  const texture = new THREE.TextureLoader().load(
    url,
    (loadedTexture) => configureWoodTexture(loadedTexture, colorSpace),
    undefined,
    (error) => console.warn(`[construction] failed to load wood PBR texture ${name}`, error),
  );
  texture.name = name;
  return texture;
}

function woodPbrTextures(): WoodPbrTextureSet {
  if (cachedWoodPbrTextures) return cachedWoodPbrTextures;
  cachedWoodPbrTextures = {
    albedo: loadWoodTexture(woodAlbedoUrl, "Wood060-albedo", THREE.SRGBColorSpace),
    normal: loadWoodTexture(woodNormalUrl, "Wood060-normal", THREE.NoColorSpace),
    roughness: loadWoodTexture(woodRoughnessUrl, "Wood060-roughness", THREE.NoColorSpace),
    ao: loadWoodTexture(woodAoUrl, "Wood060-ao", THREE.NoColorSpace),
  };
  return cachedWoodPbrTextures;
}

export function createConstructionMaterial(material: ConstructionMaterial): THREE.MeshStandardMaterial {
  if (material !== "wood") {
    const fallbackMaterial = new THREE.MeshStandardMaterial({
      color: DEFAULT_MATERIAL_COLORS[material],
      roughness: material === "metal" ? 0.46 : 0.78,
      metalness: material === "metal" ? 0.62 : 0.0,
    });
    fallbackMaterial.name = `construction-${material}`;
    return fallbackMaterial;
  }

  const textures = woodPbrTextures();
  const woodMaterial = new THREE.MeshStandardMaterial({
    name: "construction-wood-Wood060-pbr",
    color: 0xffffff,
    map: textures.albedo,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(WOOD_NORMAL_SCALE, WOOD_NORMAL_SCALE),
    roughness: 1.0,
    roughnessMap: textures.roughness,
    metalness: 0.0,
    aoMap: textures.ao,
    aoMapIntensity: WOOD_AO_INTENSITY,
  });
  return woodMaterial;
}
