import type { EditorCommand, EditorCommandContext } from "./commandTypes";
import type { EditorMode, RenderQualityPreset } from "../types/editor";
import type { ProtectedArea, ProtectedAreaRuleMatrix } from "../types/world";

const modeCommand = (id: string, title: string, mode: EditorMode, shortcut?: string): EditorCommand => ({
  id,
  title,
  description: `Switch the editor to ${title} mode.`,
  category: "Mode",
  shortcut,
  keywords: ["mode", mode],
  run: (ctx) => {
    ctx.getState().setActiveMode(mode);
    ctx.toast.info(`${title} mode active.`);
  },
});

const qualityCommand = (preset: RenderQualityPreset): EditorCommand => ({
  id: `editor.quality.${preset}`,
  title: `Quality: ${preset}`,
  description: `Set mocked render quality preset to ${preset}.`,
  category: "View",
  keywords: ["quality", "render", preset],
  run: async (ctx) => {
    const snapshot = await ctx.runtimeClient.setRenderQuality(preset);
    ctx.getState().setRenderQualityPreset(snapshot.metrics.renderQualityPreset);
  },
});

const createAreaCommand = (id: string, title: string, rules: ProtectedAreaRuleMatrix, namePrefix: string): EditorCommand => ({
  id,
  title,
  description: `Create a mocked protected area: ${namePrefix}.`,
  category: "Areas",
  keywords: ["protected", "area", "rules", "unbreakable", "no build", "no dig", namePrefix],
  preconditions: ["mocked-state"],
  run: (ctx) => {
    const state = ctx.getState();
    const nextIndex = state.protectedAreas.length + 1;
    const area: ProtectedArea = {
      id: `${id.split(".").at(-1)}-${nextIndex}`,
      name: `${namePrefix} ${nextIndex}`,
      kind: "story",
      shape: "box",
      center: [64 + nextIndex * 4, 24, 64 + nextIndex * 3],
      size: [16, 16, 16],
      rules,
    };

    ctx.setState({
      activeMode: "area",
      activeTool: "area",
      protectedAreas: [...state.protectedAreas, area],
      selection: { kind: "area", id: area.id, label: area.name },
      dirtyState: {
        ...state.dirtyState,
        hasUnsavedChanges: true,
        dirtyAreaIds: [...state.dirtyState.dirtyAreaIds, area.id],
      },
      agentObservation: { ...state.agentObservation, selectedObjectLabel: area.name },
    });
    state.pushAgentTimelineEvent({ kind: "command", message: `${title} created ${area.name}.` });
    ctx.toast.success(`${area.name} created.`);
  },
});

