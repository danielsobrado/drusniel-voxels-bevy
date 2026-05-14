import { create } from "zustand";
import { castDraft, type Draft } from "immer";
import { immer } from "zustand/middleware/immer";
import type { WorldSummary } from "../backend/EditorBackendClient";
import type {
  BrushSettings,
  CommandHistoryEntry,
  DirtyState,
  EditorMode,
  EditorViewportRole,
  EditorSavedSnapshot,
  EditorUndoEntry,
  EditorUndoSnapshot,
  LargeWorldStats,
  PropBrushSettings,
  PropPlacementSettings,
  RenderQualityPreset,
  RuntimeState,
  Selection,
  ViewportOverlayState,
} from "../types/editor";
import type { AgentObservation, AgentTimelineEvent, ConsoleMessage, RuntimeMetrics } from "../types/runtime";
import type { AtlasMapping, BlockAtlasMap, BlockType, ChunkSummary, MaterialAsset, PropAsset, PropInstance, ProtectedArea, ViewportSnapshot, VoxelBlock, WaterBody, WaterReflectionStatus, WaterRuntimeSnapshot, WorldViewportPreview } from "../types/world";

type OutlinerNodeKey = `${Selection["kind"]}:${string}`;

type OutlinerNodeState = { readonly visible: boolean; readonly locked: boolean };

const makeOutlinerNodeKey = (kind: Selection["kind"], id: string): OutlinerNodeKey => `${kind}:${id}`;
const MAX_UNDO_ENTRIES = 50;
const MAX_SAVED_SNAPSHOTS = 12;

const cloneEditorValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createOutlinerNodeState = (
  chunks: readonly ChunkSummary[],
  protectedAreas: readonly ProtectedArea[],
  waterBodies: readonly WaterBody[],
  props: readonly PropInstance[],
  materials: readonly MaterialAsset[],
): Record<OutlinerNodeKey, OutlinerNodeState> => {
  const entries: ReadonlyArray<readonly [OutlinerNodeKey, OutlinerNodeState]> = [
    ...chunks.map((chunk) => [makeOutlinerNodeKey("chunk", chunk.id), { visible: true, locked: false }] as const),
    ...protectedAreas.map((area) => [makeOutlinerNodeKey("area", area.id), { visible: true, locked: area.locked }] as const),
    ...waterBodies.map((waterBody) => [makeOutlinerNodeKey("water", waterBody.id), { visible: true, locked: false }] as const),
    ...props.map((prop) => [makeOutlinerNodeKey("prop", prop.id), { visible: true, locked: false }] as const),
    ...materials.map((material) => [makeOutlinerNodeKey("material", material.id), { visible: true, locked: false }] as const),
  ];

  return Object.fromEntries(entries);
};

const preserveSelectionWhenReplacingSummary = (summary: WorldSummary, currentSelection: Selection): Selection => {
  if (currentSelection.kind === "chunk" && summary.chunks.some((chunk) => chunk.id === currentSelection.id)) {
    return currentSelection;
  }

  if (currentSelection.kind === "area" && summary.protectedAreas.some((area) => area.id === currentSelection.id)) {
    return currentSelection;
  }

  if (currentSelection.kind === "water" && summary.waterBodies.some((waterBody) => waterBody.id === currentSelection.id)) {
    return currentSelection;
  }

  if (currentSelection.kind === "prop" && summary.props.some((prop) => prop.id === currentSelection.id)) {
    return currentSelection;
  }

  if (currentSelection.kind === "material" && summary.materials.some((material) => material.id === currentSelection.id)) {
    return currentSelection;
  }

  if (summary.chunks.length > 0) {
    const chunk = summary.chunks[0];
    return { kind: "chunk", id: chunk.id, label: chunk.label };
  }

  return { kind: "debug_resource", id: "selection-empty", label: "No selection" };
};

const captureEditorSnapshot = (state: EditorDataState): EditorUndoSnapshot => ({
  activeMode: state.activeMode,
  activeTool: state.activeTool,
  viewportRole: state.viewportRole,
  selection: cloneEditorValue(state.selection),
  brushSettings: cloneEditorValue(state.brushSettings),
  propBrushSettings: cloneEditorValue(state.propBrushSettings),
  propPlacementSettings: cloneEditorValue(state.propPlacementSettings),
  viewportOverlays: cloneEditorValue(state.viewportOverlays),
  renderQualityPreset: state.renderQualityPreset,
  chunks: cloneEditorValue(state.chunks),
  worldViewport: cloneEditorValue(state.worldViewport),
  viewportSnapshot: cloneEditorValue(state.viewportSnapshot),
  protectedAreas: cloneEditorValue(state.protectedAreas),
  waterBodies: cloneEditorValue(state.waterBodies),
  props: cloneEditorValue(state.props),
  propAssets: cloneEditorValue(state.propAssets),
  materials: cloneEditorValue(state.materials),
  atlasMapping: cloneEditorValue(state.atlasMapping),
  selectedAtlasTileId: state.selectedAtlasTileId,
  selectedPropAssetId: state.selectedPropAssetId,
  dirtyState: cloneEditorValue(state.dirtyState),
});

