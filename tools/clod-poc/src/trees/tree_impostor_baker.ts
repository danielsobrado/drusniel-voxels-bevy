import * as THREE from "three";
import { TREE_SPECIES, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";
import { octFrames, type OctahedralFrame } from "./tree_impostor_octahedral.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import {
  createTreeImpostorBakeMaterial,
  createTreeImpostorNormalDepthBakeMaterial,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
} from "./tree_impostor_capture_material.js";
import {
  configureTreeImpostorAtlasTexture,
  createTreeImpostorDataTexture,
  createTreeImpostorRenderTarget,
  readTreeImpostorAtlasPixels,
  type TreeImpostorReadbackRenderer,
} from "./tree_impostor_atlas_readback.js";
import {
  createTreeImpostorAtlasDilationJob,
  createTreeImpostorRowFlipJob,
  type TreeImpostorPixelJob,
} from "./tree_impostor_atlas_pixels.js";
import { TREE_IMPOSTOR_BAKE_CONFIG } from "./tree_impostor_bake_config.js";
import {
  TreeImpostorFrameBudget,
  isTreeImpostorBakeAbort,
  throwIfTreeImpostorBakeAborted,
} from "./tree_impostor_bake_scheduler.js";
import {
  publishTreeImpostorBakeProgress,
  type TreeImpostorBakeChannel,
  type TreeImpostorBakeProgress,
  type TreeImpostorBakeStage,
} from "./tree_impostor_bake_progress.js";
import { treeAtlasVariantIndex } from "./tree_variant_selection.js";
import { TREE_IMPOSTOR_AGE_BUCKETS } from "./morphology/constants.js";
import { deformTreeVertexReference } from "./morphology/deformation_reference.js";
import type { TreeInstanceMorphology } from "./morphology/types.js";

export {
  configureTreeImpostorAtlasTexture,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
};

const TREE_IMPOSTOR_CANONICAL_VARIANT = 0;
const TREE_IMPOSTOR_MATURE_AGE = TREE_IMPOSTOR_AGE_BUCKETS[1] ?? 0.6;
const PIXEL_JOB_OPERATIONS_PER_STEP = 256;
/** One atlas page per live structural variant keeps mesh and impostor silhouettes identical. */
export const TREE_IMPOSTOR_MAX_ATLAS_VARIANTS = TREE_STRUCTURAL_VARIANTS;

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
  layerCount?: number;
  ageBuckets?: readonly number[];
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
  foliageAtlas?: TreeFoliageAtlas;
  webgpu?: boolean;
  signal?: AbortSignal;
  maxBuildMsPerFrame?: number;
  onProgress?: (progress: TreeImpostorBakeProgress) => void;
}

interface RenderTargetRenderer extends TreeImpostorReadbackRenderer {
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

interface SpeciesBakeContext {
  species: TreeSpeciesId;
  speciesIndex: number;
  variantCount: number;
  layerCount: number;
  ageBuckets: readonly number[];
  gridSize: number;
  resolutionPx: number;
  atlasSizePx: number;
  atlasWidthPx: number;
  atlasHeightPx: number;
  baseFrames: OctahedralFrame[];
  variantFrames: Partial<Record<number, OctahedralFrame[]>>;
  variantBounds: { maxRadius: number; centerY: number };
}

class BakeProgressTracker {
  private completedWork = 0;
  private readonly totalWork: number;

  constructor(
    private readonly options: TreeImpostorBakerOptions,
    private readonly budget: TreeImpostorFrameBudget,
  ) {
    this.totalWork = estimateTotalBakeWork(options);
  }

