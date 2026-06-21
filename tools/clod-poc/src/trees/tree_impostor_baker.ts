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
  texture: THREE.Texture;
  gridSize: number;
  resolutionPx: number;
  atlasSizePx: number;
  frames: OctahedralFrame[];
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

interface WebGlRenderTargetRenderer {
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
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
  if (!isWebGlRenderTargetRenderer(options.renderer)) {
    return { atlases: {}, supported: false, reason: "renderer does not expose WebGL render-target baking" };
  }

  try {
    const atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = {};
    for (const species of TREE_SPECIES) {
      atlases[species] = bakeSpeciesAtlas(options.renderer, species, options);
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
  renderer: WebGlRenderTargetRenderer,
  species: TreeSpeciesId,
  options: TreeImpostorBakerOptions,
): TreeImpostorAtlas {
  const { settings, geometries } = options;
  const gridSize = settings.impostors.octahedralGridSize;
  const resolutionPx = settings.impostors.resolutionPx;
  const atlasSizePx = gridSize * resolutionPx;
  const frames = octFrames(gridSize, resolutionPx, settings.impostors.atlasPaddingPx);
  const renderTarget = new THREE.WebGLRenderTarget(atlasSizePx, atlasSizePx, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  renderTarget.texture.name = `tree-impostor-atlas-${species}`;
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const geometry = geometries[species][settings.impostors.sourceLod];
  geometry.computeBoundingSphere();
  const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1);
  const center = geometry.boundingSphere?.center ?? new THREE.Vector3();
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 6);
  const bakeMaterial = createBakeMaterial(options.material, settings);
  const mesh = new THREE.Mesh(geometry, bakeMaterial);
  mesh.position.copy(center).multiplyScalar(-1);
  scene.add(mesh);

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
    bakeMaterial.dispose();
  }

  return {
    species,
    texture: renderTarget.texture,
    gridSize,
    resolutionPx,
    atlasSizePx,
    frames,
    ready: true,
    dispose() {
      renderTarget.dispose();
    },
  };
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
  };
  return material;
}

function isWebGlRenderTargetRenderer(renderer: unknown): renderer is WebGlRenderTargetRenderer {
  const candidate = renderer as Partial<WebGlRenderTargetRenderer>;
  return typeof candidate.getContext === "function" &&
    typeof candidate.setRenderTarget === "function" &&
    typeof candidate.getRenderTarget === "function";
}
