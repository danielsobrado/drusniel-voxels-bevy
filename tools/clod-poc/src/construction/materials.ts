import * as THREE from "three";
import brickAoUrl from "../../textures/pbr/jpg/Bricks075A/Bricks075A_1K-JPG_AmbientOcclusion.jpg?url";
import brickAlbedoUrl from "../../textures/pbr/jpg/Bricks075A/Bricks075A_1K-JPG_Color.jpg?url";
import brickNormalUrl from "../../textures/pbr/jpg/Bricks075A/Bricks075A_1K-JPG_NormalGL.jpg?url";
import brickRoughnessUrl from "../../textures/pbr/jpg/Bricks075A/Bricks075A_1K-JPG_Roughness.jpg?url";
import concreteAoUrl from "../../textures/pbr/jpg/Concrete025/Concrete025_1K-JPG_AmbientOcclusion.jpg?url";
import concreteAlbedoUrl from "../../textures/pbr/jpg/Concrete025/Concrete025_1K-JPG_Color.jpg?url";
import concreteNormalUrl from "../../textures/pbr/jpg/Concrete025/Concrete025_1K-JPG_NormalGL.jpg?url";
import concreteRoughnessUrl from "../../textures/pbr/jpg/Concrete025/Concrete025_1K-JPG_Roughness.jpg?url";
import marbleAlbedoUrl from "../../textures/pbr/jpg/Marble016/Marble016_1K-JPG_Color.jpg?url";
import marbleNormalUrl from "../../textures/pbr/jpg/Marble016/Marble016_1K-JPG_NormalGL.jpg?url";
import marbleRoughnessUrl from "../../textures/pbr/jpg/Marble016/Marble016_1K-JPG_Roughness.jpg?url";
import tileAoUrl from "../../textures/pbr/jpg/Tiles089/Tiles089_1K-JPG_AmbientOcclusion.jpg?url";
import tileAlbedoUrl from "../../textures/pbr/jpg/Tiles089/Tiles089_1K-JPG_Color.jpg?url";
import tileNormalUrl from "../../textures/pbr/jpg/Tiles089/Tiles089_1K-JPG_NormalGL.jpg?url";
import tileRoughnessUrl from "../../textures/pbr/jpg/Tiles089/Tiles089_1K-JPG_Roughness.jpg?url";
import woodAoUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_AmbientOcclusion.jpg?url";
import woodAlbedoUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_Color.jpg?url";
import woodNormalUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_NormalGL.jpg?url";
import woodRoughnessUrl from "../../textures/pbr/jpg/Wood060/Wood060_1K-JPG_Roughness.jpg?url";
import { CONSTRUCTION_MATERIALS, type ConstructionMaterial } from "./types.js";

const DEFAULT_TEXTURE_REPEAT_U = 1.5;
const DEFAULT_TEXTURE_REPEAT_V = 1.0;
const DEFAULT_TEXTURE_ANISOTROPY = 8;
const DEFAULT_NORMAL_SCALE = 0.75;
const DEFAULT_AO_INTENSITY = 0.85;

interface ConstructionMaterialDefinition {
  id: ConstructionMaterial;
  label: string;
  color: number;
  roughness: number;
  metalness: number;
  albedoUrl?: string;
  normalUrl?: string;
  roughnessUrl?: string;
  aoUrl?: string;
  repeatU?: number;
  repeatV?: number;
  normalScale?: number;
  aoIntensity?: number;
}

export interface ConstructionMaterialOption {
  id: ConstructionMaterial;
  label: string;
  previewUrl: string;
}

interface PbrTextureSet {
  albedo?: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
  ao?: THREE.Texture;
}

const MATERIAL_DEFINITIONS: Record<ConstructionMaterial, ConstructionMaterialDefinition> = {
  wood: {
    id: "wood",
    label: "Wood",
    color: 0x9a673a,
    roughness: 1.0,
    metalness: 0.0,
    albedoUrl: woodAlbedoUrl,
    normalUrl: woodNormalUrl,
    roughnessUrl: woodRoughnessUrl,
    aoUrl: woodAoUrl,
  },
  brick: {
    id: "brick",
    label: "Brick",
    color: 0x8c5542,
    roughness: 0.92,
    metalness: 0.0,
    albedoUrl: brickAlbedoUrl,
    normalUrl: brickNormalUrl,
    roughnessUrl: brickRoughnessUrl,
    aoUrl: brickAoUrl,
    repeatU: 1.0,
    repeatV: 1.0,
  },
  concrete: {
    id: "concrete",
    label: "Concrete",
    color: 0x8a8179,
    roughness: 0.96,
    metalness: 0.0,
    albedoUrl: concreteAlbedoUrl,
    normalUrl: concreteNormalUrl,
    roughnessUrl: concreteRoughnessUrl,
    aoUrl: concreteAoUrl,
    repeatU: 1.0,
    repeatV: 1.0,
    normalScale: 0.55,
  },
  marble: {
    id: "marble",
    label: "Marble",
    color: 0xd7d1c2,
    roughness: 0.48,
    metalness: 0.0,
    albedoUrl: marbleAlbedoUrl,
    normalUrl: marbleNormalUrl,
    roughnessUrl: marbleRoughnessUrl,
    repeatU: 1.0,
    repeatV: 1.0,
    normalScale: 0.45,
  },
  tiles: {
    id: "tiles",
    label: "Tiles",
    color: 0xbdb8a8,
    roughness: 0.74,
    metalness: 0.0,
    albedoUrl: tileAlbedoUrl,
    normalUrl: tileNormalUrl,
    roughnessUrl: tileRoughnessUrl,
    aoUrl: tileAoUrl,
    repeatU: 1.0,
    repeatV: 1.0,
    normalScale: 0.65,
  },
  stone: {
    id: "stone",
    label: "Stone",
    color: 0x7f858c,
    roughness: 0.82,
    metalness: 0.0,
  },
  metal: {
    id: "metal",
    label: "Metal",
    color: 0x777f8a,
    roughness: 0.46,
    metalness: 0.62,
  },
  thatch: {
    id: "thatch",
    label: "Thatch",
    color: 0xb59b52,
    roughness: 0.88,
    metalness: 0.0,
  },
};

