import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  float,
  normalize,
  positionView,
} from "three/tsl";
import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";
import { octFrames, type OctahedralFrame } from "./tree_impostor_octahedral.js";
import {
  injectTreeFoliageFragmentShader,
  injectTreeFoliageVertexShader,
} from "./tree_material.js";
import {
  materialChurnDiagnostics,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  trackCreatedMaterial,
  trackedMeshBasicMaterial,
  trackedShaderMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";

const TREE_IMPOSTOR_ATLAS_ANISOTROPY = 4;
const TREE_IMPOSTOR_CANONICAL_VARIANT = 0;

export interface TreeImpostorAtlas {
  species: TreeSpeciesId;
  /** Legacy alias for the albedo atlas. */
  texture: THREE.Texture;
  /** Sqrt-encoded RGB albedo + coverage in A. */
  albedo?: THREE.Texture;
  /** Tree-local normal in RGB, normalized linear depth in A. */
  normalDepth?: THREE.Texture;
  gridSize: number;
  resolutionPx: number;
  /** Legacy square size for one variant page. */
  atlasSizePx: number;
  atlasWidthPx?: number;
  atlasHeightPx?: number;
  variantCount?: number;
  frames: OctahedralFrame[];
  variantFrames?: Partial<Record<number, OctahedralFrame[]>>;
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
  webgpu?: boolean;
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
  const variantCount = treeImpostorVariantCount(geometries, species);
  const atlasWidthPx = atlasSizePx;
  const atlasHeightPx = atlasSizePx * variantCount;
  const baseFrames = octFrames(gridSize, resolutionPx, settings.impostors.atlasPaddingPx);
  const variantFrames = createTreeImpostorVariantFrames(baseFrames, atlasSizePx, atlasWidthPx, atlasHeightPx, variantCount);
  const albedoTarget = createRenderTarget(atlasWidthPx, atlasHeightPx, `tree-impostor-albedo-${species}`, THREE.SRGBColorSpace);
  const normalDepthTarget = createRenderTarget(atlasWidthPx, atlasHeightPx, `tree-impostor-normal-depth-${species}`, THREE.NoColorSpace);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  const albedoMaterial = createBakeMaterial(options.material, settings);
  const variantBounds = computeTreeImpostorVariantBounds(geometries, species, settings.impostors.sourceLod, variantCount);
  const normalDepthMaterial = createNormalDepthBakeMaterial(0.01, variantBounds.maxRadius * 6, options.webgpu === true);
  const mesh = new THREE.Mesh(selectTreeImpostorBakeGeometry(geometries, species, settings.impostors.sourceLod), albedoMaterial);
  scene.add(mesh);

  try {
    for (let variant = 0; variant < variantCount; variant++) {
      const geometry = selectTreeImpostorBakeGeometry(geometries, species, settings.impostors.sourceLod, variant);
      const bounds = computeTreeImpostorGeometryBounds(geometry);
      mesh.geometry = geometry;
      mesh.position.copy(bounds.center).multiplyScalar(-1);
      const yOffsetPx = variant * atlasSizePx;
      configureBakeCamera(camera, bounds.radius);
      mesh.material = albedoMaterial;
      bakeAtlasTarget(renderer, albedoTarget, scene, camera, baseFrames, resolutionPx, bounds.radius, yOffsetPx);
      mesh.material = normalDepthMaterial;
      bakeAtlasTarget(renderer, normalDepthTarget, scene, camera, baseFrames, resolutionPx, bounds.radius, yOffsetPx);
    }
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
    atlasWidthPx,
    atlasHeightPx,
    variantCount,
    frames: variantFrames[TREE_IMPOSTOR_CANONICAL_VARIANT] ?? variantFrames[0] ?? baseFrames,
    variantFrames,
    radius: variantBounds.maxRadius,
    centerY: variantBounds.centerY,
    ready: true,
    dispose() {
      albedoTarget.dispose();
      normalDepthTarget.dispose();
    },
  };
}

export function selectTreeImpostorBakeGeometry(
  geometries: TreeGeometryMap,
  species: TreeSpeciesId,
  sourceLod: TreeSettings["impostors"]["sourceLod"],
  variant = TREE_IMPOSTOR_CANONICAL_VARIANT,
): THREE.BufferGeometry {
  return geometries[species].variants?.[normalizeTreeImpostorVariant(variant)]?.[sourceLod]
    ?? geometries[species].variants?.[TREE_IMPOSTOR_CANONICAL_VARIANT]?.[sourceLod]
    ?? geometries[species][sourceLod];
}

export function treeImpostorFramesForVariant(
  atlas: TreeImpostorAtlas,
  variant: number,
): OctahedralFrame[] {
  return atlas.variantFrames?.[normalizeTreeImpostorVariant(variant)] ?? atlas.frames;
}

export function treeImpostorVariantCountForAtlas(atlas: TreeImpostorAtlas): number {
  return Math.max(1, Math.floor(atlas.variantCount ?? 1));
}

function treeImpostorVariantCount(geometries: TreeGeometryMap, species: TreeSpeciesId): number {
  const variants = geometries[species].variants;
  if (!variants) return 1;
  return Math.max(1, Math.min(TREE_STRUCTURAL_VARIANTS, Object.keys(variants).length));
}

function normalizeTreeImpostorVariant(variant: number): number {
  return Math.max(0, Math.min(TREE_STRUCTURAL_VARIANTS - 1, Math.floor(Number.isFinite(variant) ? variant : 0)));
}

function createTreeImpostorVariantFrames(
  baseFrames: readonly OctahedralFrame[],
  atlasSizePx: number,
  atlasWidthPx: number,
  atlasHeightPx: number,
  variantCount: number,
): Partial<Record<number, OctahedralFrame[]>> {
  const out: Partial<Record<number, OctahedralFrame[]>> = {};
  for (let variant = 0; variant < variantCount; variant++) {
    const yOffsetPx = variant * atlasSizePx;
    out[variant] = baseFrames.map((frame) => ({
      ...frame,
      uvMin: [
        (frame.x * frame.resolutionPx + frame.paddingPx) / atlasWidthPx,
        (yOffsetPx + frame.y * frame.resolutionPx + frame.paddingPx) / atlasHeightPx,
      ],
      uvMax: [
        ((frame.x + 1) * frame.resolutionPx - frame.paddingPx) / atlasWidthPx,
        (yOffsetPx + (frame.y + 1) * frame.resolutionPx - frame.paddingPx) / atlasHeightPx,
      ],
    }));
  }
  return out;
}

function computeTreeImpostorVariantBounds(
  geometries: TreeGeometryMap,
  species: TreeSpeciesId,
  sourceLod: TreeSettings["impostors"]["sourceLod"],
  variantCount: number,
): { maxRadius: number; centerY: number } {
  let maxRadius = 1;
  let centerY = 0;
  for (let variant = 0; variant < variantCount; variant++) {
    const bounds = computeTreeImpostorGeometryBounds(selectTreeImpostorBakeGeometry(geometries, species, sourceLod, variant));
    maxRadius = Math.max(maxRadius, bounds.radius);
    if (variant === TREE_IMPOSTOR_CANONICAL_VARIANT) centerY = bounds.centerY;
  }
  return { maxRadius, centerY };
}

function computeTreeImpostorGeometryBounds(geometry: THREE.BufferGeometry): { radius: number; center: THREE.Vector3; centerY: number } {
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1);
  const center = geometry.boundingSphere?.center?.clone() ?? new THREE.Vector3();
  const centerY = geometry.boundingBox?.getCenter(new THREE.Vector3()).y ?? center.y;
  return { radius, center, centerY };
}

