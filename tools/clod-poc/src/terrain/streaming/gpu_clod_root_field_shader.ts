import { composeTerrainFieldShader } from "../../gpu/wgsl_modules.js";
import { createHeightfieldTileGpuAtlas } from "../../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import { continentTileMeshingEnabled } from "./streamed_root_gpu_config.js";

export interface HeightAtlasBindings {
  readonly view: GPUTextureView;
  readonly params: GPUBuffer;
  readonly dispose?: () => void;
}

function tileAtlasMesherRequested(): boolean {
  const search = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window?.location?.search ?? "";
  return continentTileMeshingEnabled(new URLSearchParams(search));
}

export function terrainFieldShaderWithTileAtlas(): string {
  const procedural = composeTerrainFieldShader()
    .replace(
      "fn surfaceHeightField(x : f32, z : f32) -> f32 {",
      "fn proceduralSurfaceHeightField(x : f32, z : f32) -> f32 {",
    )
    .replace(
      "let nrm = densityGradient(p.x, p.y, p.z);",
      "let nrm = densityGradient(continentStableNormalCoordinate(p.x), continentStableNormalCoordinate(p.y), continentStableNormalCoordinate(p.z));",
    );
  return `${procedural}
@group(0) @binding(10) var continentHeightAtlas : texture_2d<f32>;
@group(0) @binding(11) var<uniform> continentHeightAtlasParams : vec4<f32>;

fn continentPositiveMod(value : i32, divisor : i32) -> i32 {
  return ((value % divisor) + divisor) % divisor;
}

// Adjacent surface-net chunks can differ by one f32 ULP at an otherwise shared
// vertex. Snap only the finite-difference probe in atlas mode so the nearest-
// lattice lookup cannot select opposite sides of a half-cell boundary.
fn continentStableNormalCoordinate(value : f32) -> f32 {
  if (continentHeightAtlasParams.w < 0.5) { return value; }
  return floor(value * 64.0 + 0.5) / 64.0;
}

fn surfaceHeightField(x : f32, z : f32) -> f32 {
  if (continentHeightAtlasParams.w < 0.5) {
    return proceduralSurfaceHeightField(x, z);
  }
  let tileSize = continentHeightAtlasParams.x;
  let tileRes = i32(continentHeightAtlasParams.y);
  let tilesPerSide = i32(continentHeightAtlasParams.z);
  let tileX = i32(floor(x / tileSize));
  let tileZ = i32(floor(z / tileSize));
  let localX = clamp(i32(round(x - f32(tileX) * tileSize)), 0, tileRes - 1);
  let localZ = clamp(i32(round(z - f32(tileZ) * tileSize)), 0, tileRes - 1);
  let slotX = continentPositiveMod(tileX, tilesPerSide);
  let slotZ = continentPositiveMod(tileZ, tilesPerSide);
  return textureLoad(continentHeightAtlas, vec2<i32>(slotX * tileRes + localX, slotZ * tileRes + localZ), 0).x;
}
`;
}

export function createHeightAtlasBindings(device: GPUDevice): HeightAtlasBindings {
  const active = tileAtlasMesherRequested() ? createHeightfieldTileGpuAtlas(device) : null;
  if (active) return { view: active.view, params: active.params };
  const texture = device.createTexture({
    label: "continent heightfield tile atlas disabled",
    size: { width: 1, height: 1 },
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const params = device.createBuffer({
    label: "continent heightfield tile atlas disabled params",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(params, 0, new Float32Array([1, 1, 1, 0]));
  return { view: texture.createView(), params, dispose: () => { texture.destroy(); params.destroy(); } };
}
