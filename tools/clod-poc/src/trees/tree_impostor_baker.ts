import * as THREE from "three";
import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import { octFrames, type OctahedralFrame } from "./tree_impostor_octahedral.js";
import {
  injectTreeFoliageFragmentShader,
  injectTreeFoliageVertexShader,
} from "./tree_material.js";

export interface TreeImpostorAtlas {
  species: TreeSpeciesId;
  /** Legacy alias for the albedo atlas. */
  texture: THREE.Texture;
  /** Sqrt-encoded RGB albedo + coverage in A. */
  albedo?: THREE.Texture;
  /** Normal capture atlas. Depth-in-alpha is reserved for the MRT bake path. */
  normalDepth?: THREE.Texture;
  gridSize: number;
  resolutionPx: number;
  atlasSizePx: number;
  frames: OctahedralFrame[];
  radius?: number;
  centerY?: number;
  ready: boolean;
  dispose(): void;
}

export interface TreeImpostorBakeResult {
  atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  supported: boolean;
  reason: string | null;
}

export interface TreeImpostorBakerOptions {
  renderer: unknown;
  settings: TreeSettings;
  geometries: TreeGeometryMap;
  material: THREE.Material;
}

interface RenderTargetRenderer {
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setViewport(viewport: THREE.Vector4): void;
  setViewport(x: number, y: number, width: number, height: number): void;
}

export async function bakeTreeImpostorAtlases(
  options: TreeImpostorBakerOptions,
): Promise<TreeImpostorBakeResult> {
  if (!options.settings.impostors.enabled) {
    return { atlases: {}, supported: false, reason: "tree impostors disabled" };
  }
  if (!isRenderTargetRenderer(options.renderer)) {
    return { atlases: {}, supported: false, reason: "renderer does not expose render-target baking" };
  }

  try {
    const atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = {};
    const batch = Math.max(1, options.settings.impostors.maxBakesPerFrame);
    for (let i = 0; i < TREE_SPECIES.length; i++) {
      const species = TREE_SPECIES[i];
      atlases[species] = bakeSpeciesAtlas(options.renderer, species, options);
      if ((i + 1) % batch === 0 && i + 1 < TREE_SPECIES.length) await nextFrame();
    }
    return { atlases, supported: true, reason: null };
  } catch (error) {
    return {
      atlases: {},
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function bakeSpeciesAtlas(
  renderer: RenderTargetRenderer,
  species: TreeSpeciesId,
  options: TreeImpostorBakerOptions,
): TreeImpostorAtlas {
  const { settings, geometries } = options;
  const gridSize = settings.impostors.octahedralGridSize;
  const resolutionPx = settings.impostors.resolutionPx;
  const atlasSizePx = gridSize * resolutionPx;
  const frames = octFrames(gridSize, resolutionPx, settings.impostors.atlasPaddingPx);
  const albedoTarget = createRenderTarget(atlasSizePx, `tree-impostor-albedo-${species}`, THREE.SRGBColorSpace);
  const normalDepthTarget = createRenderTarget(atlasSizePx, `tree-impostor-normal-depth-${species}`, THREE.NoColorSpace);

  const scene = new THREE.Scene();
  const geometry = geometries[species][settings.impostors.sourceLod];
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1);
  const center = geometry.boundingSphere?.center ?? new THREE.Vector3();
  const centerY = geometry.boundingBox?.getCenter(new THREE.Vector3()).y ?? center.y;
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 6);
  const albedoMaterial = createBakeMaterial(options.material, settings);
  const normalDepthMaterial = createNormalDepthBakeMaterial();
  const mesh = new THREE.Mesh(geometry, albedoMaterial);
  mesh.position.copy(center).multiplyScalar(-1);
  scene.add(mesh);

  try {
    bakeAtlasTarget(renderer, albedoTarget, scene, camera, frames, resolutionPx, radius);
    mesh.material = normalDepthMaterial;
    bakeAtlasTarget(renderer, normalDepthTarget, scene, camera, frames, resolutionPx, radius);
  } finally {
    albedoMaterial.dispose();
    normalDepthMaterial.dispose();
  }

  return {
    species,
    texture: albedoTarget.texture,
    albedo: albedoTarget.texture,
    normalDepth: normalDepthTarget.texture,
    gridSize,
    resolutionPx,
    atlasSizePx,
    frames,
    radius,
    centerY,
    ready: true,
    dispose() {
      albedoTarget.dispose();
      normalDepthTarget.dispose();
    },
  };
}

function createRenderTarget(
  atlasSizePx: number,
  name: string,
  colorSpace: THREE.ColorSpace,
): THREE.WebGLRenderTarget {
  const renderTarget = new THREE.WebGLRenderTarget(atlasSizePx, atlasSizePx, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  renderTarget.texture.name = name;
  renderTarget.texture.colorSpace = colorSpace;
  return renderTarget;
}

function bakeAtlasTarget(
  renderer: RenderTargetRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  frames: readonly OctahedralFrame[],
  resolutionPx: number,
  radius: number,
): void {
  const oldTarget = renderer.getRenderTarget();
  const oldClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const oldClearAlpha = renderer.getClearAlpha();
  const oldViewport = renderer.getViewport(new THREE.Vector4()).clone();
  try {
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    for (const frame of frames) {
      const direction = new THREE.Vector3(frame.direction[0], frame.direction[1], frame.direction[2]);
      camera.position.copy(direction).multiplyScalar(radius * 3);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.setViewport(frame.x * resolutionPx, frame.y * resolutionPx, resolutionPx, resolutionPx);
      renderer.render(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClearColor, oldClearAlpha);
    renderer.setViewport(oldViewport);
  }
}

function createBakeMaterial(sourceMaterial: THREE.Material, settings: TreeSettings): THREE.MeshBasicMaterial {
  const map = sourceMaterial instanceof THREE.MeshStandardMaterial || sourceMaterial instanceof THREE.MeshBasicMaterial
    ? sourceMaterial.map
    : null;
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    map,
    alphaTest: settings.foliage.enabled ? settings.foliage.alphaTest : 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectTreeFoliageVertexShader(shader.vertexShader);
    shader.fragmentShader = injectTreeFoliageFragmentShader(shader.fragmentShader);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "diffuseColor.rgb = sqrt(max(diffuseColor.rgb, vec3(0.0)));\n#include <opaque_fragment>",
    );
  };
  return material;
}

function createNormalDepthBakeMaterial(): THREE.MeshNormalMaterial {
  // TODO(TREE-2): replace this compatibility pass with a WebGPU MRT/TSL pass
  // that writes linear depth into alpha after the runtime relight path consumes it.
  return new THREE.MeshNormalMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
}

export function encodeTreeImpostorAlbedo(channel: number): number {
  return Math.sqrt(clamp01(channel));
}

export function decodeTreeImpostorAlbedo(channel: number): number {
  const value = clamp01(channel);
  return value * value;
}

export function encodeTreeImpostorNormalComponent(component: number): number {
  return clamp01(component * 0.5 + 0.5);
}

export function decodeTreeImpostorNormalComponent(channel: number): number {
  return clamp01(channel) * 2 - 1;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function isRenderTargetRenderer(renderer: unknown): renderer is RenderTargetRenderer {
  const candidate = renderer as Partial<RenderTargetRenderer>;
  return typeof candidate.setRenderTarget === "function" &&
    typeof candidate.getRenderTarget === "function" &&
    typeof candidate.render === "function" &&
    typeof candidate.getClearColor === "function" &&
    typeof candidate.getClearAlpha === "function" &&
    typeof candidate.setClearColor === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.getViewport === "function" &&
    typeof candidate.setViewport === "function";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