function configureBakeCamera(camera: THREE.OrthographicCamera, radius: number): void {
  camera.left = -radius;
  camera.right = radius;
  camera.top = radius;
  camera.bottom = -radius;
  camera.near = 0.01;
  camera.far = radius * 6;
  camera.updateProjectionMatrix();
}

function createRenderTarget(
  atlasWidthPx: number,
  atlasHeightPx: number,
  name: string,
  colorSpace: THREE.ColorSpace,
): THREE.WebGLRenderTarget {
  const renderTarget = new THREE.WebGLRenderTarget(atlasWidthPx, atlasHeightPx, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });
  renderTarget.texture.name = name;
  renderTarget.texture.colorSpace = colorSpace;
  configureTreeImpostorAtlasTexture(renderTarget.texture);
  return renderTarget;
}

export function configureTreeImpostorAtlasTexture(texture: THREE.Texture): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(texture.anisotropy, TREE_IMPOSTOR_ATLAS_ANISOTROPY);
}

function bakeAtlasTarget(
  renderer: RenderTargetRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  frames: readonly OctahedralFrame[],
  resolutionPx: number,
  radius: number,
  yOffsetPx = 0,
): void {
  const oldTarget = renderer.getRenderTarget();
  const oldClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const oldClearAlpha = renderer.getClearAlpha();
  const oldViewport = renderer.getViewport(new THREE.Vector4()).clone();
  try {
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    if (yOffsetPx === 0) renderer.clear(true, true, true);
    for (const frame of frames) {
      const direction = new THREE.Vector3(frame.direction[0], frame.direction[1], frame.direction[2]);
      camera.position.copy(direction).multiplyScalar(radius * 3);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.setViewport(frame.x * resolutionPx, yOffsetPx + frame.y * resolutionPx, resolutionPx, resolutionPx);
      renderer.render(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClearColor, oldClearAlpha);
    renderer.setViewport(oldViewport);
  }
}

function createBakeMaterial(sourceMaterial: THREE.Material, settings: TreeSettings): THREE.Material {
  const map = sourceMaterial instanceof THREE.MeshStandardMaterial || sourceMaterial instanceof THREE.MeshBasicMaterial
    ? sourceMaterial.map
    : null;
  const material = trackedMeshBasicMaterial({
    vertexColors: true,
    map,
    alphaTest: settings.foliage.enabled ? settings.foliage.alphaTest : 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  }, "tree-impostor-bake-albedo");
  materialChurnDiagnostics.trackPipelineSensitiveMutation(material, "onBeforeCompile", null, "tree-impostor-bake", "tree-impostor-bake-shader");
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

function createNormalDepthBakeMaterial(near: number, far: number, webgpu: boolean): THREE.Material {
  if (webgpu) {
    const material = trackCreatedMaterial(
      new MeshBasicNodeMaterial(),
      "tree-impostor-bake-normal-depth-node",
    );
    const linearDepth = clamp(
      positionView.z.negate().sub(float(near)).div(float(Math.max(far - near, 0.0001))),
      0.0,
      1.0,
    );
    material.name = "tree-impostor-normal-depth-bake";
    material.colorNode = normalize(attribute("normal", "vec3")).mul(0.5).add(0.5);
    material.opacityNode = linearDepth;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    return material;
  }

  return trackedShaderMaterial({
    name: "tree-impostor-normal-depth-bake",
    uniforms: {
      near: { value: near },
      far: { value: far },
    },
    vertexShader: TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
    fragmentShader: TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  }, "tree-impostor-bake-normal-depth");
}

export const TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER = `
uniform float near;
uniform float far;
varying vec3 vTreeImpostorLocalNormal;
varying float vTreeImpostorLinearDepth;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vTreeImpostorLocalNormal = normalize(normal);
  vTreeImpostorLinearDepth = clamp((-mvPosition.z - near) / max(far - near, 0.0001), 0.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER = `
varying vec3 vTreeImpostorLocalNormal;
varying float vTreeImpostorLinearDepth;

void main() {
  vec3 packedNormal = normalize(vTreeImpostorLocalNormal) * 0.5 + 0.5;
  gl_FragColor = vec4(packedNormal, vTreeImpostorLinearDepth);
}
`;

function isRenderTargetRenderer(value: unknown): value is RenderTargetRenderer {
  if (!value || typeof value !== "object") return false;
  const renderer = value as Partial<RenderTargetRenderer>;
  return typeof renderer.render === "function"
    && typeof renderer.setRenderTarget === "function"
    && typeof renderer.getRenderTarget === "function"
    && typeof renderer.getClearColor === "function"
    && typeof renderer.getClearAlpha === "function"
    && typeof renderer.setClearColor === "function"
    && typeof renderer.clear === "function"
    && typeof renderer.getViewport === "function"
    && typeof renderer.setViewport === "function";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
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

export function encodeTreeImpostorDepth(depth: number): number {
  return clamp01(depth);
}

export function decodeTreeImpostorDepth(channel: number): number {
  return clamp01(channel);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
