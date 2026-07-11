import * as THREE from "three";
import {
  abs,
  attribute,
  floor,
  fract,
  mix,
  normalGeometry,
  positionGeometry,
  texture,
  vec2,
} from "three/tsl";
import { bakeBarkTextures, type BarkTextures } from "../textures/barkSynth.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const BARK_TILE_SCALE = 0.8;
const BARK_TILE_RESOLUTION = 128;
const BARK_ATLAS_COLUMNS = 3;
const BARK_ATLAS_ROWS = 2;
const BARK_LAYER_BY_TREE_SPECIES = [2, 1, 5, 3, 4, 0] as const;

let sharedBark: { seed: number; texture: THREE.Texture } | null = null;

export function sharedBarkTexture(seed: number): THREE.Texture {
  if (!sharedBark || sharedBark.seed !== seed) {
    sharedBark?.texture.dispose();
    const width = BARK_ATLAS_COLUMNS * BARK_TILE_RESOLUTION;
    const height = BARK_ATLAS_ROWS * BARK_TILE_RESOLUTION;
    const bytes = new Uint8Array(width * height * 4);

    for (let speciesIndex = 0; speciesIndex < BARK_LAYER_BY_TREE_SPECIES.length; speciesIndex++) {
      const baked = bakeBarkTextures({
        layer: BARK_LAYER_BY_TREE_SPECIES[speciesIndex] as number,
        seed: seed + speciesIndex * 104729,
        resolution: BARK_TILE_RESOLUTION,
      });
      copyBarkTile(bytes, width, speciesIndex, baked);
      baked.texA.dispose();
      baked.texB.dispose();
    }

    const textureAtlas = new THREE.DataTexture(
      bytes,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    textureAtlas.name = "tree-bark-species-atlas";
    textureAtlas.colorSpace = THREE.NoColorSpace;
    textureAtlas.wrapS = THREE.ClampToEdgeWrapping;
    textureAtlas.wrapT = THREE.ClampToEdgeWrapping;
    textureAtlas.generateMipmaps = true;
    textureAtlas.minFilter = THREE.LinearMipmapLinearFilter;
    textureAtlas.magFilter = THREE.LinearFilter;
    textureAtlas.anisotropy = 4;
    textureAtlas.needsUpdate = true;
    sharedBark = { seed, texture: textureAtlas };
  }
  return sharedBark.texture;
}

function copyBarkTile(
  destination: Uint8Array,
  atlasWidth: number,
  speciesIndex: number,
  baked: BarkTextures,
): void {
  const tileX = speciesIndex % BARK_ATLAS_COLUMNS;
  const tileY = Math.floor(speciesIndex / BARK_ATLAS_COLUMNS);
  for (let y = 0; y < baked.resolution; y++) {
    for (let x = 0; x < baked.resolution; x++) {
      const source = (y * baked.resolution + x) * 4;
      const target = (
        (tileY * BARK_TILE_RESOLUTION + y) * atlasWidth
        + tileX * BARK_TILE_RESOLUTION
        + x
      ) * 4;
      destination[target] = Math.round(Math.min(1, Math.max(0, baked.dataA[source] as number)) * 255);
      destination[target + 1] = Math.round(Math.min(1, Math.max(0, baked.dataA[source + 1] as number)) * 255);
      destination[target + 2] = Math.round(Math.min(1, Math.max(0, baked.dataA[source + 2] as number)) * 255);
      destination[target + 3] = Math.round(Math.min(1, Math.max(0, baked.dataA[source + 3] as number)) * 255);
    }
  }
}

function barkAtlasUv(localUv: TslNode, speciesIndex: TslNode): TslNode {
  const row: TslNode = floor(speciesIndex.div(BARK_ATLAS_COLUMNS));
  const column: TslNode = speciesIndex.sub(row.mul(BARK_ATLAS_COLUMNS));
  const tiled: TslNode = fract(localUv);
  return vec2(
    column.add(tiled.x).div(BARK_ATLAS_COLUMNS),
    row.add(tiled.y).div(BARK_ATLAS_ROWS),
  );
}

function triplanarBarkSample(barkTexture: THREE.Texture): TslNode {
  const position: TslNode = positionGeometry.mul(BARK_TILE_SCALE);
  const normal: TslNode = abs(normalGeometry);
  const weightSum: TslNode = normal.x.add(normal.y).add(normal.z).add(0.0001);
  const packedTreeWind: TslNode = attribute("treeWind", "vec3");
  const speciesIndex: TslNode = floor(packedTreeWind.z.add(0.5));
  const sampleX: TslNode = texture(barkTexture, barkAtlasUv(vec2(position.z, position.y), speciesIndex));
  const sampleY: TslNode = texture(barkTexture, barkAtlasUv(vec2(position.x, position.z), speciesIndex));
  const sampleZ: TslNode = texture(barkTexture, barkAtlasUv(vec2(position.x, position.y), speciesIndex));
  return sampleX.mul(normal.x).add(sampleY.mul(normal.y)).add(sampleZ.mul(normal.z)).div(weightSum);
}

export function barkTrunkAlbedo(vertexColor: TslNode, barkTexture: THREE.Texture): TslNode {
  const sample: TslNode = triplanarBarkSample(barkTexture);
  const decodedAlbedo: TslNode = sample.rgb.mul(sample.rgb);
  const speciesAlbedo: TslNode = mix(vertexColor, decodedAlbedo.mul(1.35), 0.72);
  return speciesAlbedo.mul(sample.w.mul(0.45).add(0.68));
}
