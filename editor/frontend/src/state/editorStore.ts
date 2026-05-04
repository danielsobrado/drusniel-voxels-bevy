import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { WorldSummary } from "../backend/EditorBackendClient";
import { getMockRenderQualityReadouts, mockAgentObservation, mockAgentTimeline, mockConsoleMessages, mockRuntimeMetrics } from "../mocks/mockRuntime";
import { mockAtlasMapping, mockChunks, mockMaterials, mockPropAssets, mockProps, mockProtectedAreas, mockVoxelBlocks, mockWaterBodies } from "../mocks/mockWorld";
import { mockWaterRuntimeSnapshot } from "../mocks/mockRuntime";
import type {
  BrushSettings,
  CommandHistoryEntry,
  DirtyState,
  EditorMode,
  PropBrushSettings,
  RenderQualityPreset,
  RuntimeState,
  Selection,
  ViewportOverlayState,
} from "../types/editor";
import type { AgentObservation, AgentTimelineEvent, ConsoleMessage, RuntimeMetrics } from "../types/runtime";
import type { AtlasMapping, BlockAtlasMap, BlockType, ChunkSummary, MaterialAsset, MockWaterRuntimeSnapshot, PropInstance, ProtectedArea, VoxelBlock, WaterBody, WaterReflectionStatus } from "../types/world";

type OutlinerNodeKey = `${Selection["kind"]}:${string}`;

type OutlinerNodeState = { readonly visible: boolean; readonly locked: boolean };

const makeOutlinerNodeKey = (kind: Selection["kind"], id: string): OutlinerNodeKey => `${kind}:${id}`;

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

  if (currentSelection.kind === "material" && summary.materials.some((material) => material.id === currentSelection.id)) {
    return currentSelection;
  }

  if (summary.chunks.length > 0) {
    const chunk = summary.chunks[0];
    return { kind: "chunk", id: chunk.id, label: chunk.label };
  }

  return { kind: "debug_resource", id: "selection-empty", label: "No selection" };
};

export interface EditorDataState {
  readonly activeMode: EditorMode;
  readonly activeTool: string;
  readonly selection: Selection;
  readonly brushSettings: BrushSettings;
  readonly propBrushSettings: PropBrushSettings;
  readonly viewportOverlays: ViewportOverlayState;
  readonly runtimeState: RuntimeState;
  readonly renderQualityPreset: RenderQualityPreset;
  readonly chunks: ChunkSummary[];
  readonly voxelBlocks: VoxelBlock[];
  readonly protectedAreas: ProtectedArea[];
  readonly waterBodies: WaterBody[];
  readonly props: PropInstance[];
  readonly materials: MaterialAsset[];
  readonly outlinerNodeState: Record<OutlinerNodeKey, OutlinerNodeState>;
  readonly atlasMapping: BlockAtlasMap;
  readonly waterRuntimeSnapshot: MockWaterRuntimeSnapshot;
  readonly selectedPropAssetId: string;
  readonly runtimeMetrics: RuntimeMetrics;
  readonly consoleMessages: ConsoleMessage[];
  readonly agentObservation: AgentObservation;
  readonly agentTimeline: AgentTimelineEvent[];
  readonly selectedAtlasTileId: string;
  readonly dirtyState: DirtyState;
  readonly commandHistory: CommandHistoryEntry[];
  readonly pendingCommandIds: readonly string[];
  readonly layoutResetRequestId: number;
}

