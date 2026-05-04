import type { EditorDataState } from "./editorStore";
import type { Selection } from "../types/editor";
import type { ChunkSummary, MaterialAsset, PropInstance, ProtectedArea, VoxelBlock, WaterBody } from "../types/world";

export type SelectedObject = ChunkSummary | ProtectedArea | PropInstance | WaterBody | MaterialAsset | VoxelBlock | { readonly kind: "debug_resource"; readonly id: string; readonly label: string } | undefined;

export interface OutlinerNode {
  readonly id: string;
  readonly label: string;
  readonly kind: Selection["kind"];
  readonly detail: string;
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

export const getVisibleOutlinerNodes = (state: EditorDataState): readonly OutlinerNode[] => [
  ...state.chunks.map((chunk) => ({ id: chunk.id, label: chunk.label, kind: "chunk" as const, detail: `${chunk.biome} / ${chunk.meshStatus}` })),
  ...state.protectedAreas.map((area) => ({ id: area.id, label: area.name, kind: "area" as const, detail: `${area.kind} / ${area.shape}` })),
  ...state.waterBodies.map((waterBody) => ({ id: waterBody.id, label: waterBody.name, kind: "water" as const, detail: `${waterBody.kind} / reflection ${waterBody.reflectionStatus.enabled ? "on" : "off"}` })),
  ...state.props.map((prop) => ({ id: prop.id, label: prop.name, kind: "prop" as const, detail: `${prop.type} / ${prop.billboardMode}` })),
  ...state.materials.map((material) => ({ id: material.id, label: material.name, kind: "material" as const, detail: material.kind })),
];

export const getAgentObservation = (state: EditorDataState) => ({
  ...state.agentObservation,
  selectedObjectLabel: state.selection.label,
  runtimeWarnings: getRuntimeWarnings(state),
});

export const getRuntimeWarnings = (state: EditorDataState): readonly string[] => {
  const waterWarnings = state.waterBodies.flatMap((waterBody) => {
    if (!waterBody.reflectionStatus.enabled) {
      return [`${waterBody.name} reflections are disabled.`];
    }

    if (!waterBody.reflectionStatus.probeValid) {
      return [`${waterBody.name} reflection probe is stale.`];
    }

    return [];
  });

  const timingWarnings = state.runtimeMetrics.frameMs > 16.7 ? [`Frame time ${state.runtimeMetrics.frameMs} ms exceeds 60 FPS budget.`] : [];

  return [...waterWarnings, ...timingWarnings];
};