  publish(
    stage: TreeImpostorBakeStage,
    context: SpeciesBakeContext | null,
    detail: {
      variant?: number | null;
      channel?: TreeImpostorBakeChannel;
      tileIndex?: number;
      tileCount?: number;
      completedDelta?: number;
    } = {},
  ): void {
    this.completedWork = Math.min(this.totalWork, this.completedWork + Math.max(0, detail.completedDelta ?? 0));
    publishTreeImpostorBakeProgress({
      stage,
      species: context?.species ?? null,
      speciesIndex: context?.speciesIndex ?? TREE_SPECIES.length,
      speciesCount: TREE_SPECIES.length,
      variant: detail.variant ?? null,
      variantCount: context?.variantCount ?? TREE_STRUCTURAL_VARIANTS,
      channel: detail.channel ?? null,
      tileIndex: detail.tileIndex ?? 0,
      tileCount: detail.tileCount ?? 0,
      completedWork: this.completedWork,
      totalWork: this.totalWork,
      percent: this.totalWork > 0 ? this.completedWork / this.totalWork : 1,
      frameMs: Math.max(this.budget.reportedFrameMs(), this.budget.elapsedMs()),
    }, this.options.onProgress);
  }
}

export function treeImpostorAgeBucketsForSettings(settings: TreeSettings): readonly number[] {
  return settings.impostors.bakeAgeLayers ? TREE_IMPOSTOR_AGE_BUCKETS : [TREE_IMPOSTOR_MATURE_AGE];
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

  const maxBuildMs = options.maxBuildMsPerFrame ?? TREE_IMPOSTOR_BAKE_CONFIG.maxBuildMsPerFrame;
  const budget = new TreeImpostorFrameBudget(maxBuildMs);
  const progress = new BakeProgressTracker(options, budget);
  const atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = {};

  try {
    for (let index = 0; index < TREE_SPECIES.length; index++) {
      throwIfTreeImpostorBakeAborted(options.signal);
      const species = TREE_SPECIES[index];
      const atlas = await bakeSpeciesAtlas(options.renderer, species, index, options, budget, progress);
      atlases[species] = atlas;
      progress.publish("committing", createSpeciesContext(species, index, options), { completedDelta: 1 });
      await budget.yieldIfExpired(true);
    }
    progress.publish("complete", null);
    return { atlases, supported: true, reason: null };
  } catch (error) {
    for (const atlas of Object.values(atlases)) atlas?.dispose();
    const cancelled = isTreeImpostorBakeAbort(error);
    progress.publish(cancelled ? "cancelled" : "failed", null);
    return {
      atlases: {},
      supported: false,
      reason: cancelled
        ? error instanceof Error ? error.message : "tree impostor baking cancelled"
        : error instanceof Error ? error.message : String(error),
    };
  }
}

async function bakeSpeciesAtlas(
  renderer: RenderTargetRenderer,
  species: TreeSpeciesId,
  speciesIndex: number,
  options: TreeImpostorBakerOptions,
  budget: TreeImpostorFrameBudget,
  progress: BakeProgressTracker,
): Promise<TreeImpostorAtlas> {
  const context = createSpeciesContext(species, speciesIndex, options);
  progress.publish("allocating", context, { completedDelta: 1 });
  throwIfTreeImpostorBakeAborted(options.signal);

  const albedoTarget = createTreeImpostorRenderTarget(
    context.atlasWidthPx,
    context.atlasHeightPx,
    `tree-impostor-albedo-${species}`,
  );
  const normalDepthTarget = createTreeImpostorRenderTarget(
    context.atlasWidthPx,
    context.atlasHeightPx,
    `tree-impostor-normal-depth-${species}`,
  );
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  const albedoMaterial = createTreeImpostorBakeMaterial(
    options.material,
    options.settings,
    options.foliageAtlas,
    options.webgpu === true,
  );
  const normalDepthMaterial = createTreeImpostorNormalDepthBakeMaterial(
    0.01,
    context.variantBounds.maxRadius * 6,
    options.foliageAtlas,
    options.webgpu === true,
  );
  const mesh = new THREE.Mesh(
    selectTreeImpostorBakeGeometry(options.geometries, species, options.settings.impostors.sourceLod),
    albedoMaterial,
  );
  scene.add(mesh);

  let cleanedAlbedo: THREE.DataTexture | null = null;
  let cleanedNormalDepth: THREE.DataTexture | null = null;
  let keepRenderTargets = true;
  try {
    clearBakeTarget(renderer, albedoTarget);
    clearBakeTarget(renderer, normalDepthTarget);
    await budget.yieldIfExpired();

    await captureSpeciesChannel(
      renderer,
      albedoTarget,
      scene,
      camera,
      mesh,
      albedoMaterial,
      "albedo",
      context,
      options,
      budget,
      progress,
    );
    await captureSpeciesChannel(
      renderer,
      normalDepthTarget,
      scene,
      camera,
      mesh,
      normalDepthMaterial,
      "normal-depth",
      context,
      options,
      budget,
      progress,
    );

    progress.publish("readback", context, { channel: "albedo" });
    await budget.yieldIfExpired(true);
    const albedoPixels = await readTreeImpostorAtlasPixels(
      renderer,
      albedoTarget,
      context.atlasWidthPx,
      context.atlasHeightPx,
    );
    progress.publish("readback", context, { channel: "albedo", completedDelta: 1 });

    progress.publish("readback", context, { channel: "normal-depth" });
    await budget.yieldIfExpired(true);
    const normalDepthPixels = await readTreeImpostorAtlasPixels(
      renderer,
      normalDepthTarget,
      context.atlasWidthPx,
      context.atlasHeightPx,
    );
    progress.publish("readback", context, { channel: "normal-depth", completedDelta: 1 });

    if (albedoPixels && normalDepthPixels) {
      if (options.webgpu === true) {
        await runPixelJob(
          createTreeImpostorRowFlipJob(albedoPixels, context.atlasWidthPx, context.atlasHeightPx, context.atlasSizePx),
          "row-flip",
          "albedo",
          context,
          options,
          budget,
          progress,
        );
        await runPixelJob(
          createTreeImpostorRowFlipJob(normalDepthPixels, context.atlasWidthPx, context.atlasHeightPx, context.atlasSizePx),
          "row-flip",
          "normal-depth",
          context,
          options,
          budget,
          progress,
        );
      }

      await runPixelJob(
        createTreeImpostorAtlasDilationJob({
          albedo: albedoPixels,
          normalDepth: normalDepthPixels,
          width: context.atlasWidthPx,
          height: context.atlasHeightPx,
          tileSize: context.resolutionPx,
        }),
        "dilating",
        null,
        context,
        options,
        budget,
        progress,
      );

      throwIfTreeImpostorBakeAborted(options.signal);
      progress.publish("uploading", context, { channel: "albedo" });
      await budget.yieldIfExpired(true);
      cleanedAlbedo = createTreeImpostorDataTexture(
        albedoPixels,
        context.atlasWidthPx,
        context.atlasHeightPx,
        albedoTarget.texture.name,
      );
      progress.publish("uploading", context, { channel: "albedo", completedDelta: 1 });

      progress.publish("uploading", context, { channel: "normal-depth" });
      await budget.yieldIfExpired(true);
      cleanedNormalDepth = createTreeImpostorDataTexture(
        normalDepthPixels,
        context.atlasWidthPx,
        context.atlasHeightPx,
        normalDepthTarget.texture.name,
      );
      progress.publish("uploading", context, { channel: "normal-depth", completedDelta: 1 });
      keepRenderTargets = false;
    }

    const albedo = cleanedAlbedo ?? albedoTarget.texture;
    const normalDepth = cleanedNormalDepth ?? normalDepthTarget.texture;
    if (!keepRenderTargets) {
      albedoTarget.dispose();
      normalDepthTarget.dispose();
    }
    return createAtlas(context, albedo, normalDepth, keepRenderTargets ? { albedoTarget, normalDepthTarget } : null);
  } catch (error) {
    cleanedAlbedo?.dispose();
    cleanedNormalDepth?.dispose();
    albedoTarget.dispose();
    normalDepthTarget.dispose();
    throw error;
  } finally {
    albedoMaterial.dispose();
    normalDepthMaterial.dispose();
  }
}

async function captureSpeciesChannel(
  renderer: RenderTargetRenderer,
  target: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  mesh: THREE.Mesh,
  material: THREE.Material,
  channel: Exclude<TreeImpostorBakeChannel, null>,
  context: SpeciesBakeContext,
  options: TreeImpostorBakerOptions,
  budget: TreeImpostorFrameBudget,
  progress: BakeProgressTracker,
): Promise<void> {
  mesh.material = material;
  const tileCount = context.baseFrames.length * context.layerCount;
  let tileIndex = 0;
  for (let variant = 0; variant < context.variantCount; variant++) {
    throwIfTreeImpostorBakeAborted(options.signal);
    const sourceGeometry = selectTreeImpostorBakeGeometry(
      options.geometries,
      context.species,
      options.settings.impostors.sourceLod,
      variant,
    );
    for (let ageBucket = 0; ageBucket < context.ageBuckets.length; ageBucket++) {
      const geometry = createTreeImpostorAgeGeometry(
        sourceGeometry,
        context.species,
        context.ageBuckets[ageBucket] ?? TREE_IMPOSTOR_MATURE_AGE,
        options.settings,
      );
      try {
        const bounds = computeTreeImpostorGeometryBounds(geometry);
        mesh.geometry = geometry;
        mesh.position.copy(bounds.center).multiplyScalar(-1);
        configureBakeCamera(camera, bounds.radius);
        const layerIndex = variant * context.ageBuckets.length + ageBucket;
        const yOffsetPx = layerIndex * context.atlasSizePx;
        for (const frame of context.baseFrames) {
          throwIfTreeImpostorBakeAborted(options.signal);
          bakeAtlasTile(
            renderer,
            target,
            scene,
            camera,
            frame,
            context.resolutionPx,
            bounds.radius,
            yOffsetPx,
          );
          tileIndex++;
          progress.publish("capturing", context, {
            variant,
            channel,
            tileIndex,
            tileCount,
            completedDelta: 1,
          });
          await budget.yieldIfExpired();
        }
      } finally {
        geometry.dispose();
      }
    }
  }
}

async function runPixelJob(
  job: TreeImpostorPixelJob,
  stage: "row-flip" | "dilating",
  channel: TreeImpostorBakeChannel,
  context: SpeciesBakeContext,
  options: TreeImpostorBakerOptions,
  budget: TreeImpostorFrameBudget,
  progress: BakeProgressTracker,
): Promise<void> {
  let previousCompleted = 0;
  while (true) {
    throwIfTreeImpostorBakeAborted(options.signal);
    const done = job.step(PIXEL_JOB_OPERATIONS_PER_STEP);
    const completed = job.completed();
    progress.publish(stage, context, {
      channel,
      tileIndex: completed,
      tileCount: job.total(),
      completedDelta: Math.max(0, completed - previousCompleted),
    });
    previousCompleted = completed;
    if (done) return;
    await budget.yieldIfExpired();
  }
}

function createSpeciesContext(
  species: TreeSpeciesId,
  speciesIndex: number,
  options: TreeImpostorBakerOptions,
): SpeciesBakeContext {
  const { settings, geometries } = options;
  const gridSize = settings.impostors.octahedralGridSize;
  const resolutionPx = settings.impostors.resolutionPx;
  const paddingPx = settings.impostors.atlasPaddingPx;
  const atlasSizePx = gridSize * resolutionPx;
  const variantCount = treeImpostorVariantCount(geometries, species);
  const ageBuckets = treeImpostorAgeBucketsForSettings(settings);
  const layerCount = variantCount * ageBuckets.length;
  const atlasWidthPx = atlasSizePx;
  const atlasHeightPx = atlasSizePx * layerCount;
  const baseFrames = octFrames(gridSize, resolutionPx, paddingPx);
  return {
    species,
    speciesIndex,
    variantCount,
    layerCount,
    ageBuckets,
    gridSize,
    resolutionPx,
    atlasSizePx,
    atlasWidthPx,
    atlasHeightPx,
    baseFrames,
    variantFrames: createTreeImpostorVariantFrames(
      baseFrames,
      atlasSizePx,
      atlasWidthPx,
      atlasHeightPx,
      resolutionPx,
      paddingPx,
      variantCount,
      ageBuckets.length,
    ),
    variantBounds: computeTreeImpostorVariantBounds(
      geometries,
      species,
      settings.impostors.sourceLod,
      variantCount,
    ),
  };
}

function createAtlas(
  context: SpeciesBakeContext,
  albedo: THREE.Texture,
  normalDepth: THREE.Texture,
  renderTargets: {
    albedoTarget: THREE.WebGLRenderTarget;
    normalDepthTarget: THREE.WebGLRenderTarget;
  } | null,
): TreeImpostorAtlas {
  return {
    species: context.species,
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: context.gridSize,
    resolutionPx: context.resolutionPx,
    atlasSizePx: context.atlasSizePx,
    atlasWidthPx: context.atlasWidthPx,
    atlasHeightPx: context.atlasHeightPx,
    variantCount: context.variantCount,
    layerCount: context.layerCount,
    ageBuckets: context.ageBuckets,
    frames: context.variantFrames[TREE_IMPOSTOR_CANONICAL_VARIANT] ?? context.variantFrames[0] ?? context.baseFrames,
    variantFrames: context.variantFrames,
    radius: context.variantBounds.maxRadius,
    centerY: context.variantBounds.centerY,
    ready: true,
    dispose() {
      if (renderTargets) {
        renderTargets.albedoTarget.dispose();
        renderTargets.normalDepthTarget.dispose();
      } else {
        albedo.dispose();
        normalDepth.dispose();
      }
    },
  };
}

function estimateTotalBakeWork(options: TreeImpostorBakerOptions): number {
  let total = 0;
  const ageLayerCount = treeImpostorAgeBucketsForSettings(options.settings).length;
  for (const species of TREE_SPECIES) {
    const gridSize = options.settings.impostors.octahedralGridSize;
    const variantCount = treeImpostorVariantCount(options.geometries, species);
    const layerCount = variantCount * ageLayerCount;
    const captureTiles = gridSize * gridSize * layerCount * 2;
    const atlasHeight = gridSize * options.settings.impostors.resolutionPx * layerCount;
    const flipRows = options.webgpu === true ? Math.floor(atlasHeight / 2) * 2 : 0;
    const dilationTiles = gridSize * gridSize * layerCount;
    total += 1 + captureTiles + 2 + flipRows + dilationTiles + 2 + 1;
  }
  return Math.max(1, total);
}

function clearBakeTarget(renderer: RenderTargetRenderer, target: THREE.WebGLRenderTarget): void {
  withBakeTarget(renderer, target, () => renderer.clear(true, true, true));
}

function bakeAtlasTile(
  renderer: RenderTargetRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  frame: OctahedralFrame,
  resolutionPx: number,
  radius: number,
  yOffsetPx: number,
): void {
  withBakeTarget(renderer, renderTarget, () => {
    const direction = new THREE.Vector3(frame.direction[0], frame.direction[1], frame.direction[2]);
    camera.position.copy(direction).multiplyScalar(radius * 3);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.setViewport(
      frame.x * resolutionPx,
      yOffsetPx + frame.y * resolutionPx,
      resolutionPx,
      resolutionPx,
    );
    renderer.render(scene, camera);
  });
}

function withBakeTarget(
  renderer: RenderTargetRenderer,
  target: THREE.WebGLRenderTarget,
  operation: () => void,
): void {
  const oldTarget = renderer.getRenderTarget();
  const oldClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const oldClearAlpha = renderer.getClearAlpha();
  const oldViewport = renderer.getViewport(new THREE.Vector4()).clone();
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    operation();
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClearColor, oldClearAlpha);
    renderer.setViewport(oldViewport);
  }
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
  const page = treeAtlasVariantIndex(
    normalizeTreeImpostorVariant(variant),
    treeImpostorVariantCountForAtlas(atlas),
  );
  return atlas.variantFrames?.[page] ?? atlas.frames;
}

