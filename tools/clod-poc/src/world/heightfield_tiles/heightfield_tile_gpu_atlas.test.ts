import { beforeAll, describe, expect, it, vi } from "vitest";
import { terrainFieldShaderWithTileAtlas } from "../../terrain/streaming/gpu_clod_root_mesher.js";
import { HEIGHTFIELD_TILE_RES } from "./heightfield_tile.js";
import {
  createHeightfieldTileGpuAtlas,
  heightfieldTileAtlasTexel,
  heightfieldTileGpuAtlasBindings,
  heightfieldTileGpuAtlasHas,
  heightfieldTileGpuAtlasStats,
  invalidateHeightfieldTileGpuAtlasBounds,
  registerHeightfieldTileGpuSource,
  unregisterHeightfieldTileGpuSource,
  uploadHeightfieldTileToGpu,
  uploadHeightfieldTilesForPage,
} from "./heightfield_tile_gpu_atlas.js";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import type { HeightfieldTileCache } from "./heightfield_tile_cache.js";
import type { WorldTileKey } from "../tile_key.js";
import { worldToTile } from "../tile_key.js";

function stubDevice(): GPUDevice {
  return {
    createTexture: () => ({ createView: () => ({}), destroy: () => {} }),
    createBuffer: () => ({ destroy: () => {} }),
    queue: { writeBuffer: () => {}, writeTexture: () => {} },
  } as unknown as GPUDevice;
}

function tileSourceCoveringOnly(residentIds: ReadonlySet<string>): {
  cache: HeightfieldTileCache;
  requested: string[];
} {
  const requested: string[] = [];
  const cache = {
    get: (key: WorldTileKey) => {
      const id = `${key.x},${key.z}`;
      requested.push(id);
      if (!residentIds.has(id)) return null;
      return buildHeightfieldTile(key, { sampleHeight: () => 1 });
    },
  } as unknown as HeightfieldTileCache;
  return { cache, requested };
}