export const editorCommands: readonly EditorCommand[] = [
  {
    id: "editor.file.openWorld",
    title: "Open world file",
    description: "Open a mocked world file picker. Parsing remains deferred.",
    category: "File",
    shortcut: "Ctrl+O",
    keywords: ["file", "world", "open"],
    run: (ctx) => ctx.openWorldFile(),
  },
  {
    id: "editor.file.save",
    title: "Save",
    description: "Clear mocked dirty state as if the editor saved successfully.",
    category: "File",
    shortcut: "Ctrl+S",
    keywords: ["file", "save", "dirty"],
    run: async (ctx) => {
      await ctx.backendClient.saveDefaultWorld();
      ctx.getState().clearDirty();
      ctx.toast.success("Mock save complete.");
    },
  },
  {
    id: "editor.file.saveSnapshot",
    title: "Save snapshot",
    description: "Record a mocked snapshot request without writing files.",
    category: "File",
    keywords: ["snapshot", "save"],
    run: async (ctx) => {
      const snapshot = await ctx.backendClient.saveWorldSnapshot();
      ctx.getState().markDirty();
      ctx.toast.success(`Mock snapshot recorded: ${snapshot.snapshotId}.`);
    },
  },
  {
    id: "editor.view.toggleVoxelGrid",
    title: "Toggle voxel grid",
    description: "Toggle the mocked voxel grid viewport overlay.",
    category: "View",
    keywords: ["voxel", "grid", "overlay"],
    run: (ctx) => ctx.getState().toggleViewportOverlay("voxelGrid"),
  },
  {
    id: "editor.view.toggleChunkBounds",
    title: "Toggle chunk bounds",
    description: "Toggle chunk bounds in the mocked viewport overlay summary.",
    category: "View",
    keywords: ["chunk", "bounds", "overlay"],
    run: (ctx) => ctx.getState().toggleViewportOverlay("chunkBounds"),
  },
  {
    id: "editor.view.toggleProtectedAreas",
    title: "Toggle protected areas",
    description: "Toggle protected area visibility in the mocked viewport.",
    category: "View",
    keywords: ["protected", "area", "overlay"],
    run: (ctx) => ctx.getState().toggleViewportOverlay("protectedAreas"),
  },
  {
    id: "editor.view.togglePropBounds",
    title: "Toggle prop bounds",
    description: "Toggle mocked prop bounds and billboard debug visibility.",
    category: "View",
    keywords: ["props", "bounds", "billboards"],
    run: (ctx) => ctx.getState().toggleViewportOverlay("propBillboards"),
  },
  {
    id: "editor.view.resetLayout",
    title: "Reset dock layout",
    description: "Reset persisted dock layout to the default editor shell.",
    category: "View",
    keywords: ["dock", "layout", "reset"],
    run: (ctx) => {
      ctx.getState().requestLayoutReset();
      ctx.toast.info("Dock layout reset requested.");
    },
  },
  modeCommand("editor.mode.select", "Select", "select", "V"),
  modeCommand("editor.mode.voxelSculpt", "Voxel Sculpt", "voxel_sculpt", "B"),
  modeCommand("editor.mode.voxelPaint", "Voxel Paint", "voxel_paint", "P"),
  modeCommand("editor.mode.area", "Area", "area", "A"),
  modeCommand("editor.mode.props", "Props", "props"),
  modeCommand("editor.mode.water", "Water", "water"),
  modeCommand("editor.mode.material", "Material", "material"),
  modeCommand("editor.mode.lighting", "Lighting", "lighting"),
  modeCommand("editor.mode.debug", "Debug", "debug"),
  modeCommand("editor.mode.agent", "Agent", "agent"),
  {
    id: "editor.world.rebuildSelectedChunk",
    title: "Rebuild selected chunk",
    description: "Mark the selected mocked chunk mesh as queued for rebuild.",
    category: "World",
    keywords: ["world", "chunk", "mesh", "rebuild"],
    preconditions: ["selection.kind === chunk"],
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "chunk") {
        ctx.toast.warning("Select a chunk before rebuilding.");
        return;
      }

      const selectedChunkId = state.selection.id;
      await ctx.runtimeClient.rebuildSelectedChunk(selectedChunkId);
      ctx.setState({ chunks: state.chunks.map((chunk) => (chunk.id === selectedChunkId ? { ...chunk, meshStatus: "queued" } : chunk)) });
      ctx.toast.info(`${state.selection.label} rebuild queued.`);
    },
  },
  {
    id: "editor.world.rebuildDirtyChunks",
    title: "Rebuild dirty chunks",
    description: "Queue all dirty mocked chunks for rebuild.",
    category: "World",
    keywords: ["world", "chunk", "dirty", "rebuild"],
    run: async (ctx) => {
      const state = ctx.getState();
      const dirtyChunkIds = state.dirtyState.dirtyChunkIds;
      await ctx.runtimeClient.rebuildDirtyChunks(dirtyChunkIds);
      ctx.setState({ chunks: state.chunks.map((chunk) => (dirtyChunkIds.includes(chunk.id) ? { ...chunk, meshStatus: "queued" } : chunk)) });
      ctx.toast.info("Dirty chunk rebuild queued.");
    },
  },
  createAreaCommand(
    "editor.area.createUnbreakableBox",
    "Create unbreakable box area",
    { allowVoxelEdit: false, allowPropEdit: false, allowWaterEdit: false, allowMaterialEdit: false, agentRequiresApproval: true },
    "Unbreakable Box",
  ),
  createAreaCommand(
    "editor.area.createNoBuildZone",
    "Create no-build zone",
    { allowVoxelEdit: true, allowPropEdit: false, allowWaterEdit: true, allowMaterialEdit: true, agentRequiresApproval: true },
    "No-Build Zone",
  ),
  createAreaCommand(
    "editor.area.createNoDigZone",
    "Create no-dig zone",
    { allowVoxelEdit: false, allowPropEdit: true, allowWaterEdit: true, allowMaterialEdit: true, agentRequiresApproval: true },
    "No-Dig Zone",
  ),
  {
    id: "editor.voxel.paintMaterial",
    title: "Paint selected material",
    description: "Mock paint operation using the active brush material.",
    category: "Voxels",
    keywords: ["voxel", "paint", "material"],
    run: (ctx) => {
      ctx.getState().markDirty();
      ctx.toast.info("Mock voxel material paint applied.");
    },
  },
  {
    id: "editor.voxel.replaceSelected",
    title: "Replace selected voxel",
    description: "Mock selected voxel replacement.",
    category: "Voxels",
    keywords: ["voxel", "replace", "selection"],
    run: (ctx) => {
      ctx.getState().markDirty();
      ctx.toast.info("Mock selected voxel replaced.");
    },
  },
  {
    id: "editor.water.openReflectionDebug",
    title: "Open reflection debug",
    description: "Enable mocked water debug overlay.",
    category: "Water",
    keywords: ["water", "reflection", "debug"],
    run: (ctx) => ctx.getState().toggleViewportOverlay("waterDebug"),
  },
  {
    id: "editor.water.toggleReflectionMask",
    title: "Toggle reflection mask",
    description: "Toggle the first mocked water body reflection debug mode between Off and Mask.",
    category: "Water",
    keywords: ["water", "mask", "reflection"],
    run: async (ctx) => {
      const state = ctx.getState();
      const water = state.waterBodies[0];
      if (!water) {
        return;
      }

      const debugViewMode = water.reflectionStatus.debugViewMode === "Mask" ? "Off" : "Mask";
      await ctx.runtimeClient.setWaterReflectionDebugMode(water.id, debugViewMode);
      state.updateWaterBody(water.id, {
        reflectionStatus: {
          ...water.reflectionStatus,
          debugViewMode,
        },
      });
    },
  },
  {
    id: "editor.water.runVisualProbe",
    title: "Run water visual probe",
    description: "Refresh mocked water reflection probe status.",
    category: "Water",
    keywords: ["water", "probe", "reflection"],
    run: async (ctx) => {
      const state = ctx.getState();
      const probe = await ctx.runtimeClient.runWaterVisualProbe();
      for (const waterBody of state.waterBodies) {
        state.updateWaterBody(waterBody.id, { reflectionStatus: { ...waterBody.reflectionStatus, probeValid: probe.probeValid, lastProbeUpdateMs: probe.lastProbeUpdateMs } });
      }
      ctx.toast.success("Mock water visual probe complete.");
    },
  },
  {
    id: "editor.props.scatterOnSelection",
    title: "Scatter props on selection",
    description: "Record a mocked prop scatter request.",
    category: "Props",
    keywords: ["props", "scatter", "selection"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Mock prop scatter requested." });
      ctx.toast.info("Mock prop scatter requested.");
    },
  },
  {
    id: "editor.material.openTextureAtlas",
    title: "Open texture atlas",
    description: "Toggle mocked atlas preview overlay.",
    category: "Materials",
    keywords: ["material", "atlas", "texture"],
    run: async (ctx) => {
      const atlasMapping = await ctx.backendClient.loadAtlasMapping();
      ctx.setState({ atlasMapping });
      ctx.getState().toggleViewportOverlay("atlasPreview");
    },
  },
  {
    id: "editor.agent.observeScreen",
    title: "Agent observe screen",
    description: "Add a mocked agent observation event.",
    category: "Agent",
    keywords: ["agent", "observe", "screen"],
    run: (ctx) => ctx.getState().pushAgentTimelineEvent({ kind: "observation", message: "Agent observed the mocked editor screen." }),
  },
  {
    id: "editor.agent.runPlan",
    title: "Agent run plan",
    description: "Record a mocked agent plan execution request.",
    category: "Agent",
    keywords: ["agent", "plan", "automation"],
    preconditions: ["mocked-only"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Agent run plan requested in mocked mode." });
      ctx.toast.info("Agent plan recorded; automation is deferred.");
    },
  },
  {
    id: "editor.agent.generatePlaywrightTest",
    title: "Generate Playwright test",
    description: "Record a mocked Playwright generation request.",
    category: "Agent",
    keywords: ["agent", "playwright", "test"],
    run: (ctx) => ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Mock Playwright test generation requested." }),
  },
  {
    id: "editor.tests.runViewportSmokeTest",
    title: "Run viewport smoke test",
    description: "Record a mocked viewport smoke test request.",
    category: "Tests",
    keywords: ["test", "viewport", "smoke"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Mock viewport smoke test requested." });
      ctx.toast.info("Viewport smoke test request recorded.");
    },
  },
  {
    id: "editor.palette.open",
    title: "Open command palette",
    description: "Open the command palette.",
    category: "View",
    shortcut: "Ctrl+K",
    keywords: ["palette", "commands"],
    run: (ctx) => ctx.openCommandPalette(),
  },
  qualityCommand("Low"),
  qualityCommand("Medium"),
  qualityCommand("High"),
  qualityCommand("Performance100"),
];

export const getCommand = (id: string): EditorCommand => {
  const command = editorCommands.find((candidate) => candidate.id === id);
  if (!command) {
    throw new Error(`Unknown editor command: ${id}`);
  }

  return command;
};

export const runCommand = async (id: string, context: EditorCommandContext): Promise<void> => {
  const command = getCommand(id);
  await command.run(context);
  context.pushCommandHistory(command.id, command.title);
};
