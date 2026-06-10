import { getMockRenderQualityReadouts, mockRuntimeMetrics, mockWaterRuntimeSnapshot } from "../mocks/mockRuntime";
import { mockAtlasMapping, mockChunks, mockLights, mockMaterials, mockProps, mockProtectedAreas } from "../mocks/mockWorld";
import type { EditorDiagnosticsCategory, EditorDiagnosticsState, RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { LightAtmospherePatch, LightAtmosphereSettings, RuntimeMetrics, RenderFeatureFlag, TerrainTexturingPatch } from "../types/runtime";
import type { BlockAtlasMap, BlockType, LightInstance, MaterialCatalog, MaterialPatch, PropInstance, ProtectedArea, TerrainGenerationConfig, TerrainPreviewRequest, TerrainPreviewSample, TerrainRecipe, WaterBody, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { RuntimeClient } from "./RuntimeClient";
import { createDefaultEditorCameraState } from "./defaultEditorCamera";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type { EditorCameraInteractionMode, EditorCameraKind, EditorCameraPose, EditorCameraProjection, EditorCameraState, EditorCameraTemplate, LightAtmosphereTemplate, RuntimeConnectionState, RuntimeProtectedAreaConflict, RuntimeSnapshot, RuntimeVoxelBrushRequest } from "./runtimeSchemas";
import { runtimeCommandSuccess } from "./runtimeSchemas";

const mockCapabilities = {
  canSelectEntity: true,
  canFocusCamera: true,
  canRebuildChunks: true,
  canSetRenderQuality: true,
  canDebugWaterReflections: true,
  canRunWaterVisualProbe: true,
  canEditAtlasMapping: true,
  canEditMaterials: true,
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

const initialMaterialCatalog: MaterialCatalog = {
  materialTypes: [
    { id: "terrain", name: "Terrain", materialIds: ["mat-1", "mat-2", "mat-3", "mat-5", "mat-6"] },
    { id: "water", name: "Water and Ice", materialIds: ["mat-7"] },
    { id: "organic", name: "Organic", materialIds: ["mat-8", "mat-9"] },
    { id: "dungeon", name: "Dungeon", materialIds: ["mat-10", "mat-11"] },
  ],
  materials: [
    { id: "mat-1", name: "Top Soil", kind: "blocky", sourcePath: "runtime/materials/1", materialTypeId: "terrain", colorRgb: [83, 128, 62], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 1, defaultVoxel: "TopSoil" },
    { id: "mat-2", name: "Sub Soil", kind: "blocky", sourcePath: "runtime/materials/2", materialTypeId: "terrain", colorRgb: [112, 78, 48], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 1, defaultVoxel: "SubSoil" },
    { id: "mat-3", name: "Rock", kind: "blocky", sourcePath: "runtime/materials/3", materialTypeId: "terrain", colorRgb: [112, 112, 118], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 1.8, defaultVoxel: "Rock" },
    { id: "mat-5", name: "Sand", kind: "blocky", sourcePath: "runtime/materials/5", materialTypeId: "terrain", colorRgb: [207, 184, 119], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 0.6, defaultVoxel: "Sand" },
    { id: "mat-6", name: "Clay", kind: "blocky", sourcePath: "runtime/materials/6", materialTypeId: "terrain", colorRgb: [142, 97, 86], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 0.8, defaultVoxel: "Clay" },
    { id: "mat-7", name: "Water", kind: "water", sourcePath: "runtime/materials/7", materialTypeId: "water", colorRgb: [66, 152, 210], metallic: 0, smooth: 0.85, emissive: 0, surfaceTransmission: 0.72, absorptionLength: 24, scatterLength: 96, indexOfRefraction: 1.33, phase: 0, strength: 0.3, defaultVoxel: "Water" },
    { id: "mat-8", name: "Wood", kind: "blocky", sourcePath: "runtime/materials/8", materialTypeId: "organic", colorRgb: [121, 82, 45], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 1, defaultVoxel: "Wood" },
    { id: "mat-9", name: "Leaves", kind: "blocky", sourcePath: "runtime/materials/9", materialTypeId: "organic", colorRgb: [65, 134, 59], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 0.4, defaultVoxel: "Leaves" },
    { id: "mat-10", name: "Dungeon Wall", kind: "blocky", sourcePath: "runtime/materials/10", materialTypeId: "dungeon", colorRgb: [84, 82, 96], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 2, defaultVoxel: "DungeonWall" },
    { id: "mat-11", name: "Dungeon Floor", kind: "blocky", sourcePath: "runtime/materials/11", materialTypeId: "dungeon", colorRgb: [91, 87, 78], metallic: 0, smooth: 0.45, emissive: 0, surfaceTransmission: 0, absorptionLength: 0, scatterLength: 0, indexOfRefraction: 1, phase: 0, strength: 1.6, defaultVoxel: "DungeonFloor" },
    ...mockMaterials.filter((material) => !material.id.startsWith("mat-")),
  ],
  palettes: [{ id: "default", name: "Default", materialIds: ["mat-1", "mat-2", "mat-3", "mat-5", "mat-6", "mat-7", "mat-8", "mat-9"] }],
  activeMaterialId: "mat-1",
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
    case "topSoil":
      return "TopSoil";
    case "dirt":
    case "subSoil":
      return "SubSoil";
    case "rock":
      return "Rock";
    case "sand":
      return "Sand";
    case "clay":
      return "Clay";
    case "water":
      return "Water";
    case "wood":
      return "Wood";
    case "leaves":
      return "Leaves";
    case "dungeonWall":
      return "DungeonWall";
    case "dungeonFloor":
      return "DungeonFloor";
  }
};

const defaultLightAtmosphereSettings: LightAtmosphereSettings = {
  cycleEnabled: false,
  lightEnabled: true,
  lightPreset: "sun",
  atmospherePreset: "hazy",
  globalPreset: "default",
  lightColor: "#fff8f0",
  lightIlluminance: 100000,
  lightAzimuthDegrees: 0,
  lightElevationDegrees: 70,
  lightDirection: [0, 0.94, 0.34],
  atmosphereAmount: 1,
  atmosphereHalfLength: 220,
  fogActive: true,
  godRaysEnabled: false,
  ambientColor: "#5f8fce",
  ambientBrightness: 1200,
};

export class MockRuntimeClient implements RuntimeClient {
  private renderQualityPreset: RenderQualityPreset = mockRuntimeMetrics.renderQualityPreset;
  private runtimeMetrics: RuntimeMetrics = JSON.parse(JSON.stringify(mockRuntimeMetrics)) as RuntimeMetrics;
  private lightAtmosphereSettings: LightAtmosphereSettings = { ...defaultLightAtmosphereSettings };
  private atlasMapping: BlockAtlasMap = { ...mockAtlasMapping };
  private materialCatalog: MaterialCatalog = JSON.parse(JSON.stringify(initialMaterialCatalog)) as MaterialCatalog;
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
  private editorCamera: EditorCameraState = createDefaultEditorCameraState();
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
    const gatedByLowQuality =
      this.runtimeMetrics.terrainTexturing.configured.enabled &&
      (preset === "Low" || preset === "Performance100");
    const terrainTexturing = {
      ...this.runtimeMetrics.terrainTexturing,
      gatedByLowQuality,
      effective: {
        enabled:
          this.runtimeMetrics.terrainTexturing.configured.enabled &&
          !gatedByLowQuality &&
          !this.runtimeMetrics.terrainTexturing.gatedByIntegratedGpu,
        normalEnabled:
          this.runtimeMetrics.terrainTexturing.configured.normalEnabled &&
          this.runtimeMetrics.terrainTexturing.configured.enabled &&
          !gatedByLowQuality &&
          !this.runtimeMetrics.terrainTexturing.gatedByIntegratedGpu,
      },
    };
    this.runtimeMetrics = {
      ...this.runtimeMetrics,
      renderQualityPreset: preset,
      renderQualityReadouts: getMockRenderQualityReadouts(preset),
      terrainTexturing,
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
    this.lightAtmosphereSettings = {
      ...this.lightAtmosphereSettings,
      ambientColor: color,
      ambientBrightness: brightness,
    };
    this.runtimeMetrics = {
      ...this.runtimeMetrics,
      lightingAtmosphere: {
        ...this.runtimeMetrics.lightingAtmosphere,
        settings: this.lightAtmosphereSettings,
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

  async getLightAtmosphere() {
    return runtimeCommandSuccess(this.lightAtmosphereSettings);
  }

  async updateLightAtmosphere(patch: LightAtmospherePatch) {
    this.lightAtmosphereSettings = {
      ...this.lightAtmosphereSettings,
      ...patch,
    };
    this.runtimeMetrics = {
      ...this.runtimeMetrics,
      lightingAtmosphere: {
        ...this.runtimeMetrics.lightingAtmosphere,
        settings: this.lightAtmosphereSettings,
        fogPreset: this.lightAtmosphereSettings.atmospherePreset,
        fogActive: this.lightAtmosphereSettings.fogActive,
        godRaysEnabled: this.lightAtmosphereSettings.godRaysEnabled,
        ambientColor: this.lightAtmosphereSettings.ambientColor,
        ambientBrightness: this.lightAtmosphereSettings.ambientBrightness,
      },
    };
    return runtimeCommandSuccess({
      settings: this.lightAtmosphereSettings,
      metrics: {
        lightingAtmosphere: this.runtimeMetrics.lightingAtmosphere,
      },
    });
  }

  async updateTerrainTexturing(patch: TerrainTexturingPatch) {
    const current = this.runtimeMetrics.terrainTexturing;
    const configured = {
      enabled: patch.hexTiling?.enabled ?? current.configured.enabled,
      normalEnabled: patch.hexTiling?.normalEnabled ?? current.configured.normalEnabled,
    };
    const gatedByLowQuality =
      configured.enabled &&
      (this.renderQualityPreset === "Low" || this.renderQualityPreset === "Performance100");
    const terrainTexturing = {
      configured,
      effective: {
        enabled: configured.enabled && !gatedByLowQuality && !current.gatedByIntegratedGpu,
        normalEnabled:
          configured.normalEnabled &&
          configured.enabled &&
          !gatedByLowQuality &&
          !current.gatedByIntegratedGpu,
      },
      gatedByIntegratedGpu: current.gatedByIntegratedGpu,
      gatedByLowQuality,
    };
    this.runtimeMetrics = {
      ...this.runtimeMetrics,
      terrainTexturing,
    };
    return runtimeCommandSuccess({
      settings: terrainTexturing,
      metrics: {
        terrainTexturing,
      },
    });
  }

  async importLightAtmosphereTemplate(template: LightAtmosphereTemplate) {
    return this.updateLightAtmosphere(template.settings);
  }

  async exportLightAtmosphereTemplate() {
    return runtimeCommandSuccess({
      schema: "drusniel.light-atmosphere-template.v1" as const,
      settings: this.lightAtmosphereSettings,
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

  async paintVoxelMaterial(position: readonly [number, number, number], materialId: string) {
    const material = this.materialCatalog.materials.find((candidate) => candidate.id === materialId) ?? this.materialCatalog.materials[0];
    const chunk = position.map((coordinate) => Math.floor(coordinate / 16));
    this.materialCatalog = { ...this.materialCatalog, activeMaterialId: material.id };
    return runtimeCommandSuccess({
      position,
      chunkId: `chunk-${chunk[0]}-${chunk[1]}-${chunk[2]}`,
      material,
      previousMaterialId: "mat-1",
      currentMaterialId: material.id,
      previousVoxel: "TopSoil",
      editResult: "applied" as const,
      dirtyChunkIds: [`chunk-${chunk[0]}-${chunk[1]}-${chunk[2]}`],
    });
  }

  async pickVoxelMaterial(position: readonly [number, number, number]) {
    const material = this.materialCatalog.materials.find((candidate) => candidate.id === this.materialCatalog.activeMaterialId) ?? this.materialCatalog.materials[0];
    return runtimeCommandSuccess({
      position,
      voxel: material.defaultVoxel ?? "TopSoil",
      material,
    });
  }

  async replaceMaterial(fromMaterialId: string, toMaterialId: string) {
    const toMaterial = this.materialCatalog.materials.find((material) => material.id === toMaterialId) ?? this.materialCatalog.materials[0];
    return runtimeCommandSuccess({
      fromMaterialId,
      toMaterialId: toMaterial.id,
      toMaterial,
      changedCount: 12,
      noChangeCount: 0,
      skippedCount: 0,
      dirtyChunkIds: ["chunk-0-0-0"],
      mode: "completed" as const,
      completed: true,
      processedChunks: 1,
      totalChunks: 1,
    });
  }

  async getMaterialReplaceJob(jobId: string) {
    const toMaterial = this.materialCatalog.materials.find((material) => material.id === this.materialCatalog.activeMaterialId) ?? this.materialCatalog.materials[0];
    return runtimeCommandSuccess({
      fromMaterialId: "mat-1",
      toMaterialId: toMaterial.id,
      toMaterial,
      changedCount: 12,
      noChangeCount: 0,
      skippedCount: 0,
      dirtyChunkIds: [],
      mode: "completed" as const,
      completed: true,
      processedChunks: 1,
      totalChunks: 1,
      jobId,
    });
  }

  async updateMaterial(materialId: string, patch: MaterialPatch) {
    let updated = this.materialCatalog.materials.find((material) => material.id === materialId) ?? this.materialCatalog.materials[0];
    updated = { ...updated, ...patch };
    this.materialCatalog = {
      ...this.materialCatalog,
      materials: this.materialCatalog.materials.map((material) => (material.id === updated.id ? updated : material)),
    };
    return runtimeCommandSuccess({
      material: updated,
      catalog: this.materialCatalog,
      dirtyChunkIds: ["chunk-0-0-0"],
    });
  }

  async setActiveMaterial(materialId: string) {
    const material = this.materialCatalog.materials.find((candidate) => candidate.id === materialId) ?? this.materialCatalog.materials[0];
    this.materialCatalog = { ...this.materialCatalog, activeMaterialId: material.id };
    return runtimeCommandSuccess({
      activeMaterialId: material.id,
      material,
      catalog: this.materialCatalog,
    });
  }

  async applyVoxelBrush(brush: RuntimeVoxelBrushRequest) {
    const chunk = brush.position.map((coordinate) => Math.floor(coordinate / 16));
    const result = {
      position: brush.position,
      chunkId: `chunk-${chunk[0]}-${chunk[1]}-${chunk[2]}`,
      block: brush.block,
      voxel: blockRuntimeName(brush.block),
      previousVoxel: brush.action === "set" ? "Air" : blockRuntimeName(brush.block),
      currentVoxel: brush.action === "delete" ? "Air" : blockRuntimeName(brush.block),
      editResult: "applied" as const,
    };
    return runtimeCommandSuccess({
      origin: brush.position,
      action: brush.action,
      shape: brush.shape,
      block: brush.block,
      changedCount: 1,
      noChangeCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
      affectedCount: 1,
      dirtyChunkIds: [result.chunkId],
      sampledResult: result,
      results: brush.includeResults ? [result] : [],
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
      materialCatalog: this.materialCatalog,
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