const restoreEditorSnapshot = (state: Draft<EditorDataState>, snapshot: EditorUndoSnapshot): void => {
  state.activeMode = snapshot.activeMode;
  state.activeTool = snapshot.activeTool;
  state.viewportRole = snapshot.viewportRole;
  state.selection = cloneEditorValue(snapshot.selection);
  state.brushSettings = cloneEditorValue(snapshot.brushSettings);
  state.propBrushSettings = cloneEditorValue(snapshot.propBrushSettings);
  state.propPlacementSettings = cloneEditorValue(snapshot.propPlacementSettings);
  state.viewportOverlays = cloneEditorValue(snapshot.viewportOverlays);
  state.renderQualityPreset = snapshot.renderQualityPreset;
  state.chunks = [...cloneEditorValue(snapshot.chunks)];
  state.worldViewport = castDraft(cloneEditorValue(snapshot.worldViewport));
  state.viewportSnapshot = castDraft(cloneEditorValue(snapshot.viewportSnapshot));
  state.protectedAreas = [...cloneEditorValue(snapshot.protectedAreas)];
  state.waterBodies = [...cloneEditorValue(snapshot.waterBodies)];
  state.props = [...cloneEditorValue(snapshot.props)];
  state.propAssets = [...cloneEditorValue(snapshot.propAssets)];
  state.materials = [...cloneEditorValue(snapshot.materials)];
  state.outlinerNodeState = createOutlinerNodeState(state.chunks, state.protectedAreas, state.waterBodies, state.props, state.materials);
  state.atlasMapping = cloneEditorValue(snapshot.atlasMapping);
  state.selectedAtlasTileId = snapshot.selectedAtlasTileId;
  state.selectedPropAssetId = snapshot.selectedPropAssetId;
  state.dirtyState = castDraft(cloneEditorValue(snapshot.dirtyState));
};

const replaceDirtyViewportChunks = (
  currentSnapshot: ViewportSnapshot | null,
  nextSnapshot: ViewportSnapshot,
  dirtyChunkIds: readonly string[],
): ViewportSnapshot => {
  if (!currentSnapshot || currentSnapshot.worldId !== nextSnapshot.worldId || dirtyChunkIds.length === 0) {
    return nextSnapshot;
  }

  const dirtyChunks = new Set(dirtyChunkIds);
  const currentChunks = new Map(currentSnapshot.chunks.map((chunk) => [chunk.chunkId, chunk] as const));

  return {
    ...nextSnapshot,
    chunks: nextSnapshot.chunks.map((chunk) => {
      const currentChunk = currentChunks.get(chunk.chunkId);
      if (
        !currentChunk ||
        dirtyChunks.has(chunk.chunkId) ||
        chunk.dirty ||
        chunk.meshState === "queued" ||
        currentChunk.payloadId !== chunk.payloadId
      ) {
        return chunk;
      }

      return currentChunk;
    }),
  };
};

const mergeViewportPreview = (
  currentPreview: WorldViewportPreview | null,
  nextPreview: WorldViewportPreview,
): WorldViewportPreview => {
  if (
    !currentPreview ||
    currentPreview.chunks.length <= nextPreview.chunks.length
  ) {
    return nextPreview;
  }

  if (currentPreview.chunkSize !== nextPreview.chunkSize || currentPreview.sampleResolution !== nextPreview.sampleResolution) {
    return currentPreview;
  }

  const nextChunksById = new Map(nextPreview.chunks.map((chunk) => [chunk.chunkId, chunk] as const));
  return {
    ...currentPreview,
    chunks: currentPreview.chunks.map((chunk) => nextChunksById.get(chunk.chunkId) ?? chunk),
  };
};

