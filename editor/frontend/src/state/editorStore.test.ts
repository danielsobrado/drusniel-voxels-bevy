import { beforeEach, describe, expect, it } from "vitest";
import { MockEditorBackendClient } from "../backend/MockEditorBackendClient";
import { runCommand } from "../commands/commandRegistry";
import type { EditorCommandContext } from "../commands/commandTypes";
import { MockRuntimeClient } from "../runtime/MockRuntimeClient";
import { createInitialEditorState, useEditorStore } from "./editorStore";
import { getAgentObservation, getCurrentInspectorKind, getDirtyChunks, getRuntimeWarnings, getSelectedObject, getVisibleOutlinerNodes } from "./editorSelectors";

beforeEach(() => {
  useEditorStore.setState(createInitialEditorState(), false);
});

describe("editor store actions", () => {
  it("updates active mode, active tool, selection, and brush settings", () => {
    useEditorStore.getState().setActiveMode("water");
    useEditorStore.getState().setActiveTool("shoreline-brush");
    useEditorStore.getState().setSelection({ kind: "water", id: "water-mirror-lake", label: "Mirror Lake" });
    useEditorStore.getState().updateBrushSettings({ radius: 9, materialBlockId: "sand" });

    const state = useEditorStore.getState();
    expect(state.activeMode).toBe("water");
    expect(state.activeTool).toBe("shoreline-brush");
    expect(state.selection.label).toBe("Mirror Lake");
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
  const createContext = (): EditorCommandContext => ({
    getState: useEditorStore.getState,
    setState: useEditorStore.setState,
    toast: {
      success: () => undefined,
      info: () => undefined,
      warning: () => undefined,
      error: () => undefined,
    },
    backendClient: new MockEditorBackendClient(),
    runtimeClient: new MockRuntimeClient(),
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

  it("toggles chunk bounds through command registry", async () => {
    expect(useEditorStore.getState().viewportOverlays.chunkBounds).toBe(true);
    await runCommand("editor.view.toggleChunkBounds", createContext());
    expect(useEditorStore.getState().viewportOverlays.chunkBounds).toBe(false);
  });
});
