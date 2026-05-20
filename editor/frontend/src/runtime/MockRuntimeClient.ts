import { getMockRenderQualityReadouts, mockRuntimeMetrics, mockWaterRuntimeSnapshot } from "../mocks/mockRuntime";
import { mockAtlasMapping, mockChunks, mockLights, mockProps, mockProtectedAreas } from "../mocks/mockWorld";
import type { EditorDiagnosticsCategory, EditorDiagnosticsState, RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { RenderFeatureFlag, RuntimeMetrics } from "../types/runtime";
import type { BlockAtlasMap, BlockType, LightInstance, PropInstance, ProtectedArea, TerrainGenerationConfig, TerrainPreviewRequest, TerrainPreviewSample, TerrainRecipe, WaterBody, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { RuntimeClient } from "./RuntimeClient";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type { EditorCameraInteractionMode, EditorCameraKind, EditorCameraPose, EditorCameraProjection, EditorCameraState, EditorCameraTemplate, RuntimeConnectionState, RuntimeProtectedAreaConflict, RuntimeSnapshot } from "./runtimeSchemas";
import { runtimeCommandSuccess } from "./runtimeSchemas";

const mockCapabilities = {
  canSelectEntity: true,
  canFocusCamera: true,
  canRebuildChunks: true,
  canSetRenderQuality: true,
  canDebugWaterReflections: true,
  canRunWaterVisualProbe: true,
  canEditAtlasMapping: true,
  canEditProtectedAreas: true,
  canEditLights: true,
  canSaveWorldSnapshot: true,
};

const mockTerrainConfig: TerrainGenerationConfig = {
  height: { min: 14, max: 118, sea_level: 0 },
  continent: { scale: 0.001, amplitude: 40, octaves: 2, persistence: 0.5, lacunarity: 2 },
  mountains: {
    scale: 0.008,
    amplitude: 120,
    octaves: 7,
    persistence: 0.48,
    lacunarity: 2.3,
    ridge_power: 1.8,
    massif_scale: 0.0035,
    massif_amplitude: 38,
    massif_threshold: 0.38,
    massif_power: 1.65,
  },
  hills: { scale: 0.025, amplitude: 25, octaves: 4, persistence: 0.5, lacunarity: 2 },
  detail: { scale: 0.1, amplitude: 3, octaves: 3, persistence: 0.5, lacunarity: 2 },
  caves: { enabled: false },
  rivers: { enabled: true, scale: 0.003, width: 4, depth: 6, octaves: 3, tributary_scale: 0.008, tributary_width: 2 },
  water_bodies: {
    enabled: true,
    lakes: { enabled: true, spacing: 96, density: 0.38, min_radius: 18, max_radius: 42, min_depth: 3, max_depth: 8, shore_power: 1.45 },
    ponds: { enabled: true, spacing: 48, density: 0.34, min_radius: 7, max_radius: 17, min_depth: 2, max_depth: 5, shore_power: 1.25 },
    aquifers: { enabled: false, max_y: 10, noise_scale: 0.045, threshold: 0.84 },
  },
  biome_modifiers: {},
};

const mockTerrainRecipe: TerrainRecipe = {
  version: 1,
  seed: 0,
  config: mockTerrainConfig,
};

const mockPropStats = (props: readonly PropInstance[]) => ({
  totalInstances: props.length,
  visibleInstances: props.filter((prop) => prop.visible).length,
  hiddenInstances: props.filter((prop) => !prop.visible).length,
  billboardedCount: props.filter((prop) => prop.billboardEnabled).length,
  threeDCount: props.filter((prop) => !prop.billboardEnabled).length,
  lodSwitches: props.filter((prop) => prop.currentLod !== prop.lodState).length,
  missingGeneratedAssets: props.filter((prop) => !prop.generatedAssetAvailable).length,
  boundsWarnings: props.filter((prop) => prop.boundsWarning).length,
  instancedGroups: new Set(props.map((prop) => prop.type)).size,
  shadowCastCount: props.filter((prop) => prop.shadowCast).length,
});

const pointInsideBounds = (point: readonly [number, number, number], bounds: ProtectedArea["bounds"]): boolean =>
  point[0] >= bounds.min[0] &&
  point[0] <= bounds.max[0] &&
  point[1] >= bounds.min[1] &&
  point[1] <= bounds.max[1] &&
  point[2] >= bounds.min[2] &&
  point[2] <= bounds.max[2];

const boundsOverlap = (left: ProtectedArea["bounds"], right: ProtectedArea["bounds"]): boolean =>
  left.min[0] <= right.max[0] &&
  left.max[0] >= right.min[0] &&
  left.min[1] <= right.max[1] &&
  left.max[1] >= right.min[1] &&
  left.min[2] <= right.max[2] &&
  left.max[2] >= right.min[2];

const blockRuntimeName = (block: BlockType): string => {
  switch (block) {
    case "grass":
      return "TopSoil";
    case "dirt":
      return "SubSoil";
    case "rock":
      return "Rock";
    case "sand":
      return "Sand";
  }
};

const defaultEditorCameraPose: EditorCameraPose = {
  position: [96, 80, 96],
  target: [64, 48, 64],
  yaw: -Math.PI / 4,
  pitch: -0.45,
  roll: 0,
  radius: 64,
  fovDegrees: 70,
  orthographicScale: 96,
};

export class MockRuntimeClient implements RuntimeClient {
  private renderQualityPreset: RenderQualityPreset = mockRuntimeMetrics.renderQualityPreset;
  private runtimeMetrics: RuntimeMetrics = JSON.parse(JSON.stringify(mockRuntimeMetrics)) as RuntimeMetrics;
  private atlasMapping: BlockAtlasMap = { ...mockAtlasMapping };
  private atlasDirty = false;
  private props: PropInstance[] = [...mockProps];
  private lights: LightInstance[] = [...mockLights];
  private protectedAreas: ProtectedArea[] = [...mockProtectedAreas];
  private connectionState: RuntimeConnectionState = "mock";
  private viewportDebug: ViewportOverlayState = {
    chunkBounds: true,
    voxelGrid: true,
    waterDebug: false,
    protectedAreas: true,
    propBounds: true,
    propBillboards: true,
    agentTargets: true,
    atlasPreview: false,
    wireframe: false,
  };
  private editorDiagnostics: EditorDiagnosticsState = {
    enabled: false,
    categories: ["nativeViewport", "frontend", "input", "selection", "hover", "highlight", "runtime"],
  };
  private editorCamera: EditorCameraState = {
    interactionMode: "menu",
    cameraKind: "firstPerson",
    projection: "perspective",
    pose: defaultEditorCameraPose,
    alignToAxes: false,
    automaticAxis: true,
    savedCameras: [],
  };
  private readonly handlers = new Set<RuntimeEventHandler>();

  getConnectionState(): RuntimeConnectionState {
    return this.connectionState;
  }

  async getRuntimeSnapshot() {
    return runtimeCommandSuccess(this.createSnapshot());
  }

  async getRenderQuality() {
    return runtimeCommandSuccess({
      preset: this.renderQualityPreset,
      metrics: getMockRenderQualityReadouts(this.renderQualityPreset),
    });
  }

  async setRenderQuality(preset: RenderQualityPreset) {
    this.renderQualityPreset = preset;
    this.runtimeMetrics = {
      ...this.runtimeMetrics,
      renderQualityPreset: preset,
      renderQualityReadouts: getMockRenderQualityReadouts(preset),
    };
    return runtimeCommandSuccess({
      preset: this.renderQualityPreset,
      metrics: getMockRenderQualityReadouts(this.renderQualityPreset),
    });
  }

  async setRenderFeatureFlag(feature: RenderFeatureFlag, enabled: boolean, value?: number) {
    const metrics = this.runtimeMetrics;
    switch (feature) {
      case "gtao":
        this.runtimeMetrics = {
          ...metrics,
          ambientOcclusion: { ...metrics.ambientOcclusion, gtaoEnabled: enabled },
        };
        break;
      case "ssao":
        this.runtimeMetrics = {
          ...metrics,
          ambientOcclusion: { ...metrics.ambientOcclusion, ssaoEnabled: enabled },
        };
        break;
      case "bakedAo":
        this.runtimeMetrics = {
          ...metrics,
          ambientOcclusion: {
            ...metrics.ambientOcclusion,
            bakedAoStrength: enabled ? (value ?? 0.35) : 0,
          },
        };
        break;
      case "shadowBudget":
        this.runtimeMetrics = {
          ...metrics,
          shadowBudget: { ...metrics.shadowBudget, enabled },
        };
        break;
      case "rayTracing":
        this.runtimeMetrics = {
          ...metrics,
          graphicsCapabilities: { ...metrics.graphicsCapabilities, rayTracingEnabled: enabled },
        };
        break;
      case "photoMode":
        this.runtimeMetrics = {
          ...metrics,
          cinematicPhotoMode: { ...metrics.cinematicPhotoMode, photoModeActive: enabled },
        };
        break;
      case "cinematicMode":
        this.runtimeMetrics = {
          ...metrics,
          cinematicPhotoMode: { ...metrics.cinematicPhotoMode, cinematicModeActive: enabled },
        };
        break;
      case "fog":
        this.runtimeMetrics = {
          ...metrics,
          lightingAtmosphere: { ...metrics.lightingAtmosphere, fogActive: enabled },
        };
        break;
      case "godRays":
        this.runtimeMetrics = {
          ...metrics,
          lightingAtmosphere: {
            ...metrics.lightingAtmosphere,
            godRaysEnabled: enabled,
            godRayIntensity: value ?? metrics.lightingAtmosphere.godRayIntensity,
          },
        };
        break;
    }

    return runtimeCommandSuccess({
      feature,
      enabled,
      value: feature === "bakedAo" ? this.runtimeMetrics.ambientOcclusion.bakedAoStrength : feature === "godRays" ? this.runtimeMetrics.lightingAtmosphere.godRayIntensity : enabled,
      metrics: {
        shadowBudget: this.runtimeMetrics.shadowBudget,
        ambientOcclusion: this.runtimeMetrics.ambientOcclusion,
        lightingAtmosphere: this.runtimeMetrics.lightingAtmosphere,
        graphicsCapabilities: this.runtimeMetrics.graphicsCapabilities,
        cinematicPhotoMode: this.runtimeMetrics.cinematicPhotoMode,
      },
    });
  }

  async updateAmbientLight(color: string, brightness: number) {
    this.runtimeMetrics = {
      ...this.runtimeMetrics,
      lightingAtmosphere: {
        ...this.runtimeMetrics.lightingAtmosphere,
        ambientColor: color,
        ambientBrightness: brightness,
      },
    };
    return runtimeCommandSuccess({
      color,
      brightness,
      metrics: {
        lightingAtmosphere: this.runtimeMetrics.lightingAtmosphere,
      },
    });
  }

  async getWaterReflectionStatus() {
    return runtimeCommandSuccess(mockWaterRuntimeSnapshot.reflectionStatus);
  }

  async selectEntity(selection: Selection) {
    return runtimeCommandSuccess({ selection });
  }

  async focusCamera(target: Selection | readonly [number, number, number]) {
    return runtimeCommandSuccess({ target });
  }

  async setEditorCameraMode(patch: { readonly interactionMode?: EditorCameraInteractionMode; readonly cameraKind?: EditorCameraKind }) {
    this.editorCamera = { ...this.editorCamera, ...patch };
    return runtimeCommandSuccess(this.editorCamera);
  }

  async setEditorCameraProjection(projection: EditorCameraProjection, options: { readonly fovDegrees?: number; readonly orthographicScale?: number } = {}) {
    this.editorCamera = {
      ...this.editorCamera,
      projection,
      pose: {
        ...this.editorCamera.pose,
        ...(options.fovDegrees === undefined ? {} : { fovDegrees: options.fovDegrees }),
        ...(options.orthographicScale === undefined ? {} : { orthographicScale: options.orthographicScale }),
      },
    };
    return runtimeCommandSuccess(this.editorCamera);
  }

  async setEditorCameraPose(pose: EditorCameraPose) {
    this.editorCamera = { ...this.editorCamera, pose };
    return runtimeCommandSuccess(this.editorCamera);
  }

  async alignEditorCameraToAxes(axis = "nearest", automatic = false) {
    const preset =
      axis === "isometric"
        ? { yaw: Math.PI / 4, pitch: -(35.264 * Math.PI) / 180 }
        : axis === "dimetric"
          ? { yaw: Math.PI / 4, pitch: -Math.PI / 6 }
          : { yaw: Math.round(this.editorCamera.pose.yaw / (Math.PI / 4)) * (Math.PI / 4), pitch: Math.round(this.editorCamera.pose.pitch / (Math.PI / 12)) * (Math.PI / 12) };
    this.editorCamera = {
      ...this.editorCamera,
      alignToAxes: true,
      automaticAxis: automatic,
      pose: { ...this.editorCamera.pose, ...preset },
    };
    return runtimeCommandSuccess(this.editorCamera);
  }

  async addSavedEditorCamera(input: { readonly name?: string; readonly description?: string } = {}) {
    const now = new Date().toISOString();
    const camera = {
      id: `camera-${Date.now()}-${this.editorCamera.savedCameras.length + 1}`,
      name: input.name ?? `Camera ${this.editorCamera.savedCameras.length + 1}`,
      description: input.description,
      cameraKind: this.editorCamera.cameraKind,
      projection: this.editorCamera.projection,
      pose: this.editorCamera.pose,
      alignToAxes: this.editorCamera.alignToAxes,
      automaticAxis: this.editorCamera.automaticAxis,
      createdAt: now,
      updatedAt: now,
    };
    this.editorCamera = {
      ...this.editorCamera,
      savedCameras: [...this.editorCamera.savedCameras, camera],
      activeSavedCameraId: camera.id,
    };
    return runtimeCommandSuccess({ camera, editorCamera: this.editorCamera });
  }

  async updateSavedEditorCamera(cameraId: string, input: { readonly name?: string; readonly description?: string } = {}) {
    let updated = this.editorCamera.savedCameras.find((camera) => camera.id === cameraId);
    if (!updated) {
      const result = await this.addSavedEditorCamera({ name: input.name, description: input.description });
      return result;
    }
    updated = {
      ...updated,
      ...input,
      cameraKind: this.editorCamera.cameraKind,
      projection: this.editorCamera.projection,
      pose: this.editorCamera.pose,
      alignToAxes: this.editorCamera.alignToAxes,
      automaticAxis: this.editorCamera.automaticAxis,
      updatedAt: new Date().toISOString(),
    };
    this.editorCamera = {
      ...this.editorCamera,
      savedCameras: this.editorCamera.savedCameras.map((camera) => (camera.id === cameraId ? updated! : camera)),
    };
    return runtimeCommandSuccess({ camera: updated, editorCamera: this.editorCamera });
  }

  async deleteSavedEditorCamera(cameraId: string) {
    const deleted = this.editorCamera.savedCameras.some((camera) => camera.id === cameraId);
    const nextCameras = this.editorCamera.savedCameras.filter((camera) => camera.id !== cameraId);
    this.editorCamera = {
      ...this.editorCamera,
      savedCameras: nextCameras,
      activeSavedCameraId: this.editorCamera.activeSavedCameraId === cameraId ? undefined : this.editorCamera.activeSavedCameraId,
    };
    return runtimeCommandSuccess({ cameraId, deleted, editorCamera: this.editorCamera });
  }

  async recallSavedEditorCamera(cameraId: string) {
    const camera = this.editorCamera.savedCameras.find((candidate) => candidate.id === cameraId);
    if (camera) {
      this.editorCamera = {
        ...this.editorCamera,
        cameraKind: camera.cameraKind,
        projection: camera.projection,
        pose: camera.pose,
        alignToAxes: camera.alignToAxes,
        automaticAxis: camera.automaticAxis,
        activeSavedCameraId: camera.id,
      };
    }
    return runtimeCommandSuccess(this.editorCamera);
  }

  async stepSavedEditorCamera(direction: number) {
    if (this.editorCamera.savedCameras.length === 0) {
      return runtimeCommandSuccess(this.editorCamera);
    }
    const currentIndex = Math.max(0, this.editorCamera.savedCameras.findIndex((camera) => camera.id === this.editorCamera.activeSavedCameraId));
    const nextIndex = (currentIndex + direction + this.editorCamera.savedCameras.length) % this.editorCamera.savedCameras.length;
    return this.recallSavedEditorCamera(this.editorCamera.savedCameras[nextIndex].id);
  }

  async importEditorCameraTemplate(template: EditorCameraTemplate) {
    this.editorCamera = {
      ...this.editorCamera,
      savedCameras: template.cameras,
      activeSavedCameraId: template.cameras[0]?.id,
    };
    return runtimeCommandSuccess(this.editorCamera);
  }

  async exportEditorCameraTemplate() {
    return runtimeCommandSuccess({
      schema: "drusniel.camera-template.v1" as const,
      cameras: this.editorCamera.savedCameras,
    });
  }

  async setWaterReflectionDebugMode(waterBodyId: string, mode: WaterReflectionDebugViewMode) {
    return runtimeCommandSuccess({ waterBodyId, mode });
  }

  async updateWaterBody(waterBodyId: string, patch: Partial<WaterBody>) {
    return runtimeCommandSuccess({
      waterBody: {
        id: waterBodyId,
        kind: patch.kind ?? "Unknown",
        reflectionStrength: patch.reflectionStrength ?? 0,
        fresnelPower: patch.fresnelPower ?? 0,
        distortionStrength: patch.distortionStrength ?? 0,
        ...patch,
      },
    });
  }

  async runWaterVisualProbe() {
    return runtimeCommandSuccess({
      ...mockWaterRuntimeSnapshot,
      reflectionStatus: { ...mockWaterRuntimeSnapshot.reflectionStatus, lastProbeUpdateMs: 3.1 },
      waterPresence: { ...mockWaterRuntimeSnapshot.waterPresence, nearestWaterDistance: 4.2 },
      capturedAt: new Date().toISOString(),
    });
  }

  async getDefaultTerrainRecipe() {
    return runtimeCommandSuccess({
      recipe: JSON.parse(JSON.stringify(mockTerrainRecipe)) as TerrainRecipe,
      fingerprint: "0xmockterrain000000",
    });
  }

  async previewTerrainRecipe(request: TerrainPreviewRequest) {
    const samples: TerrainPreviewSample[] = [];
    let minHeight = Number.POSITIVE_INFINITY;
    let maxHeight = Number.NEGATIVE_INFINITY;
    let sumHeight = 0;
    let waterCells = 0;
    let treeCells = 0;
    const denominator = Math.max(1, request.resolution - 1);

    for (let row = 0; row < request.resolution; row += 1) {
      for (let col = 0; col < request.resolution; col += 1) {
        const x = request.origin[0] + Math.round((col / denominator) * request.size[0]);
        const z = request.origin[1] + Math.round((row / denominator) * request.size[1]);
        const wave = Math.sin((x + request.recipe.seed) * 0.04) + Math.cos((z - request.recipe.seed) * 0.035);
        const height = Math.round(32 + wave * 10 + request.recipe.config.hills.amplitude * 0.12);
        const water = height <= 18;
        const tree = !water && ((x * 31 + z * 17 + request.recipe.seed) % 19 === 0);
        const biome: TerrainPreviewSample["biome"] = water ? "Sandy" : height > 48 ? "Rocky" : height < 25 ? "Sandy" : "Grassland";
        const material: TerrainPreviewSample["material"] = water ? "Water" : biome === "Rocky" ? "Rock" : biome === "Sandy" ? "Sand" : "TopSoil";

        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        sumHeight += height;
        waterCells += water ? 1 : 0;
        treeCells += tree ? 1 : 0;
        samples.push({
          x,
          z,
          height,
          biome,
          material,
          water,
          waterKind: water ? "Pond" : "None",
          waterDepth: water ? 18 - height : 0,
          surfaceY: 18,
          tree,
        });
      }
    }

    return runtimeCommandSuccess({
      recipe: request.recipe,
      origin: request.origin,
      size: request.size,
      resolution: request.resolution,
      samples,
      stats: {
        minHeight,
        maxHeight,
        avgHeight: sumHeight / Math.max(1, samples.length),
        waterCells,
        treeCells,
      },
      fingerprint: "0xmockterrain000000",
      timingMs: 1.25,
    });
  }

  async setVoxel(position: readonly [number, number, number], block: BlockType) {
    const chunk = position.map((coordinate) => Math.floor(coordinate / 16));
    return runtimeCommandSuccess({
      position,
      chunkId: `chunk-${chunk[0]}-${chunk[1]}-${chunk[2]}`,
      block,
      voxel: blockRuntimeName(block),
      previousVoxel: "Air",
      currentVoxel: blockRuntimeName(block),
      editResult: "applied" as const,
    });
  }

  async setViewportDebugOverlay(overlay: keyof ViewportOverlayState, enabled: boolean) {
    this.viewportDebug = { ...this.viewportDebug, [overlay]: enabled };
    return runtimeCommandSuccess(this.viewportDebug);
  }

  async setEditorDiagnostics(enabled: boolean, categories?: readonly EditorDiagnosticsCategory[]) {
    this.editorDiagnostics = {
      enabled,
      categories:
        categories && categories.length > 0
          ? [...categories]
          : ["nativeViewport", "frontend", "input", "selection", "hover", "highlight", "runtime"],
    };
    return runtimeCommandSuccess(this.editorDiagnostics);
  }

  async rebuildSelectedChunk(chunkId: string) {
    return runtimeCommandSuccess({ queuedChunkIds: [chunkId] });
  }

  async rebuildDirtyChunks(chunkIds: readonly string[]) {
    return runtimeCommandSuccess({ queuedChunkIds: chunkIds });
  }

  async setAtlasMapping(mapping: BlockAtlasMap) {
    this.atlasMapping = { ...mapping };
    this.atlasDirty = true;
    return runtimeCommandSuccess({
      mapping: this.atlasMapping,
      dirty: this.atlasDirty,
    });
  }

  async saveAtlasMapping(mapping: BlockAtlasMap) {
    this.atlasMapping = { ...mapping };
    this.atlasDirty = false;
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: "mock-atlas-mapping",
    });
  }

  async scatterProps(props: readonly PropInstance[]) {
    const incomingIds = new Set(props.map((prop) => prop.id));
    this.props = [...this.props.filter((prop) => !incomingIds.has(prop.id)), ...props];
    return runtimeCommandSuccess({
      props,
      propStats: mockPropStats(this.props),
    });
  }

  async removeProps(filter: { readonly propIds?: readonly string[]; readonly chunkId?: string }) {
    const propIds = new Set(filter.propIds ?? []);
    const removed = this.props.filter((prop) => propIds.has(prop.id) || (filter.chunkId !== undefined && prop.chunkId === filter.chunkId));
    const removedPropIds = removed.map((prop) => prop.id);
    const removedIdSet = new Set(removedPropIds);
    this.props = this.props.filter((prop) => !removedIdSet.has(prop.id));
    return runtimeCommandSuccess({
      removedPropIds,
      propStats: mockPropStats(this.props),
    });
  }

  async createLight(light: LightInstance) {
    this.lights = [...this.lights.filter((candidate) => candidate.id !== light.id), light];
    return runtimeCommandSuccess({ light });
  }

  async updateLight(lightId: string, patch: Partial<Omit<LightInstance, "id">>) {
    const existing = this.lights.find((light) => light.id === lightId);
    const next: LightInstance = existing
      ? { ...existing, ...patch }
      : {
          id: lightId,
          name: patch.name ?? lightId,
          kind: patch.kind ?? "point",
          enabled: patch.enabled ?? true,
          visible: patch.visible ?? true,
          locked: patch.locked ?? false,
          position: patch.position ?? [0, 16, 0],
          rotation: patch.rotation ?? [0, 0, 0],
          color: patch.color ?? "#ffffff",
          intensity: patch.intensity ?? 800,
          range: patch.range ?? 24,
          radius: patch.radius ?? 0,
          innerConeAngle: patch.innerConeAngle ?? 25,
          outerConeAngle: patch.outerConeAngle ?? 45,
          shadowsEnabled: patch.shadowsEnabled ?? true,
          volumetric: patch.volumetric ?? false,
          source: patch.source ?? "editor",
        };
    this.lights = [...this.lights.filter((light) => light.id !== lightId), next];
    return runtimeCommandSuccess({ light: next });
  }

  async deleteLight(lightId: string) {
    const before = this.lights.length;
    this.lights = this.lights.filter((light) => light.id !== lightId || light.source === "sun");
    return runtimeCommandSuccess({ lightId, deleted: this.lights.length !== before });
  }

  async saveLights() {
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: "mock-editor-lights",
    });
  }

  async loadLights() {
    return runtimeCommandSuccess({
      lights: this.lights,
      lightCount: this.lights.length,
    });
  }

  async createProtectedArea(area: ProtectedArea) {
    this.protectedAreas = [...this.protectedAreas.filter((candidate) => candidate.id !== area.id), area];
    return runtimeCommandSuccess({ area });
  }

  async updateProtectedArea(areaId: string, patch: Partial<Omit<ProtectedArea, "id">>) {
    const existing = this.protectedAreas.find((area) => area.id === areaId);
    const next: ProtectedArea = existing
      ? { ...existing, ...patch }
      : {
          id: areaId,
          name: patch.name ?? areaId,
          kind: patch.kind ?? "story_lock",
          shape: patch.shape ?? "box",
          priority: patch.priority ?? 1,
          locked: patch.locked ?? false,
          color: patch.color ?? "#22d3ee",
          center: patch.center ?? [0, 0, 0],
          size: patch.size ?? [1, 1, 1],
          bounds: patch.bounds ?? { min: [0, 0, 0], max: [1, 1, 1] },
          rules: patch.rules ?? {
            canMine: false,
            canPlace: false,
            canPaint: false,
            canSpawnProps: false,
            canEditWater: false,
            canSaveModify: false,
          },
        };
    this.protectedAreas = [...this.protectedAreas.filter((area) => area.id !== areaId), next];
    return runtimeCommandSuccess({
      area: next,
    });
  }

  async deleteProtectedArea(areaId: string) {
    const before = this.protectedAreas.length;
    this.protectedAreas = this.protectedAreas.filter((area) => area.id !== areaId);
    return runtimeCommandSuccess({ areaId, deleted: this.protectedAreas.length !== before });
  }

  async queryProtectedRulesAtVoxel(voxel: readonly [number, number, number]) {
    const area = this.protectedAreas.find((candidate) => pointInsideBounds(voxel, candidate.bounds));
    return runtimeCommandSuccess({
      position: voxel,
      blocked: Boolean(area && Object.values(area.rules).some((allowed) => !allowed)),
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      kind: area?.kind ?? null,
      priority: area?.priority ?? null,
      rules:
        area?.rules ?? {
          canMine: true,
          canPlace: true,
          canPaint: true,
          canSpawnProps: true,
          canEditWater: true,
          canSaveModify: true,
        },
    });
  }

  async validateProtectedAreaConflicts(area?: ProtectedArea) {
    const candidates = area ? [...this.protectedAreas.filter((candidate) => candidate.id !== area.id), area] : this.protectedAreas;
    const conflicts: RuntimeProtectedAreaConflict[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      for (const other of candidates.slice(index + 1)) {
        const current = candidates[index];
        if (current.priority === other.priority && boundsOverlap(current.bounds, other.bounds)) {
          conflicts.push({
            leftAreaId: current.id,
            rightAreaId: other.id,
            priority: current.priority,
            message: `Protected areas ${current.name} and ${other.name} overlap at priority ${current.priority}.`,
          });
        }
      }
    }
    return runtimeCommandSuccess({ clear: conflicts.length === 0, conflicts });
  }

  async saveProtectedAreas() {
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: "mock-world-rules",
    });
  }

  async loadProtectedAreas() {
    return runtimeCommandSuccess({
      areas: this.protectedAreas,
      areaCount: this.protectedAreas.length,
    });
  }

  async saveWorldSnapshot() {
    return runtimeCommandSuccess({
      worldId: "mock-drusniel-world",
      savedAt: new Date().toISOString(),
      snapshotId: `mock-runtime-snapshot-${Date.now()}`,
      editorPropCount: this.props.length,
      editorPropSavePath: "saves/editor_placed_props.json",
    });
  }

  onRuntimeEvent(handler: RuntimeEventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private createSnapshot(): RuntimeSnapshot {
    const metrics = {
      ...this.runtimeMetrics,
      renderQualityPreset: this.renderQualityPreset,
      renderQualityReadouts: getMockRenderQualityReadouts(this.renderQualityPreset),
    };
    const waterReflectionStatus: WaterReflectionStatus = mockWaterRuntimeSnapshot.reflectionStatus;

    return {
      connectionState: this.connectionState,
      capabilities: mockCapabilities,
      metrics,
      renderQuality: {
        preset: this.renderQualityPreset,
        metrics: metrics.renderQualityReadouts,
      },
      selection: null,
      targetedVoxel: null,
      chunks: mockChunks,
      dirtyChunkIds: mockChunks.filter((chunk) => chunk.dirty).map((chunk) => chunk.id),
      waterReflection: {
        waterBodyId: null,
        status: waterReflectionStatus,
      },
      waterVisualProbe: {
        ...mockWaterRuntimeSnapshot,
        capturedAt: new Date().toISOString(),
      },
      atlasMapping: {
        mapping: this.atlasMapping,
        dirty: this.atlasDirty,
      },
      viewportDebug: this.viewportDebug,
      editorDiagnostics: this.editorDiagnostics,
      editorCamera: this.editorCamera,
      propStats: mockPropStats(this.props),
      lights: this.lights,
      timingSamples: metrics.timingSamples,
      consoleEvents: [],
      capturedAt: new Date().toISOString(),
    };
  }
}
