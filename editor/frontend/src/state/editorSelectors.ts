import type { EditorDataState } from "./editorStore";
import type { Selection } from "../types/editor";
import type { ChunkSummary, MaterialAsset, PropInstance, PropStats, ProtectedArea, VoxelBlock, WaterBody } from "../types/world";
import type { AgentObservation } from "../types/runtime";

export type OutlinerNodeKind = Selection["kind"];

export type OutlinerNodeKey = `${OutlinerNodeKind}:${string}`;

export const getOutlinerNodeKey = (kind: OutlinerNodeKind, id: string): OutlinerNodeKey => `${kind}:${id}`;

export type SelectedObject = ChunkSummary | ProtectedArea | PropInstance | WaterBody | MaterialAsset | VoxelBlock | { readonly kind: "debug_resource"; readonly id: string; readonly label: string } | undefined;

const badgeByKind: Record<Selection["kind"], string> = {
  voxel: "VOX",
  chunk: "CHUNK",
  area: "AREA",
  prop: "PROP",
  water: "WATER",
  material: "MATERIAL",
  debug_resource: "DEBUG",
};

export interface OutlinerNode {
  readonly id: string;
  readonly label: string;
  readonly kind: OutlinerNodeKind;
  readonly detail: string;
  readonly typeBadge: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly dirty: boolean;
}

export const getSelectedObject = (state: EditorDataState): SelectedObject => {
  const selection = state.selection;

  if (selection.kind === "voxel") {
    return state.voxelBlocks.find((block) => block.id === selection.label.toLowerCase());
  }

  if (selection.kind === "chunk") {
    return state.chunks.find((chunk) => chunk.id === selection.id);
  }

  if (selection.kind === "area") {
    return state.protectedAreas.find((area) => area.id === selection.id);
  }

  if (selection.kind === "prop") {
    return state.props.find((prop) => prop.id === selection.id);
  }

  if (selection.kind === "water") {
    return state.waterBodies.find((waterBody) => waterBody.id === selection.id);
  }

  if (selection.kind === "material") {
    return state.materials.find((material) => material.id === selection.id);
  }

  return { kind: "debug_resource", id: selection.id, label: selection.label };
};

export const getDirtyChunks = (state: EditorDataState): readonly ChunkSummary[] =>
  state.chunks.filter((chunk) => state.dirtyState.dirtyChunkIds.includes(chunk.id) || chunk.dirty);

export const getCurrentInspectorKind = (state: EditorDataState): Selection["kind"] => state.selection.kind;

export const getVisibleOutlinerNodes = (state: EditorDataState): readonly OutlinerNode[] => {
  const toNode = (kind: OutlinerNodeKind, id: string, label: string, detail: string, dirty: boolean): OutlinerNode => {
    const key = getOutlinerNodeKey(kind, id);
    const nodeState = state.outlinerNodeState[key] ?? { visible: true, locked: false };

    return {
      id,
      label,
      kind,
      detail,
      typeBadge: badgeByKind[kind],
      visible: nodeState.visible,
      locked: nodeState.locked,
      dirty,
    };
  };

  return [
    ...state.chunks.map((chunk) => toNode("chunk", chunk.id, chunk.label, `${chunk.biome} / ${chunk.meshStatus}`, Boolean(chunk.dirty))),
    ...state.protectedAreas.map((area) => toNode("area", area.id, area.name, `${area.kind} / ${area.shape}`, state.dirtyState.dirtyAreaIds.includes(area.id))),
    ...state.waterBodies.map((waterBody) =>
      toNode(
        "water",
        waterBody.id,
        waterBody.name,
        `${waterBody.kind} / reflection ${waterBody.reflectionStatus.enabled ? "on" : "off"}`,
        state.dirtyState.dirtyWaterBodyIds.includes(waterBody.id),
      ),
    ),
    ...state.props.map((prop) => toNode("prop", prop.id, prop.name, `${prop.type} / ${prop.lodState}`, false)),
    ...state.materials.map((material) => toNode("material", material.id, material.name, material.kind, false)),
  ];
};

export const getPropStats = (state: EditorDataState): PropStats => {
  const totalInstances = state.props.length;
  const visibleInstances = state.props.filter((prop) => prop.visible).length;
  const hiddenInstances = totalInstances - visibleInstances;
  const billboardedCount = state.props.filter((prop) => prop.billboardEnabled).length;
  const threeDCount = state.props.filter((prop) => !prop.billboardEnabled).length;
  const lodSwitches = state.props.filter((prop) => prop.lodState !== prop.currentLod).length;
  const missingGeneratedAssets = state.props.filter((prop) => !prop.generatedAssetAvailable).length;
  const boundsWarnings = state.props.filter((prop) => prop.boundsWarning).length;
  const instancedGroups = new Set(state.props.map((prop) => prop.type)).size;
  const shadowCastCount = state.props.filter((prop) => prop.shadowCast).length;

  return {
    totalInstances,
    visibleInstances,
    hiddenInstances,
    billboardedCount,
    threeDCount,
    lodSwitches,
    missingGeneratedAssets,
    boundsWarnings,
    instancedGroups,
    shadowCastCount,
  };
};

