import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  float,
  floor,
  fract,
  min,
  texture,
  uv,
  vec2,
} from "three/tsl";
import type {
  TerrainTextureArrayProbeColor,
  TerrainTextureArrayProbePass,
  TerrainTextureArrayProbeResult,
} from "./terrain_texture_array_probe_types.js";

export type {
  TerrainTextureArrayProbeColor,
  TerrainTextureArrayProbeFinding,
  TerrainTextureArrayProbePass,
  TerrainTextureArrayProbeResult,
} from "./terrain_texture_array_probe_types.js";
export { diagnoseTerrainTextureArrayProbe } from "./terrain_texture_array_probe_types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface TextureArrayProbeRenderer {
  render(scene: THREE.Object3D, camera: THREE.Camera): void | Promise<void>;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  readRenderTargetPixelsAsync(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<ArrayBufferView>;
}

declare global {
  interface Window {
    __drusnielTerrainAlbedoArray?: THREE.DataArrayTexture;
    __drusnielTerrainTextureArrayProbe?: () => Promise<TerrainTextureArrayProbeResult>;
  }
}

const PROBE_STRIPE_WIDTH = 24;
const PROBE_HEIGHT = 24;
const RGBA_BYTES_PER_PIXEL = 4;
const COLOR_CLUSTER_EPSILON = 0.035;
const SYNTHETIC_COLORS: readonly TerrainTextureArrayProbeColor[] = [
  { r: 1, g: 0.04, b: 0.04 },
  { r: 0.04, g: 1, b: 0.04 },
  { r: 0.04, g: 0.04, b: 1 },
  { r: 1, g: 1, b: 0.04 },
] as const;

export function installTerrainTextureArrayProbe(renderer: unknown): void {
  if (typeof window === "undefined") return;
  window.__drusnielTerrainTextureArrayProbe = () => probeTerrainTextureArrays(
    renderer,
    window.__drusnielTerrainAlbedoArray ?? null,
  );
}

export async function probeTerrainTextureArrays(
  renderer: unknown,
  actualTexture: THREE.DataArrayTexture | null,
): Promise<TerrainTextureArrayProbeResult> {
  if (!isTextureArrayProbeRenderer(renderer)) {
    return {
      supported: false,
      reason: "renderer does not expose asynchronous render-target readback",
      synthetic: null,
      actual: null,
    };
  }

  const syntheticTexture = createSyntheticTextureArray();
  try {
    const synthetic = await probeTexture(renderer, syntheticTexture);
    const actual = actualTexture ? await probeTexture(renderer, actualTexture) : null;
    return { supported: true, reason: null, synthetic, actual };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
      synthetic: null,
      actual: null,
    };
  } finally {
    syntheticTexture.dispose();
  }
}

async function probeTexture(
  renderer: TextureArrayProbeRenderer,
  textureArray: THREE.DataArrayTexture,
): Promise<TerrainTextureArrayProbePass> {
  const image = textureArray.image as {
    data?: ArrayBufferView;
    width?: number;
    height?: number;
    depth?: number;
  };
  const layerCount = Math.max(1, Math.floor(image.depth ?? 1));
  const width = layerCount * PROBE_STRIPE_WIDTH;
  const height = PROBE_HEIGHT;
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  renderTarget.texture.colorSpace = THREE.NoColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
  camera.position.z = 1;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new MeshBasicNodeMaterial();
  const localUv: TslNode = uv();
  const layer: TslNode = min(
    floor(localUv.x.mul(float(layerCount))),
    float(layerCount - 1),
  );
  const sampleUv: TslNode = vec2(fract(localUv.x.mul(float(layerCount))), localUv.y);
  material.colorNode = texture(textureArray, sampleUv).depth(layer).rgb;
  material.toneMapped = false;
  material.depthTest = false;
  material.depthWrite = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = renderer.getClearAlpha();

  try {
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    await Promise.resolve(renderer.render(scene, camera));
    const raw = await renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
    const pixels = compactRgbaReadback(raw, width, height);
    const gpuStripeMeans = stripeMeans(pixels, width, height, layerCount);
    const cpuLayerMeans = cpuLayerMeansFor(textureArray, layerCount);
    const nearestCpuLayerByStripe = gpuStripeMeans.map((color) => nearestColorIndex(color, cpuLayerMeans));
    const correct = nearestCpuLayerByStripe.reduce(
      (count, mapped, stripe) => count + (mapped === stripe ? 1 : 0),
      0,
    );
    return {
      layerCount,
      cpuLayerMeans,
      gpuStripeMeans,
      nearestCpuLayerByStripe,
      cpuUniqueColors: countUniqueColors(cpuLayerMeans),
      gpuUniqueColors: countUniqueColors(gpuStripeMeans),
      correctLayerRatio: correct / layerCount,
    };
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    geometry.dispose();
    material.dispose();
    renderTarget.dispose();
  }
}