export function treeImpostorVariantCountForAtlas(atlas: TreeImpostorAtlas): number {
  return Math.max(1, Math.floor(atlas.variantCount ?? 1));
}

function treeImpostorVariantCount(geometries: TreeGeometryMap, species: TreeSpeciesId): number {
  const variants = geometries[species].variants;
  if (!variants) return 1;
  return Math.max(
    1,
    Math.min(TREE_STRUCTURAL_VARIANTS, TREE_IMPOSTOR_MAX_ATLAS_VARIANTS, Object.keys(variants).length),
  );
}

function normalizeTreeImpostorVariant(variant: number): number {
  return Math.max(
    0,
    Math.min(TREE_STRUCTURAL_VARIANTS - 1, Math.floor(Number.isFinite(variant) ? variant : 0)),
  );
}

function createTreeImpostorVariantFrames(
  baseFrames: readonly OctahedralFrame[],
  atlasSizePx: number,
  atlasWidthPx: number,
  atlasHeightPx: number,
  resolutionPx: number,
  paddingPx: number,
  variantCount: number,
  ageLayerCount: number,
): Partial<Record<number, OctahedralFrame[]>> {
  const out: Partial<Record<number, OctahedralFrame[]>> = {};
  const canonicalAgeLayer = Math.floor(Math.max(0, ageLayerCount - 1) / 2);
  for (let variant = 0; variant < variantCount; variant++) {
    const yOffsetPx = (variant * ageLayerCount + canonicalAgeLayer) * atlasSizePx;
    out[variant] = baseFrames.map((frame) => ({
      ...frame,
      uvMin: [
        (frame.x * resolutionPx + paddingPx) / atlasWidthPx,
        (yOffsetPx + frame.y * resolutionPx + paddingPx) / atlasHeightPx,
      ],
      uvMax: [
        ((frame.x + 1) * resolutionPx - paddingPx) / atlasWidthPx,
        (yOffsetPx + (frame.y + 1) * resolutionPx - paddingPx) / atlasHeightPx,
      ],
    }));
  }
  return out;
}

