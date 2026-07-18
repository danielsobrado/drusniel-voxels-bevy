import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute } from "three/tsl";
import { buildLeaf, buildNeedleSpray } from "../veg/veg_leaf_mesh.js";
import { VegMeshGrower } from "../veg/veg_mesh_grower.js";
import { vegRng, type Rng } from "../veg/veg_rng.js";
import { VEG_TREE_SPECIES } from "../veg/veg_species.js";
import type { SpeciesParams } from "../veg/veg_types.js";
import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import {
  TREE_FOLIAGE_ATLAS_COLUMNS,
  TREE_FOLIAGE_ATLAS_ROWS,
  TREE_FOLIAGE_ATLAS_VARIANTS,
  type TreeFoliageAtlas,
} from "./tree_alpha_mask.js";

interface FoliageCaptureRenderer {
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

export interface TreeFoliageAtlasBakeOptions {
  renderer: unknown;
  settings: TreeSettings;
  webgpu: boolean;
}

export interface TreeFoliageAtlasBakeResult {
  atlas: TreeFoliageAtlas | null;
  supported: boolean;
  reason: string | null;
}

const CAPTURE_MIN_CELL_SIZE = 128;
const DILATION_DISTANCE_PX = 8;
const FOLIAGE_ATLAS_ANISOTROPY = 8;
const TILE_HALF_EXTENT = 0.46;
const MIN_LEAFY_ALPHA_COVERAGE = 0.005;
const MAX_LEAFY_ALPHA_COVERAGE = 0.82;
const MAX_DEAD_ALPHA_COVERAGE = 0.005;
const ALPHA_PRESENT_THRESHOLD = 16;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tilePosition = new THREE.Vector3();
const tileQuaternion = new THREE.Quaternion();
const planeQuaternion = new THREE.Quaternion();
const tileScale = new THREE.Vector3();
const tileMatrix = new THREE.Matrix4();
const captureColor = new THREE.Color();

export async function bakeTreeFoliageAtlas(
  options: TreeFoliageAtlasBakeOptions,
): Promise<TreeFoliageAtlasBakeResult> {
  if (!isFoliageCaptureRenderer(options.renderer)) {
    return { atlas: null, supported: false, reason: "renderer does not expose asynchronous foliage-atlas readback" };
  }

  const cellSize = Math.max(CAPTURE_MIN_CELL_SIZE, Math.floor(options.settings.foliage.maskResolutionPx));
  const width = TREE_FOLIAGE_ATLAS_COLUMNS * cellSize;
  const height = TREE_FOLIAGE_ATLAS_ROWS * cellSize;
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  renderTarget.texture.name = "tree-foliage-capture-target";
  renderTarget.texture.colorSpace = THREE.NoColorSpace;

  const scene = new THREE.Scene();
  const geometry = buildCaptureGeometry(options.settings);
  const material = createCaptureMaterial(options.webgpu);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const camera = new THREE.OrthographicCamera(
    0,
    TREE_FOLIAGE_ATLAS_COLUMNS,
    TREE_FOLIAGE_ATLAS_ROWS,
    0,
    0.1,
    20,
  );
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const previousTarget = options.renderer.getRenderTarget();
  const previousClearColor = options.renderer.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = options.renderer.getClearAlpha();

  try {
    options.renderer.setRenderTarget(renderTarget);
    options.renderer.setClearColor(0x000000, 0);
    options.renderer.clear(true, true, true);
    await Promise.resolve(options.renderer.render(scene, camera));
    const raw = await options.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
    const pixels = copyPixels(raw, width * height * 4);
    if (options.webgpu) flipRows(pixels, width, height);

    const validationError = validateCapturedFoliageAtlasAlpha(pixels, width, height, cellSize);
    if (validationError) return { atlas: null, supported: false, reason: validationError };

    dilateFoliageAtlasCells(pixels, width, cellSize, DILATION_DISTANCE_PX);
    const atlas = createCapturedAtlas(pixels, width, height, cellSize);
    return { atlas, supported: true, reason: null };
  } catch (error) {
    return {
      atlas: null,
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    options.renderer.setRenderTarget(previousTarget);
    options.renderer.setClearColor(previousClearColor, previousClearAlpha);
    geometry.dispose();
    material.dispose();
    renderTarget.dispose();
  }
}

export function replaceTreeFoliageAtlasData(
  target: TreeFoliageAtlas,
  captured: TreeFoliageAtlas,
): void {
  target.texture.image = captured.texture.image;
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = true;
  target.texture.anisotropy = Math.max(target.texture.anisotropy, FOLIAGE_ATLAS_ANISOTROPY);
  target.texture.needsUpdate = true;
  target.columns = captured.columns;
  target.rows = captured.rows;
  target.cellSize = captured.cellSize;
  captured.texture.dispose();
}

function buildCaptureGeometry(settings: TreeSettings): THREE.BufferGeometry {
  const grower = new VegMeshGrower();
  for (let speciesIndex = 0; speciesIndex < TREE_SPECIES.length; speciesIndex++) {
    const species = TREE_SPECIES[speciesIndex] as TreeSpeciesId;
    const params = VEG_TREE_SPECIES[species];
    if (!params.foliage) continue;
    for (let variant = 0; variant < TREE_FOLIAGE_ATLAS_VARIANTS; variant++) {
      const rng = vegRng(settings.seed, `foliage-atlas/${species}/${variant}`);
      buildCaptureTile(grower, params, speciesIndex, variant, rng);
    }
  }
  const geometry = grower.build();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildCaptureTile(
  grower: VegMeshGrower,
  species: SpeciesParams,
  speciesIndex: number,
  variant: number,
  rng: Rng,
): void {
  const foliage = species.foliage;
  if (!foliage) return;
  captureColor.setRGB(species.foliageColor.r, species.foliageColor.g, species.foliageColor.b);
  const centerX = variant + 0.5;
  const centerY = speciesIndex + 0.5;

  if (foliage.kind === "needleSpray") {
    const sprayCount = species.id === "spruce" ? 12 : 10;
    const scaleToTile = 0.72 / Math.max(0.08, foliage.scale[1]);
    const leaf = {
      ...foliage.leaf,
      len: foliage.leaf.len * scaleToTile * 1.08,
      width: foliage.leaf.width * scaleToTile,
      needleCount: Math.max(24, Math.round(foliage.leaf.needleCount * 0.9)),
    };
    for (let index = 0; index < sprayCount; index++) {
      const t = sprayCount <= 1 ? 0 : index / (sprayCount - 1);
      const side = index % 2 === 0 ? 1 : -1;
      const angle = side * (0.38 + rng.float() * 0.68) * (0.45 + t * 0.55);
      tilePosition.set(
        centerX + side * (0.04 + t * 0.16),
        centerY - TILE_HALF_EXTENT * 0.82 + t * TILE_HALF_EXTENT * 1.45,
        (rng.float() - 0.5) * 0.025,
      );
      tileQuaternion.setFromAxisAngle(Z_AXIS, angle);
      planeQuaternion.setFromAxisAngle(X_AXIS, -Math.PI / 2);
      tileQuaternion.multiply(planeQuaternion);
      const scale = scaleToTile * (0.46 + rng.float() * 0.28) * (1.1 - t * 0.22);
      tileScale.set(scale, scale, scale);
      tileMatrix.compose(tilePosition, tileQuaternion, tileScale);
      buildNeedleSpray(grower, tileMatrix, leaf, foliage.scale[1], rng, captureColor, 0.6);
    }
    return;
  }

  const leafCount = 22 + variant * 3 + rng.int(5);
  const scaleToTile = 0.86 / Math.max(0.1, foliage.leaf.len * 2.1);
  for (let index = 0; index < leafCount; index++) {
    const t = leafCount <= 1 ? 0 : index / (leafCount - 1);
    const spread = 0.5 + t * 0.6;
    const angle = (rng.float() - 0.5) * 3 * spread;
    const radius = (0.14 + t * 0.84) * TILE_HALF_EXTENT * (0.74 + rng.float() * 0.44);
    tilePosition.set(
      centerX + Math.sin(angle) * radius,
      centerY - TILE_HALF_EXTENT * 0.8 + (t * 1.42 + rng.float() * 0.28) * TILE_HALF_EXTENT,
      (rng.float() - 0.5) * 0.035,
    );
    tileQuaternion.setFromAxisAngle(Z_AXIS, angle * 0.8 + (rng.float() - 0.5) * 0.5);
    planeQuaternion.setFromAxisAngle(X_AXIS, -Math.PI / 2 + 0.42 + (rng.float() - 0.3) * 0.66);
    tileQuaternion.multiply(planeQuaternion);
    const scale = scaleToTile * (0.72 + rng.float() * 0.48);
    tileScale.set(scale, scale, scale);
    tileMatrix.compose(tilePosition, tileQuaternion, tileScale);
    const hue = 1 + (rng.float() - 0.5) * species.foliageColor.hueVar;
    const color = captureColor.clone().multiplyScalar(hue);
    buildLeaf(grower, tileMatrix, foliage.leaf, color, 0.62);
  }
}

function createCaptureMaterial(webgpu: boolean): THREE.Material {
  if (webgpu) {
    const material = new MeshBasicNodeMaterial();
    material.colorNode = attribute("color", "vec3");
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    return material;
  }
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
}

function createCapturedAtlas(
  pixels: Uint8Array,
  width: number,
  height: number,
  cellSize: number,
): TreeFoliageAtlas {
  const texture = new THREE.DataTexture(
    pixels,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "tree-foliage-captured-atlas";
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = FOLIAGE_ATLAS_ANISOTROPY;
  texture.needsUpdate = true;
  return {
    texture,
    columns: TREE_FOLIAGE_ATLAS_COLUMNS,
    rows: TREE_FOLIAGE_ATLAS_ROWS,
    cellSize,
    dispose() {
      texture.dispose();
    },
  };
}

function copyPixels(raw: ArrayBufferView, expectedLength: number): Uint8Array {
  const source = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (source.length !== expectedLength) {
    throw new Error(`foliage atlas readback returned ${source.length} bytes; expected ${expectedLength}`);
  }
  return source.slice();
}

export function validateCapturedFoliageAtlasAlpha(
  pixels: Uint8Array,
  width: number,
  height: number,
  cellSize: number,
): string | null {
  const expectedWidth = TREE_FOLIAGE_ATLAS_COLUMNS * cellSize;
  const expectedHeight = TREE_FOLIAGE_ATLAS_ROWS * cellSize;
  if (width !== expectedWidth || height !== expectedHeight || pixels.length !== width * height * 4) {
    return `foliage atlas alpha validation received invalid dimensions ${width}x${height}`;
  }

  for (let speciesIndex = 0; speciesIndex < TREE_SPECIES.length; speciesIndex++) {
    const species = TREE_SPECIES[speciesIndex] as TreeSpeciesId;
    for (let variant = 0; variant < TREE_FOLIAGE_ATLAS_VARIANTS; variant++) {
      let covered = 0;
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          const atlasX = variant * cellSize + x;
          const atlasY = speciesIndex * cellSize + y;
          const alpha = pixels[(atlasY * width + atlasX) * 4 + 3] as number;
          if (alpha >= ALPHA_PRESENT_THRESHOLD) covered++;
        }
      }
      const coverage = covered / (cellSize * cellSize);
      if (species === "dead") {
        if (coverage > MAX_DEAD_ALPHA_COVERAGE) {
          return `foliage atlas dead row is unexpectedly opaque (${coverage.toFixed(3)})`;
        }
        continue;
      }
      if (coverage < MIN_LEAFY_ALPHA_COVERAGE) {
        return `foliage atlas ${species} variant ${variant} is empty (${coverage.toFixed(3)})`;
      }
      if (coverage > MAX_LEAFY_ALPHA_COVERAGE) {
        return `foliage atlas ${species} variant ${variant} is too opaque (${coverage.toFixed(3)})`;
      }
    }
  }
  return null;
}

export function flipRows(pixels: Uint8Array, width: number, height: number): void {
  const rowBytes = width * 4;
  const temporary = new Uint8Array(rowBytes);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const top = y * rowBytes;
    const bottom = (height - 1 - y) * rowBytes;
    temporary.set(pixels.subarray(top, top + rowBytes));
    pixels.copyWithin(top, bottom, bottom + rowBytes);
    pixels.set(temporary, bottom);
  }
}

function dilateFoliageAtlasCells(
  pixels: Uint8Array,
  width: number,
  cellSize: number,
  maxDistance: number,
): void {
  for (let row = 0; row < TREE_FOLIAGE_ATLAS_ROWS; row++) {
    for (let column = 0; column < TREE_FOLIAGE_ATLAS_COLUMNS; column++) {
      dilateCellRgb(pixels, width, cellSize, column, row, maxDistance);
    }
  }
}

function dilateCellRgb(
  pixels: Uint8Array,
  width: number,
  cellSize: number,
  column: number,
  row: number,
  maxDistance: number,
): void {
  const pixelCount = cellSize * cellSize;
  const distance = new Int16Array(pixelCount);
  distance.fill(-1);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const originX = column * cellSize;
  const originY = row * cellSize;

  for (let y = 0; y < cellSize; y++) {
    for (let x = 0; x < cellSize; x++) {
      const local = y * cellSize + x;
      const offset = ((originY + y) * width + originX + x) * 4;
      if ((pixels[offset + 3] as number) === 0) continue;
      distance[local] = 0;
      queue[tail++] = local;
    }
  }

  while (head < tail) {
    const local = queue[head++] as number;
    const currentDistance = distance[local] as number;
    if (currentDistance >= maxDistance) continue;
    const x = local % cellSize;
    const y = Math.floor(local / cellSize);
    const sourceOffset = ((originY + y) * width + originX + x) * 4;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= cellSize || nextY >= cellSize) continue;
        const nextLocal = nextY * cellSize + nextX;
        if ((distance[nextLocal] as number) >= 0) continue;
        const nextOffset = ((originY + nextY) * width + originX + nextX) * 4;
        pixels[nextOffset] = pixels[sourceOffset] as number;
        pixels[nextOffset + 1] = pixels[sourceOffset + 1] as number;
        pixels[nextOffset + 2] = pixels[sourceOffset + 2] as number;
        pixels[nextOffset + 3] = 0;
        distance[nextLocal] = currentDistance + 1;
        queue[tail++] = nextLocal;
      }
    }
  }
}

function isFoliageCaptureRenderer(value: unknown): value is FoliageCaptureRenderer {
  if (!value || typeof value !== "object") return false;
  const renderer = value as Partial<FoliageCaptureRenderer>;
  return typeof renderer.render === "function"
    && typeof renderer.setRenderTarget === "function"
    && typeof renderer.getRenderTarget === "function"
    && typeof renderer.getClearColor === "function"
    && typeof renderer.getClearAlpha === "function"
    && typeof renderer.setClearColor === "function"
    && typeof renderer.clear === "function"
    && typeof renderer.readRenderTargetPixelsAsync === "function";
}
