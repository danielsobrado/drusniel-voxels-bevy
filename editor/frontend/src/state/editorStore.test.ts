import { beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MockEditorBackendClient } from "../backend/MockEditorBackendClient";
import type { BackendResult, WorldSaveSummary } from "../backend/EditorBackendClient";
import { runCommand } from "../commands/commandRegistry";
import type { EditorCommandContext } from "../commands/commandTypes";
import { MockRuntimeClient } from "../runtime/MockRuntimeClient";
import { mockChunks, mockMaterials, mockProtectedAreas, mockWaterBodies } from "../mocks/mockWorld";
import { createInitialEditorState, useEditorStore } from "./editorStore";
import { getAgentObservation, getCurrentInspectorKind, getDirtyChunks, getRuntimeWarnings, getSelectedObject, getVisibleOutlinerNodes } from "./editorSelectors";

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
    useEditorStore.getState().clearDirty();

    const state = useEditorStore.getState();
    expect(state.dirtyState.hasUnsavedChanges).toBe(false);
    expect(state.dirtyState.dirtyChunkIds).toEqual([]);
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
    expect(state.protectedAreas[0].rules.canMine).toBe(false);
    expect(state.waterBodies.find((body) => body.id === "water-mill-pond")?.murkiness).toBe(0.6);
  });

  it("replaces world summaries while preserving compatible selection", () => {
    useEditorStore.getState().setSelection({ kind: "area", id: "area-spawn-keep", label: "Spawn Keep" });
    useEditorStore.getState().replaceWorldSummary({
      worldId: "summary-1",
      name: "Summary World",
      chunks: mockChunks.slice(0, 3),
      protectedAreas: [mockProtectedAreas[0]],
      waterBodies: [mockWaterBodies[0]],
      materials: mockMaterials.slice(0, 1),
      updatedAt: "2026-05-04T00:00:00.000Z",
    });

    const state = useEditorStore.getState();
    expect(state.chunks).toHaveLength(3);
    expect(state.protectedAreas).toHaveLength(1);
    expect(state.waterBodies).toHaveLength(1);
    expect(state.materials).toHaveLength(1);
    if (state.selection.kind === "area") {
      expect(state.selection.id).toBe("area-spawn-keep");
    } else {
      throw new Error("Expected area selection after replaceWorldSummary");
    }
    expect(state.dirtyState.hasUnsavedChanges).toBe(false);
    expect(state.dirtyState.dirtyChunkIds).toHaveLength(state.chunks.filter((chunk) => chunk.dirty).length);
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
    expect(observation.selectedObjectLabel).toBe("South River");
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
    pushCommandHistory: (commandId, title) => useEditorStore.getState().pushCommandHistory(commandId, title),
    pushAgentTimelineEvent: (event) => useEditorStore.getState().pushAgentTimelineEvent(event),
    openCommandPalette: () => undefined,
    openWorldFile: () => undefined,
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
    await runCommand("editor.area.createUnbreakableBox", createContext());
    const createdState = useEditorStore.getState();
    if (createdState.selection.kind !== "area") {
      throw new Error("Expected area selection after creating area.");
    }
    const createdAreaId = createdState.selection.id;

    await runCommand("editor.area.duplicateSelected", createContext());

    const state = useEditorStore.getState();
    expect(state.protectedAreas).toHaveLength(5);
    expect(state.selection.kind).toBe("area");
    if (state.selection.kind !== "area") {
      throw new Error("Expected duplicated area selection.");
    }
    expect(state.selection.id).not.toBe(createdAreaId);
    expect(state.selection.label).toContain("Copy");
    expect(state.commandHistory[0].commandId).toBe("editor.area.duplicateSelected");
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
    useEditorStore.getState().setSelection({ kind: "water", id: "water-lk-03", label: "LK_03" });
    await runCommand("editor.water.runVisualProbe", createContext());

    const state = useEditorStore.getState();
    const selectedWater = state.waterBodies.find((candidate) => candidate.id === "water-lk-03");
    expect(selectedWater?.reflectionStatus.lastProbeUpdateMs).toBe(3.1);
    expect(state.waterRuntimeSnapshot.probe.nearestBodyKind).toBe("Lake");
    expect(state.waterRuntimeSnapshot.probe.reflectionEligible).toBe(true);
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

    await runCommand("editor.file.save", createContext(backendClient, runtimeClient));
    useEditorStore.getState().markDirty("chunk-1-0");
    await runCommand("editor.world.rebuildDirtyChunks", createContext(backendClient, runtimeClient));

    expect(backendClient.saveDefaultWorldCalled).toBe(true);
    expect(runtimeClient.rebuildDirtyChunksCalled).toBe(true);
  });

  it("runs mocked atlas workflow through command ids", async () => {
    class SpyBackendClient extends MockEditorBackendClient {
      saveAtlasMappingCalled = false;

      override async saveAtlasMapping(_atlasMapping: Parameters<MockEditorBackendClient["saveAtlasMapping"]>[0]): Promise<BackendResult<WorldSaveSummary>> {
        this.saveAtlasMappingCalled = true;
        return super.saveAtlasMapping(_atlasMapping);
      }
    }

    const backendClient = new SpyBackendClient();
    await runCommand("editor.atlas.selectTile.tile-7", createContext(backendClient));
    await runCommand("editor.atlas.assignGrassSide", createContext(backendClient));

    const assigned = useEditorStore.getState();
    expect(assigned.atlasMapping.grass.side).toBe("tile-7");
    expect(assigned.dirtyState.dirtyAtlas).toBe(true);

    await runCommand("editor.atlas.rebuildTextureArray", createContext(backendClient));
    expect(useEditorStore.getState().dirtyState.dirtyAtlas).toBe(false);

    await runCommand("editor.atlas.saveMapping", createContext(backendClient));
    expect(backendClient.saveAtlasMappingCalled).toBe(true);
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

