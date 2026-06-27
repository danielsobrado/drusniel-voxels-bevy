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
import type { ConstructionMaterial } from "./types.js";

export type ConstructionTextureRole = "albedo" | "normal" | "roughness" | "ao";

export interface ConstructionMaterialAsset {
  id: ConstructionMaterial;
  label: string;
  color: number;
  roughness: number;
  metalness: number;
  previewUrl: string;
  textures: Partial<Record<ConstructionTextureRole, string>>;
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

export const CONSTRUCTION_MATERIAL_ASSETS: Record<ConstructionMaterial, ConstructionMaterialAsset> = {
  wood: {
    id: "wood",
    label: "Wood",
    color: 0x9a673a,
    roughness: 1.0,
    metalness: 0.0,
    previewUrl: woodAlbedoUrl,
    textures: {
      albedo: woodAlbedoUrl,
      normal: woodNormalUrl,
      roughness: woodRoughnessUrl,
      ao: woodAoUrl,
    },
  },
  brick: {
    id: "brick",
    label: "Brick",
    color: 0x8c5542,
    roughness: 0.92,
    metalness: 0.0,
    previewUrl: brickAlbedoUrl,
    textures: {
      albedo: brickAlbedoUrl,
      normal: brickNormalUrl,
      roughness: brickRoughnessUrl,
      ao: brickAoUrl,
    },
    repeatU: 1.0,
    repeatV: 1.0,
  },
  concrete: {
    id: "concrete",
    label: "Concrete",
    color: 0x8a8179,
    roughness: 0.96,
    metalness: 0.0,
    previewUrl: concreteAlbedoUrl,
    textures: {
      albedo: concreteAlbedoUrl,
      normal: concreteNormalUrl,
      roughness: concreteRoughnessUrl,
      ao: concreteAoUrl,
    },
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
    previewUrl: marbleAlbedoUrl,
    textures: {
      albedo: marbleAlbedoUrl,
      normal: marbleNormalUrl,
      roughness: marbleRoughnessUrl,
    },
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
    previewUrl: tileAlbedoUrl,
    textures: {
      albedo: tileAlbedoUrl,
      normal: tileNormalUrl,
      roughness: tileRoughnessUrl,
      ao: tileAoUrl,
    },
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
    previewUrl: woodAlbedoUrl,
    textures: {},
  },
  metal: {
    id: "metal",
    label: "Metal",
    color: 0x777f8a,
    roughness: 0.46,
    metalness: 0.62,
    previewUrl: woodAlbedoUrl,
    textures: {},
  },
  thatch: {
    id: "thatch",
    label: "Thatch",
    color: 0xb59b52,
    roughness: 0.88,
    metalness: 0.0,
    previewUrl: woodAlbedoUrl,
    textures: {},
  },
};

export const CONSTRUCTION_MATERIAL_OPTIONS: readonly ConstructionMaterialOption[] = [
  CONSTRUCTION_MATERIAL_ASSETS.wood,
  CONSTRUCTION_MATERIAL_ASSETS.brick,
  CONSTRUCTION_MATERIAL_ASSETS.concrete,
  CONSTRUCTION_MATERIAL_ASSETS.marble,
  CONSTRUCTION_MATERIAL_ASSETS.tiles,
];