export const CONSTRUCTION_MATERIAL_OPTIONS: readonly ConstructionMaterialOption[] = [
  { id: "wood", label: MATERIAL_DEFINITIONS.wood.label, previewUrl: woodAlbedoUrl },
  { id: "brick", label: MATERIAL_DEFINITIONS.brick.label, previewUrl: brickAlbedoUrl },
  { id: "concrete", label: MATERIAL_DEFINITIONS.concrete.label, previewUrl: concreteAlbedoUrl },
  { id: "marble", label: MATERIAL_DEFINITIONS.marble.label, previewUrl: marbleAlbedoUrl },
  { id: "tiles", label: MATERIAL_DEFINITIONS.tiles.label, previewUrl: tileAlbedoUrl },
];

const cachedPbrTextures = new Map<ConstructionMaterial, PbrTextureSet>();

export function asConstructionMaterial(value: string): ConstructionMaterial | null {
  const normalized = value.trim().toLowerCase();
  return CONSTRUCTION_MATERIALS.includes(normalized as ConstructionMaterial)
    ? normalized as ConstructionMaterial
    : null;
}

export function constructionMaterialLabel(material: ConstructionMaterial): string {
  return MATERIAL_DEFINITIONS[material]?.label ?? material;
}

function configurePbrTexture(texture: THREE.Texture, definition: ConstructionMaterialDefinition, colorSpace: THREE.ColorSpace): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(definition.repeatU ?? DEFAULT_TEXTURE_REPEAT_U, definition.repeatV ?? DEFAULT_TEXTURE_REPEAT_V);
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = DEFAULT_TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
}

function loadPbrTexture(url: string, name: string, definition: ConstructionMaterialDefinition, colorSpace: THREE.ColorSpace): THREE.Texture {
  const texture = new THREE.TextureLoader().load(
    url,
    (loadedTexture) => configurePbrTexture(loadedTexture, definition, colorSpace),
    undefined,
    (error) => console.warn(`[construction] failed to load PBR texture ${name}`, error),
  );
  texture.name = name;
  return texture;
}

function pbrTextures(definition: ConstructionMaterialDefinition): PbrTextureSet {
  const cached = cachedPbrTextures.get(definition.id);
  if (cached) return cached;

  const textures: PbrTextureSet = {
    albedo: definition.albedoUrl
      ? loadPbrTexture(definition.albedoUrl, `${definition.id}-albedo`, definition, THREE.SRGBColorSpace)
      : undefined,
    normal: definition.normalUrl
      ? loadPbrTexture(definition.normalUrl, `${definition.id}-normal`, definition, THREE.NoColorSpace)
      : undefined,
    roughness: definition.roughnessUrl
      ? loadPbrTexture(definition.roughnessUrl, `${definition.id}-roughness`, definition, THREE.NoColorSpace)
      : undefined,
    ao: definition.aoUrl
      ? loadPbrTexture(definition.aoUrl, `${definition.id}-ao`, definition, THREE.NoColorSpace)
      : undefined,
  };
  cachedPbrTextures.set(definition.id, textures);
  return textures;
}

export function createConstructionMaterial(material: ConstructionMaterial): THREE.MeshStandardMaterial {
  const definition = MATERIAL_DEFINITIONS[material] ?? MATERIAL_DEFINITIONS.wood;
  const textures = pbrTextures(definition);
  const result = new THREE.MeshStandardMaterial({
    name: `construction-${definition.id}`,
    color: textures.albedo ? 0xffffff : definition.color,
    map: textures.albedo,
    normalMap: textures.normal,
    normalScale: textures.normal
      ? new THREE.Vector2(definition.normalScale ?? DEFAULT_NORMAL_SCALE, definition.normalScale ?? DEFAULT_NORMAL_SCALE)
      : undefined,
    roughness: definition.roughness,
    roughnessMap: textures.roughness,
    metalness: definition.metalness,
    aoMap: textures.ao,
    aoMapIntensity: definition.aoIntensity ?? DEFAULT_AO_INTENSITY,
  });
  return result;
}
