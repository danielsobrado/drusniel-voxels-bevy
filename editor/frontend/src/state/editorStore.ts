import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { mockAgentObservation, mockAgentTimeline, mockConsoleMessages, mockRuntimeMetrics } from "../mocks/mockRuntime";
import { mockAtlasMapping, mockChunks, mockMaterials, mockProps, mockProtectedAreas, mockVoxelBlocks, mockWaterBodies } from "../mocks/mockWorld";
import type { BrushSettings, CommandHistoryEntry, DirtyState, EditorMode, RenderQualityPreset, RuntimeState, Selection, ViewportOverlayState } from "../types/editor";
import type { AgentObservation, AgentTimelineEvent, ConsoleMessage, RuntimeMetrics } from "../types/runtime";
import type { AtlasMapping, BlockAtlasMap, BlockType, ChunkSummary, MaterialAsset, PropInstance, ProtectedArea, VoxelBlock, WaterBody } from "../types/world";

export interface EditorDataState {
  readonly activeMode: EditorMode;
  readonly activeTool: string;
  readonly selection: Selection;
  readonly brushSettings: BrushSettings;
  readonly viewportOverlays: ViewportOverlayState;
  readonly runtimeState: RuntimeState;
  readonly renderQualityPreset: RenderQualityPreset;
  readonly chunks: ChunkSummary[];
  readonly voxelBlocks: VoxelBlock[];
  readonly protectedAreas: ProtectedArea[];
  readonly waterBodies: WaterBody[];
  readonly props: PropInstance[];
  readonly materials: MaterialAsset[];
  readonly atlasMapping: BlockAtlasMap;
  readonly runtimeMetrics: RuntimeMetrics;
  readonly consoleMessages: ConsoleMessage[];
  readonly agentObservation: AgentObservation;
  readonly agentTimeline: AgentTimelineEvent[];
  readonly dirtyState: DirtyState;
  readonly commandHistory: CommandHistoryEntry[];
  readonly layoutResetRequestId: number;
}

interface EditorActions {
  readonly setActiveMode: (mode: EditorMode) => void;
  readonly setActiveTool: (tool: string) => void;
  readonly setSelection: (selection: Selection) => void;
  readonly updateBrushSettings: (settings: Partial<BrushSettings>) => void;
  readonly setBrushRadius: (radius: number) => void;
  readonly toggleViewportOverlay: (overlay: keyof ViewportOverlayState) => void;
  readonly setRuntimeState: (state: RuntimeState) => void;
  readonly setRenderQualityPreset: (preset: RenderQualityPreset) => void;
  readonly updateProtectedArea: (id: string, patch: Partial<Omit<ProtectedArea, "id">>) => void;
  readonly updateWaterBody: (id: string, patch: Partial<Omit<WaterBody, "id">>) => void;
  readonly updateAtlasMapping: (block: BlockType, patch: Partial<AtlasMapping>) => void;
  readonly markDirty: (chunkId?: string) => void;
  readonly clearDirty: () => void;
  readonly clearConsole: () => void;
  readonly pushAgentTimelineEvent: (event: Omit<AgentTimelineEvent, "id" | "createdAt"> & Partial<Pick<AgentTimelineEvent, "id" | "createdAt">>) => void;
  readonly requestLayoutReset: () => void;
  readonly pushCommandHistory: (commandId: string, label: string) => void;
}

export type EditorStore = EditorDataState & EditorActions;

const dirtyChunkIds = mockChunks.filter((chunk) => chunk.dirty).map((chunk) => chunk.id);

export const createInitialEditorState = (): EditorDataState => ({
  activeMode: "select",
  activeTool: "select",
  selection: { kind: "chunk", id: "chunk-0-0", label: "Chunk 0,0" },
  brushSettings: { radius: 4, strength: 0.75, materialBlockId: "grass", falloff: "smooth" },
  viewportOverlays: { chunkBounds: true, voxelGrid: true, waterDebug: false, protectedAreas: true, propBillboards: true, atlasPreview: false },
  runtimeState: "mocked",
  renderQualityPreset: "High",
  chunks: [...mockChunks],
  voxelBlocks: [...mockVoxelBlocks],
  protectedAreas: [...mockProtectedAreas],
  waterBodies: [...mockWaterBodies],
  props: [...mockProps],
  materials: [...mockMaterials],
  atlasMapping: { ...mockAtlasMapping },
  runtimeMetrics: mockRuntimeMetrics,
  consoleMessages: [...mockConsoleMessages],
  agentObservation: mockAgentObservation,
  agentTimeline: [...mockAgentTimeline],
  dirtyState: {
    hasUnsavedChanges: true,
    dirtyChunkIds,
    dirtyAreaIds: [],
    dirtyWaterBodyIds: [],
    dirtyAtlas: false,
  },
  commandHistory: [],
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
        state.agentObservation = { ...state.agentObservation, selectedObjectLabel: selection.label };
      }),
    updateBrushSettings: (settings) =>
      set((state) => {
        state.brushSettings = { ...state.brushSettings, ...settings };
      }),
    setBrushRadius: (radius) =>
      set((state) => {
        state.brushSettings.radius = radius;
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
    updateAtlasMapping: (block, patch) =>
      set((state) => {
        state.atlasMapping[block] = { ...state.atlasMapping[block], ...patch };
        state.dirtyState.hasUnsavedChanges = true;
        state.dirtyState.dirtyAtlas = true;
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
    pushCommandHistory: (commandId, label) =>
      set((state) => {
        state.commandHistory.unshift({ commandId, label, createdAt: new Date().toISOString() });
        state.commandHistory = state.commandHistory.slice(0, 20);
      }),
  })),
);
