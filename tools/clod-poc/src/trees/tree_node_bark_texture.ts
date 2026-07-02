import * as THREE from "three";
import { abs, normalGeometry, positionGeometry, texture, vec2 } from "three/tsl";
import { bakeBarkTextures, type BarkTextures } from "../textures/barkSynth.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

// Object-space bark tiling: positionGeometry is metres, so 0.8 repeats the bark
// atlas roughly every 1.25 m on a trunk.
const BARK_TILE_SCALE = 0.8;
const BARK_RESOLUTION = 256;

// One furrowed-bark atlas, baked once and shared across every tree material handle
// (the CPU InstancedMesh path plus the four per-LOD ring handles), keyed by seed.
// Long-lived for the app: handles never dispose it. The bake produces a float
// texture; we repack its height/AO channel into an 8-bit texture because WebGPU
// cannot linearly filter rgba32float without the (unrequested) float32-filterable
// feature.
let sharedBark: { seed: number; texture: THREE.Texture } | null = null;

export function sharedBarkTexture(seed: number): THREE.Texture {
  if (!sharedBark || sharedBark.seed !== seed) {
    const baked: BarkTextures = bakeBarkTextures({ layer: 0, seed, resolution: BARK_RESOLUTION });
    const texelCount = baked.resolution * baked.resolution;
    const bytes = new Uint8Array(texelCount * 4);
    for (let i = 0; i < texelCount; i++) {
      const height = Math.round(Math.min(1, Math.max(0, baked.dataA[i * 4 + 3])) * 255);
      bytes[i * 4] = height;
      bytes[i * 4 + 1] = height;
      bytes[i * 4 + 2] = height;
      bytes[i * 4 + 3] = height;
    }
    const barkTexture = new THREE.DataTexture(bytes, baked.resolution, baked.resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    barkTexture.name = "tree-bark-height";
    barkTexture.wrapS = THREE.RepeatWrapping;
    barkTexture.wrapT = THREE.RepeatWrapping;
    barkTexture.generateMipmaps = true;
    barkTexture.minFilter = THREE.LinearMipmapLinearFilter;
    barkTexture.magFilter = THREE.LinearFilter;
    barkTexture.needsUpdate = true;
    baked.texA.dispose();
    baked.texB.dispose();
    sharedBark = { seed, texture: barkTexture };
  }
  return sharedBark.texture;
}

// Triplanar bark height/AO (range 0.3..1.0) from the object-space geometry, blended
// by the object-space normal so angled branches read correctly. Used to shade the
// trunk/branch vertex colour into furrowed bark.
function triplanarBarkShade(barkTexture: THREE.Texture): TslNode {
  const p: TslNode = positionGeometry.mul(BARK_TILE_SCALE);
  const an: TslNode = abs(normalGeometry);
  const wsum: TslNode = an.x.add(an.y).add(an.z).add(0.0001);
  const sx: TslNode = texture(barkTexture, vec2(p.z, p.y)).w;
  const sy: TslNode = texture(barkTexture, vec2(p.x, p.z)).w;
  const sz: TslNode = texture(barkTexture, vec2(p.x, p.y)).w;
  return sx.mul(an.x).add(sy.mul(an.y)).add(sz.mul(an.z)).div(wsum);
}

export function barkTrunkAlbedo(vertexColor: TslNode, barkTexture: THREE.Texture): TslNode {
  return vertexColor.mul(triplanarBarkShade(barkTexture).mul(0.85).add(0.2));
}
