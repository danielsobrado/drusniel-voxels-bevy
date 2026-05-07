import { beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MockEditorBackendClient } from "../backend/MockEditorBackendClient";
import type { BackendResult, WorldSaveSummary } from "../backend/EditorBackendClient";
import { editorCommands, getCommand, runCommand } from "../commands/commandRegistry";
import type { EditorCommandContext } from "../commands/commandTypes";
import { MockRuntimeClient } from "../runtime/MockRuntimeClient";
import { runtimeCommandFailure, runtimeCommandSuccess } from "../runtime/runtimeSchemas";
import { mockChunks, mockMaterials, mockProps, mockProtectedAreas, mockWaterBodies } from "../mocks/mockWorld";
import { createInitialEditorState, useEditorStore } from "./editorStore";
import { getAgentObservation, getCurrentInspectorKind, getDirtyChunks, getRuntimeWarnings, getSelectedObject, getVisibleOutlinerNodes } from "./editorSelectors";
import { menuCommandIds } from "../components/editor/EditorMenubar";
import { toolbarCommandIds } from "../components/editor/MainToolbar";

const collectSourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectSourceFiles(path) : [path];
  });

beforeEach(() => {
  useEditorStore.setState(createInitialEditorState(), false);
});

describe("editor store actions", () => {
  it("updates active mode, active tool, selection, and brush settings", () => {
    useEditorStore.getState().setActiveMode("water");
    useEditorStore.getState().setActiveTool("shoreline-brush");
    useEditorStore.getState().setSelection({ kind: "water", id: "water-lk-03", label: "LK_03" });
    useEditorStore.getState().updateBrushSettings({ radius: 9, materialBlockId: "sand" });

    const state = useEditorStore.getState();
    expect(state.activeMode).toBe("water");
    expect(state.activeTool).toBe("shoreline-brush");
    expect(state.selection.label).toBe("LK_03");
    expect(state.brushSettings.radius).toBe(9);
    expect(state.brushSettings.materialBlockId).toBe("sand");
  });

  it("updates protected areas, water bodies, atlas mapping, dirty state, and agent timeline", () => {
    useEditorStore.getState().updateProtectedArea("area-spawn-keep", { name: "Spawn Keep Updated" });
    useEditorStore.getState().updateWaterBody("water-mill-pond", { surfaceY: 17 });
    useEditorStore.getState().updateAtlasMapping("grass", { side: "atlas/terrain_grass_side_alt" });
    useEditorStore.getState().markDirty("chunk-1-0");
    useEditorStore.getState().pushAgentTimelineEvent({ kind: "command", message: "Mock command recorded." });

    const state = useEditorStore.getState();
    expect(state.protectedAreas.find((area) => area.id === "area-spawn-keep")?.name).toBe("Spawn Keep Updated");
    expect(state.waterBodies.find((waterBody) => waterBody.id === "water-mill-pond")?.surfaceY).toBe(17);
    expect(state.atlasMapping.grass.side).toBe("atlas/terrain_grass_side_alt");
    expect(state.dirtyState.dirtyChunkIds).toContain("chunk-1-0");
    expect(state.dirtyState.dirtyAreaIds).toContain("area-spawn-keep");
    expect(state.dirtyState.dirtyWaterBodyIds).toContain("water-mill-pond");
    expect(state.dirtyState.dirtyAtlas).toBe(true);
    expect(state.agentTimeline[0].message).toBe("Mock command recorded.");
  });

  it("clears dirty state", () => {
    useEditorStore.getState().markDirty("chunk-1-0");
    useEditorStore.getState().markPropDirty("prop-tree-01");
    useEditorStore.getState().markLayoutDirty();
    useEditorStore.getState().clearDirty();

    const state = useEditorStore.getState();
    expect(state.dirtyState.hasUnsavedChanges).toBe(false);
    expect(state.dirtyState.dirtyChunkIds).toEqual([]);
    expect(state.dirtyState.dirtyPropIds).toEqual([]);
    expect(state.dirtyState.layoutDirty).toBe(false);
    expect(getDirtyChunks(state)).toEqual([]);
  });

  it("updates outliner state and editable domain records", () => {
    useEditorStore.getState().toggleOutlinerNodeVisibility("area", "area-spawn-keep");
    useEditorStore.getState().toggleOutlinerNodeLock("area", "area-spawn-keep");
    useEditorStore.getState().updateProtectedArea("area-spawn-keep", {
      rules: {
        ...mockProtectedAreas[0].rules,
        canMine: false,
      },
    });
    useEditorStore.getState().updateWaterBody("water-mill-pond", { murkiness: 0.6 });

    const state = useEditorStore.getState();
    const key = "area:area-spawn-keep";
    expect(state.outlinerNodeState[key]).toMatchObject({ visible: false, locked: true });
    expect(state.protectedAreas[0].locked).toBe(true);
    expect(state.protectedAreas[0].rules.canMine).toBe(mockProtectedAreas[0].rules.canMine);
    expect(state.waterBodies.find((body) => body.id === "water-mill-pond")?.murkiness).toBe(0.6);
  });

  it("keeps prop position fields in sync", () => {
    useEditorStore.getState().updateProp("prop-tree-01", {
      transform: {
        ...useEditorStore.getState().props.find((prop) => prop.id === "prop-tree-01")!.transform,
        position: [12, 34, 56],
      },
    });

    const prop = useEditorStore.getState().props.find((candidate) => candidate.id === "prop-tree-01");
    expect(prop?.position).toEqual([12, 34, 56]);
    expect(prop?.transform.position).toEqual([12, 34, 56]);
  });

  it("rebuilds outliner state when replacing protected areas", () => {
    const runtimeAreas = [
      { ...mockProtectedAreas[0], id: "runtime-area-1", name: "Runtime Area 1", locked: true },
      { ...mockProtectedAreas[1], id: "runtime-area-2", name: "Runtime Area 2", locked: false },
    ];

    useEditorStore.getState().setSelection({ kind: "area", id: "area-spawn-keep", label: "Spawn Keep" });
    useEditorStore.getState().replaceProtectedAreas(runtimeAreas);

    const state = useEditorStore.getState();
    expect(state.protectedAreas).toHaveLength(2);
    expect(state.outlinerNodeState["area:runtime-area-1"]).toMatchObject({ visible: true, locked: true });
    expect(state.outlinerNodeState["area:runtime-area-2"]).toMatchObject({ visible: true, locked: false });
    expect(state.selection).toMatchObject({ kind: "area", id: "runtime-area-1" });
  });

  it("replaces world summaries while preserving compatible selection", () => {
    useEditorStore.getState().setSelection({ kind: "area", id: "area-spawn-keep", label: "Spawn Keep" });
    useEditorStore.getState().replaceWorldSummary({
      worldId: "summary-1",
      name: "Summary World",
      chunks: mockChunks.slice(0, 3),
      protectedAreas: [mockProtectedAreas[0]],
      waterBodies: [mockWaterBodies[0]],
      props: mockProps.slice(0, 2),
      materials: mockMaterials.slice(0, 1),
      updatedAt: "2026-05-04T00:00:00.000Z",
    });

    const state = useEditorStore.getState();
    expect(state.chunks).toHaveLength(3);
    expect(state.protectedAreas).toHaveLength(1);
    expect(state.waterBodies).toHaveLength(1);
    expect(state.props).toHaveLength(2);
    expect(state.materials).toHaveLength(1);
    if (state.selection.kind === "area") {
      expect(state.selection.id).toBe("area-spawn-keep");
    } else {
      throw new Error("Expected area selection after replaceWorldSummary");
    }
    expect(state.dirtyState.hasUnsavedChanges).toBe(false);
    expect(state.dirtyState.dirtyChunkIds).toHaveLength(state.chunks.filter((chunk) => chunk.dirty).length);
  });

  it("records undo, redo, and explicit editor snapshots", () => {
    useEditorStore.getState().recordUndoCheckpoint("editor.test.rename", "Rename area");
    useEditorStore.getState().updateProtectedArea("area-spawn-keep", { name: "Undo Me" });

    expect(useEditorStore.getState().protectedAreas[0].name).toBe("Undo Me");
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    expect(useEditorStore.getState().undoLastCommand()).toBe(true);
    expect(useEditorStore.getState().protectedAreas[0].name).toBe("Spawn Keep");
    expect(useEditorStore.getState().redoStack).toHaveLength(1);

    expect(useEditorStore.getState().redoLastCommand()).toBe(true);
    expect(useEditorStore.getState().protectedAreas[0].name).toBe("Undo Me");

    const snapshot = useEditorStore.getState().saveEditorSnapshot("Area renamed", "editor.test.snapshot");
    useEditorStore.getState().updateProtectedArea("area-spawn-keep", { name: "Changed Again" });
    expect(useEditorStore.getState().loadEditorSnapshot(snapshot.id)).toBe(true);
    expect(useEditorStore.getState().protectedAreas[0].name).toBe("Undo Me");
  });

  it("loads a large mock world and exposes capped outliner data", () => {
    useEditorStore.getState().loadLargeMockWorld();

    const state = useEditorStore.getState();
    expect(state.largeWorldStats.enabled).toBe(true);
    expect(state.chunks).toHaveLength(960);
    expect(state.props).toHaveLength(4200);
    expect(state.protectedAreas).toHaveLength(180);
    expect(state.waterBodies).toHaveLength(96);
    expect(state.consoleMessages).toHaveLength(1200);
    expect(getVisibleOutlinerNodes(state).length).toBeGreaterThan(500);
  });
});

