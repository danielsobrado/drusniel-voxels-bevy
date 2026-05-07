import type { EditorCommand, EditorCommandContext } from "./commandTypes";
import type { BackendResult } from "../backend/EditorBackendClient";
import type { RuntimeCommandResult, RuntimeCommandStatus } from "../runtime/RuntimeClient";
import type { EditorMode, RenderQualityPreset, ViewportOverlayState } from "../types/editor";
import type { BlockType, PropInstance, ProtectedArea, ProtectedAreaKind, ProtectedAreaRuleMatrix, WaterBody, WaterBodyKind, WaterReflectionDebugViewMode, WaterReflectionStatus } from "../types/world";
import { mockPropAssets } from "../mocks/mockWorld";

const unwrapBackend = <T>(result: BackendResult<T>): T => {
  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
};

class RuntimeCommandError extends Error {
  readonly status: Exclude<RuntimeCommandStatus, "success">;

  constructor(status: Exclude<RuntimeCommandStatus, "success">, message: string) {
    super(message);
    this.name = "RuntimeCommandError";
    this.status = status;
  }
}

const unwrapRuntime = <T>(result: RuntimeCommandResult<T>): T => {
  if (!result.ok) {
    throw new RuntimeCommandError(result.status, result.message);
  }

  return result.data;
};

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
  description: `Set runtime render quality preset to ${preset}.`,
  category: "View",
  keywords: ["quality", "render", preset],
  runtimeWrite: true,
  run: async (ctx) => {
    const renderQuality = unwrapRuntime(await ctx.runtimeClient.setRenderQuality(preset));
    ctx.getState().setRenderQualityPreset(renderQuality.preset);
  },
});

const renderingQualityCommand = (preset: RenderQualityPreset): EditorCommand => ({
  ...qualityCommand(preset),
  id: `editor.rendering.setQuality${preset}`,
  keywords: ["debug", "rendering", "quality", preset],
});

type RuntimeMetricsSnapshot = ReturnType<EditorCommandContext["getState"]>["runtimeMetrics"];

const runtimeSettingCommand = (
  id: string,
  title: string,
  description: string,
  update: (runtimeMetrics: RuntimeMetricsSnapshot) => RuntimeMetricsSnapshot,
  keywords: readonly string[] = ["debug", "runtime", "settings"],
): EditorCommand => ({
  id,
  title,
  description,
  category: "Debug",
  keywords,
  run: (ctx) => {
    const current = ctx.getState();
    ctx.setState({ runtimeMetrics: update(current.runtimeMetrics) });
  },
});

const setRuntimeViewportOverlay = async (
  ctx: EditorCommandContext,
  overlay: keyof ViewportOverlayState,
  enabled?: boolean,
): Promise<void> => {
  const nextEnabled = enabled ?? !ctx.getState().viewportOverlays[overlay];
  const viewportDebug = unwrapRuntime(await ctx.runtimeClient.setViewportDebugOverlay(overlay, nextEnabled));
  ctx.setState((state) => ({
    viewportOverlays: {
      ...state.viewportOverlays,
      ...viewportDebug,
    },
  }));
};

const makeAreaId = (prefix: string, index: number): string => `${prefix}-${index}`;

const createBounds = (center: [number, number, number], size: [number, number, number]): ProtectedArea["bounds"] => {
  const [x, y, z] = center;
  const [sx, sy, sz] = size;

  return {
    min: [x - sx / 2, y - sy / 2, z - sz / 2],
    max: [x + sx / 2, y + sy / 2, z + sz / 2],
  };
};

const areaIntersects = (left: ProtectedArea["bounds"], right: ProtectedArea["bounds"]): boolean =>
  left.min[0] < right.max[0] &&
  left.max[0] > right.min[0] &&
  left.min[1] < right.max[1] &&
  left.max[1] > right.min[1] &&
  left.min[2] < right.max[2] &&
  left.max[2] > right.min[2];

const selectWaterBody = (state: ReturnType<EditorCommandContext["getState"]>): WaterBody | undefined => {
  if (state.selection.kind === "water") {
    const selectedWaterId = state.selection.id;
    return state.waterBodies.find((waterBody) => waterBody.id === selectedWaterId);
  }

  return undefined;
};

const setSelectedWaterBody = (
  state: ReturnType<EditorCommandContext["getState"]>,
  waterBody: WaterBody,
): void => {
  state.setSelection({ kind: "water", id: waterBody.id, label: waterBody.name });
  state.setActiveMode("water");
  state.setActiveTool("water");
};

const runSetWaterDebugMode = async (
  ctx: EditorCommandContext,
  debugViewMode: WaterReflectionDebugViewMode,
): Promise<void> => {
  const state = ctx.getState();
  const water = selectWaterBody(state);
  if (!water) {
    ctx.toast.warning("No water body available.");
    return;
  }

  unwrapRuntime(await ctx.runtimeClient.setWaterReflectionDebugMode(water.id, debugViewMode));
  state.updateWaterBody(water.id, {
    reflectionStatus: {
      ...water.reflectionStatus,
      debugViewMode,
    },
  });
};

const toBrushPlacementRules = (state: ReturnType<EditorCommandContext["getState"]>) => ({
  avoidWater: state.propBrushSettings.avoidWater,
  maxSlope: state.propBrushSettings.slopeLimit,
  minSeparation: state.propBrushSettings.spacing,
  randomRotation: state.propBrushSettings.randomRotation,
  scaleJitter: state.propBrushSettings.scaleJitter,
  alignToNormal: state.propBrushSettings.alignToNormal,
  terrainConform: state.propBrushSettings.terrainConform,
  avoidProtectedAreas: state.propBrushSettings.avoidProtectedAreas,
  collisionCheck: state.propBrushSettings.collisionCheck,
  seed: state.propBrushSettings.seed,
});

const getActivePropAsset = (state: ReturnType<EditorCommandContext["getState"]>) => {
  const selected = state.selectedPropAssetId;
  return mockPropAssets.find((candidate) => candidate.id === selected) ?? mockPropAssets[0];
};

const buildSeededRandom = (seed: number) => {
  let next = seed % 2147483647;
  if (next <= 0) {
    next += 2147483646;
  }

  return () => {
    next = (next * 48271) % 2147483647;
    return next / 2147483647;
  };
};

const createScatterProps = (state: ReturnType<EditorCommandContext["getState"]>): readonly PropInstance[] => {
  const asset = getActivePropAsset(state);
  const seed = state.propBrushSettings.seed;
  const random = buildSeededRandom(seed);
  const baseIndex = state.props.length;
  const targetChunkId = state.selection.kind === "chunk" ? state.selection.id : state.props[0]?.chunkId ?? "chunk-0-0";
  const spawnCount = Math.max(2, Math.round(state.propBrushSettings.density + state.propBrushSettings.spacing * 0.5));
  const chunkId = targetChunkId;
  const baseX = (chunkId.length * 11 + state.props.length * 3) % 200;
  const baseZ = (chunkId.length * 13 + state.props.length * 5) % 180;

  return Array.from({ length: spawnCount }, (_, index): PropInstance => {
    const spreadX = ((random() - 0.5) * 10 * state.propBrushSettings.spacing) + (index % 4) * 4;
    const spreadZ = ((random() - 0.5) * 10 * state.propBrushSettings.spacing) + Math.floor(index / 4) * 4;
    const scale = 0.85 + state.propBrushSettings.scaleJitter * random();
    const rotation = state.propBrushSettings.randomRotation ? random() * 360 : (index % 4) * 90;
    const position: [number, number, number] = [baseX + spreadX, 20 + Math.floor(random() * 4), baseZ + spreadZ];

    return {
      id: `prop-scatter-${state.props.length + index + 1}`,
      name: `${asset.name} ${String(baseIndex + index + 1).padStart(3, "0")}`,
      type: asset.type,
      billboardMode: "Directional4",
      billboardEnabled: true,
      billboardSwitchDistance: 12 + state.propBrushSettings.spacing * 1.3,
      currentLod: "High",
      visible: true,
      shadowCast: index % 2 === 0,
      boundsWarning: false,
      generatedAssetAvailable: true,
      chunkId,
      position,
      assetPath: asset.assetPath,
      transform: {
        position,
        rotation: [0, rotation, 0],
        scale: [scale, scale, scale],
      },
      material: asset.defaultMaterial,
      lodState: index % 3 === 0 ? "Medium" : "High",
      collision: state.propBrushSettings.collisionCheck,
      placementRules: toBrushPlacementRules(state),
    };
  });
};