const areaBoundsOverlap = (left: ProtectedArea, right: ProtectedArea): boolean =>
  left.bounds.min[0] < right.bounds.max[0] &&
  left.bounds.max[0] > right.bounds.min[0] &&
  left.bounds.min[2] < right.bounds.max[2] &&
  left.bounds.max[2] > right.bounds.min[2] &&
  left.bounds.min[1] < right.bounds.max[1] &&
  left.bounds.max[1] > right.bounds.min[1];

export const getProtectedAreaWarnings = (state: EditorDataState): Record<string, readonly string[]> => {
  const warningsByArea: Record<string, string[]> = {};

  for (const area of state.protectedAreas) {
    const warnings: string[] = [];

    if (!area.name.trim()) {
      warnings.push("Missing area name.");
    }

    if (area.locked && state.dirtyState.dirtyAreaIds.includes(area.id)) {
      warnings.push("Locked but edited.");
    }

    for (const other of state.protectedAreas) {
      if (other.id === area.id) {
        continue;
      }

      if (other.priority === area.priority) {
        warnings.push("Equal priority conflict.");
      }

      if (areaBoundsOverlap(area, other)) {
        warnings.push(`Overlapping area conflict with ${other.name}.`);
      }
    }

    warningsByArea[area.id] = [...new Set(warnings)];
  }

  return Object.fromEntries(Object.entries(warningsByArea).map(([id, next]) => [id, Object.freeze(next)])) as Record<string, readonly string[]>;
};

export const getSelectedProtectedAreaWarnings = (state: EditorDataState): readonly string[] => {
  if (state.selection.kind !== "area") {
    return [];
  }

  return getProtectedAreaWarnings(state)[state.selection.id] ?? [];
};

const AGENT_VISIBLE_PANELS: readonly string[] = [
  "viewport",
  "world-outliner",
  "inspector",
  "asset-browser",
  "texture-atlas",
  "console",
  "profiler",
  "agent-workbench",
  "command-palette",
];

const AGENT_SUGGESTED_COMMANDS: readonly string[] = [
  "editor.agent.observeScreen",
  "editor.agent.runPlan",
  "editor.agent.approveStep",
  "editor.agent.rejectStep",
  "editor.agent.revisePlan",
  "editor.agent.generatePlaywrightTest",
  "editor.agent.compareBeforeAfter",
  "editor.agent.saveSnapshot",
  "editor.agent.copyObservationJson",
];

export const getAgentObservation = (state: EditorDataState): AgentObservation => {
  const selected = state.selection.kind === "voxel" ? null : state.selection;
  const targetVoxel: readonly [number, number, number] =
    state.selection.kind === "voxel" ? state.selection.position : [84 + 6, 56 - 12, 112];
  const runtimeWarnings = [...getRuntimeWarnings(state), ...getSelectedProtectedAreaWarnings(state)];
  const overlays = Object.entries(state.viewportOverlays).flatMap(([overlay, enabled]) => (enabled ? [overlay] : []));

  return {
    activeMode: state.activeMode,
    activeTool: state.activeTool,
    selected,
    visiblePanels: AGENT_VISIBLE_PANELS,
    viewport: {
      cameraPosition: [84, 56, 112],
      targetVoxel,
      overlays,
    },
    brush: state.brushSettings,
    dirtyChunks: getDirtyChunks(state).length,
    warnings: runtimeWarnings,
    suggestedCommands: AGENT_SUGGESTED_COMMANDS,
  };
};

export const getRuntimeWarnings = (state: EditorDataState): readonly string[] => {
  const selectedWater = state.waterBodies[0];
  const snapshot = state.waterRuntimeSnapshot;
  const globalWarnings = snapshot && !snapshot.reflectionStatus.active
    ? [`${selectedWater ? `${selectedWater.name} reflection mode is inactive` : "Water reflection mode"} (${snapshot.reflectionStatus.reason}).`]
    : [];

  const waterWarnings = state.waterBodies.flatMap((waterBody) => {
    if (!waterBody.reflectionStatus.enabled) {
      return [`${waterBody.name} reflections are disabled.`];
    }

    if (!waterBody.reflectionStatus.sampleReflection) {
      return [`${waterBody.name} reflection probe is stale.`];
    }

    return [];
  });

  const samplingWarnings = !snapshot || !snapshot.reflectionStatus.sampleReflection
    ? [`Runtime water reflection sampling disabled (${snapshot?.reflectionStatus.reason ?? "unknown"}).`]
    : [];

  const timingWarnings = state.runtimeMetrics.frameMs > 16.7 ? [`Frame time ${state.runtimeMetrics.frameMs} ms exceeds 60 FPS budget.`] : [];

  return [...globalWarnings, ...waterWarnings, ...samplingWarnings, ...timingWarnings];
};
