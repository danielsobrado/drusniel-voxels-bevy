import type { EditorDiagnosticsCategory, RenderQualityPreset, Selection, ViewportOverlayState } from "../types/editor";
import type { LightAtmospherePatch, LightAtmosphereSettings, RenderFeatureFlag, TerrainTexturingPatch } from "../types/runtime";
import type { BlockAtlasMap, BlockType, LightInstance, MaterialPatch, PropInstance, ProtectedArea, TerrainPreviewRequest, WaterBody, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import type { RuntimeClient } from "./RuntimeClient";
import type { RuntimeCommandRequest } from "./runtimeCommands";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type {
  EditorCameraInteractionMode,
  EditorCameraKind,
  EditorCameraPose,
  EditorCameraProjection,
  EditorCameraTemplate,
  LightAtmosphereTemplate,
  RuntimeAtlasMappingState,
  RuntimeAmbientLightMutationResult,
  RuntimeChunkRebuildResult,
  RuntimeCommandResult,
  RuntimeConnectionState,
  RuntimeDeleteSavedEditorCameraResult,
  RuntimeEditorCameraResult,
  RuntimeEditorDiagnosticsState,
  RuntimeFocusCameraResult,
  RuntimeLightDeleteResult,
  RuntimeLightAtmosphereMutationResult,
  RuntimeTerrainTexturingMutationResult,
  RuntimeLightLoadResult,
  RuntimeLightMutationResult,
  RuntimeActiveMaterialResult,
  RuntimeMaterialMutationResult,
  RuntimeMaterialPaintResult,
  RuntimeMaterialPickResult,
  RuntimeMaterialReplaceResult,
  RuntimeProtectedAreaDeleteResult,
  RuntimeProtectedAreaLoadResult,
  RuntimeProtectedAreaMutationResult,
  RuntimeProtectedAreaValidationResult,
  RuntimeProtectedRuleQueryResult,
  RuntimePropRemoveResult,
  RuntimePropScatterResult,
  RuntimeRenderFeatureFlagResult,
  RuntimeRenderQualityState,
  RuntimeSaveSummary,
  RuntimeSavedEditorCameraResult,
  RuntimeSelectEntityResult,
  RuntimeSnapshot,
  RuntimeVoxelMutationResult,
  RuntimeViewportDebugState,
  RuntimeWaterBodyMutationResult,
  RuntimeWaterDebugModeResult,
  RuntimeWaterVisualProbeResult,
  RuntimeTerrainRecipeState,
  RuntimeTerrainPreviewResult,
  RuntimeVoxelBrushRequest,
  RuntimeVoxelBrushResult,
} from "./runtimeSchemas";
import { runtimeCommandFailure } from "./runtimeSchemas";

export interface RuntimeBridge {
  readonly executeCommand: (request: RuntimeCommandRequest) => Promise<RuntimeCommandResult<unknown>>;
  readonly getRuntimeSnapshot?: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality?: () => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly getWaterReflectionStatus?: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly onRuntimeEvent?: (handler: RuntimeEventHandler) => () => void;
}

declare global {
  interface Window {
    drusnielRuntime?: RuntimeBridge;
  }
}

const unsupported = <T>(message: string): RuntimeCommandResult<T> =>
  runtimeCommandFailure("unsupported", message);

const makeRequestId = (type: string): string =>
  `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const hasBrowserRuntimeBridge = (): boolean =>
  typeof window !== "undefined" && typeof window.drusnielRuntime?.executeCommand === "function";

export class BrowserRuntimeClient implements RuntimeClient {
  private readonly bridge: RuntimeBridge;

  constructor(bridge: RuntimeBridge = window.drusnielRuntime as RuntimeBridge) {
    this.bridge = bridge;
  }

  getConnectionState(): RuntimeConnectionState {
    return "connected";
  }

  async getRuntimeSnapshot(): Promise<RuntimeCommandResult<RuntimeSnapshot>> {
    return this.bridge.getRuntimeSnapshot?.() ?? unsupported("Runtime snapshot reads are not available from this bridge.");
  }

  async getRenderQuality(): Promise<RuntimeCommandResult<RuntimeRenderQualityState>> {
    return this.bridge.getRenderQuality?.() ?? unsupported("Render quality reads are not available from this bridge.");
  }

  async getWaterReflectionStatus(): Promise<RuntimeCommandResult<WaterReflectionStatus>> {
    return this.bridge.getWaterReflectionStatus?.() ?? unsupported("Water reflection status reads are not available from this bridge.");
  }

  async selectEntity(selection: Selection): Promise<RuntimeCommandResult<RuntimeSelectEntityResult>> {
    return this.execute({
      type: "runtime.selectEntity",
      requestId: makeRequestId("runtime.selectEntity"),
      payload: { selection },
    });
  }

  async focusCamera(target: Selection | readonly [number, number, number]): Promise<RuntimeCommandResult<RuntimeFocusCameraResult>> {
    return this.execute({
      type: "runtime.focusCamera",
      requestId: makeRequestId("runtime.focusCamera"),
      payload: { target },
    });
  }

  async setEditorCameraMode(patch: { readonly interactionMode?: EditorCameraInteractionMode; readonly cameraKind?: EditorCameraKind }): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.setEditorCameraMode",
      requestId: makeRequestId("runtime.setEditorCameraMode"),
      payload: patch,
    });
  }

  async setEditorCameraProjection(projection: EditorCameraProjection, options: { readonly fovDegrees?: number; readonly orthographicScale?: number } = {}): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.setEditorCameraProjection",
      requestId: makeRequestId("runtime.setEditorCameraProjection"),
      payload: { projection, ...options },
    });
  }

  async setEditorCameraPose(pose: EditorCameraPose): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.setEditorCameraPose",
      requestId: makeRequestId("runtime.setEditorCameraPose"),
      payload: { pose },
    });
  }

  async alignEditorCameraToAxes(axis?: string, automatic = false): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.alignEditorCameraToAxes",
      requestId: makeRequestId("runtime.alignEditorCameraToAxes"),
      payload: axis === undefined ? { automatic } : { axis, automatic },
    });
  }

  async addSavedEditorCamera(input: { readonly name?: string; readonly description?: string } = {}): Promise<RuntimeCommandResult<RuntimeSavedEditorCameraResult>> {
    return this.execute({
      type: "runtime.addSavedEditorCamera",
      requestId: makeRequestId("runtime.addSavedEditorCamera"),
      payload: input,
    });
  }

  async updateSavedEditorCamera(cameraId: string, input: { readonly name?: string; readonly description?: string } = {}): Promise<RuntimeCommandResult<RuntimeSavedEditorCameraResult>> {
    return this.execute({
      type: "runtime.updateSavedEditorCamera",
      requestId: makeRequestId("runtime.updateSavedEditorCamera"),
      payload: { cameraId, ...input },
    });
  }

  async deleteSavedEditorCamera(cameraId: string): Promise<RuntimeCommandResult<RuntimeDeleteSavedEditorCameraResult>> {
    return this.execute({
      type: "runtime.deleteSavedEditorCamera",
      requestId: makeRequestId("runtime.deleteSavedEditorCamera"),
      payload: { cameraId },
    });
  }

  async recallSavedEditorCamera(cameraId: string): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.recallSavedEditorCamera",
      requestId: makeRequestId("runtime.recallSavedEditorCamera"),
      payload: { cameraId },
    });
  }

  async stepSavedEditorCamera(direction: number): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.stepSavedEditorCamera",
      requestId: makeRequestId("runtime.stepSavedEditorCamera"),
      payload: { direction },
    });
  }

  async importEditorCameraTemplate(template: EditorCameraTemplate): Promise<RuntimeCommandResult<RuntimeEditorCameraResult>> {
    return this.execute({
      type: "runtime.importEditorCameraTemplate",
      requestId: makeRequestId("runtime.importEditorCameraTemplate"),
      payload: { template },
    });
  }

  async exportEditorCameraTemplate(): Promise<RuntimeCommandResult<EditorCameraTemplate>> {
    return this.execute({
      type: "runtime.exportEditorCameraTemplate",
      requestId: makeRequestId("runtime.exportEditorCameraTemplate"),
      payload: {},
    });
  }

  async rebuildSelectedChunk(chunkId: string): Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>> {
    return this.execute({
      type: "runtime.rebuildSelectedChunk",
      requestId: makeRequestId("runtime.rebuildSelectedChunk"),
      payload: { chunkId },
    });
  }

  async rebuildDirtyChunks(chunkIds: readonly string[]): Promise<RuntimeCommandResult<RuntimeChunkRebuildResult>> {
    return this.execute({
      type: "runtime.rebuildDirtyChunks",
      requestId: makeRequestId("runtime.rebuildDirtyChunks"),
      payload: { chunkIds },
    });
  }

  async setRenderQuality(preset: RenderQualityPreset): Promise<RuntimeCommandResult<RuntimeRenderQualityState>> {
    return this.execute({
      type: "runtime.setRenderQuality",
      requestId: makeRequestId("runtime.setRenderQuality"),
      payload: { preset },
    });
  }

  async setRenderFeatureFlag(feature: RenderFeatureFlag, enabled: boolean, value?: number): Promise<RuntimeCommandResult<RuntimeRenderFeatureFlagResult>> {
    return this.execute({
      type: "runtime.setRenderFeatureFlag",
      requestId: makeRequestId("runtime.setRenderFeatureFlag"),
      payload: value === undefined ? { feature, enabled } : { feature, enabled, value },
    });
  }

  async updateAmbientLight(color: string, brightness: number): Promise<RuntimeCommandResult<RuntimeAmbientLightMutationResult>> {
    return this.execute({
      type: "runtime.updateAmbientLight",
      requestId: makeRequestId("runtime.updateAmbientLight"),
      payload: { color, brightness },
    });
  }

  async getLightAtmosphere(): Promise<RuntimeCommandResult<LightAtmosphereSettings>> {
    return this.execute({
      type: "runtime.getLightAtmosphere",
      requestId: makeRequestId("runtime.getLightAtmosphere"),
      payload: {},
    });
  }

  async updateLightAtmosphere(patch: LightAtmospherePatch): Promise<RuntimeCommandResult<RuntimeLightAtmosphereMutationResult>> {
    return this.execute({
      type: "runtime.updateLightAtmosphere",
      requestId: makeRequestId("runtime.updateLightAtmosphere"),
      payload: { patch },
    });
  }

  async updateTerrainTexturing(patch: TerrainTexturingPatch): Promise<RuntimeCommandResult<RuntimeTerrainTexturingMutationResult>> {
    return this.execute({
      type: "runtime.updateTerrainTexturing",
      requestId: makeRequestId("runtime.updateTerrainTexturing"),
      payload: { patch },
    });
  }

  async importLightAtmosphereTemplate(template: LightAtmosphereTemplate): Promise<RuntimeCommandResult<RuntimeLightAtmosphereMutationResult>> {
    return this.execute({
      type: "runtime.importLightAtmosphereTemplate",
      requestId: makeRequestId("runtime.importLightAtmosphereTemplate"),
      payload: { template },
    });
  }

  async exportLightAtmosphereTemplate(): Promise<RuntimeCommandResult<LightAtmosphereTemplate>> {
    return this.execute({
      type: "runtime.exportLightAtmosphereTemplate",
      requestId: makeRequestId("runtime.exportLightAtmosphereTemplate"),
      payload: {},
    });
  }

  async setWaterReflectionDebugMode(waterBodyId: string, mode: WaterReflectionDebugViewMode): Promise<RuntimeCommandResult<RuntimeWaterDebugModeResult>> {
    return this.execute({
      type: "runtime.setWaterReflectionDebugMode",
      requestId: makeRequestId("runtime.setWaterReflectionDebugMode"),
      payload: { waterBodyId, mode },
    });
  }

  async updateWaterBody(waterBodyId: string, patch: Partial<WaterBody>): Promise<RuntimeCommandResult<RuntimeWaterBodyMutationResult>> {
    return this.execute({
      type: "runtime.updateWaterBody",
      requestId: makeRequestId("runtime.updateWaterBody"),
      payload: { waterBodyId, patch },
    });
  }

  async runWaterVisualProbe(): Promise<RuntimeCommandResult<RuntimeWaterVisualProbeResult>> {
    return this.execute({
      type: "runtime.runWaterVisualProbe",
      requestId: makeRequestId("runtime.runWaterVisualProbe"),
      payload: {},
    });
  }

  async getDefaultTerrainRecipe(): Promise<RuntimeCommandResult<RuntimeTerrainRecipeState>> {
    return this.execute({
      type: "runtime.getDefaultTerrainRecipe",
      requestId: makeRequestId("runtime.getDefaultTerrainRecipe"),
      payload: {},
    });
  }

  async previewTerrainRecipe(request: TerrainPreviewRequest): Promise<RuntimeCommandResult<RuntimeTerrainPreviewResult>> {
    return this.execute({
      type: "runtime.previewTerrainRecipe",
      requestId: makeRequestId("runtime.previewTerrainRecipe"),
      payload: { request },
    });
  }

  async setVoxel(position: readonly [number, number, number], block: BlockType): Promise<RuntimeCommandResult<RuntimeVoxelMutationResult>> {
    return this.execute({
      type: "runtime.setVoxel",
      requestId: makeRequestId("runtime.setVoxel"),
      payload: { position, block },
    });
  }

  async paintVoxelMaterial(position: readonly [number, number, number], materialId: string): Promise<RuntimeCommandResult<RuntimeMaterialPaintResult>> {
    return this.execute({
      type: "runtime.paintVoxelMaterial",
      requestId: makeRequestId("runtime.paintVoxelMaterial"),
      payload: { position, materialId },
    });
  }

  async pickVoxelMaterial(position: readonly [number, number, number]): Promise<RuntimeCommandResult<RuntimeMaterialPickResult>> {
    return this.execute({
      type: "runtime.pickVoxelMaterial",
      requestId: makeRequestId("runtime.pickVoxelMaterial"),
      payload: { position },
    });
  }

  async replaceMaterial(fromMaterialId: string, toMaterialId: string): Promise<RuntimeCommandResult<RuntimeMaterialReplaceResult>> {
    return this.execute({
      type: "runtime.replaceMaterial",
      requestId: makeRequestId("runtime.replaceMaterial"),
      payload: { fromMaterialId, toMaterialId },
    });
  }

  async getMaterialReplaceJob(jobId: string): Promise<RuntimeCommandResult<RuntimeMaterialReplaceResult>> {
    return this.execute({
      type: "runtime.getMaterialReplaceJob",
      requestId: makeRequestId("runtime.getMaterialReplaceJob"),
      payload: { jobId },
    });
  }

  async updateMaterial(materialId: string, patch: MaterialPatch): Promise<RuntimeCommandResult<RuntimeMaterialMutationResult>> {
    return this.execute({
      type: "runtime.updateMaterial",
      requestId: makeRequestId("runtime.updateMaterial"),
      payload: { materialId, patch },
    });
  }

  async setActiveMaterial(materialId: string): Promise<RuntimeCommandResult<RuntimeActiveMaterialResult>> {
    return this.execute({
      type: "runtime.setActiveMaterial",
      requestId: makeRequestId("runtime.setActiveMaterial"),
      payload: { materialId },
    });
  }

  async applyVoxelBrush(brush: RuntimeVoxelBrushRequest): Promise<RuntimeCommandResult<RuntimeVoxelBrushResult>> {
    return this.execute({
      type: "runtime.applyVoxelBrush",
      requestId: makeRequestId("runtime.applyVoxelBrush"),
      payload: { brush },
    });
  }

  async setViewportDebugOverlay(overlay: keyof ViewportOverlayState, enabled: boolean): Promise<RuntimeCommandResult<RuntimeViewportDebugState>> {
    return this.execute({
      type: "runtime.setViewportDebugOverlay",
      requestId: makeRequestId("runtime.setViewportDebugOverlay"),
      payload: { overlay, enabled },
    });
  }

  async setEditorDiagnostics(enabled: boolean, categories?: readonly EditorDiagnosticsCategory[]): Promise<RuntimeCommandResult<RuntimeEditorDiagnosticsState>> {
    return this.execute({
      type: "runtime.setEditorDiagnostics",
      requestId: makeRequestId("runtime.setEditorDiagnostics"),
      payload: categories === undefined ? { enabled } : { enabled, categories },
    });
  }

  async setAtlasMapping(mapping: BlockAtlasMap): Promise<RuntimeCommandResult<RuntimeAtlasMappingState>> {
    return this.execute({
      type: "runtime.setAtlasMapping",
      requestId: makeRequestId("runtime.setAtlasMapping"),
      payload: { mapping },
    });
  }

  async saveAtlasMapping(mapping: BlockAtlasMap): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveAtlasMapping",
      requestId: makeRequestId("runtime.saveAtlasMapping"),
      payload: { mapping },
    });
  }

  async scatterProps(props: readonly PropInstance[]): Promise<RuntimeCommandResult<RuntimePropScatterResult>> {
    return this.execute({
      type: "runtime.scatterProps",
      requestId: makeRequestId("runtime.scatterProps"),
      payload: { props },
    });
  }

  async removeProps(filter: { readonly propIds?: readonly string[]; readonly chunkId?: string }): Promise<RuntimeCommandResult<RuntimePropRemoveResult>> {
    return this.execute({
      type: "runtime.removeProps",
      requestId: makeRequestId("runtime.removeProps"),
      payload: filter,
    });
  }

  async createLight(light: LightInstance): Promise<RuntimeCommandResult<RuntimeLightMutationResult>> {
    return this.execute({
      type: "runtime.createLight",
      requestId: makeRequestId("runtime.createLight"),
      payload: { light },
    });
  }

  async updateLight(lightId: string, patch: Partial<Omit<LightInstance, "id">>): Promise<RuntimeCommandResult<RuntimeLightMutationResult>> {
    return this.execute({
      type: "runtime.updateLight",
      requestId: makeRequestId("runtime.updateLight"),
      payload: { lightId, patch },
    });
  }

  async deleteLight(lightId: string): Promise<RuntimeCommandResult<RuntimeLightDeleteResult>> {
    return this.execute({
      type: "runtime.deleteLight",
      requestId: makeRequestId("runtime.deleteLight"),
      payload: { lightId },
    });
  }

  async saveLights(): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveLights",
      requestId: makeRequestId("runtime.saveLights"),
      payload: {},
    });
  }

  async loadLights(): Promise<RuntimeCommandResult<RuntimeLightLoadResult>> {
    return this.execute({
      type: "runtime.loadLights",
      requestId: makeRequestId("runtime.loadLights"),
      payload: {},
    });
  }

  async createProtectedArea(area: ProtectedArea): Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>> {
    return this.execute({
      type: "runtime.createProtectedArea",
      requestId: makeRequestId("runtime.createProtectedArea"),
      payload: { area },
    });
  }

  async updateProtectedArea(areaId: string, patch: Partial<Omit<ProtectedArea, "id">>): Promise<RuntimeCommandResult<RuntimeProtectedAreaMutationResult>> {
    return this.execute({
      type: "runtime.updateProtectedArea",
      requestId: makeRequestId("runtime.updateProtectedArea"),
      payload: { areaId, patch },
    });
  }

  async deleteProtectedArea(areaId: string): Promise<RuntimeCommandResult<RuntimeProtectedAreaDeleteResult>> {
    return this.execute({
      type: "runtime.deleteProtectedArea",
      requestId: makeRequestId("runtime.deleteProtectedArea"),
      payload: { areaId },
    });
  }

  async queryProtectedRulesAtVoxel(voxel: readonly [number, number, number]): Promise<RuntimeCommandResult<RuntimeProtectedRuleQueryResult>> {
    return this.execute({
      type: "runtime.queryProtectedRulesAtVoxel",
      requestId: makeRequestId("runtime.queryProtectedRulesAtVoxel"),
      payload: { voxel },
    });
  }

  async validateProtectedAreaConflicts(area?: ProtectedArea): Promise<RuntimeCommandResult<RuntimeProtectedAreaValidationResult>> {
    return this.execute({
      type: "runtime.validateProtectedAreaConflicts",
      requestId: makeRequestId("runtime.validateProtectedAreaConflicts"),
      payload: area ? { area } : {},
    });
  }

  async saveProtectedAreas(): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveProtectedAreas",
      requestId: makeRequestId("runtime.saveProtectedAreas"),
      payload: {},
    });
  }

  async loadProtectedAreas(): Promise<RuntimeCommandResult<RuntimeProtectedAreaLoadResult>> {
    return this.execute({
      type: "runtime.loadProtectedAreas",
      requestId: makeRequestId("runtime.loadProtectedAreas"),
      payload: {},
    });
  }

  async saveWorldSnapshot(): Promise<RuntimeCommandResult<RuntimeSaveSummary>> {
    return this.execute({
      type: "runtime.saveWorldSnapshot",
      requestId: makeRequestId("runtime.saveWorldSnapshot"),
      payload: {},
    });
  }

  onRuntimeEvent(handler: RuntimeEventHandler): () => void {
    return this.bridge.onRuntimeEvent?.(handler) ?? (() => undefined);
  }

  private async execute<T>(request: RuntimeCommandRequest): Promise<RuntimeCommandResult<T>> {
    const result = await this.bridge.executeCommand(request);
    return result as RuntimeCommandResult<T>;
  }
}