function createSyntheticTextureArray(): THREE.DataArrayTexture {
  const size = 8;
  const data = new Uint8Array(size * size * SYNTHETIC_COLORS.length * RGBA_BYTES_PER_PIXEL);
  const layerStride = size * size * RGBA_BYTES_PER_PIXEL;
  for (let layer = 0; layer < SYNTHETIC_COLORS.length; layer++) {
    const color = SYNTHETIC_COLORS[layer] as TerrainTextureArrayProbeColor;
    for (let pixel = 0; pixel < size * size; pixel++) {
      const offset = layer * layerStride + pixel * RGBA_BYTES_PER_PIXEL;
      data[offset] = Math.round(color.r * 255);
      data[offset + 1] = Math.round(color.g * 255);
      data[offset + 2] = Math.round(color.b * 255);
      data[offset + 3] = 255;
    }
  }
  const textureArray = new THREE.DataArrayTexture(data, size, size, SYNTHETIC_COLORS.length);
  textureArray.format = THREE.RGBAFormat;
  textureArray.type = THREE.UnsignedByteType;
  textureArray.colorSpace = THREE.NoColorSpace;
  textureArray.wrapS = THREE.RepeatWrapping;
  textureArray.wrapT = THREE.RepeatWrapping;
  textureArray.minFilter = THREE.NearestFilter;
  textureArray.magFilter = THREE.NearestFilter;
  textureArray.generateMipmaps = false;
  textureArray.needsUpdate = true;
  return textureArray;
}

function cpuLayerMeansFor(
  textureArray: THREE.DataArrayTexture,
  layerCount: number,
): TerrainTextureArrayProbeColor[] {
  const image = textureArray.image as {
    data?: ArrayBufferView;
    width?: number;
    height?: number;
  };
  const width = Math.max(1, Math.floor(image.width ?? 1));
  const height = Math.max(1, Math.floor(image.height ?? 1));
  const raw = image.data;
  if (!raw) return Array.from({ length: layerCount }, () => ({ r: 0, g: 0, b: 0 }));
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const layerPixels = width * height;
  const layerStride = layerPixels * RGBA_BYTES_PER_PIXEL;
  const sampleStride = Math.max(1, Math.floor(layerPixels / 4096));
  const srgb = textureArray.colorSpace === THREE.SRGBColorSpace;
  const means: TerrainTextureArrayProbeColor[] = [];

  for (let layer = 0; layer < layerCount; layer++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let samples = 0;
    for (let pixel = 0; pixel < layerPixels; pixel += sampleStride) {
      const offset = layer * layerStride + pixel * RGBA_BYTES_PER_PIXEL;
      if (offset + 2 >= bytes.length) break;
      r += decodeChannel(bytes[offset] as number, srgb);
      g += decodeChannel(bytes[offset + 1] as number, srgb);
      b += decodeChannel(bytes[offset + 2] as number, srgb);
      samples++;
    }
    means.push(samples > 0
      ? { r: r / samples, g: g / samples, b: b / samples }
      : { r: 0, g: 0, b: 0 });
  }
  return means;
}