export interface EditorDataState {
  readonly activeMode: EditorMode;
  readonly activeTool: string;
  readonly viewportRole: EditorViewportRole;
  readonly selection: Selection;
  readonly brushSettings: BrushSettings;
  readonly propBrushSettings: PropBrushSettings;
  readonly propPlacementSettings: PropPlacementSettings;
  readonly viewportOverlays: ViewportOverlayState;
  readonly runtimeState: RuntimeState;
  readonly renderQualityPreset: RenderQualityPreset;
  readonly chunks: ChunkSummary[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
  readonly voxelBlocks: VoxelBlock[];
  readonly protectedAreas: ProtectedArea[];
  readonly waterBodies: WaterBody[];
  readonly props: PropInstance[];
  readonly propAssets: PropAsset[];
  readonly materials: MaterialAsset[];
  readonly outlinerNodeState: Record<OutlinerNodeKey, OutlinerNodeState>;
  readonly atlasMapping: BlockAtlasMap;
  readonly waterRuntimeSnapshot: WaterRuntimeSnapshot;
  readonly selectedPropAssetId: string;
  readonly runtimeMetrics: RuntimeMetrics;
  readonly consoleMessages: ConsoleMessage[];
  readonly agentObservation: AgentObservation;
  readonly agentTimeline: AgentTimelineEvent[];
  readonly selectedAtlasTileId: string;
  readonly dirtyState: DirtyState;
  readonly commandHistory: CommandHistoryEntry[];
  readonly undoStack: EditorUndoEntry[];
  readonly redoStack: EditorUndoEntry[];
  readonly savedSnapshots: EditorSavedSnapshot[];
  readonly largeWorldStats: LargeWorldStats;
  readonly pendingCommandIds: readonly string[];
  readonly layoutResetRequestId: number;
}

interface EditorActions {
  readonly setActiveMode: (mode: EditorMode) => void;
  readonly setActiveTool: (tool: string) => void;
  readonly setViewportRole: (role: EditorViewportRole) => void;
  readonly setSelection: (selection: Selection) => void;
  readonly updateBrushSettings: (settings: Partial<BrushSettings>) => void;
  readonly setBrushRadius: (radius: number) => void;
  readonly addProtectedArea: (area: ProtectedArea) => void;
  readonly toggleViewportOverlay: (overlay: keyof ViewportOverlayState) => void;
  readonly setViewportOverlay: (overlay: keyof ViewportOverlayState, enabled: boolean) => void;
  readonly setRuntimeState: (state: RuntimeState) => void;
  readonly setRenderQualityPreset: (preset: RenderQualityPreset) => void;
  readonly setOutlinerNodeVisibility: (kind: Selection["kind"], id: string, visible: boolean) => void;
  readonly setOutlinerNodeLock: (kind: Selection["kind"], id: string, locked: boolean) => void;
  readonly toggleOutlinerNodeVisibility: (kind: Selection["kind"], id: string) => void;
  readonly toggleOutlinerNodeLock: (kind: Selection["kind"], id: string) => void;
  readonly updateProtectedArea: (id: string, patch: Partial<Omit<ProtectedArea, "id">>) => void;
  readonly replaceProtectedAreas: (areas: readonly ProtectedArea[]) => void;
  readonly updateWaterBody: (id: string, patch: Partial<Omit<WaterBody, "id">>) => void;
  readonly removeProtectedArea: (id: string) => void;
  readonly updateProp: (id: string, patch: Partial<Omit<PropInstance, "id">>) => void;
  readonly updateAtlasMapping: (block: BlockType, patch: Partial<AtlasMapping>) => void;
  readonly setSelectedAtlasTile: (tileId: string) => void;
  readonly markAtlasRebuilt: () => void;
  readonly replaceWorldSummary: (summary: WorldSummary) => void;
  readonly setViewportSnapshot: (snapshot: ViewportSnapshot | null) => void;
  readonly setWaterRuntimeSnapshot: (snapshot: WaterRuntimeSnapshot) => void;
  readonly syncWaterReflectionStatus: (patch: Partial<WaterReflectionStatus>) => void;
  readonly markDirty: (chunkId?: string) => void;
  readonly markPropDirty: (propId: string) => void;
  readonly markLayoutDirty: () => void;
  readonly clearDirty: () => void;
  readonly clearConsole: () => void;
  readonly pushAgentTimelineEvent: (event: Omit<AgentTimelineEvent, "id" | "createdAt"> & Partial<Pick<AgentTimelineEvent, "id" | "createdAt">>) => void;
  readonly requestLayoutReset: () => void;
  readonly pushCommandHistory: (commandId: string, label: string, status?: CommandHistoryEntry["status"], message?: string) => void;
  readonly recordUndoCheckpoint: (commandId: string, label: string, actor?: EditorUndoEntry["actor"]) => void;
  readonly discardUndoCheckpoint: (commandId: string) => void;
  readonly undoLastCommand: () => boolean;
  readonly redoLastCommand: () => boolean;
  readonly saveEditorSnapshot: (note: string, commandId?: string, actor?: EditorUndoEntry["actor"]) => EditorSavedSnapshot;
  readonly loadEditorSnapshot: (snapshotId: string) => boolean;
  readonly beginCommand: (commandId: string) => void;
  readonly finishCommand: (commandId: string) => void;
  readonly setPropBrushSettings: (settings: Partial<PropBrushSettings>) => void;
  readonly setPropPlacementSettings: (settings: Partial<PropPlacementSettings>) => void;
  readonly setSelectedPropAsset: (propAssetId: string) => void;
  readonly addProps: (props: readonly PropInstance[]) => void;
  readonly removeProp: (propId: string) => void;
  readonly removePropsByChunk: (chunkId: string) => void;
  readonly updateRuntimeMetrics: (mutator: (runtimeMetrics: RuntimeMetrics) => void) => void;
}

export type EditorStore = EditorDataState & EditorActions;

const initialSelection: Selection = { kind: "debug_resource", id: "selection-empty", label: "No selection" };

const defaultVoxelBlocks: readonly VoxelBlock[] = [
  { id: "grass", displayName: "Grass", solid: true, defaultMaterialId: "mat-grass-block" },
  { id: "dirt", displayName: "Dirt", solid: true, defaultMaterialId: "mat-dirt-block" },
  { id: "rock", displayName: "Rock", solid: true, defaultMaterialId: "mat-rock-block" },
  { id: "sand", displayName: "Sand", solid: true, defaultMaterialId: "mat-sand-block" },
];

const defaultAtlasMapping: BlockAtlasMap = {
  grass: { top: "", side: "", bottom: "" },
  dirt: { top: "", side: "", bottom: "" },
  rock: { top: "", side: "", bottom: "" },
  sand: { top: "", side: "", bottom: "" },
};

const createDefaultRenderQualityReadouts = (): RuntimeMetrics["renderQualityReadouts"] => ({
  propLodDistanceScale: 0,
  propShadowDistanceScale: 0,
  terrainMaterialLodDistance: 0,
  waterReflectionResolutionScale: 0,
  waterReflectionUpdateInterval: 0,
  waterReflectionDistance: 0,
  waterReflectionQualityCode: 0,
  shadowQualityCode: 0,
});

const defaultWaterRuntimeSnapshot: WaterRuntimeSnapshot = {
  reflectionStatus: {
    active: false,
    sampleReflection: false,
    reason: "disabled",
    resolutionScale: 0,
    effectiveHz: 0,
    enabled: false,
    debugViewMode: "Off",
    probeValid: false,
    lastProbeUpdateMs: 0,
  },
  waterPresence: {
    nearestWaterDistance: null,
    visibleMeshes: 0,
    eligibleMeshes: 0,
    viewVisibleMeshes: 0,
    totalWaterMeshes: 0,
  },
  probe: {
    nearestBodyKind: "Unknown",
    materialMode: "Unknown",
    maxDepth: 0,
    triangles: 0,
    reflectionEligible: false,
    reflectionActive: false,
    compositorPixelMatched: false,
  },
};

const defaultRuntimeMetrics: RuntimeMetrics = {
  fps: 0,
  frameMs: 0,
  renderQualityPreset: "High",
  renderQualityReadouts: createDefaultRenderQualityReadouts(),
  chunkMeshMs: 0,
  waterReflectionMs: 0,
  propBillboardMs: 0,
  shadowBudget: { enabled: false },
  ambientOcclusion: {
    gtaoEnabled: false,
    gtaoQuality: "medium",
    gtaoSliceCount: 0,
    gtaoStepsPerSlice: 0,
    gtaoRadius: 0,
    gtaoTemporalDenoise: false,
    ssaoSupported: false,
    ssaoEnabled: false,
    bakedAoStrength: 0,
  },
  adaptiveGI: {
    adaptiveGiQuality: 0,
    stochasticProbeSelection: false,
    probeSelectionCount: 0,
    sdfShadows: false,
    contactShadows: false,
  },
  waterRenderDebug: {
    reflectionActive: false,
    waterMaskPixels: 0,
    displacementEnabled: false,
    visualProbeStatus: "unavailable",
  },
  lightingAtmosphere: {
    sunTimeOfDay: "",
    fogPreset: "",
    fogActive: false,
    godRaysEnabled: false,
    godRayIntensity: 0,
  },
  volumetricClouds: {
    coverage: 0,
    renderScale: 0,
    primarySteps: 0,
    lightSteps: 0,
  },
  cinematicPhotoMode: {
    photoModeActive: false,
    focalDistance: 0,
    aperture: 0,
    blurEnabled: false,
    depthOfFieldMode: "",
    motionBlurSamples: 0,
    cinematicModeActive: false,
  },
  graphicsCapabilities: {
    adapterName: "",
    integratedGPU: false,
    taaSupported: false,
    rayTracingSupported: false,
    rayTracingEnabled: false,
  },
  timingSamples: [],
};

const defaultAgentObservation: AgentObservation = {
  activeMode: "select",
  activeTool: "select",
  selected: null,
  visiblePanels: [],
  viewport: {
    cameraPosition: [0, 0, 0],
    overlays: [],
  },
  brush: {
    radius: 4,
    strength: 0.75,
    materialBlockId: "grass",
    falloff: "smooth",
    brushShape: "cube",
    targetFace: "all",
  },
  dirtyChunks: 0,
  warnings: [],
  suggestedCommands: [],
};

const initialPropBrushSettings: PropBrushSettings = {
  density: 8,
  spacing: 4,
  slopeLimit: 35,
  randomRotation: true,
  scaleJitter: 0.18,
  alignToNormal: true,
  terrainConform: true,
  avoidProtectedAreas: false,
  avoidWater: true,
  collisionCheck: true,
  seed: 24601,
};

const initialPropPlacementSettings: PropPlacementSettings = {
  rotateDragModifier: "shift",
  fineScaleModifier: "alt",
  rotationSensitivity: 0.45,
  rotationSnapDegrees: 5,
  scaleStep: 0.1,
  minScale: 0.25,
  maxScale: 4,
};

export const createInitialEditorState = (): EditorDataState => ({
  activeMode: "select",
  activeTool: "select",
  viewportRole: "authoring",
  selection: initialSelection,
  brushSettings: {
    radius: 4,
    strength: 0.75,
    materialBlockId: "grass",
    falloff: "smooth",
    brushShape: "cube",
    targetFace: "all",
  },
  viewportOverlays: {
    chunkBounds: true,
    voxelGrid: true,
    waterDebug: false,
    protectedAreas: true,
    propBounds: true,
    propBillboards: true,
    agentTargets: true,
    atlasPreview: false,
    wireframe: false,
  },
  runtimeState: "disconnected",
  renderQualityPreset: "High",
  selectedAtlasTileId: "",
  chunks: [],
  worldViewport: null,
  viewportSnapshot: null,
  voxelBlocks: [...defaultVoxelBlocks],
  protectedAreas: [],
  waterBodies: [],
  props: [],
  propAssets: [],
  materials: [],
  outlinerNodeState: createOutlinerNodeState([], [], [], [], []),
  propBrushSettings: initialPropBrushSettings,
  propPlacementSettings: initialPropPlacementSettings,
  selectedPropAssetId: "",
  atlasMapping: { ...defaultAtlasMapping },
  waterRuntimeSnapshot: { ...defaultWaterRuntimeSnapshot },
  runtimeMetrics: { ...defaultRuntimeMetrics },
  consoleMessages: [],
  agentObservation: defaultAgentObservation,
  agentTimeline: [],
  dirtyState: {
    hasUnsavedChanges: false,
    dirtyChunkIds: [],
    dirtyAreaIds: [],
    dirtyWaterBodyIds: [],
    dirtyPropIds: [],
    dirtyAtlas: false,
    layoutDirty: false,
  },
  commandHistory: [],
  undoStack: [],
  redoStack: [],
  savedSnapshots: [],
  largeWorldStats: {
    enabled: false,
    chunkCount: 0,
    propCount: 0,
    protectedAreaCount: 0,
    waterBodyCount: 0,
    consoleMessageCount: 0,
  },
  pendingCommandIds: [],
  layoutResetRequestId: 0,
});

export const useEditorStore = create<EditorStore>()(
  immer((set) => ({
    ...createInitialEditorState(),
    setActiveMode: (mode) =>
      set((state) => {
        state.activeMode = mode;
        state.activeTool = mode;
      }),
    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool;
      }),
    setViewportRole: (role) =>
      set((state) => {
        state.viewportRole = role;
      }),
    setSelection: (selection) =>
      set((state) => {
        state.selection = selection;
      }),
    setPropBrushSettings: (settings) =>
      set((state) => {
        state.propBrushSettings = { ...state.propBrushSettings, ...settings };
      }),
    setPropPlacementSettings: (settings) =>
      set((state) => {
        state.propPlacementSettings = { ...state.propPlacementSettings, ...settings };
      }),
    setSelectedPropAsset: (propAssetId) =>
      set((state) => {
        state.selectedPropAssetId = propAssetId;
        state.activeMode = "props";
        state.activeTool = "props";
      }),
    addProps: (props) =>
      set((state) => {
        state.props = [...state.props, ...props];
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.dirtyPropIds = [...new Set([...state.dirtyState.dirtyPropIds, ...props.map((prop) => prop.id)])];
      }),
    removeProp: (propId) =>
      set((state) => {
        state.props = state.props.filter((prop) => prop.id !== propId);
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.dirtyPropIds = [...new Set([...state.dirtyState.dirtyPropIds, propId])];
      }),
    removePropsByChunk: (chunkId) =>
      set((state) => {
        const removedIds = state.props.filter((prop) => prop.chunkId === chunkId).map((prop) => prop.id);
        state.props = state.props.filter((prop) => prop.chunkId !== chunkId);
        if (removedIds.length > 0) {
          state.dirtyState.hasUnsavedChanges = true;
          state.dirtyState.dirtyPropIds = [...new Set([...state.dirtyState.dirtyPropIds, ...removedIds])];
        }
      }),
    setWaterRuntimeSnapshot: (snapshot) =>
      set((state) => {
        state.waterRuntimeSnapshot = snapshot;
      }),
    syncWaterReflectionStatus: (patch) =>
      set((state) => {
        state.waterBodies = state.waterBodies.map((waterBody) => ({
          ...waterBody,
          reflectionStatus: {
            ...waterBody.reflectionStatus,
            ...patch,
          },
        }));
      }),
    updateBrushSettings: (settings) =>
      set((state) => {
        state.brushSettings = { ...state.brushSettings, ...settings };
      }),
    setBrushRadius: (radius) =>
      set((state) => {
        state.brushSettings.radius = radius;
      }),
    addProtectedArea: (area) =>
      set((state) => {
        state.protectedAreas = [...state.protectedAreas, area];
        state.outlinerNodeState[makeOutlinerNodeKey("area", area.id)] = { visible: true, locked: area.locked };
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.dirtyAreaIds = [...state.dirtyState.dirtyAreaIds, area.id];
      }),
    toggleViewportOverlay: (overlay) =>
      set((state) => {
        state.viewportOverlays[overlay] = !state.viewportOverlays[overlay];
      }),
    setViewportOverlay: (overlay, enabled) =>
      set((state) => {
        state.viewportOverlays[overlay] = enabled;
      }),
    setRuntimeState: (runtimeState) =>
      set((state) => {
        state.runtimeState = runtimeState;
      }),
    setRenderQualityPreset: (preset) =>
      set((state) => {
        state.renderQualityPreset = preset;
        state.runtimeMetrics.renderQualityPreset = preset;
        state.runtimeMetrics.renderQualityReadouts = createDefaultRenderQualityReadouts();
      }),
    updateRuntimeMetrics: (mutator) =>
      set((state) => {
        mutator(state.runtimeMetrics);
      }),
    setOutlinerNodeVisibility: (kind, id, visible) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        state.outlinerNodeState[key] = { ...existing, visible };
        if (kind === "prop") {
          const propIndex = state.props.findIndex((prop) => prop.id === id);
          if (propIndex >= 0) {
            state.props[propIndex] = { ...state.props[propIndex], visible };
            state.dirtyState.hasUnsavedChanges = true;
            if (!state.dirtyState.dirtyPropIds.includes(id)) {
              state.dirtyState.dirtyPropIds = [...state.dirtyState.dirtyPropIds, id];
            }
          }
        }
      }),
    setOutlinerNodeLock: (kind, id, locked) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        state.outlinerNodeState[key] = { ...existing, locked };
        if (kind === "area") {
          const areaIndex = state.protectedAreas.findIndex((area) => area.id === id);
          if (areaIndex >= 0) {
            state.protectedAreas[areaIndex] = { ...state.protectedAreas[areaIndex], locked };
            state.dirtyState.hasUnsavedChanges = true;
            if (!state.dirtyState.dirtyAreaIds.includes(id)) {
              state.dirtyState.dirtyAreaIds = [...state.dirtyState.dirtyAreaIds, id];
            }
          }
        }
      }),
    toggleOutlinerNodeVisibility: (kind, id) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        const visible = !existing.visible;
        state.outlinerNodeState[key] = { ...existing, visible };
        if (kind === "prop") {
          const propIndex = state.props.findIndex((prop) => prop.id === id);
          if (propIndex >= 0) {
            state.props[propIndex] = { ...state.props[propIndex], visible };
            state.dirtyState.hasUnsavedChanges = true;
            if (!state.dirtyState.dirtyPropIds.includes(id)) {
              state.dirtyState.dirtyPropIds = [...state.dirtyState.dirtyPropIds, id];
            }
          }
        }
      }),
    toggleOutlinerNodeLock: (kind, id) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        const locked = !existing.locked;
        state.outlinerNodeState[key] = { ...existing, locked };
        if (kind === "area") {
          const areaIndex = state.protectedAreas.findIndex((area) => area.id === id);
          if (areaIndex >= 0) {
            state.protectedAreas[areaIndex] = { ...state.protectedAreas[areaIndex], locked };
            state.dirtyState.hasUnsavedChanges = true;
            if (!state.dirtyState.dirtyAreaIds.includes(id)) {
              state.dirtyState.dirtyAreaIds = [...state.dirtyState.dirtyAreaIds, id];
            }
          }
        }
      }),
    updateProtectedArea: (id, patch) =>
      set((state) => {
        const index = state.protectedAreas.findIndex((area) => area.id === id);
        if (index < 0) {
          return;
        }

        if (state.protectedAreas[index].locked && patch.locked !== false) {
          return;
        }

        state.protectedAreas[index] = { ...state.protectedAreas[index], ...patch };
        state.dirtyState.hasUnsavedChanges = true;
        if (!state.dirtyState.dirtyAreaIds.includes(id)) {
          state.dirtyState.dirtyAreaIds = [...state.dirtyState.dirtyAreaIds, id];
        }

        if (typeof patch.locked === "boolean") {
          const key = makeOutlinerNodeKey("area", id);
          const currentState = state.outlinerNodeState[key] ?? { visible: true, locked: false };
          state.outlinerNodeState[key] = { ...currentState, locked: patch.locked };
        }
      }),
    replaceProtectedAreas: (areas) =>
      set((state) => {
        state.protectedAreas = [...areas];
        state.outlinerNodeState = createOutlinerNodeState(state.chunks, state.protectedAreas, state.waterBodies, state.props, state.materials);
        state.dirtyState.dirtyAreaIds = [];
        state.dirtyState.hasUnsavedChanges =
          state.dirtyState.dirtyChunkIds.length > 0 ||
          state.dirtyState.dirtyWaterBodyIds.length > 0 ||
          state.dirtyState.dirtyPropIds.length > 0 ||
          state.dirtyState.dirtyAtlas ||
          state.dirtyState.layoutDirty;

        const selectedAreaId = state.selection.kind === "area" ? state.selection.id : null;
        if (selectedAreaId && !state.protectedAreas.some((area) => area.id === selectedAreaId)) {
          state.selection = state.protectedAreas[0]
            ? { kind: "area", id: state.protectedAreas[0].id, label: state.protectedAreas[0].name }
            : state.chunks[0]
              ? { kind: "chunk", id: state.chunks[0].id, label: state.chunks[0].label }
              : { kind: "debug_resource", id: "selection-empty", label: "No selection" };
        }
      }),
    removeProtectedArea: (id) =>
      set((state) => {
        state.protectedAreas = state.protectedAreas.filter((area) => area.id !== id);
        state.dirtyState.dirtyAreaIds = state.dirtyState.dirtyAreaIds.filter((areaId) => areaId !== id);
        state.dirtyState.hasUnsavedChanges = true;
        state.outlinerNodeState = Object.fromEntries(Object.entries(state.outlinerNodeState).filter(([key]) => key !== `area:${id}`));
        if (state.selection.kind === "area" && state.selection.id === id) {
          state.selection = state.chunks[0]
            ? { kind: "chunk", id: state.chunks[0].id, label: state.chunks[0].label }
            : { kind: "debug_resource", id: "selection-empty", label: "No selection" };
        }
      }),
    updateWaterBody: (id, patch) =>
      set((state) => {
        const index = state.waterBodies.findIndex((waterBody) => waterBody.id === id);
        if (index < 0) {
          return;
        }

        state.waterBodies[index] = { ...state.waterBodies[index], ...patch };
        state.dirtyState.hasUnsavedChanges = true;
        if (!state.dirtyState.dirtyWaterBodyIds.includes(id)) {
          state.dirtyState.dirtyWaterBodyIds = [...state.dirtyState.dirtyWaterBodyIds, id];
        }
      }),
    updateProp: (id, patch) =>
      set((state) => {
        const index = state.props.findIndex((prop) => prop.id === id);
        if (index < 0) {
          return;
        }

        const nextProp = { ...state.props[index], ...patch };
        if (patch.transform?.position) {
          nextProp.position = patch.transform.position;
        } else if (patch.position) {
          nextProp.transform = { ...nextProp.transform, position: patch.position };
        }

        state.props[index] = nextProp;
        state.dirtyState.hasUnsavedChanges = true;
        if (!state.dirtyState.dirtyPropIds.includes(id)) {
          state.dirtyState.dirtyPropIds = [...state.dirtyState.dirtyPropIds, id];
        }
      }),
    updateAtlasMapping: (block, patch) =>
      set((state) => {
        state.atlasMapping[block] = { ...state.atlasMapping[block], ...patch };
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.dirtyAtlas = true;
      }),
    setSelectedAtlasTile: (tileId) =>
      set((state) => {
        state.selectedAtlasTileId = tileId;
      }),
    markAtlasRebuilt: () =>
      set((state) => {
        state.dirtyState.dirtyAtlas = false;
        state.dirtyState.hasUnsavedChanges =
          state.dirtyState.dirtyChunkIds.length > 0 ||
          state.dirtyState.dirtyAreaIds.length > 0 ||
          state.dirtyState.dirtyWaterBodyIds.length > 0 ||
          state.dirtyState.dirtyPropIds.length > 0 ||
          state.dirtyState.layoutDirty;
      }),
    replaceWorldSummary: (summary) =>
      set((state) => {
        state.chunks = [...summary.chunks];
        state.worldViewport = castDraft(summary.viewport ?? null);
        state.protectedAreas = [...summary.protectedAreas];
        state.waterBodies = [...summary.waterBodies];
        state.props = [...summary.props];
        state.propAssets = [...(summary.propAssets ?? state.propAssets)];
        if (!state.propAssets.some((asset) => asset.id === state.selectedPropAssetId)) {
          state.selectedPropAssetId = state.propAssets[0]?.id ?? "";
        }
        state.materials = [...summary.materials];
        state.outlinerNodeState = createOutlinerNodeState(summary.chunks, summary.protectedAreas, summary.waterBodies, summary.props, summary.materials);
        state.selection = preserveSelectionWhenReplacingSummary(summary, state.selection);
        state.dirtyState = {
          hasUnsavedChanges: false,
          dirtyChunkIds: summary.chunks.filter((chunk) => chunk.dirty).map((chunk) => chunk.id),
          dirtyAreaIds: [],
          dirtyWaterBodyIds: [],
          dirtyPropIds: [],
          dirtyAtlas: false,
          layoutDirty: false,
        };
        state.largeWorldStats = {
          enabled: false,
          chunkCount: summary.chunks.length,
          propCount: summary.props.length,
          protectedAreaCount: summary.protectedAreas.length,
          waterBodyCount: summary.waterBodies.length,
          consoleMessageCount: state.consoleMessages.length,
        };
      }),
    setViewportSnapshot: (snapshot) =>
      set((state) => {
        const nextSnapshot = snapshot ? replaceDirtyViewportChunks(state.viewportSnapshot, snapshot, state.dirtyState.dirtyChunkIds) : null;
        state.viewportSnapshot = castDraft(nextSnapshot);
        const preview = nextSnapshot
          ? {
              chunkSize: nextSnapshot.chunkSize,
              sampleResolution: nextSnapshot.sampleResolution,
              chunks: nextSnapshot.chunks.map((chunk) => ({
                chunkId: chunk.chunkId,
                coordinate: chunk.coordinate,
                samples: [...chunk.samples],
                voxels: [...(chunk.voxels ?? [])],
              })),
            }
          : null;
        if (preview) {
          state.worldViewport = castDraft(mergeViewportPreview(state.worldViewport, preview));
        }
      }),
    markDirty: (chunkId) =>
      set((state) => {
        state.dirtyState.hasUnsavedChanges = true;
        if (chunkId && !state.dirtyState.dirtyChunkIds.includes(chunkId)) {
          state.dirtyState.dirtyChunkIds = [...state.dirtyState.dirtyChunkIds, chunkId];
        }
      }),
    markPropDirty: (propId) =>
      set((state) => {
        state.dirtyState.hasUnsavedChanges = true;
        if (!state.dirtyState.dirtyPropIds.includes(propId)) {
          state.dirtyState.dirtyPropIds = [...state.dirtyState.dirtyPropIds, propId];
        }
      }),
    markLayoutDirty: () =>
      set((state) => {
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.layoutDirty = true;
      }),
    clearDirty: () =>
      set((state) => {
        state.dirtyState = {
          hasUnsavedChanges: false,
          dirtyChunkIds: [],
          dirtyAreaIds: [],
          dirtyWaterBodyIds: [],
          dirtyPropIds: [],
          dirtyAtlas: false,
          layoutDirty: false,
          lastSavedAt: new Date().toISOString(),
        };
        state.chunks = state.chunks.map((chunk) => ({ ...chunk, dirty: false, meshStatus: chunk.meshStatus === "dirty" ? "clean" : chunk.meshStatus }));
      }),
    clearConsole: () =>
      set((state) => {
        state.consoleMessages = [];
      }),
    pushAgentTimelineEvent: (event) =>
      set((state) => {
        state.agentTimeline.unshift({
          id: event.id ?? `agent-event-${state.agentTimeline.length + 1}`,
          kind: event.kind,
          message: event.message,
          createdAt: event.createdAt ?? new Date().toISOString(),
        });
      }),
    requestLayoutReset: () =>
      set((state) => {
        state.layoutResetRequestId += 1;
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.layoutDirty = true;
      }),
    pushCommandHistory: (commandId, label, status = "success", message) =>
      set((state) => {
        state.commandHistory.unshift({ commandId, label, status, message, createdAt: new Date().toISOString() });
        state.commandHistory = state.commandHistory.slice(0, 20);
      }),
    recordUndoCheckpoint: (commandId, label, actor = "user") =>
      set((state) => {
        state.undoStack.unshift(castDraft({
          id: `undo-${Date.now()}-${state.undoStack.length + 1}`,
          commandId,
          label,
          actor,
          createdAt: new Date().toISOString(),
          snapshot: captureEditorSnapshot(state),
        }));
        state.undoStack = state.undoStack.slice(0, MAX_UNDO_ENTRIES);
        state.redoStack = [];
      }),
    discardUndoCheckpoint: (commandId) =>
      set((state) => {
        if (state.undoStack[0]?.commandId === commandId) {
          state.undoStack = state.undoStack.slice(1);
        }
      }),
    undoLastCommand: () => {
      let applied = false;
      set((state) => {
        const entry = state.undoStack[0];
        if (!entry) {
          return;
        }

        state.redoStack.unshift(castDraft({
          id: `redo-${Date.now()}-${state.redoStack.length + 1}`,
          commandId: entry.commandId,
          label: entry.label,
          actor: entry.actor,
          createdAt: new Date().toISOString(),
          snapshot: captureEditorSnapshot(state),
        }));
        state.redoStack = state.redoStack.slice(0, MAX_UNDO_ENTRIES);
        state.undoStack = state.undoStack.slice(1);
        restoreEditorSnapshot(state, entry.snapshot);
        state.dirtyState.hasUnsavedChanges = true;
        applied = true;
      });
      return applied;
    },
    redoLastCommand: () => {
      let applied = false;
      set((state) => {
        const entry = state.redoStack[0];
        if (!entry) {
          return;
        }

        state.undoStack.unshift(castDraft({
          id: `undo-${Date.now()}-${state.undoStack.length + 1}`,
          commandId: entry.commandId,
          label: entry.label,
          actor: entry.actor,
          createdAt: new Date().toISOString(),
          snapshot: captureEditorSnapshot(state),
        }));
        state.undoStack = state.undoStack.slice(0, MAX_UNDO_ENTRIES);
        state.redoStack = state.redoStack.slice(1);
        restoreEditorSnapshot(state, entry.snapshot);
        state.dirtyState.hasUnsavedChanges = true;
        applied = true;
      });
      return applied;
    },
    saveEditorSnapshot: (note, commandId = "editor.snapshot.create", actor = "user") => {
      let entry: EditorSavedSnapshot | undefined;
      set((state) => {
        entry = {
          id: `snapshot-${Date.now()}-${state.savedSnapshots.length + 1}`,
          commandId,
          label: note,
          note,
          actor,
          createdAt: new Date().toISOString(),
          snapshot: captureEditorSnapshot(state),
        };
        state.savedSnapshots.unshift(castDraft(entry));
        state.savedSnapshots = state.savedSnapshots.slice(0, MAX_SAVED_SNAPSHOTS);
      });

      if (!entry) {
        throw new Error("Failed to save editor snapshot.");
      }

      return entry;
    },
    loadEditorSnapshot: (snapshotId) => {
      let applied = false;
      set((state) => {
        const entry = state.savedSnapshots.find((candidate) => candidate.id === snapshotId);
        if (!entry) {
          return;
        }

        state.undoStack.unshift(castDraft({
          id: `undo-${Date.now()}-${state.undoStack.length + 1}`,
          commandId: "editor.snapshot.restore",
          label: `Restore ${entry.note}`,
          actor: "user",
          createdAt: new Date().toISOString(),
          snapshot: captureEditorSnapshot(state),
        }));
        restoreEditorSnapshot(state, entry.snapshot);
        state.dirtyState.hasUnsavedChanges = true;
        applied = true;
      });
      return applied;
    },
    beginCommand: (commandId) =>
      set((state) => {
        if (!state.pendingCommandIds.includes(commandId)) {
          state.pendingCommandIds = [...state.pendingCommandIds, commandId];
        }
      }),
    finishCommand: (commandId) =>
      set((state) => {
        state.pendingCommandIds = state.pendingCommandIds.filter((pendingCommandId) => pendingCommandId !== commandId);
      }),
  })),
);