const setReflectionModeCommand = (id: string, title: string, mode: WaterReflectionDebugViewMode): EditorCommand => ({
  id,
  title,
  description: `Set reflection debug mode to ${title.toLowerCase()}.`,
  category: "Water",
  keywords: ["water", "reflection", "debug", mode],
  run: async (ctx) => {
    await runSetWaterDebugMode(ctx, mode);
  },
});

const waterPresets: Record<string, Partial<WaterBody>> = {
  ocean: {
    kind: "Ocean",
    bodyType: "deep_ocean",
    waveAmplitude: 0.78,
    waveSpeed: 0.9,
    waveScale: 1.16,
    waveCount: 6,
    reflectionStrength: 0.94,
    fresnelPower: 3.4,
    distortionStrength: 0.16,
    shallowColor: "#4a8cff",
    deepColor: "#0d2d5a",
    clarity: 0.85,
    murkiness: 0.12,
    foamEnabled: true,
    shoreFoam: 0.9,
    waveCrestFoam: 0.45,
    baseAlpha: 0.9,
    detailNormalIntensity: 0.72,
    detailScrollSpeed: 0.31,
  },
  lake: {
    kind: "Lake",
    bodyType: "calm_lake",
    waveAmplitude: 0.3,
    waveSpeed: 0.5,
    waveScale: 0.95,
    waveCount: 4,
    reflectionStrength: 0.92,
    fresnelPower: 2.4,
    distortionStrength: 0.08,
    shallowColor: "#66d5a8",
    deepColor: "#0f6f63",
    clarity: 0.98,
    murkiness: 0.04,
    foamEnabled: false,
    shoreFoam: 0.25,
    waveCrestFoam: 0.15,
    baseAlpha: 0.93,
    detailNormalIntensity: 0.54,
    detailScrollSpeed: 0.22,
  },
  river: {
    kind: "River",
    bodyType: "fast_current",
    waveAmplitude: 0.64,
    waveSpeed: 1.1,
    waveScale: 1.2,
    waveCount: 10,
    reflectionStrength: 0.81,
    fresnelPower: 3.7,
    distortionStrength: 0.16,
    shallowColor: "#6bb0ff",
    deepColor: "#2b56ad",
    clarity: 0.74,
    murkiness: 0.22,
    foamEnabled: true,
    shoreFoam: 0.65,
    waveCrestFoam: 0.58,
    baseAlpha: 0.86,
    detailNormalIntensity: 0.66,
    detailScrollSpeed: 0.34,
  },
  pond: {
    kind: "Pond",
    bodyType: "slow_eddy",
    waveAmplitude: 0.18,
    waveSpeed: 0.28,
    waveScale: 0.9,
    waveCount: 3,
    reflectionStrength: 0.65,
    fresnelPower: 2.9,
    distortionStrength: 0.03,
    shallowColor: "#7ad2ff",
    deepColor: "#1f4e97",
    clarity: 0.82,
    murkiness: 0.27,
    foamEnabled: false,
    shoreFoam: 0.2,
    waveCrestFoam: 0.22,
    baseAlpha: 0.86,
    detailNormalIntensity: 0.38,
    detailScrollSpeed: 0.14,
  },
};

const applyWaterPreset = (ctx: EditorCommandContext, presetKind: WaterBodyKind, values: Partial<WaterBody>) => {
  const state = ctx.getState();
  const water = selectWaterBody(state);
  if (!water) {
    ctx.toast.warning("No water body selected.");
    return;
  }

  state.updateWaterBody(water.id, {
    kind: presetKind,
    ...values,
  });
  ctx.toast.success(`${water.name} set to ${presetKind} preset.`);
};

const areaConflictWarnings = (candidate: ProtectedArea, areas: readonly ProtectedArea[]): string[] => {
  const warnings = new Set<string>();

  if (!candidate.name.trim()) {
    warnings.add("Missing area name warning.");
  }

  for (const area of areas) {
    if (area.id === candidate.id) {
      continue;
    }

    if (area.priority === candidate.priority) {
      warnings.add("Equal priority conflict warning.");
    }

    if (areaIntersects(candidate.bounds, area.bounds)) {
      warnings.add("Overlapping area warning.");
    }
  }

  return [...warnings];
};

const atlasTileIds = Array.from({ length: 64 }, (_, index) => `tile-${index}`);

const getSelectedTile = (ctx: EditorCommandContext): string => ctx.getState().selectedAtlasTileId ?? "tile-0";

const createAtlasAssignCommand = (
  id: string,
  title: string,
  block: BlockType,
  face: "top" | "side" | "bottom",
): EditorCommand => ({
  id,
  title,
  description: `Assign selected atlas tile to ${block} ${face}.`,
  category: "Materials",
  keywords: ["atlas", "tile", "mapping", `${block} ${face}`],
  preconditions: ["selectedAtlasTileId"],
  runtimeWrite: true,
  run: async (ctx) => {
    const selectedTile = getSelectedTile(ctx);
    const nextAtlasMapping = {
      ...ctx.getState().atlasMapping,
      [block]: {
        ...ctx.getState().atlasMapping[block],
        [face]: selectedTile,
      },
    };
    unwrapRuntime(await ctx.runtimeClient.setAtlasMapping(nextAtlasMapping));
    ctx.getState().updateAtlasMapping(block, { [face]: selectedTile });
    ctx.getState().pushAgentTimelineEvent({
      kind: "command",
      message: `Assigned tile ${selectedTile} to ${block}.${face}`,
    });
    ctx.toast.success(`Assigned atlas tile for ${block} ${face}.`);
  },
});

const setSelectedVoxelMaterial = async (
  ctx: EditorCommandContext,
  commandLabel: string,
  block: BlockType,
): Promise<void> => {
  const state = ctx.getState();
  if (state.selection.kind !== "voxel") {
    ctx.toast.warning("Select a runtime voxel before editing voxel material.");
    return;
  }

  const result = unwrapRuntime(await ctx.runtimeClient.setVoxel(state.selection.position, block));
  const position: [number, number, number] = [result.position[0], result.position[1], result.position[2]];
  state.markDirty(result.chunkId);
  state.setSelection({
    kind: "voxel",
    chunkId: result.chunkId,
    position,
    label: `${result.voxel} (${position[0]}, ${position[1]}, ${position[2]})`,
  });
  state.setActiveMode("voxel_paint");
  state.setActiveTool("paint");
  state.pushAgentTimelineEvent({
    kind: "command",
    message: `${commandLabel}: set voxel ${position.join(", ")} to ${result.voxel}.`,
  });
  ctx.toast.success(`${commandLabel} applied to runtime voxel.`);
};

const setSelectionToFallbackChunk = (ctx: EditorCommandContext): void => {
  const state = ctx.getState();
  const fallback = state.chunks[0];
  state.setSelection(fallback ? { kind: "chunk", id: fallback.id, label: fallback.label } : { kind: "debug_resource", id: "selection-empty", label: "No selection" });
};