interface EditorActions {
  readonly setActiveMode: (mode: EditorMode) => void;
  readonly setActiveTool: (tool: string) => void;
  readonly setSelection: (selection: Selection) => void;
  readonly updateBrushSettings: (settings: Partial<BrushSettings>) => void;
  readonly setBrushRadius: (radius: number) => void;
  readonly addProtectedArea: (area: ProtectedArea) => void;
  readonly toggleViewportOverlay: (overlay: keyof ViewportOverlayState) => void;
  readonly setRuntimeState: (state: RuntimeState) => void;
  readonly setRenderQualityPreset: (preset: RenderQualityPreset) => void;
  readonly setOutlinerNodeVisibility: (kind: Selection["kind"], id: string, visible: boolean) => void;
  readonly setOutlinerNodeLock: (kind: Selection["kind"], id: string, locked: boolean) => void;
  readonly toggleOutlinerNodeVisibility: (kind: Selection["kind"], id: string) => void;
  readonly toggleOutlinerNodeLock: (kind: Selection["kind"], id: string) => void;
  readonly updateProtectedArea: (id: string, patch: Partial<Omit<ProtectedArea, "id">>) => void;
  readonly updateWaterBody: (id: string, patch: Partial<Omit<WaterBody, "id">>) => void;
  readonly removeProtectedArea: (id: string) => void;
  readonly updateProp: (id: string, patch: Partial<Omit<PropInstance, "id">>) => void;
  readonly updateAtlasMapping: (block: BlockType, patch: Partial<AtlasMapping>) => void;
  readonly setSelectedAtlasTile: (tileId: string) => void;
  readonly markAtlasRebuilt: () => void;
  readonly replaceWorldSummary: (summary: WorldSummary) => void;
  readonly setWaterRuntimeSnapshot: (snapshot: MockWaterRuntimeSnapshot) => void;
  readonly syncWaterReflectionStatus: (patch: Partial<WaterReflectionStatus>) => void;
  readonly markDirty: (chunkId?: string) => void;
  readonly clearDirty: () => void;
  readonly clearConsole: () => void;
  readonly pushAgentTimelineEvent: (event: Omit<AgentTimelineEvent, "id" | "createdAt"> & Partial<Pick<AgentTimelineEvent, "id" | "createdAt">>) => void;
  readonly requestLayoutReset: () => void;
  readonly pushCommandHistory: (commandId: string, label: string, status?: CommandHistoryEntry["status"], message?: string) => void;
  readonly beginCommand: (commandId: string) => void;
  readonly finishCommand: (commandId: string) => void;
  readonly setPropBrushSettings: (settings: Partial<PropBrushSettings>) => void;
  readonly setSelectedPropAsset: (propAssetId: string) => void;
  readonly addProps: (props: readonly PropInstance[]) => void;
  readonly removeProp: (propId: string) => void;
  readonly removePropsByChunk: (chunkId: string) => void;
  readonly updateRuntimeMetrics: (mutator: (runtimeMetrics: RuntimeMetrics) => void) => void;
}

export type EditorStore = EditorDataState & EditorActions;

const dirtyChunkIds = mockChunks.filter((chunk) => chunk.dirty).map((chunk) => chunk.id);

const initialSelection: Selection = { kind: "chunk", id: "chunk-0-0", label: "Chunk 0,0" };
const initialChunkIndex = dirtyChunkIds.length ? dirtyChunkIds : [];

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

