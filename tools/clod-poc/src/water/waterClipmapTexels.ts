// Static-topology water clipmap level storage (Phase 5b).
//
// In static mode a level's per-vertex water data lives in two toroidal RGBA32F
// textures instead of CPU vertex buffers, and the grid geometry (positions = grid
// indices, full index buffer) never changes after construction. A snap therefore
// updates texels + two origin uniforms — no index rebuild, no attribute re-upload.
//
// Texel layout (slot (sx, sz) = world column/row mod vertsPerEdge, matching the
// legacy toroidal vertex slots exactly):
//   A: R = waterY, G = terrainY, B = bodyMask, A = bodyKind
//   B: R = flowX,  G = flowZ,    B = flowSpeed, A = flowDrop
import * as THREE from "three";
import type { WaterFieldResult } from "./waterField.js";
import type { WaterStaticGridParams } from "./water_material_types.js";

export class WaterLevelTexelStore {
  readonly vertsPerEdge: number;
  readonly cellSize: number;
  readonly dataA: Float32Array;
  readonly dataB: Float32Array;
  readonly texelsA: THREE.DataTexture;
  readonly texelsB: THREE.DataTexture;
  /** Wet-vertex count so a fully dry ring can stay hidden like the legacy path. */
  private wetCount = 0;
  private readonly wetFlags: Uint8Array;

  constructor(vertsPerEdge: number, cellSize: number) {
    this.vertsPerEdge = vertsPerEdge;
    this.cellSize = cellSize;
    const count = vertsPerEdge * vertsPerEdge;
    this.dataA = new Float32Array(count * 4);
    this.dataB = new Float32Array(count * 4);
    this.wetFlags = new Uint8Array(count);
    this.texelsA = makeTexelTexture(this.dataA, vertsPerEdge, "water-clipmap-texels-a");
    this.texelsB = makeTexelTexture(this.dataB, vertsPerEdge, "water-clipmap-texels-b");
  }

  get wetVertexCount(): number {
    return this.wetCount;
  }

  materialParams(): WaterStaticGridParams {
    return {
      texelsA: this.texelsA,
      texelsB: this.texelsB,
      vertsPerEdge: this.vertsPerEdge,
      cellSize: this.cellSize,
    };
  }

  writeSample(slot: number, sample: WaterFieldResult): void {
    const i = slot * 4;
    this.dataA[i] = sample.waterY;
    this.dataA[i + 1] = sample.terrainY;
    this.dataA[i + 2] = sample.bodyMask;
    this.dataA[i + 3] = sample.bodyKind;
    this.dataB[i] = sample.flow.x;
    this.dataB[i + 1] = sample.flow.z;
    this.dataB[i + 2] = sample.flow.speed;
    this.dataB[i + 3] = sample.flow.drop;
    this.trackWet(slot, sample.bodyMask > 0 && sample.waterY - sample.terrainY > 0);
  }

  writeDry(slot: number): void {
    const i = slot * 4;
    this.dataA[i] = 0;
    this.dataA[i + 1] = 0;
    this.dataA[i + 2] = 0;
    this.dataA[i + 3] = 0;
    this.dataB[i] = 0;
    this.dataB[i + 1] = 0;
    this.dataB[i + 2] = 0;
    this.dataB[i + 3] = 0;
    this.trackWet(slot, false);
  }

  /** Mark both textures for upload after a batch of writes. */
  commit(): void {
    this.texelsA.needsUpdate = true;
    this.texelsB.needsUpdate = true;
  }

  dispose(): void {
    this.texelsA.dispose();
    this.texelsB.dispose();
  }

  private trackWet(slot: number, wet: boolean): void {
    const flag = wet ? 1 : 0;
    this.wetCount += flag - this.wetFlags[slot];
    this.wetFlags[slot] = flag;
  }
}

function makeTexelTexture(data: Float32Array, vertsPerEdge: number, name: string): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, vertsPerEdge, vertsPerEdge, THREE.RGBAFormat, THREE.FloatType);
  texture.name = name;
  // rgba32float is not filterable without an optional feature; the vertex stage reads
  // exact texels via textureLoad, so nearest/no-mips is both sufficient and required.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Static grid geometry for a static-topology level: position.xz carry the grid indices
 * (i, j) ∈ [0, cellsPerLevel]² (the vertex stage turns them into world positions and
 * toroidal texel slots), aLevel is constant, and the index buffer covers every quad
 * once, forever — snaps never touch this geometry.
 */
export function createStaticWaterGridGeometry(cellsPerLevel: number, levelIndex: number): THREE.BufferGeometry {
  const vertsPerEdge = cellsPerLevel + 1;
  const vertexCount = vertsPerEdge * vertsPerEdge;
  const positions = new Float32Array(vertexCount * 3);
  const level = new Float32Array(vertexCount);
  level.fill(levelIndex);
  for (let j = 0; j < vertsPerEdge; j++) {
    for (let i = 0; i < vertsPerEdge; i++) {
      const vi = (j * vertsPerEdge + i) * 3;
      positions[vi] = i;
      positions[vi + 1] = 0;
      positions[vi + 2] = j;
    }
  }
  const indices = new Uint32Array(cellsPerLevel * cellsPerLevel * 6);
  let p = 0;
  for (let qj = 0; qj < cellsPerLevel; qj++) {
    for (let qi = 0; qi < cellsPerLevel; qi++) {
      const a = qj * vertsPerEdge + qi;
      const b = a + 1;
      const c = a + vertsPerEdge;
      const d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aLevel", new THREE.BufferAttribute(level, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.MAX_VALUE);
  return geometry;
}