const createAreaCommand = (
  id: string,
  title: string,
  kind: ProtectedAreaKind,
  rules: ProtectedAreaRuleMatrix,
  namePrefix: string,
): EditorCommand => ({
  id,
  title,
  description: `Create a protected area: ${namePrefix}.`,
  category: "Areas",
  keywords: ["protected", "area", "rules", "unbreakable", "no build", "no dig", namePrefix],
  runtimeWrite: true,
  run: async (ctx) => {
    const state = ctx.getState();
    const nextIndex = state.protectedAreas.length + 1;
    const center: [number, number, number] = [64 + nextIndex * 4, 24, 64 + nextIndex * 3];
    const size: [number, number, number] = [16, 16, 16];
    const areaIdPrefix = id.split(".").at(-1) ?? id;
    const area: ProtectedArea = {
      id: makeAreaId(areaIdPrefix, nextIndex),
      name: `${namePrefix} ${nextIndex}`,
      kind,
      shape: "box",
      center,
      size,
      priority: 1,
      locked: false,
      color: "#22d3ee",
      bounds: createBounds(center, size),
      rules,
    };

    const warnings = areaConflictWarnings(area, state.protectedAreas);
    const validation = unwrapRuntime(await ctx.runtimeClient.validateProtectedAreaConflicts(area));
    const runtimeArea = unwrapRuntime(await ctx.runtimeClient.createProtectedArea(area)).area;
    state.addProtectedArea(runtimeArea);
    state.setActiveMode("area");
    state.setSelection({ kind: "area", id: runtimeArea.id, label: runtimeArea.name });
    state.setActiveTool("area");

    if (warnings.length > 0 || !validation.clear) {
      ctx.toast.warning(`${area.name} has warnings.`);
      ctx.getState().pushAgentTimelineEvent({
        kind: "warning",
        message: `${runtimeArea.name} warning(s): ${[...warnings, ...validation.conflicts.map((conflict) => conflict.message)].join(", ")}`,
      });
    } else {
      ctx.getState().pushAgentTimelineEvent({
        kind: "command",
        message: `${runtimeArea.name} created and runtime accepted.`,
      });
    }

    ctx.toast.success(`${area.name} created.`);
  },
});