export const createInitialEditorState = (): EditorDataState => ({
  activeMode: "select",
  activeTool: "select",
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
  },
  runtimeState: "mock",
  renderQualityPreset: "High",
  selectedAtlasTileId: "tile-0",
  chunks: [...mockChunks],
  voxelBlocks: [...mockVoxelBlocks],
  protectedAreas: [...mockProtectedAreas],
  waterBodies: [...mockWaterBodies],
  props: [...mockProps],
  materials: [...mockMaterials],
  outlinerNodeState: createOutlinerNodeState(mockChunks, mockProtectedAreas, mockWaterBodies, mockProps, mockMaterials),
  propBrushSettings: initialPropBrushSettings,
  selectedPropAssetId: mockPropAssets[0]?.id ?? "asset-tree-01",
  atlasMapping: { ...mockAtlasMapping },
  waterRuntimeSnapshot: { ...mockWaterRuntimeSnapshot },
  runtimeMetrics: mockRuntimeMetrics,
  consoleMessages: [...mockConsoleMessages],
  agentObservation: mockAgentObservation,
  agentTimeline: [...mockAgentTimeline],
  dirtyState: {
    hasUnsavedChanges: true,
    dirtyChunkIds: initialChunkIndex,
    dirtyAreaIds: [],
    dirtyWaterBodyIds: [],
    dirtyAtlas: false,
  },
  commandHistory: [],
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
    setSelection: (selection) =>
      set((state) => {
        state.selection = selection;
      }),
    setPropBrushSettings: (settings) =>
      set((state) => {
        state.propBrushSettings = { ...state.propBrushSettings, ...settings };
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
      }),
    removeProp: (propId) =>
      set((state) => {
        state.props = state.props.filter((prop) => prop.id !== propId);
      }),
    removePropsByChunk: (chunkId) =>
      set((state) => {
        state.props = state.props.filter((prop) => prop.chunkId !== chunkId);
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
    setRuntimeState: (runtimeState) =>
      set((state) => {
        state.runtimeState = runtimeState;
      }),
    setRenderQualityPreset: (preset) =>
      set((state) => {
        state.renderQualityPreset = preset;
        state.runtimeMetrics.renderQualityPreset = preset;
        state.runtimeMetrics.renderQualityReadouts = getMockRenderQualityReadouts(preset);
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
      }),
    setOutlinerNodeLock: (kind, id, locked) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        state.outlinerNodeState[key] = { ...existing, locked };
      }),
    toggleOutlinerNodeVisibility: (kind, id) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        state.outlinerNodeState[key] = { ...existing, visible: !existing.visible };
      }),
    toggleOutlinerNodeLock: (kind, id) =>
      set((state) => {
        const key = makeOutlinerNodeKey(kind, id);
        const existing = state.outlinerNodeState[key] ?? { visible: true, locked: false };
        state.outlinerNodeState[key] = { ...existing, locked: !existing.locked };
      }),
    updateProtectedArea: (id, patch) =>
      set((state) => {
        const index = state.protectedAreas.findIndex((area) => area.id === id);
        if (index < 0) {
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
    removeProtectedArea: (id) =>
      set((state) => {
        state.protectedAreas = state.protectedAreas.filter((area) => area.id !== id);
        state.dirtyState.dirtyAreaIds = state.dirtyState.dirtyAreaIds.filter((areaId) => areaId !== id);
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

        state.props[index] = { ...state.props[index], ...patch };
        state.dirtyState.hasUnsavedChanges = true;
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
        state.dirtyState.hasUnsavedChanges = state.dirtyState.dirtyChunkIds.length > 0 || state.dirtyState.dirtyAreaIds.length > 0 || state.dirtyState.dirtyWaterBodyIds.length > 0;
      }),
    replaceWorldSummary: (summary) =>
      set((state) => {
        state.chunks = [...summary.chunks];
        state.protectedAreas = [...summary.protectedAreas];
        state.waterBodies = [...summary.waterBodies];
        state.materials = [...summary.materials];
        state.outlinerNodeState = createOutlinerNodeState(summary.chunks, summary.protectedAreas, summary.waterBodies, state.props, summary.materials);
        state.selection = preserveSelectionWhenReplacingSummary(summary, state.selection);
        state.dirtyState = {
          hasUnsavedChanges: false,
          dirtyChunkIds: summary.chunks.filter((chunk) => chunk.dirty).map((chunk) => chunk.id),
          dirtyAreaIds: [],
          dirtyWaterBodyIds: [],
          dirtyAtlas: false,
        };
      }),
    markDirty: (chunkId) =>
      set((state) => {
        state.dirtyState.hasUnsavedChanges = true;
        if (chunkId && !state.dirtyState.dirtyChunkIds.includes(chunkId)) {
          state.dirtyState.dirtyChunkIds = [...state.dirtyState.dirtyChunkIds, chunkId];
        }
      }),
    clearDirty: () =>
      set((state) => {
        state.dirtyState = { hasUnsavedChanges: false, dirtyChunkIds: [], dirtyAreaIds: [], dirtyWaterBodyIds: [], dirtyAtlas: false, lastSavedAt: new Date().toISOString() };
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
      }),
    pushCommandHistory: (commandId, label, status = "success", message) =>
      set((state) => {
        state.commandHistory.unshift({ commandId, label, status, message, createdAt: new Date().toISOString() });
        state.commandHistory = state.commandHistory.slice(0, 20);
      }),
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