describe("editor selectors", () => {
  it("returns selected object, inspector kind, outliner nodes, observation, and warnings", () => {
    useEditorStore.getState().setSelection({ kind: "water", id: "water-south-river", label: "South River" });

    const state = useEditorStore.getState();
    const selectedObject = getSelectedObject(state);
    const outlinerNodes = getVisibleOutlinerNodes(state);
    const observation = getAgentObservation(state);
    const warnings = getRuntimeWarnings(state);

    expect(selectedObject && "name" in selectedObject ? selectedObject.name : undefined).toBe("South River");
    expect(getCurrentInspectorKind(state)).toBe("water");
    expect(outlinerNodes).toHaveLength(66);
    expect(observation.selected?.label).toBe("South River");
    expect(warnings).toContain("South River reflection probe is stale.");
    expect(warnings).toContain("Mill Pond reflections are disabled.");
  });
});

describe("editor command registry", () => {
  const createContext = (
    backendClient = new MockEditorBackendClient(),
    runtimeClient = new MockRuntimeClient(),
    toastMessages: string[] = [],
  ): EditorCommandContext => ({
    getState: useEditorStore.getState,
    setState: useEditorStore.setState,
    toast: {
      success: (message) => toastMessages.push(`success:${message}`),
      info: (message) => toastMessages.push(`info:${message}`),
      warning: (message) => toastMessages.push(`warning:${message}`),
      error: (message) => toastMessages.push(`error:${message}`),
    },
    backendClient,
    runtimeClient,
    pushCommandHistory: (commandId, title, status, message) => useEditorStore.getState().pushCommandHistory(commandId, title, status, message),
    pushAgentTimelineEvent: (event) => useEditorStore.getState().pushAgentTimelineEvent(event),
    openCommandPalette: () => undefined,
    openWorldFile: () => undefined,
  });

  it("mock runtime client returns a runtime snapshot", async () => {
    const runtimeClient = new MockRuntimeClient();
    const result = await runtimeClient.getRuntimeSnapshot();

    expect(result.status).toBe("success");
    if (!result.ok) {
      throw new Error("Expected mock runtime snapshot.");
    }
    expect(result.data.connectionState).toBe("mock");
    expect(result.data.capabilities.canRebuildChunks).toBe(true);
    expect(result.data.viewportDebug.wireframe).toBe(false);
    expect(result.data.metrics.fps).toBeGreaterThan(0);
  });

  it("creates unbreakable areas and records command history", async () => {
    await runCommand("editor.area.createUnbreakableBox", createContext());

    const state = useEditorStore.getState();
    expect(state.protectedAreas).toHaveLength(4);
    expect(state.selection.kind).toBe("area");
    expect(state.selection.label).toBe("Unbreakable Box 4");
    expect(state.commandHistory[0].commandId).toBe("editor.area.createUnbreakableBox");
  });

  it("duplicates the selected protected area", async () => {
    class SpyRuntimeClient extends MockRuntimeClient {
      createProtectedAreaCalled = false;

      override async createProtectedArea(area: Parameters<MockRuntimeClient["createProtectedArea"]>[0]) {
        this.createProtectedAreaCalled = true;
        return super.createProtectedArea(area);
      }
    }

    const runtimeClient = new SpyRuntimeClient();
    await runCommand("editor.area.createUnbreakableBox", createContext());
    const createdState = useEditorStore.getState();
    if (createdState.selection.kind !== "area") {
      throw new Error("Expected area selection after creating area.");
    }
    const createdAreaId = createdState.selection.id;

    await runCommand("editor.area.duplicateSelected", createContext(undefined, runtimeClient));

    const state = useEditorStore.getState();
    expect(state.protectedAreas).toHaveLength(5);
    expect(state.selection.kind).toBe("area");
    if (state.selection.kind !== "area") {
      throw new Error("Expected duplicated area selection.");
    }
    expect(state.selection.id).not.toBe(createdAreaId);
    expect(state.selection.label).toContain("Copy");
    expect(state.commandHistory[0].commandId).toBe("editor.area.duplicateSelected");
    expect(runtimeClient.createProtectedAreaCalled).toBe(true);
  });

  it("locks, unlocks, and focuses a protected area through commands", async () => {
    await runCommand("editor.area.createUnbreakableBox", createContext());
    const createdState = useEditorStore.getState();
    if (createdState.selection.kind !== "area") {
      throw new Error("Expected area selection after creating area.");
    }
    const createdAreaId = createdState.selection.id;

    await runCommand("editor.area.lockSelected", createContext());
    expect(useEditorStore.getState().protectedAreas.find((area) => area.id === createdAreaId)?.locked).toBe(true);
    expect(useEditorStore.getState().activeMode).toBe("area");
    expect(useEditorStore.getState().activeTool).toBe("area");

    await runCommand("editor.area.unlockSelected", createContext());
    expect(useEditorStore.getState().protectedAreas.find((area) => area.id === createdAreaId)?.locked).toBe(false);

    await runCommand("editor.area.focusSelected", createContext());
    expect(useEditorStore.getState().activeMode).toBe("area");
    expect(useEditorStore.getState().activeTool).toBe("area");
    const focusedState = useEditorStore.getState();
    expect(focusedState.selection.kind).toBe("area");
    if (focusedState.selection.kind === "area") {
      expect(focusedState.selection.id).toBe(createdAreaId);
    }
    expect(useEditorStore.getState().commandHistory[0].commandId).toBe("editor.area.focusSelected");
  });

  it("toggles chunk bounds through command registry", async () => {
    expect(useEditorStore.getState().viewportOverlays.chunkBounds).toBe(true);
    await runCommand("editor.view.toggleChunkBounds", createContext());
    expect(useEditorStore.getState().viewportOverlays.chunkBounds).toBe(false);
  });

  it("toggles wireframe through the runtime debug bridge", async () => {
    expect(useEditorStore.getState().viewportOverlays.wireframe).toBe(false);
    await runCommand("editor.view.toggleWireframe", createContext());
    expect(useEditorStore.getState().viewportOverlays.wireframe).toBe(true);
  });

  it("applies a water preset through command registry", async () => {
    useEditorStore.getState().setSelection({ kind: "water", id: "water-lk-03", label: "LK_03" });
    await runCommand("editor.water.applyRiverPreset", createContext());

    const state = useEditorStore.getState();
    const water = state.waterBodies.find((candidate) => candidate.id === "water-lk-03");
    expect(water?.kind).toBe("River");
    expect(water?.waveAmplitude).toBe(0.64);
    expect(water?.waveCount).toBe(10);
  });

  it("runs water visual probe and stores mocked snapshot", async () => {
    useEditorStore.getState().clearDirty();
    useEditorStore.getState().setSelection({ kind: "water", id: "water-lk-03", label: "LK_03" });
    await runCommand("editor.water.runVisualProbe", createContext());

    const state = useEditorStore.getState();
    const selectedWater = state.waterBodies.find((candidate) => candidate.id === "water-lk-03");
    expect(selectedWater?.reflectionStatus.lastProbeUpdateMs).toBe(3.1);
    expect(state.waterRuntimeSnapshot.probe.nearestBodyKind).toBe("Lake");
    expect(state.waterRuntimeSnapshot.probe.reflectionEligible).toBe(true);
    expect(state.dirtyState.dirtyWaterBodyIds).toEqual([]);
    expect(state.dirtyState.hasUnsavedChanges).toBe(false);
  });

  it("does not apply selected-water commands to the first water body when nothing water is selected", async () => {
    class SpyRuntimeClient extends MockRuntimeClient {
      setWaterReflectionDebugModeCalled = false;

      override async setWaterReflectionDebugMode(waterBodyId: Parameters<MockRuntimeClient["setWaterReflectionDebugMode"]>[0], mode: Parameters<MockRuntimeClient["setWaterReflectionDebugMode"]>[1]) {
        this.setWaterReflectionDebugModeCalled = true;
        return super.setWaterReflectionDebugMode(waterBodyId, mode);
      }
    }

    const runtimeClient = new SpyRuntimeClient();
    useEditorStore.getState().clearDirty();
    useEditorStore.getState().setSelection({ kind: "chunk", id: "chunk-0-0", label: "Chunk 0,0" });
    await runCommand("editor.water.setDebugMask", createContext(undefined, runtimeClient));

    const state = useEditorStore.getState();
    expect(runtimeClient.setWaterReflectionDebugModeCalled).toBe(false);
    expect(state.waterBodies[0].reflectionStatus.debugViewMode).toBe("Off");
    expect(state.dirtyState.dirtyWaterBodyIds).toEqual([]);
  });

  it("does not update water debug state when the runtime rejects the command", async () => {
    class FailingRuntimeClient extends MockRuntimeClient {
      override async setWaterReflectionDebugMode() {
        return runtimeCommandFailure("runtime_unavailable", "runtime offline");
      }
    }

    useEditorStore.getState().setSelection({ kind: "water", id: "water-lk-03", label: "LK_03" });
    const beforeMode = useEditorStore.getState().waterBodies.find((candidate) => candidate.id === "water-lk-03")?.reflectionStatus.debugViewMode;
    const toastMessages: string[] = [];
    await runCommand("editor.water.setDebugMask", createContext(undefined, new FailingRuntimeClient(), toastMessages));

    const state = useEditorStore.getState();
    const water = useEditorStore.getState().waterBodies.find((candidate) => candidate.id === "water-lk-03");
    expect(water?.reflectionStatus.debugViewMode).toBe(beforeMode);
    expect(state.commandHistory[0]).toMatchObject({
      commandId: "editor.water.setDebugMask",
      status: "runtime_unavailable",
      message: "runtime offline",
    });
    expect(state.consoleMessages[0].level).toBe("error");
    expect(state.consoleMessages[0].message).toContain("runtime offline");
    expect(state.agentTimeline[0].kind).toBe("warning");
    expect(toastMessages).toContain("error:Set reflection debug mask failed.");
  });

  it("does not import Tauri from commands or UI components", () => {
    const files = [
      ...collectSourceFiles(join(process.cwd(), "src", "commands")),
      ...collectSourceFiles(join(process.cwd(), "src", "components")),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("@tauri-apps/api")).toBe(false);
      expect(source.includes("src-tauri")).toBe(false);
    }
  });

  it("commands call backend and runtime interfaces", async () => {
    class SpyBackendClient extends MockEditorBackendClient {
      saveDefaultWorldCalled = false;
      loadDefaultWorldCalled = false;

      override async loadDefaultWorld() {
        this.loadDefaultWorldCalled = true;
        return super.loadDefaultWorld();
      }

      override async saveDefaultWorld(): Promise<BackendResult<WorldSaveSummary>> {
        this.saveDefaultWorldCalled = true;
        return super.saveDefaultWorld();
      }
    }

    class SpyRuntimeClient extends MockRuntimeClient {
      rebuildDirtyChunksCalled = false;

      override async rebuildDirtyChunks(chunkIds: readonly string[]) {
        this.rebuildDirtyChunksCalled = chunkIds.length > 0;
        return super.rebuildDirtyChunks(chunkIds);
      }
    }

    const backendClient = new SpyBackendClient();
    const runtimeClient = new SpyRuntimeClient();

    await runCommand("editor.file.loadDefaultWorld", createContext(backendClient, runtimeClient));
    await runCommand("editor.file.save", createContext(backendClient, runtimeClient));
    useEditorStore.getState().markDirty("chunk-1-0");
    await runCommand("editor.world.rebuildDirtyChunks", createContext(backendClient, runtimeClient));

    expect(backendClient.loadDefaultWorldCalled).toBe(true);
    expect(backendClient.saveDefaultWorldCalled).toBe(true);
    expect(runtimeClient.rebuildDirtyChunksCalled).toBe(true);
  });

  it("runs mocked atlas workflow through command ids", async () => {
    class SpyRuntimeClient extends MockRuntimeClient {
      setAtlasMappingCalled = false;
      saveAtlasMappingCalled = false;

      override async setAtlasMapping(mapping: Parameters<MockRuntimeClient["setAtlasMapping"]>[0]) {
        this.setAtlasMappingCalled = true;
        return super.setAtlasMapping(mapping);
      }

      override async saveAtlasMapping(mapping: Parameters<MockRuntimeClient["saveAtlasMapping"]>[0]) {
        this.saveAtlasMappingCalled = true;
        return super.saveAtlasMapping(mapping);
      }
    }

    const runtimeClient = new SpyRuntimeClient();
    await runCommand("editor.atlas.selectTile.tile-7", createContext(undefined, runtimeClient));
    await runCommand("editor.atlas.assignGrassSide", createContext(undefined, runtimeClient));

    const assigned = useEditorStore.getState();
    expect(assigned.atlasMapping.grass.side).toBe("tile-7");
    expect(assigned.dirtyState.dirtyAtlas).toBe(true);
    expect(runtimeClient.setAtlasMappingCalled).toBe(true);

    await runCommand("editor.atlas.rebuildTextureArray", createContext(undefined, runtimeClient));
    expect(useEditorStore.getState().dirtyState.dirtyAtlas).toBe(false);

    await runCommand("editor.atlas.saveMapping", createContext(undefined, runtimeClient));
    expect(runtimeClient.saveAtlasMappingCalled).toBe(true);
    expect(useEditorStore.getState().agentTimeline[0].message).toBe("Runtime write succeeded: Save atlas mapping.");
  });

  it("paints the selected voxel through the runtime client", async () => {
    class SpyRuntimeClient extends MockRuntimeClient {
      setVoxelCalls: Array<{
        readonly position: Parameters<MockRuntimeClient["setVoxel"]>[0];
        readonly block: Parameters<MockRuntimeClient["setVoxel"]>[1];
      }> = [];

      override async setVoxel(position: Parameters<MockRuntimeClient["setVoxel"]>[0], block: Parameters<MockRuntimeClient["setVoxel"]>[1]) {
        this.setVoxelCalls.push({ position, block });
        return runtimeCommandSuccess({
          position,
          chunkId: "chunk-0-0-0",
          block,
          voxel: "Rock",
          previousVoxel: "TopSoil",
          currentVoxel: "Rock",
          editResult: "applied" as const,
        });
      }
    }

    const runtimeClient = new SpyRuntimeClient();
    useEditorStore.getState().setSelection({
      kind: "voxel",
      chunkId: "chunk-0-0-0",
      position: [3, 4, 5],
      label: "TopSoil (3, 4, 5)",
    });
    useEditorStore.getState().updateBrushSettings({ materialBlockId: "rock" });

    await runCommand("editor.voxel.paintMaterial", createContext(undefined, runtimeClient));

    const state = useEditorStore.getState();
    expect(runtimeClient.setVoxelCalls).toEqual([{ position: [3, 4, 5], block: "rock" }]);
    expect(state.selection).toEqual({
      kind: "voxel",
      chunkId: "chunk-0-0-0",
      position: [3, 4, 5],
      label: "Rock (3, 4, 5)",
    });
    expect(state.dirtyState.dirtyChunkIds).toContain("chunk-0-0-0");
    expect(state.commandHistory[0].commandId).toBe("editor.voxel.paintMaterial");
  });

  it("does not run voxel replacement without a voxel selection", async () => {
    class SpyRuntimeClient extends MockRuntimeClient {
      setVoxelCalled = false;

      override async setVoxel(position: Parameters<MockRuntimeClient["setVoxel"]>[0], block: Parameters<MockRuntimeClient["setVoxel"]>[1]) {
        this.setVoxelCalled = true;
        return super.setVoxel(position, block);
      }
    }

    const runtimeClient = new SpyRuntimeClient();
    const toastMessages: string[] = [];
    useEditorStore.getState().setSelection({ kind: "chunk", id: "chunk-0-0-0", label: "Chunk 0,0,0" });

    await runCommand("editor.voxel.replaceSelected", createContext(undefined, runtimeClient, toastMessages));

    expect(runtimeClient.setVoxelCalled).toBe(false);
    expect(toastMessages).toContain("warning:Select a runtime voxel before editing voxel material.");
  });

  it("has no duplicate command IDs", () => {
    const commandIds = editorCommands.map((command) => command.id);
    expect(new Set(commandIds).size).toBe(commandIds.length);
  });

  it("requires title, description, category, and keywords for every command", () => {
    for (const command of editorCommands) {
      expect(command.title.length).toBeGreaterThan(0);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.category.length).toBeGreaterThan(0);
      if (!command.keywords || command.keywords.length === 0) {
        expect.fail(`Command "${command.id}" is missing keywords.`);
      }
    }
  });

  it("maps toolbar command ids to registered commands", () => {
    for (const commandId of toolbarCommandIds) {
      const command = getCommand(commandId);
      expect(command.id).toBe(commandId);
    }
  });

  it("maps menu command ids to registered commands", () => {
    for (const commandId of menuCommandIds) {
      const command = getCommand(commandId);
      expect(command.id).toBe(commandId);
    }
  });

  it("serializes AgentObservation payload", () => {
    const state = useEditorStore.getState();
    const observation = getAgentObservation(state);
    const parsed = JSON.parse(JSON.stringify(observation)) as typeof observation;

    expect(parsed.activeMode).toBe(state.activeMode);
    expect(parsed.activeTool).toBe(state.activeTool);
    expect(parsed.brush).toEqual(state.brushSettings);
    expect(Array.isArray(parsed.visiblePanels)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it("mock mode works without a Bevy bridge", async () => {
    const runtimeClient = new MockRuntimeClient();
    const toastMessages: string[] = [];

    expect(runtimeClient.getConnectionState()).toBe("mock");
    await runCommand("editor.file.saveSnapshot", createContext(undefined, runtimeClient, toastMessages));

    expect(useEditorStore.getState().commandHistory[0].commandId).toBe("editor.file.saveSnapshot");
    expect(useEditorStore.getState().savedSnapshots[0].commandId).toBe("editor.file.saveSnapshot");
    expect(toastMessages.some((message) => message.startsWith("success:Runtime snapshot saved: mock-runtime-snapshot-"))).toBe(true);
  });

  it("runs undo, redo, snapshots, handoff, and large-world commands", async () => {
    await runCommand("editor.area.createUnbreakableBox", createContext());
    expect(useEditorStore.getState().undoStack.length).toBeGreaterThan(0);

    const createdCount = useEditorStore.getState().protectedAreas.length;
    await runCommand("editor.history.undo", createContext());
    expect(useEditorStore.getState().protectedAreas.length).toBe(createdCount - 1);

    await runCommand("editor.history.redo", createContext());
    expect(useEditorStore.getState().protectedAreas.length).toBe(createdCount);

    await runCommand("editor.snapshot.create", createContext());
    expect(useEditorStore.getState().savedSnapshots.length).toBeGreaterThan(0);

    await runCommand("editor.performance.loadLargeMockWorld", createContext());
    expect(useEditorStore.getState().largeWorldStats.enabled).toBe(true);

    await runCommand("editor.help.showHandoff", createContext());
    expect(useEditorStore.getState().agentTimeline[0].message).toContain("Editor handoff");
  });

  it("runs rendering and debug commands through new command IDs", async () => {
    await runCommand("editor.rendering.setQualityPerformance100", createContext());
    await runCommand("editor.debug.openRenderTimings", createContext());
    await runCommand("editor.debug.openGraphicsCapabilities", createContext());
    await runCommand("editor.debug.toggleGtao", createContext());
    await runCommand("editor.debug.toggleSsao", createContext());
    await runCommand("editor.debug.toggleBakedAo", createContext());
    await runCommand("editor.debug.toggleShadowBudget", createContext());
    await runCommand("editor.debug.toggleGodRays", createContext());
    await runCommand("editor.debug.toggleFog", createContext());
    await runCommand("editor.debug.togglePhotoMode", createContext());
    await runCommand("editor.debug.toggleCinematicMode", createContext());
    await runCommand("editor.debug.toggleRayTracingMock", createContext());

    const state = useEditorStore.getState();
    expect(state.renderQualityPreset).toBe("Performance100");
    expect(state.runtimeMetrics.renderQualityReadouts.waterReflectionDistance).toBe(220);
    expect(state.runtimeMetrics.ambientOcclusion.gtaoEnabled).toBe(false);
    expect(state.runtimeMetrics.ambientOcclusion.ssaoEnabled).toBe(false);
    expect(state.runtimeMetrics.ambientOcclusion.bakedAoStrength).toBe(0);
    expect(state.runtimeMetrics.shadowBudget.enabled).toBe(false);
    expect(state.runtimeMetrics.lightingAtmosphere.godRaysEnabled).toBe(true);
    expect(state.runtimeMetrics.lightingAtmosphere.fogActive).toBe(false);
    expect(state.runtimeMetrics.cinematicPhotoMode.photoModeActive).toBe(true);
    expect(state.runtimeMetrics.cinematicPhotoMode.cinematicModeActive).toBe(true);
    expect(state.runtimeMetrics.graphicsCapabilities.rayTracingSupported).toBe(true);
    expect(state.commandHistory[0].commandId).toBe("editor.debug.toggleRayTracingMock");
  });

  it("mock backend returns serializable data", async () => {
    const backendClient = new MockEditorBackendClient();
    const summary = await backendClient.getWorldSummary();
    const atlas = await backendClient.loadAtlasMapping();

    expect(() => JSON.stringify(summary)).not.toThrow();
    expect(() => JSON.stringify(atlas)).not.toThrow();
    expect(summary.ok).toBe(true);
    expect(atlas.ok).toBe(true);
  });

  it("failed backend command records console error and toast", async () => {
    class FailingBackendClient extends MockEditorBackendClient {
      override async saveDefaultWorld(): Promise<BackendResult<WorldSaveSummary>> {
        return { ok: false, error: "Mock backend save failed.", code: "MOCK_SAVE_FAILED" };
      }
    }

    const toastMessages: string[] = [];
    await runCommand("editor.file.save", createContext(new FailingBackendClient(), new MockRuntimeClient(), toastMessages));

    const state = useEditorStore.getState();
    expect(state.consoleMessages[0].level).toBe("error");
    expect(state.consoleMessages[0].message).toContain("Mock backend save failed.");
    expect(toastMessages).toContain("error:Save failed.");
  });
});