export const editorCommands: readonly EditorCommand[] = [
  {
    id: "editor.file.openWorld",
    title: "Open world file",
    description: "Open a persisted voxel world file and load it through the editor backend.",
    category: "File",
    shortcut: "Ctrl+O",
    keywords: ["file", "world", "open"],
    run: (ctx) => ctx.openWorldFile(),
  },
  {
    id: "editor.file.loadDefaultWorld",
    title: "Load default world",
    description: "Load the default world through the editor backend client.",
    category: "File",
    keywords: ["file", "world", "load", "default", "backend"],
    run: async (ctx) => {
      const summary = unwrapBackend(await ctx.backendClient.loadDefaultWorld());
      ctx.getState().replaceWorldSummary(summary);
      const snapshot = await ctx.backendClient.getViewportSnapshot();
      if (snapshot.ok) {
        ctx.getState().setViewportSnapshot(snapshot.data);
      }
      ctx.toast.success(`Loaded default world: ${summary.name}.`);
    },
  },
  {
    id: "editor.file.save",
    title: "Save",
    description: "Save the current backend world and clear dirty state.",
    category: "File",
    shortcut: "Ctrl+S",
    keywords: ["file", "save", "dirty"],
    run: async (ctx) => {
      unwrapBackend(await ctx.backendClient.saveDefaultWorld());
      ctx.getState().clearDirty();
      ctx.toast.success("World save complete.");
    },
  },
  {
    id: "editor.file.saveSnapshot",
    title: "Save snapshot",
    description: "Save a runtime world snapshot and record a frontend editor state checkpoint.",
    category: "File",
    keywords: ["snapshot", "save"],
    run: async (ctx) => {
      const snapshot = unwrapRuntime(await ctx.runtimeClient.saveWorldSnapshot());
      ctx.getState().saveEditorSnapshot(`Runtime snapshot ${snapshot.snapshotId}`, "editor.file.saveSnapshot");
      ctx.toast.success(`Runtime snapshot saved: ${snapshot.snapshotId}.`);
    },
  },
  {
    id: "editor.history.undo",
    title: "Undo",
    description: "Restore the editor state captured before the last undoable command.",
    category: "Edit",
    shortcut: "Ctrl+Z",
    keywords: ["undo", "history", "edit"],
    run: (ctx) => {
      const applied = ctx.getState().undoLastCommand();
      if (applied) {
        ctx.toast.success("Undo applied.");
        ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Undo restored the previous editor snapshot." });
      } else {
        ctx.toast.info("Nothing to undo.");
      }
    },
  },
  {
    id: "editor.history.redo",
    title: "Redo",
    description: "Reapply the editor state reversed by Undo.",
    category: "Edit",
    shortcut: "Ctrl+Shift+Z",
    keywords: ["redo", "history", "edit"],
    run: (ctx) => {
      const applied = ctx.getState().redoLastCommand();
      if (applied) {
        ctx.toast.success("Redo applied.");
        ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Redo restored the next editor snapshot." });
      } else {
        ctx.toast.info("Nothing to redo.");
      }
    },
  },
  {
    id: "editor.snapshot.create",
    title: "Create editor snapshot",
    description: "Store a frontend editor state snapshot for later restore.",
    category: "File",
    keywords: ["snapshot", "checkpoint", "state"],
    run: (ctx) => {
      const snapshot = ctx.getState().saveEditorSnapshot("Manual editor checkpoint", "editor.snapshot.create");
      ctx.toast.success(`Editor snapshot saved: ${snapshot.id}.`);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Saved editor state snapshot ${snapshot.id}.` });
    },
  },
  {
    id: "editor.snapshot.restoreLatest",
    title: "Restore latest editor snapshot",
    description: "Restore the most recent frontend editor state snapshot.",
    category: "File",
    keywords: ["snapshot", "restore", "state"],
    run: (ctx) => {
      const latestSnapshot = ctx.getState().savedSnapshots[0];
      if (!latestSnapshot) {
        ctx.toast.info("No editor snapshot is available.");
        return;
      }

      const applied = ctx.getState().loadEditorSnapshot(latestSnapshot.id);
      if (applied) {
        ctx.toast.success(`Restored snapshot: ${latestSnapshot.note}.`);
        ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Restored editor state snapshot ${latestSnapshot.id}.` });
      }
    },
  },
  {
    id: "editor.performance.loadLargeMockWorld",
    title: "Load large mock world",
    description: "Load a high-cardinality mock world to exercise editor panels without Bevy or Tauri.",
    category: "Tests",
    keywords: ["large world", "stress", "mock", "outliner", "console"],
    undoable: true,
    run: (ctx) => {
      ctx.getState().loadLargeMockWorld();
      const stats = ctx.getState().largeWorldStats;
      ctx.toast.success(`Loaded large mock world: ${stats.chunkCount} chunks, ${stats.propCount} props.`);
      ctx.getState().pushAgentTimelineEvent({
        kind: "command",
        message: `Large mock world loaded with ${stats.chunkCount} chunks, ${stats.propCount} props, and ${stats.consoleMessageCount} console entries.`,
      });
    },
  },
  {
    id: "editor.help.showHandoff",
    title: "Show editor handoff",
    description: "Record the current editor implementation handoff summary for agent review.",
    category: "Help",
    keywords: ["help", "handoff", "docs", "agent"],
    run: (ctx) => {
      const state = ctx.getState();
      ctx.getState().pushAgentTimelineEvent({
        kind: "observation",
        message: `Editor handoff: mock frontend backend, ${state.chunks.length} chunks, ${state.protectedAreas.length} protected areas, ${state.waterBodies.length} water bodies, ${state.props.length} props.`,
      });
      ctx.toast.info("Editor handoff summary recorded.");
    },
  },
  {
    id: "editor.view.toggleVoxelGrid",
    title: "Toggle voxel grid",
    description: "Toggle the runtime voxel grid viewport overlay.",
    category: "View",
    keywords: ["voxel", "grid", "overlay"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "voxelGrid"),
  },
  {
    id: "editor.view.toggleChunkBounds",
    title: "Toggle chunk bounds",
    description: "Toggle chunk bounds in the runtime world viewport.",
    category: "View",
    keywords: ["chunk", "bounds", "overlay"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "chunkBounds"),
  },
  {
    id: "editor.view.toggleProtectedAreas",
    title: "Toggle protected areas",
    description: "Toggle protected area visibility in the runtime world viewport.",
    category: "View",
    keywords: ["protected", "area", "overlay"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "protectedAreas"),
  },
  {
    id: "editor.view.togglePropBounds",
    title: "Toggle prop bounds",
    description: "Toggle runtime prop bounds debug visibility.",
    category: "View",
    keywords: ["props", "bounds", "billboards"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "propBounds"),
  },
  {
    id: "editor.view.toggleWaterDebug",
    title: "Toggle water debug",
    description: "Toggle runtime water debug overlay.",
    category: "View",
    keywords: ["water", "debug", "overlay"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "waterDebug"),
  },
  {
    id: "editor.view.toggleAgentTargets",
    title: "Toggle agent targets",
    description: "Toggle runtime agent-target markers in the viewport.",
    category: "View",
    keywords: ["agent", "targets", "overlay"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "agentTargets"),
  },
  {
    id: "editor.view.toggleWireframe",
    title: "Toggle wireframe",
    description: "Toggle runtime wireframe debug mode.",
    category: "View",
    keywords: ["wireframe", "debug", "overlay"],
    runtimeWrite: true,
    run: (ctx) => setRuntimeViewportOverlay(ctx, "wireframe"),
  },
  {
    id: "editor.view.resetLayout",
    title: "Reset dock layout",
    description: "Reset persisted dock layout to the default editor shell.",
    category: "View",
    keywords: ["dock", "layout", "reset"],
    run: async (ctx) => {
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
    id: "editor.world.loadSummary",
    title: "Load world summary",
    description: "Load a mocked world summary via backend client.",
    category: "World",
    keywords: ["world", "load", "summary", "backend"],
    run: async (ctx) => {
      const summary = unwrapBackend(await ctx.backendClient.getWorldSummary());
      ctx.getState().replaceWorldSummary(summary);
      ctx.toast.info(`Loaded world summary for ${summary.name}.`);
    },
  },
  {
    id: "editor.world.rebuildSelectedChunk",
    title: "Rebuild selected chunk",
    description: "Queue the selected runtime chunk mesh for rebuild.",
    category: "World",
    keywords: ["world", "chunk", "mesh", "rebuild"],
    preconditions: ["selection.kind === chunk"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "chunk") {
        ctx.toast.warning("Select a chunk before rebuilding.");
        return;
      }

      const selectedChunkId = state.selection.id;
      unwrapRuntime(await ctx.runtimeClient.rebuildSelectedChunk(selectedChunkId));
      ctx.setState({ chunks: state.chunks.map((chunk) => (chunk.id === selectedChunkId ? { ...chunk, meshStatus: "queued" } : chunk)) });
      ctx.toast.info(`${state.selection.label} rebuild queued.`);
    },
  },
  {
    id: "editor.world.rebuildDirtyChunks",
    title: "Rebuild dirty chunks",
    description: "Queue all dirty runtime chunks for rebuild.",
    category: "World",
    keywords: ["world", "chunk", "dirty", "rebuild"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      const dirtyChunkIds = state.dirtyState.dirtyChunkIds;
      unwrapRuntime(await ctx.runtimeClient.rebuildDirtyChunks(dirtyChunkIds));
      ctx.setState({ chunks: state.chunks.map((chunk) => (dirtyChunkIds.includes(chunk.id) ? { ...chunk, meshStatus: "queued" } : chunk)) });
      ctx.toast.info("Dirty chunk rebuild queued.");
    },
  },
  createAreaCommand(
    "editor.area.createUnbreakableBox",
    "Create unbreakable box area",
    "story_lock",
    { canMine: false, canPlace: false, canPaint: false, canSpawnProps: false, canEditWater: false, canSaveModify: false },
    "Unbreakable Box",
  ),
  createAreaCommand(
    "editor.area.createNoBuildZone",
    "Create no-build zone",
    "no_build",
    { canMine: true, canPlace: true, canPaint: false, canSpawnProps: false, canEditWater: true, canSaveModify: true },
    "No-Build Zone",
  ),
  createAreaCommand(
    "editor.area.createNoDigZone",
    "Create no-dig zone",
    "no_dig",
    { canMine: false, canPlace: true, canPaint: false, canSpawnProps: true, canEditWater: true, canSaveModify: true },
    "No-Dig Zone",
  ),
  {
    id: "editor.area.duplicateSelected",
    title: "Duplicate selected protected area",
    description: "Duplicate the selected protected area through the runtime rule registry.",
    category: "Areas",
    keywords: ["protected", "area", "duplicate", "copy"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before duplicating.");
        return;
      }

      const sourceAreaId = state.selection.id;
      const sourceArea = state.protectedAreas.find((area) => area.id === sourceAreaId);
      if (!sourceArea) {
        ctx.toast.warning("Selected protected area no longer exists.");
        return;
      }

      const nextIndex = state.protectedAreas.length + 1;
      const duplicate: ProtectedArea = {
        ...sourceArea,
        id: makeAreaId(`copy-${sourceArea.id}`, nextIndex),
        name: `${sourceArea.name} Copy`,
        center: [sourceArea.center[0] + 6, sourceArea.center[1], sourceArea.center[2] + 6],
        bounds: createBounds([sourceArea.center[0] + 6, sourceArea.center[1], sourceArea.center[2] + 6], sourceArea.size),
      };

      const validation = unwrapRuntime(await ctx.runtimeClient.validateProtectedAreaConflicts(duplicate));
      const runtimeArea = unwrapRuntime(await ctx.runtimeClient.createProtectedArea(duplicate)).area;
      state.addProtectedArea(runtimeArea);
      state.setActiveMode("area");
      state.setActiveTool("area");
      state.setSelection({ kind: "area", id: runtimeArea.id, label: runtimeArea.name });
      if (validation.clear) {
        ctx.toast.success(`${sourceArea.name} duplicated.`);
        ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Duplicated protected area ${sourceArea.name} through runtime.` });
      } else {
        ctx.toast.warning(`${sourceArea.name} duplicated with warnings.`);
        ctx.getState().pushAgentTimelineEvent({
          kind: "warning",
          message: `${runtimeArea.name} duplicate warning(s): ${validation.conflicts.map((conflict) => conflict.message).join(", ")}`,
        });
      }
    },
  },
  {
    id: "editor.area.deleteSelected",
    title: "Delete selected protected area",
    description: "Delete the selected protected area from the runtime rule registry.",
    category: "Areas",
    keywords: ["protected", "area", "delete", "remove"],
    preconditions: ["selection.kind === area"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before deleting.");
        return;
      }

      const targetId = state.selection.id;
      const targetLabel = state.selection.label;
      unwrapRuntime(await ctx.runtimeClient.deleteProtectedArea(targetId));
      state.removeProtectedArea(targetId);
      setSelectionToFallbackChunk(ctx);
      state.setActiveMode("select");
      state.setActiveTool("select");
      ctx.toast.warning(`${targetLabel} deleted.`);
      ctx.getState().pushAgentTimelineEvent({ kind: "warning", message: `Deleted protected area ${targetLabel}.` });
    },
  },
  {
    id: "editor.area.lockSelected",
    title: "Lock selected protected area",
    description: "Lock the selected protected area in the runtime rule registry.",
    category: "Areas",
    keywords: ["protected", "area", "lock"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before locking.");
        return;
      }

      const runtimeArea = unwrapRuntime(await ctx.runtimeClient.updateProtectedArea(state.selection.id, { locked: true })).area;
      state.updateProtectedArea(state.selection.id, runtimeArea);
      state.setActiveTool("area");
      ctx.toast.info(`${state.selection.label} locked.`);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Locked protected area ${state.selection.label}.` });
    },
  },
  {
    id: "editor.area.unlockSelected",
    title: "Unlock selected protected area",
    description: "Unlock the selected protected area in the runtime rule registry.",
    category: "Areas",
    keywords: ["protected", "area", "unlock"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before unlocking.");
        return;
      }

      const runtimeArea = unwrapRuntime(await ctx.runtimeClient.updateProtectedArea(state.selection.id, { locked: false })).area;
      state.updateProtectedArea(state.selection.id, runtimeArea);
      state.setActiveTool("area");
      ctx.toast.info(`${state.selection.label} unlocked.`);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Unlocked protected area ${state.selection.label}.` });
    },
  },
  {
    id: "editor.area.focusSelected",
    title: "Focus selected protected area",
    description: "Focus the selected protected area in the viewport.",
    category: "Areas",
    keywords: ["protected", "area", "focus", "camera"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before focusing.");
        return;
      }

      unwrapRuntime(await ctx.runtimeClient.focusCamera(state.selection));
      state.setActiveMode("area");
      state.setActiveTool("area");
      ctx.toast.success(`Focused ${state.selection.label} in viewport.`);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Focused protected area ${state.selection.label}.` });
    },
  },
  {
    id: "editor.area.validateSelectedRuntime",
    title: "Validate selected protected area",
    description: "Ask the runtime to validate protected area conflicts.",
    category: "Areas",
    keywords: ["protected", "area", "validate", "runtime", "conflict"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before validation.");
        return;
      }
      const selectedAreaId = state.selection.id;
      const area = state.protectedAreas.find((candidate) => candidate.id === selectedAreaId);
      if (!area) {
        ctx.toast.warning("Selected protected area no longer exists.");
        return;
      }
      const result = unwrapRuntime(await ctx.runtimeClient.validateProtectedAreaConflicts(area));
      ctx.getState().pushAgentTimelineEvent({
        kind: result.clear ? "command" : "warning",
        message: result.clear ? "Protected area conflict status clear." : `Protected area conflicts: ${result.conflicts.map((conflict) => conflict.message).join(", ")}`,
      });
      if (result.clear) {
        ctx.toast.success("Protected area conflicts clear.");
      } else {
        ctx.toast.warning("Protected area conflicts found.");
      }
    },
  },
  {
    id: "editor.area.querySelectedCenterRuntime",
    title: "Query selected area center rules",
    description: "Query runtime protected rules at the selected area's center voxel.",
    category: "Areas",
    keywords: ["protected", "area", "query", "runtime", "rules"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind !== "area") {
        ctx.toast.warning("Select a protected area before querying rules.");
        return;
      }
      const selectedAreaId = state.selection.id;
      const area = state.protectedAreas.find((candidate) => candidate.id === selectedAreaId);
      if (!area) {
        ctx.toast.warning("Selected protected area no longer exists.");
        return;
      }
      const voxel: [number, number, number] = [Math.floor(area.center[0]), Math.floor(area.center[1]), Math.floor(area.center[2])];
      const result = unwrapRuntime(await ctx.runtimeClient.queryProtectedRulesAtVoxel(voxel));
      ctx.getState().pushAgentTimelineEvent({
        kind: result.blocked ? "command" : "warning",
        message: result.blocked ? `Voxel edit blocked by protected area ${result.areaName ?? result.areaId ?? "unknown"}.` : "Selected area center has no blocking runtime rules.",
      });
      ctx.toast.info(`Runtime protected rule query completed at ${voxel.join(", ")}.`);
    },
  },
  {
    id: "editor.area.saveProtectedAreas",
    title: "Save protected areas",
    description: "Save runtime protected area rules.",
    category: "Areas",
    keywords: ["protected", "area", "save", "runtime"],
    runtimeWrite: true,
    run: async (ctx) => {
      const result = unwrapRuntime(await ctx.runtimeClient.saveProtectedAreas());
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Saved protected areas as ${result.snapshotId ?? "world-rules"}.` });
      ctx.toast.success("Protected areas saved.");
    },
  },
  {
    id: "editor.area.loadProtectedAreas",
    title: "Load protected areas",
    description: "Load runtime protected area rules.",
    category: "Areas",
    keywords: ["protected", "area", "load", "runtime"],
    runtimeWrite: true,
    run: async (ctx) => {
      const result = unwrapRuntime(await ctx.runtimeClient.loadProtectedAreas());
      ctx.getState().replaceProtectedAreas(result.areas);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Loaded ${result.areaCount} protected areas from runtime.` });
      ctx.toast.success("Protected areas loaded.");
    },
  },
  {
    id: "editor.voxel.paintMaterial",
    title: "Paint selected material",
    description: "Paint the selected runtime voxel with the active brush material.",
    category: "Voxels",
    keywords: ["voxel", "paint", "material"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      await setSelectedVoxelMaterial(ctx, "Paint material", state.brushSettings.materialBlockId);
    },
  },
  {
    id: "editor.voxel.replaceSelected",
    title: "Replace selected voxel",
    description: "Replace the selected runtime voxel with the active brush material.",
    category: "Voxels",
    keywords: ["voxel", "replace", "selection"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      await setSelectedVoxelMaterial(ctx, "Replace voxel", state.brushSettings.materialBlockId);
    },
  },
  {
    id: "editor.water.openReflectionDebug",
    title: "Open reflection debug",
    description: "Enable the runtime water debug overlay.",
    category: "Water",
    keywords: ["water", "reflection", "debug", "viewport", "overlay"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      if (!state.viewportOverlays.waterDebug) {
        await setRuntimeViewportOverlay(ctx, "waterDebug", true);
      }

      ctx.getState().setActiveMode("water");
      ctx.getState().setActiveTool("water");
      ctx.toast.info("Water reflection debug overlay opened.");
      ctx.getState().pushAgentTimelineEvent({
        kind: "command",
        message: "Opened water reflection debug overlay.",
      });
    },
  },
  {
    id: "editor.water.toggleReflectionMask",
    title: "Toggle reflection mask",
    description: "Toggle selected water reflection debug mode between Off and Mask.",
    category: "Water",
    keywords: ["water", "mask", "reflection"],
    run: async (ctx) => {
      const state = ctx.getState();
      const water = selectWaterBody(state);
      if (!water) {
        ctx.toast.warning("No water body selected.");
        return;
      }

      const debugViewMode = water.reflectionStatus.debugViewMode === "Mask" ? "Off" : "Mask";
      await runSetWaterDebugMode(ctx, debugViewMode);
      ctx.getState().pushAgentTimelineEvent({
        kind: "command",
        message: `Set ${water.name} reflection mode to ${debugViewMode}.`,
      });
    },
  },
  {
    id: "editor.water.setDebugOff",
    title: "Set reflection debug off",
    description: "Set selected water reflection debug mode to Off.",
    category: "Water",
    keywords: ["water", "reflection", "debug", "off"],
    runtimeWrite: true,
    run: async (ctx) => {
      await runSetWaterDebugMode(ctx, "Off");
    },
  },
  {
    id: "editor.water.setDebugMask",
    title: "Set reflection debug mask",
    description: "Set selected water reflection debug mode to Mask.",
    category: "Water",
    keywords: ["water", "reflection", "debug", "mask"],
    runtimeWrite: true,
    run: async (ctx) => {
      await runSetWaterDebugMode(ctx, "Mask");
    },
  },
  {
    id: "editor.water.setDebugReflectionOnly",
    title: "Set reflection-only debug",
    description: "Set selected water reflection debug mode to ReflectionOnly.",
    category: "Water",
    keywords: ["water", "reflection", "debug", "reflection-only"],
    runtimeWrite: true,
    run: async (ctx) => {
      await runSetWaterDebugMode(ctx, "ReflectionOnly");
    },
  },
  {
    id: "editor.water.setDebugBlendFactor",
    title: "Set reflection blend factor debug",
    description: "Set selected water reflection debug mode to BlendFactor.",
    category: "Water",
    keywords: ["water", "reflection", "debug", "blend"],
    runtimeWrite: true,
    run: async (ctx) => {
      await runSetWaterDebugMode(ctx, "BlendFactor");
    },
  },
  {
    id: "editor.water.runVisualProbe",
    title: "Run water visual probe",
    description: "Run the runtime water visual probe and capture sample results.",
    category: "Water",
    keywords: ["water", "probe", "reflection"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      const snapshot = unwrapRuntime(await ctx.runtimeClient.runWaterVisualProbe());
      const reflectionStatus: Partial<WaterReflectionStatus> = {
        probeValid: snapshot.reflectionStatus.probeValid,
        lastProbeUpdateMs: snapshot.reflectionStatus.lastProbeUpdateMs,
        active: snapshot.reflectionStatus.active,
        sampleReflection: snapshot.reflectionStatus.sampleReflection,
        reason: snapshot.reflectionStatus.reason,
        resolutionScale: snapshot.reflectionStatus.resolutionScale,
        effectiveHz: snapshot.reflectionStatus.effectiveHz,
        enabled: snapshot.reflectionStatus.enabled,
      };

      state.setWaterRuntimeSnapshot(snapshot);
      state.syncWaterReflectionStatus(reflectionStatus);
      if (state.selection.kind === "water") {
        ctx.toast.success(`Water visual probe completed for ${state.selection.label}.`);
      } else {
        ctx.toast.success("Water visual probe completed.");
      }
    },
  },
  {
    id: "editor.water.focusNearestWaterBody",
    title: "Focus nearest water body",
    description: "Select the nearest mocked water body.",
    category: "Water",
    keywords: ["water", "focus", "selection", "nearest"],
    run: (ctx) => {
      const state = ctx.getState();
      const lake = state.waterBodies.find((waterBody) => waterBody.id === "water-lk-03") ?? state.waterBodies[0];
      if (!lake) {
        ctx.toast.warning("No water body to focus.");
        return;
      }

      setSelectedWaterBody(state, lake);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Focused water body ${lake.name}.` });
    },
  },
  {
    id: "editor.water.classifyAsOcean",
    title: "Classify selected water as ocean",
    description: "Set selected water kind to Ocean.",
    category: "Water",
    keywords: ["water", "classify", "ocean"],
    run: (ctx) => {
      const state = ctx.getState();
      const water = selectWaterBody(state);
      if (!water) {
        ctx.toast.warning("No water body selected.");
        return;
      }

      state.updateWaterBody(water.id, { kind: "Ocean" });
      state.setActiveMode("water");
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Classified ${water.name} as Ocean.` });
    },
  },
  {
    id: "editor.water.classifyAsLake",
    title: "Classify selected water as lake",
    description: "Set selected water kind to Lake.",
    category: "Water",
    keywords: ["water", "classify", "lake"],
    run: (ctx) => {
      const state = ctx.getState();
      const water = selectWaterBody(state);
      if (!water) {
        ctx.toast.warning("No water body selected.");
        return;
      }

      state.updateWaterBody(water.id, { kind: "Lake" });
      state.setActiveMode("water");
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Classified ${water.name} as Lake.` });
    },
  },
  {
    id: "editor.water.classifyAsRiver",
    title: "Classify selected water as river",
    description: "Set selected water kind to River.",
    category: "Water",
    keywords: ["water", "classify", "river"],
    run: (ctx) => {
      const state = ctx.getState();
      const water = selectWaterBody(state);
      if (!water) {
        ctx.toast.warning("No water body selected.");
        return;
      }

      state.updateWaterBody(water.id, { kind: "River" });
      state.setActiveMode("water");
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Classified ${water.name} as River.` });
    },
  },
  {
    id: "editor.water.classifyAsPond",
    title: "Classify selected water as pond",
    description: "Set selected water kind to Pond.",
    category: "Water",
    keywords: ["water", "classify", "pond"],
    run: (ctx) => {
      const state = ctx.getState();
      const water = selectWaterBody(state);
      if (!water) {
        ctx.toast.warning("No water body selected.");
        return;
      }

      state.updateWaterBody(water.id, { kind: "Pond" });
      state.setActiveMode("water");
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Classified ${water.name} as Pond.` });
    },
  },
  {
    id: "editor.water.applyOceanPreset",
    title: "Apply ocean preset",
    description: "Apply mocked ocean water parameter preset.",
    category: "Water",
    keywords: ["water", "preset", "ocean"],
    run: (ctx) => {
      applyWaterPreset(ctx, "Ocean", waterPresets.ocean);
    },
  },
  {
    id: "editor.water.applyLakePreset",
    title: "Apply lake preset",
    description: "Apply mocked lake water parameter preset.",
    category: "Water",
    keywords: ["water", "preset", "lake"],
    run: (ctx) => {
      applyWaterPreset(ctx, "Lake", waterPresets.lake);
    },
  },
  {
    id: "editor.water.applyRiverPreset",
    title: "Apply river preset",
    description: "Apply mocked river water parameter preset.",
    category: "Water",
    keywords: ["water", "preset", "river"],
    run: (ctx) => {
      applyWaterPreset(ctx, "River", waterPresets.river);
    },
  },
  {
    id: "editor.water.applyPondPreset",
    title: "Apply pond preset",
    description: "Apply mocked pond water parameter preset.",
    category: "Water",
    keywords: ["water", "preset", "pond"],
    run: (ctx) => {
      applyWaterPreset(ctx, "Pond", waterPresets.pond);
    },
  },
  {
    id: "editor.props.scatterOnSelection",
    title: "Scatter props on selection",
    description: "Scatter mocked prop instances at current brush settings.",
    category: "Props",
    keywords: ["props", "scatter", "selection", "brush", "placement"],
    run: (ctx) => {
      const state = ctx.getState();
      const generated = createScatterProps(state);
      if (generated.length === 0) {
        ctx.toast.warning("No prop brush assets selected.");
        return;
      }

      state.addProps(generated);
      const firstGenerated = generated[0];
      if (firstGenerated) {
        ctx.getState().setSelection({ kind: "prop", id: firstGenerated.id, label: firstGenerated.name });
        state.setActiveMode("props");
        state.setActiveTool("props");
      }
      ctx.toast.success(`Scattered ${generated.length} props.`);
      ctx.getState().pushAgentTimelineEvent({
        kind: "command",
        message: `Scattered ${generated.length} mocked props from ${state.selectedPropAssetId}.`,
      });
    },
  },
  {
    id: "editor.props.clearInSelection",
    title: "Clear props in selection",
    description: "Remove mocked props constrained by current selection.",
    category: "Props",
    keywords: ["props", "delete", "clear", "selection"],
    run: (ctx) => {
      const state = ctx.getState();
      if (state.selection.kind === "chunk") {
        const before = state.props.length;
        state.removePropsByChunk(state.selection.id);
        const removed = before - state.props.length;
        ctx.toast.info(`Removed ${removed} props from ${state.selection.label}.`);
        ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Cleared ${removed} props in ${state.selection.label}.` });
      } else if (state.selection.kind === "prop") {
        state.removeProp(state.selection.id);
        ctx.toast.info(`Removed selected prop ${state.selection.label}.`);
        ctx.getState().pushAgentTimelineEvent({ kind: "command", message: `Removed prop ${state.selection.label}.` });
      } else {
        ctx.toast.warning("Select a chunk or prop before clearing props.");
      }
    },
  },
  {
    id: "editor.props.focusSelectedProp",
    title: "Focus selected prop",
    description: "Focus a selected prop through the runtime camera.",
    category: "Props",
    keywords: ["props", "focus", "selection", "runtime", "viewport"],
    runtimeWrite: true,
    run: async (ctx) => {
      const state = ctx.getState();
      let targetSelection = state.selection;
      if (state.selection.kind !== "prop") {
        const firstProp = state.props[0];
        if (!firstProp) {
          ctx.toast.warning("No prop available to focus.");
          return;
        }

        targetSelection = { kind: "prop", id: firstProp.id, label: firstProp.name };
        state.setSelection(targetSelection);
        ctx.toast.info(`Focused ${firstProp.name}.`);
      } else {
        ctx.toast.info(`Focused ${state.selection.label}.`);
      }

      unwrapRuntime(await ctx.runtimeClient.focusCamera(targetSelection));
      state.setActiveMode("props");
      state.setActiveTool("props");
    },
  },
  {
    id: "editor.props.selectPropBrush",
    title: "Select prop brush",
    description: "Switch to prop brush mode.",
    category: "Props",
    keywords: ["props", "brush", "mode", "tool"],
    run: (ctx) => {
      const state = ctx.getState();
      state.setActiveMode("props");
      state.setActiveTool("props");
      ctx.toast.info(`Prop brush ready. Asset ${state.selectedPropAssetId}.`);
    },
  },
  {
    id: "editor.props.toggleAvoidProtectedAreas",
    title: "Toggle avoid protected areas",
    description: "Toggle prop brush protected-area avoidance.",
    category: "Props",
    keywords: ["props", "brush", "protected area", "toggle"],
    run: (ctx) => {
      const state = ctx.getState();
      state.setPropBrushSettings({ avoidProtectedAreas: !state.propBrushSettings.avoidProtectedAreas });
      ctx.toast.success(`Avoid protected areas ${state.propBrushSettings.avoidProtectedAreas ? "off" : "on"}.`);
    },
  },
  {
    id: "editor.props.toggleBillboardDebug",
    title: "Toggle billboard debug",
    description: "Toggle mocked prop billboard debug overlay.",
    category: "Props",
    keywords: ["props", "billboard", "debug", "overlay"],
    run: (ctx) => {
      ctx.getState().toggleViewportOverlay("propBillboards");
    },
  },
  {
    id: "editor.material.openTextureAtlas",
    title: "Open texture atlas",
    description: "Open the texture atlas editing mode and reload atlas mapping.",
    category: "Materials",
    keywords: ["material", "atlas", "texture", "mapping"],
    run: async (ctx) => {
      const runtimeSnapshot = await ctx.runtimeClient.getRuntimeSnapshot();
      if (runtimeSnapshot.ok) {
        const dirtyAtlas = runtimeSnapshot.data.atlasMapping.dirty;
        const dirtyState = ctx.getState().dirtyState;
        ctx.setState({
          atlasMapping: runtimeSnapshot.data.atlasMapping.mapping,
          dirtyState: {
            ...dirtyState,
            dirtyAtlas,
            hasUnsavedChanges:
              dirtyState.dirtyChunkIds.length > 0 ||
              dirtyState.dirtyAreaIds.length > 0 ||
              dirtyState.dirtyWaterBodyIds.length > 0 ||
              dirtyState.dirtyPropIds.length > 0 ||
              dirtyAtlas ||
              dirtyState.layoutDirty,
          },
        });
      } else {
        const atlasMapping = unwrapBackend(await ctx.backendClient.loadAtlasMapping());
        ctx.setState({ atlasMapping });
      }
      ctx.getState().setActiveMode("material");
      ctx.getState().setActiveTool("material");
      ctx.getState().setSelection({ kind: "material", id: "mat-grass-block", label: "Grass Block" });
      ctx.getState().toggleViewportOverlay("atlasPreview");
    },
  },
  {
    id: "editor.atlas.selectTile",
    title: "Select atlas tile",
    description: "Set the currently selected atlas tile by ID.",
    category: "Materials",
    keywords: ["atlas", "tile", "selection", "index", "material"],
    preconditions: ["selectedAtlasTileId"],
    run: (ctx) => {
      const state = ctx.getState();
      const tileId = state.selectedAtlasTileId ?? atlasTileIds.at(0);
      if (!tileId) {
        ctx.toast.warning("No atlas tile to select.");
        return;
      }

      state.setSelectedAtlasTile(tileId);
      ctx.toast.info(`Atlas tile selected: ${tileId}.`);
    },
  },
  ...atlasTileIds.map(
    (tileId): EditorCommand => ({
      id: `editor.atlas.selectTile.${tileId}`,
      title: `Select atlas tile ${tileId}`,
      description: `Select atlas tile ${tileId} for mapping assignments.`,
      category: "Materials",
      keywords: ["atlas", "tile", tileId],
      run: (ctx) => {
        ctx.getState().setSelectedAtlasTile(tileId);
        ctx.toast.info(`Atlas tile selected: ${tileId}.`);
      },
    }),
  ),
  createAtlasAssignCommand("editor.atlas.assignGrassTop", "Assign selected tile to grass top", "grass", "top"),
  createAtlasAssignCommand("editor.atlas.assignGrassSide", "Assign selected tile to grass side", "grass", "side"),
  createAtlasAssignCommand("editor.atlas.assignGrassBottom", "Assign selected tile to grass bottom", "grass", "bottom"),
  createAtlasAssignCommand("editor.atlas.assignDirtTop", "Assign selected tile to dirt top", "dirt", "top"),
  createAtlasAssignCommand("editor.atlas.assignDirtSide", "Assign selected tile to dirt side", "dirt", "side"),
  createAtlasAssignCommand("editor.atlas.assignDirtBottom", "Assign selected tile to dirt bottom", "dirt", "bottom"),
  createAtlasAssignCommand("editor.atlas.assignRockTop", "Assign selected tile to rock top", "rock", "top"),
  createAtlasAssignCommand("editor.atlas.assignRockSide", "Assign selected tile to rock side", "rock", "side"),
  createAtlasAssignCommand("editor.atlas.assignRockBottom", "Assign selected tile to rock bottom", "rock", "bottom"),
  createAtlasAssignCommand("editor.atlas.assignSandTop", "Assign selected tile to sand top", "sand", "top"),
  createAtlasAssignCommand("editor.atlas.assignSandSide", "Assign selected tile to sand side", "sand", "side"),
  createAtlasAssignCommand("editor.atlas.assignSandBottom", "Assign selected tile to sand bottom", "sand", "bottom"),
  {
    id: "editor.atlas.rebuildTextureArray",
    title: "Rebuild texture array",
    description: "Save atlas mapping and clear atlas dirty state after runtime accepts it.",
    category: "Materials",
    keywords: ["atlas", "rebuild", "texture", "mapping"],
    runtimeWrite: true,
    run: async (ctx) => {
      unwrapRuntime(await ctx.runtimeClient.saveAtlasMapping(ctx.getState().atlasMapping));
      ctx.getState().markAtlasRebuilt();
      ctx.toast.success("Atlas texture array rebuild queued.");
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Runtime atlas texture array rebuild accepted." });
    },
  },
  {
    id: "editor.atlas.saveMapping",
    title: "Save atlas mapping",
    description: "Save current atlas mapping through the runtime.",
    category: "Materials",
    keywords: ["atlas", "save", "mapping", "yaml"],
    runtimeWrite: true,
    run: async (ctx) => {
      const result = unwrapRuntime(await ctx.runtimeClient.saveAtlasMapping(ctx.getState().atlasMapping));

      ctx.toast.success(`Atlas mapping saved as ${result.snapshotId ?? "mapping"}.`);
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Saved atlas mapping through runtime.", id: "agent-event-atlas-save" });
    },
  },
  {
    id: "editor.debug.openRenderTimings",
    title: "Open render timing table",
    description: "Open mocked render timing view in profiler.",
    category: "Debug",
    keywords: ["debug", "rendering", "timings", "profiler"],
    run: (ctx) => {
      ctx.getState().setActiveMode("debug");
      ctx.getState().setActiveTool("debug");
      ctx.toast.info("Render timing table opened in mocked profiler.");
    },
  },
  {
    id: "editor.debug.openGraphicsCapabilities",
    title: "Open graphics capabilities",
    description: "Open mocked graphics capabilities debug data.",
    category: "Debug",
    keywords: ["debug", "graphics", "capabilities", "adapter"],
    run: (ctx) => {
      ctx.getState().setActiveMode("debug");
      ctx.getState().setActiveTool("debug");
      ctx.toast.info("Graphics capabilities panel opened in mocked profiler.");
    },
  },
  runtimeSettingCommand(
    "editor.debug.toggleGtao",
    "Toggle GTAO",
    "Mock toggle GTAO in render debug settings.",
    (metrics) => ({
      ...metrics,
      ambientOcclusion: {
        ...metrics.ambientOcclusion,
        gtaoEnabled: !metrics.ambientOcclusion.gtaoEnabled,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleSsao",
    "Toggle SSAO",
    "Mock toggle SSAO support state in debug.",
    (metrics) => ({
      ...metrics,
      ambientOcclusion: {
        ...metrics.ambientOcclusion,
        ssaoEnabled: !metrics.ambientOcclusion.ssaoEnabled,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleBakedAo",
    "Toggle baked AO",
    "Mock toggle baked AO strength.",
    (metrics) => ({
      ...metrics,
      ambientOcclusion: {
        ...metrics.ambientOcclusion,
        bakedAoStrength: metrics.ambientOcclusion.bakedAoStrength > 0 ? 0 : 0.35,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleShadowBudget",
    "Toggle shadow budget",
    "Mock toggle shadow budget budget state.",
    (metrics) => ({
      ...metrics,
      shadowBudget: {
        ...metrics.shadowBudget,
        enabled: !metrics.shadowBudget.enabled,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleGodRays",
    "Toggle god rays",
    "Mock toggle directional god rays.",
    (metrics) => ({
      ...metrics,
      lightingAtmosphere: {
        ...metrics.lightingAtmosphere,
        godRaysEnabled: !metrics.lightingAtmosphere.godRaysEnabled,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleFog",
    "Toggle fog",
    "Mock toggle fog rendering.",
    (metrics) => ({
      ...metrics,
      lightingAtmosphere: {
        ...metrics.lightingAtmosphere,
        fogActive: !metrics.lightingAtmosphere.fogActive,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.togglePhotoMode",
    "Toggle photo mode",
    "Mock toggle cinematic photo mode.",
    (metrics) => ({
      ...metrics,
      cinematicPhotoMode: {
        ...metrics.cinematicPhotoMode,
        photoModeActive: !metrics.cinematicPhotoMode.photoModeActive,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleCinematicMode",
    "Toggle cinematic mode",
    "Mock toggle cinematic rendering mode.",
    (metrics) => ({
      ...metrics,
      cinematicPhotoMode: {
        ...metrics.cinematicPhotoMode,
        cinematicModeActive: !metrics.cinematicPhotoMode.cinematicModeActive,
      },
    }),
  ),
  runtimeSettingCommand(
    "editor.debug.toggleRayTracingMock",
    "Toggle ray tracing mock",
    "Mock toggle ray tracing support.",
    (metrics) => ({
      ...metrics,
      graphicsCapabilities: {
        ...metrics.graphicsCapabilities,
        rayTracingSupported: !metrics.graphicsCapabilities.rayTracingSupported,
      },
    }),
  ),
  {
    id: "editor.agent.observeScreen",
    title: "Agent observe screen",
    description: "Add a mocked agent observation event.",
    category: "Agent",
    keywords: ["agent", "observe", "screen"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "observation", message: "Observed current mocked editor screen." });
      ctx.toast.info("Agent observation captured.");
    },
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
    id: "editor.agent.approveStep",
    title: "Approve step",
    description: "Record a mocked approval decision for the selected plan step.",
    category: "Agent",
    keywords: ["agent", "plan", "approve"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Agent step approved." });
      ctx.toast.success("Agent step approved (mock).");
    },
  },
  {
    id: "editor.agent.rejectStep",
    title: "Reject step",
    description: "Record a mocked rejection decision for the selected plan step.",
    category: "Agent",
    keywords: ["agent", "plan", "reject"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "warning", message: "Agent step rejected." });
      ctx.toast.warning("Agent step rejected (mock).");
    },
  },
  {
    id: "editor.agent.revisePlan",
    title: "Revise plan",
    description: "Record a mocked revision request for the active plan.",
    category: "Agent",
    keywords: ["agent", "plan", "revise"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Agent plan revision requested." });
      ctx.toast.info("Agent plan revision requested.");
    },
  },
  {
    id: "editor.agent.generatePlaywrightTest",
    title: "Generate Playwright test",
    description: "Record a mocked Playwright generation request.",
    category: "Agent",
    keywords: ["agent", "playwright", "test"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({
        kind: "command",
        message: "Generated mocked Playwright test: mock-protected-area-workflow.spec.ts",
      });
      ctx.toast.info("Mocked Playwright test generated.");
    },
  },
  {
    id: "editor.agent.compareBeforeAfter",
    title: "Compare before/after",
    description: "Record a mocked before/after comparison request.",
    category: "Agent",
    keywords: ["agent", "compare", "before", "after"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "observation", message: "Compared before/after viewport state (mock)." });
      ctx.toast.info("Before/after comparison recorded.");
    },
  },
  {
    id: "editor.agent.saveSnapshot",
    title: "Save snapshot",
    description: "Record a mocked workflow snapshot in the agent timeline.",
    category: "Agent",
    keywords: ["agent", "snapshot", "save"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Agent snapshot saved (mock)." });
      ctx.getState().pushCommandHistory("editor.agent.saveSnapshot", "Save snapshot");
      ctx.toast.success("Agent snapshot saved.");
    },
  },
  {
    id: "editor.agent.copyObservationJson",
    title: "Copy observation JSON",
    description: "Record a mocked copy action for the current observation payload.",
    category: "Agent",
    keywords: ["agent", "observation", "copy", "json"],
    run: (ctx) => {
      ctx.getState().pushAgentTimelineEvent({ kind: "command", message: "Copied agent observation JSON (mock)." });
      ctx.toast.success("Agent observation JSON copied.");
    },
  },
  {
    id: "editor.tests.runViewportSmokeTest",
    title: "Run viewport smoke test",
    description: "Record a viewport smoke test request.",
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
  renderingQualityCommand("Low"),
  renderingQualityCommand("Medium"),
  renderingQualityCommand("High"),
  renderingQualityCommand("Performance100"),
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

const undoableCommandCategories = new Set(["Areas", "Water", "Props", "Materials"]);
const nonUndoableCommandIds = new Set([
  "editor.material.openTextureAtlas",
  "editor.atlas.selectTile",
  "editor.atlas.rebuildTextureArray",
  "editor.atlas.saveMapping",
]);

const shouldRecordUndoCheckpoint = (command: EditorCommand): boolean => {
  if (command.undoable === true) {
    return true;
  }

  if (command.undoable === false || nonUndoableCommandIds.has(command.id)) {
    return false;
  }

  if (command.id.startsWith("editor.atlas.selectTile.")) {
    return false;
  }

  return undoableCommandCategories.has(command.category);
};

export const runCommand = async (id: string, context: EditorCommandContext): Promise<void> => {
  const command = getCommand(id);
  const stateAtStart = context.getState();
  const recordUndoCheckpoint = shouldRecordUndoCheckpoint(command);
  if (command.runtimeWrite) {
    stateAtStart.beginCommand(command.id);
  }

  if (recordUndoCheckpoint) {
    stateAtStart.recordUndoCheckpoint(command.id, command.title);
  }

  try {
    await command.run(context);
    context.pushCommandHistory(command.id, command.title, "success");
    if (command.runtimeWrite) {
      context.pushAgentTimelineEvent({ kind: "command", message: `Runtime write succeeded: ${command.title}.` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown command failure.";
    const status = error instanceof RuntimeCommandError ? error.status : "failure";
    const state = context.getState();
    context.setState({
      consoleMessages: [
        {
          id: `console-command-error-${Date.now()}`,
          level: "error",
          message: `${command.id}: ${message}`,
          time: new Date().toLocaleTimeString(),
        },
        ...state.consoleMessages,
      ],
    });
    if (recordUndoCheckpoint) {
      context.getState().discardUndoCheckpoint(command.id);
    }
    context.pushCommandHistory(command.id, command.title, status, message);
    context.pushAgentTimelineEvent({ kind: "warning", message: `${command.title} failed: ${message}` });
    context.toast.error(`${command.title} failed.`);
  } finally {
    if (command.runtimeWrite) {
      context.getState().finishCommand(command.id);
    }
  }
};