describe("heightfield tile GPU atlas", () => {
  beforeAll(() => {
    vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, COPY_DST: 2 });
    vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2 });
  });

  it("maps positive and negative world tiles into deterministic toroidal slots", () => {
    expect(heightfieldTileAtlasTexel({ x: 0, z: 0 }, 0, 0, 7)).toEqual({ x: 0, z: 0 });
    expect(heightfieldTileAtlasTexel({ x: 7, z: 7 }, 12, 34, 7)).toEqual({ x: 12, z: 34 });
    expect(heightfieldTileAtlasTexel({ x: -1, z: -2 }, 0, 0, 7)).toEqual({
      x: 6 * HEIGHTFIELD_TILE_RES,
      z: 5 * HEIGHTFIELD_TILE_RES,
    });
  });

  it("replaces procedural surface reads with exact unfiltered textureLoad lattice reads", () => {
    const shader = terrainFieldShaderWithTileAtlas();
    expect(shader).toContain("fn proceduralSurfaceHeightField");
    expect(shader).toContain("fn surfaceHeightField");
    expect(shader).toContain("textureLoad(continentHeightAtlas");
    expect(shader).not.toContain("textureSample(continentHeightAtlas");
    expect(shader).toContain("@binding(10)");
    expect(shader).toContain("@binding(11)");
  });

  it("quantizes tile-atlas normal probes before finite differences so welded f32 seam vertices agree", () => {
    const shader = terrainFieldShaderWithTileAtlas();
    expect(shader).toContain("fn continentStableNormalCoordinate");
    expect(shader).toContain("densityGradient(continentStableNormalCoordinate(p.x)");
  });

  it("mirrors exact f32 lattice reads across positive and negative tile borders", () => {
    const side = 7;
    const atlasRes = side * HEIGHTFIELD_TILE_RES;
    const data = new Float32Array(atlasRes * atlasRes);
    const tiles = [-1, 0, 1].map((x) => buildHeightfieldTile({ x, z: 0 }, {
      sampleHeight: (worldX, worldZ) => worldX * 0.125 + worldZ * 0.25,
    }));
    for (const tile of tiles) {
      const origin = heightfieldTileAtlasTexel(tile.key, 0, 0, side);
      for (let z = 0; z < HEIGHTFIELD_TILE_RES; z++) {
        data.set(tile.heights.subarray(z * HEIGHTFIELD_TILE_RES, (z + 1) * HEIGHTFIELD_TILE_RES),
          (origin.z + z) * atlasRes + origin.x);
      }
    }
    for (const x of [-256, -1, 0, 255, 256, 511]) {
      const key = worldToTile(x, 0);
      const localX = x - key.x * 256;
      const texel = heightfieldTileAtlasTexel(key, localX, 0, side);
      expect(data[texel.z * atlasRes + texel.x]).toBe(Math.fround(x * 0.125));
    }
  });

  it("uploads the world-tile key beside each toroidal height slot", () => {
    const writes: Array<{ label: string; origin: { x?: number; y?: number }; data: ArrayBufferView }> = [];
    const device = {
      createTexture: ({ label }: { label: string }) => ({
        label,
        createView: () => ({ label }),
        destroy: () => {},
      }),
      createBuffer: () => ({ destroy: () => {} }),
      queue: {
        writeBuffer: () => {},
        writeTexture: (
          destination: { texture: { label: string }; origin?: { x?: number; y?: number } },
          data: ArrayBufferView,
        ) => writes.push({ label: destination.texture.label, origin: destination.origin ?? {}, data }),
      },
    } as unknown as GPUDevice;
    const key = { x: -1, z: 8 };
    const { cache } = tileSourceCoveringOnly(new Set([`${key.x},${key.z}`]));
    registerHeightfieldTileGpuSource(cache, true);
    try {
      const atlas = createHeightfieldTileGpuAtlas(device, 7);
      expect(atlas).not.toBeNull();
      expect(heightfieldTileGpuAtlasBindings(device).enabled).toBe(true);
      expect(uploadHeightfieldTileToGpu(key)).toBe(true);

      const residency = writes.find((write) =>
        write.label === "continent heightfield tile residency" && write.origin.x !== undefined);
      expect(residency?.origin).toEqual({ x: 6, y: 1 });
      expect(Array.from(new Int32Array(
        residency!.data.buffer,
        residency!.data.byteOffset,
        residency!.data.byteLength / Int32Array.BYTES_PER_ELEMENT,
      ))).toEqual([-1, 8]);
    } finally {
      unregisterHeightfieldTileGpuSource(cache);
    }
  });

  it("reuploads a rebuilt tile instead of accepting stale GPU contents", () => {
    const heightWrites: ArrayBufferView[] = [];
    const device = {
      createTexture: ({ label }: { label: string }) => ({
        label,
        createView: () => ({ label }),
        destroy: () => {},
      }),
      createBuffer: () => ({ destroy: () => {} }),
      queue: {
        writeBuffer: () => {},
        writeTexture: (
          destination: { texture: { label: string } },
          data: ArrayBufferView,
        ) => {
          if (destination.texture.label === "continent heightfield tile atlas") heightWrites.push(data);
        },
      },
    } as unknown as GPUDevice;
    const key = { x: 2, z: -3 };
    let tile = buildHeightfieldTile(key, { sampleHeight: () => 1 });
    const cache = { get: () => tile } as unknown as HeightfieldTileCache;
    registerHeightfieldTileGpuSource(cache, true);
    try {
      expect(createHeightfieldTileGpuAtlas(device, 7)).not.toBeNull();
      expect(uploadHeightfieldTileToGpu(key)).toBe(true);
      expect(uploadHeightfieldTileToGpu(key)).toBe(true);
      expect(heightWrites).toHaveLength(1);

      tile = buildHeightfieldTile(key, { sampleHeight: () => 9 });
      expect(uploadHeightfieldTileToGpu(key)).toBe(true);
      expect(heightWrites).toHaveLength(2);
    } finally {
      unregisterHeightfieldTileGpuSource(cache);
    }
  });

  it("invalidates edited tile residency and disables diagnostics without an authority source", () => {
    const key = { x: 1, z: 1 };
    const { cache } = tileSourceCoveringOnly(new Set([`${key.x},${key.z}`]));
    registerHeightfieldTileGpuSource(cache, true);
    try {
      expect(createHeightfieldTileGpuAtlas(stubDevice(), 7)).not.toBeNull();
      expect(uploadHeightfieldTileToGpu(key)).toBe(true);
      expect(heightfieldTileGpuAtlasHas(key)).toBe(true);

      invalidateHeightfieldTileGpuAtlasBounds(cache, { minX: 256, minZ: 256, maxX: 512, maxZ: 512 });
      expect(heightfieldTileGpuAtlasHas(key)).toBe(false);
    } finally {
      unregisterHeightfieldTileGpuSource(cache);
    }
    expect(heightfieldTileGpuAtlasStats().enabled).toBe(0);
  });

  it.each([
    ["large positive origin", 127, 127],
    ["large negative origin", -128, -128],
    ["small origin", 0, 0],
  ])("uploads only the tiles a tile-aligned page overlaps at a %s", (_name, pageCoord, tileCoord) => {
    const covered = `${tileCoord},${tileCoord}`;
    const { cache, requested } = tileSourceCoveringOnly(new Set([covered]));
    registerHeightfieldTileGpuSource(cache, true);
    try {
      expect(createHeightfieldTileGpuAtlas(stubDevice())).not.toBeNull();

      expect(uploadHeightfieldTilesForPage({ px: pageCoord, pz: pageCoord, level: 2 }, 64)).toBe(true);
      expect([...new Set(requested)]).toEqual([covered]);
    } finally {
      unregisterHeightfieldTileGpuSource(cache);
    }
  });
});