function stripeMeans(
  pixels: Uint8Array,
  width: number,
  height: number,
  layerCount: number,
): TerrainTextureArrayProbeColor[] {
  const means: TerrainTextureArrayProbeColor[] = [];
  for (let stripe = 0; stripe < layerCount; stripe++) {
    const startX = stripe * PROBE_STRIPE_WIDTH + 2;
    const endX = Math.min(width, (stripe + 1) * PROBE_STRIPE_WIDTH - 2);
    let r = 0;
    let g = 0;
    let b = 0;
    let samples = 0;
    for (let y = 2; y < height - 2; y++) {
      for (let x = startX; x < endX; x++) {
        const offset = (y * width + x) * RGBA_BYTES_PER_PIXEL;
        r += (pixels[offset] as number) / 255;
        g += (pixels[offset + 1] as number) / 255;
        b += (pixels[offset + 2] as number) / 255;
        samples++;
      }
    }
    means.push(samples > 0
      ? { r: r / samples, g: g / samples, b: b / samples }
      : { r: 0, g: 0, b: 0 });
  }
  return means;
}

function decodeChannel(byte: number, srgb: boolean): number {
  const value = byte / 255;
  if (!srgb) return value;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function nearestColorIndex(
  target: TerrainTextureArrayProbeColor,
  colors: readonly TerrainTextureArrayProbeColor[],
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < colors.length; index++) {
    const distance = colorDistance(target, colors[index] as TerrainTextureArrayProbeColor);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function countUniqueColors(colors: readonly TerrainTextureArrayProbeColor[]): number {
  const clusters: TerrainTextureArrayProbeColor[] = [];
  for (const color of colors) {
    if (!clusters.some((cluster) => colorDistance(color, cluster) <= COLOR_CLUSTER_EPSILON)) {
      clusters.push(color);
    }
  }
  return clusters.length;
}

function colorDistance(a: TerrainTextureArrayProbeColor, b: TerrainTextureArrayProbeColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function compactRgbaReadback(
  raw: ArrayBufferView,
  width: number,
  height: number,
): Uint8Array {
  const tightRowBytes = width * RGBA_BYTES_PER_PIXEL;
  const tightLength = tightRowBytes * height;
  const source = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (source.length === tightLength) return source.slice();
  if (height <= 1 || source.length < tightLength) {
    throw new Error(`texture-array probe returned ${source.length} bytes; expected at least ${tightLength}`);
  }

  // WebGPU copies texture rows with bytesPerRow aligned to 256 bytes. Three.js
  // can expose that padded staging layout directly: every row except the final
  // row includes padding, so total bytes are (height - 1) * stride + tightRow.
  const paddedBytes = source.length - tightRowBytes;
  const rowStride = paddedBytes / (height - 1);
  if (!Number.isInteger(rowStride) || rowStride < tightRowBytes) {
    throw new Error(
      `texture-array probe returned unsupported row layout: ${source.length} bytes for ${width}x${height}`,
    );
  }

  const compacted = new Uint8Array(tightLength);
  for (let row = 0; row < height; row++) {
    const sourceOffset = row * rowStride;
    const targetOffset = row * tightRowBytes;
    compacted.set(source.subarray(sourceOffset, sourceOffset + tightRowBytes), targetOffset);
  }
  return compacted;
}

function isTextureArrayProbeRenderer(value: unknown): value is TextureArrayProbeRenderer {
  if (!value || typeof value !== "object") return false;
  const renderer = value as Partial<TextureArrayProbeRenderer>;
  return typeof renderer.render === "function"
    && typeof renderer.setRenderTarget === "function"
    && typeof renderer.getRenderTarget === "function"
    && typeof renderer.getClearColor === "function"
    && typeof renderer.getClearAlpha === "function"
    && typeof renderer.setClearColor === "function"
    && typeof renderer.clear === "function"
    && typeof renderer.readRenderTargetPixelsAsync === "function";
}