export function createTreeImpostorAgeGeometry(
  source: THREE.BufferGeometry,
  species: TreeSpeciesId,
  age01: number,
  settings: TreeSettings,
): THREE.BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const height = geometry.getAttribute("treeHeight01");
  const radial = geometry.getAttribute("treeRadial01");
  const branchLevel = geometry.getAttribute("treeBranchLevel");
  const branchPhase = geometry.getAttribute("treeBranchPhase");
  const rootMask = geometry.getAttribute("treeRootMask");
  if (!position || !normal || !height || !radial || !branchLevel || !branchPhase || !rootMask) return geometry;

  source.computeBoundingBox();
  const treeHeight = Math.max(1e-6, source.boundingBox?.max.y ?? settings.species[species].trunkHeightM);
  const crownStart01 = Math.max(0, Math.min(1, settings.species[species].trunkHeightM / treeHeight));
  const morphology: TreeInstanceMorphology = {
    age01,
    leanX: 0,
    leanZ: 0,
    crownBiasX: 0,
    crownBiasZ: 0,
    crownWidth: 1,
    crownFlattening: 1,
    branchDroop: settings.species[species].morphologyRuntime.baseDroop,
    foliageDensity: 1,
    health01: 1,
    rootFlare: 1,
    stiffness: 1,
  };
  for (let index = 0; index < position.count; index++) {
    const result = deformTreeVertexReference({
      position: [position.getX(index), position.getY(index), position.getZ(index)],
      normal: [normal.getX(index), normal.getY(index), normal.getZ(index)],
      attributes: {
        treeHeight01: height.getX(index),
        treeRadial01: radial.getX(index),
        treeBranchLevel: branchLevel.getX(index),
        treeBranchPhase: branchPhase.getX(index),
        treeRootMask: rootMask.getX(index),
        treeFoliageMask: geometry.getAttribute("treeFoliageMask")?.getX(index) ?? 0,
        treeFoliageCard: geometry.getAttribute("treeFoliageCard")?.getX(index) ?? 0,
      },
      morphology,
      treeHeight,
      crownRadius: settings.species[species].crownRadiusM,
      crownStart01,
    });
    position.setXYZ(index, ...result.position);
    normal.setXYZ(index, ...result.normal);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
    const bounds = computeTreeImpostorGeometryBounds(
      selectTreeImpostorBakeGeometry(geometries, species, sourceLod, variant),
    );
    maxRadius = Math.max(maxRadius, bounds.radius);
    if (variant === TREE_IMPOSTOR_CANONICAL_VARIANT) centerY = bounds.centerY;
  }
  return { maxRadius, centerY };
}

function computeTreeImpostorGeometryBounds(
  geometry: THREE.BufferGeometry,
): { radius: number; center: THREE.Vector3; centerY: number } {
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
