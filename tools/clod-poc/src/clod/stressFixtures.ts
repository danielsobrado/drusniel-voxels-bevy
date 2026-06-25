import type { PageMesh, TerrainChunkMainSurface, Vec3 } from "../types.js";

export type HeightFn = (x: number, z: number) => number;
export type NormalFn = (x: number, z: number) => [number, number, number];
export type MaterialFn = (x: number, z: number) => number;

export interface FixtureDef {
  name: string;
  description: string;
  height: HeightFn;
  material: MaterialFn;
}

function normalFromHeight(fn: HeightFn, eps = 0.01): NormalFn {
  return (x: number, z: number): [number, number, number] => {
    const hx = fn(x + eps, z);
    const hz = fn(x, z + eps);
    const h = fn(x, z);
    const dx = (hx - h) / eps;
    const dz = (hz - h) / eps;
    const len = Math.hypot(-dx, 1, -dz);
    return [-dx / len, 1 / len, -dz / len];
  };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash1D(ix: number, seed: number): number {
  const h = ((ix * 374761393 + seed * 668265263) & 0x7fffffff) / 0x7fffffff;
  return h;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);
  const a = hash1D(ix + iz * 1013, seed);
  const b = hash1D(ix + 1 + iz * 1013, seed);
  const c = hash1D(ix + (iz + 1) * 1013, seed);
  const d = hash1D(ix + 1 + (iz + 1) * 1013, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

function fbm(x: number, z: number, seed: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / norm;
}

export const FLAT: FixtureDef = {
  name: "flat",
  description: "Flat terrain at y=0",
  height: () => 0,
  material: () => 0,
};

export const ROLLING_HILL: FixtureDef = {
  name: "rolling_hill",
  description: "Smooth rolling hill using sine waves",
  height: (x, z) => Math.sin(x * 0.05) * 3 + Math.cos(z * 0.07) * 2 + Math.sin((x + z) * 0.03) * 1.5,
  material: () => 0,
};

const RIDGE_LINE_X = 32;
export const RIDGE_BORDER: FixtureDef = {
  name: "ridge_border",
  description: "Ridge crossing a page border (x=32)",
  height: (x, z) => {
    const dist = Math.abs(x - RIDGE_LINE_X);
    const ridge = Math.max(0, 1 - dist * 0.1) * 8;
    const noise = fbm(x * 0.1, z * 0.1, 42, 3) * 2;
    return ridge + noise;
  },
  material: (x, _z) => Math.abs(x - RIDGE_LINE_X) < 2 ? 1 : 0,
};

export const CLIFF_CORNER: FixtureDef = {
  name: "cliff_corner",
  description: "Cliff crossing a 4-page corner (x=32,z=32)",
  height: (x, z) => {
    const xDist = x - 32;
    const zDist = z - 32;
    const cliffHeight = xDist > 0 && zDist > 0 ? 10 : 0;
    const slope = xDist > 0 ? Math.min(1, xDist * 0.05) * 5 : 0;
    const noise = fbm(x * 0.08, z * 0.08, 99, 2) * 1.5;
    return cliffHeight + slope + noise;
  },
  material: (x, z) => x > 32 && z > 32 ? 2 : (x > 32 || z > 32 ? 1 : 0),
};

const CAVE_X = 40;
const CAVE_Z = 40;
export const CAVE_MOUTH: FixtureDef = {
  name: "cave_mouth",
  description: "Cave mouth depression near page border",
  height: (x, z) => {
    const dx = x - CAVE_X;
    const dz = z - CAVE_Z;
    const dist = Math.hypot(dx, dz);
    const cave = Math.max(0, 1 - dist * 0.15) * (-5);
    const base = fbm(x * 0.06, z * 0.06, 200, 3) * 3;
    return base + cave;
  },
  material: (x, z) => {
    const dx = x - CAVE_X;
    const dz = z - CAVE_Z;
    const dist = Math.hypot(dx, dz);
    return dist < 6 ? 2 : 0;
  },
};

const BRIDGE_X_START = 28;
const BRIDGE_X_END = 36;
const BRIDGE_Z_CENTER = 32;
export const THIN_BRIDGE: FixtureDef = {
  name: "thin_bridge",
  description: "Thin terrain bridge 2-3 cells wide spanning a page border",
  height: (x, z) => {
    const dz = Math.abs(z - BRIDGE_Z_CENTER);
    const onBridge = x >= BRIDGE_X_START && x <= BRIDGE_X_END && dz < 1.5;
    if (onBridge) {
      return 4;
    }
    const base = fbm(x * 0.07, z * 0.07, 55, 3) * 2;
    return base - 2;
  },
  material: (x, z) => {
    const dz = Math.abs(z - BRIDGE_Z_CENTER);
    const onBridge = x >= BRIDGE_X_START && x <= BRIDGE_X_END && dz < 1.5;
    return onBridge ? 1 : 0;
  },
};

const LIP_X = 32;
const LIP_Z = 16;
export const OVERHANG_LIP: FixtureDef = {
  name: "overhang_lip",
  description: "Overhang/cave lip near page border",
  height: (x, z) => {
    const distX = Math.abs(x - LIP_X);
    const dz = z - LIP_Z;
    const lip = Math.max(0, 1 - distX * 0.15) * (dz > 0 ? 4 : -2);
    const base = fbm(x * 0.05, z * 0.05, 77, 3) * 2;
    return base + Math.max(0, lip);
  },
  material: (x, z) => {
    const dx = Math.abs(x - LIP_X);
    const dz = z - LIP_Z;
    return dx < 4 && dz > 0 && dz < 4 ? 1 : 0;
  },
};

const MAT_TRANSITION_X = 32;
export const MATERIAL_TRANSITION: FixtureDef = {
  name: "material_transition",
  description: "Material transition crossing a page border (x=32)",
  height: (x, z) => {
    return Math.sin(x * 0.04) * 2 + Math.cos(z * 0.05) * 2 + fbm(x * 0.08, z * 0.08, 33, 3) * 1;
  },
  material: (x, _z) => x < MAT_TRANSITION_X ? 0 : (x < MAT_TRANSITION_X + 4 ? 1 : 2),
};

export const ALL_FIXTURES: FixtureDef[] = [
  FLAT,
  ROLLING_HILL,
  RIDGE_BORDER,
  CLIFF_CORNER,
  CAVE_MOUTH,
  THIN_BRIDGE,
  OVERHANG_LIP,
  MATERIAL_TRANSITION,
];

export function fixtureByName(name: string): FixtureDef | undefined {
  return ALL_FIXTURES.find((f) => f.name === name);
}

interface BuildFixtureChunksOptions {
  fixture: FixtureDef;
  lod0PagesX: number;
  lod0PagesZ: number;
  chunksPerPage: number;
  chunkSize: number;
  seed?: number;
}

export interface FixtureChunkResult {
  chunks: TerrainChunkMainSurface[];
  pageMeshes: PageMesh[];
}

function chunkOrigin(cx: number, cz: number, chunkSize: number): Vec3 {
  return { x: cx * chunkSize, y: 0, z: cz * chunkSize };
}

export function buildFixtureChunks(options: BuildFixtureChunksOptions): FixtureChunkResult {
  const { fixture, lod0PagesX, lod0PagesZ, chunksPerPage, chunkSize, seed = 1 } = options;

  const heightFn = fixture.height;
  const materialFn = fixture.material;
  const normalFn = normalFromHeight(heightFn, 0.01);

  const chunks: TerrainChunkMainSurface[] = [];
  const pageMeshes: PageMesh[] = [];
  let revision = seed;

  for (let pz = 0; pz < lod0PagesZ; pz++) {
    for (let px = 0; px < lod0PagesX; px++) {
      const chunkPositions: number[] = [];
      const chunkNormals: number[] = [];
      const chunkMaterials: number[] = [];
      const chunkIndices: number[] = [];

      const baseCX = px * chunksPerPage;
      const baseCZ = pz * chunksPerPage;

      for (let dz = 0; dz < chunksPerPage; dz++) {
        for (let dx = 0; dx < chunksPerPage; dx++) {
          const cx = baseCX + dx;
          const cz = baseCZ + dz;
          const origin = chunkOrigin(cx, cz, chunkSize);

          const localPositions: number[] = [];
          const localNormals: number[] = [];
          const localMaterials: number[] = [];
          const localIndices: number[] = [];
          const cellsPerSide = chunkSize;

          for (let j = 0; j <= cellsPerSide; j++) {
            for (let i = 0; i <= cellsPerSide; i++) {
              const wx = cx * chunkSize + i;
              const wz = cz * chunkSize + j;
              const h = heightFn(wx, wz);
              const n = normalFn(wx, wz);
              const m = materialFn(wx, wz);
              localPositions.push(wx, h, wz);
              localNormals.push(n[0], n[1], n[2]);
              localMaterials.push(m);
            }
          }

          const vertsPerSide = cellsPerSide + 1;
          for (let j = 0; j < cellsPerSide; j++) {
            for (let i = 0; i < cellsPerSide; i++) {
              const a = j * vertsPerSide + i;
              const b = a + 1;
              const c = (j + 1) * vertsPerSide + i;
              const d = c + 1;
              localIndices.push(a, c, b, b, c, d);
            }
          }

          const vc = (cellsPerSide + 1) * (cellsPerSide + 1);
          const localOffset = chunkPositions.length / 3;
          for (let vi = 0; vi < vc; vi++) {
            chunkPositions.push(localPositions[vi * 3], localPositions[vi * 3 + 1], localPositions[vi * 3 + 2]);
            chunkNormals.push(localNormals[vi * 3], localNormals[vi * 3 + 1], localNormals[vi * 3 + 2]);
            chunkMaterials.push(localMaterials[vi]);
          }
          for (let ii = 0; ii < localIndices.length; ii++) {
            chunkIndices.push(localIndices[ii] + localOffset);
          }

          const chunkMesh: PageMesh = {
            positions: new Float32Array(localPositions),
            normals: new Float32Array(localNormals),
            materials: new Float32Array(localMaterials),
            indices: new Uint32Array(localIndices),
          };
          const chunkExport: TerrainChunkMainSurface = {
            chunkX: cx,
            chunkZ: cz,
            lod: 0,
            origin,
            revision: revision++,
            positions: new Float32Array(localPositions),
            normals: new Float32Array(localNormals),
            materials: new Float32Array(localMaterials),
            indices: new Uint32Array(localIndices),
          };
          chunks.push(chunkExport);
          pageMeshes.push(chunkMesh);
        }
      }
    }
  }

  return { chunks, pageMeshes };
}
