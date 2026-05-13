import { ChangeEvent, useCallback, useMemo } from "react";
import { Boxes, Camera, CheckSquare2, Focus, Grid3X3, MousePointer2, Paintbrush, ShieldCheck, TestTube2, TriangleAlert } from "lucide-react";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getProtectedAreaWarnings, getRuntimeWarnings, getSelectedObject } from "../../state/editorSelectors";
import { BevyCanvasHost, type AreaOverlayState } from "./BevyCanvasHost";
import type { LiteVoxelEditRequest, LiteVoxelEditResponse, LiteVoxelSelection } from "./LiteVoxelViewport";
import type { ViewportModifierKey } from "../../types/editor";
import type { PropAsset, PropInstance, ProtectedAreaKind, ProtectedAreaShape } from "../../types/world";
import type { WaterReflectionDebugViewMode } from "../../types/world";

const breadcrumbPath = (kind: string, label: string) => {
  if (kind === "chunk") {
    return `World / Terrain / Chunks / ${label}`;
  }

  if (kind === "area") {
    return `World / Protected Areas / ${label}`;
  }

  if (kind === "water") {
    return `World / Water / ${label}`;
  }

  if (kind === "prop") {
    return `World / Props / ${label}`;
  }

  if (kind === "material") {
    return `World / Materials / ${label}`;
  }

  return "World / Selection";
};

const chunkIdForPosition = (position: readonly [number, number, number]) =>
  `chunk-${Math.floor(position[0] / 16)}-${Math.floor(position[1] / 16)}-${Math.floor(position[2] / 16)}`;

const modifierKeyOptions: readonly { readonly value: ViewportModifierKey; readonly label: string }[] = [
  { value: "shift", label: "Shift" },
  { value: "alt", label: "Alt" },
  { value: "control", label: "Ctrl" },
  { value: "meta", label: "Meta" },
  { value: "none", label: "None" },
];

const formatPropNumber = (value: number) => Number(value.toFixed(2)).toString();

const voxelSelectionLabel = (position: readonly [number, number, number], block = "Voxel") =>
  `${block} (${position[0]}, ${position[1]}, ${position[2]})`;

const buildPlacedProp = (
  asset: PropAsset,
  index: number,
  position: readonly [number, number, number],
  state: ReturnType<typeof useEditorStore.getState>,
): PropInstance => {
  const scale = 1 + state.propBrushSettings.scaleJitter * 0.5;
  const rotationY = state.propBrushSettings.randomRotation ? (state.propBrushSettings.seed + index * 37) % 360 : 0;
  const propPosition: [number, number, number] = [position[0], position[1], position[2]];

  return {
    id: `prop-placed-${index}`,
    assetId: asset.id,
    name: `${asset.name} ${String(index).padStart(3, "0")}`,
    type: asset.type,
    billboardMode: "Directional4",
    billboardEnabled: true,
    billboardSwitchDistance: 12 + state.propBrushSettings.spacing * 1.3,
    currentLod: "High",
    visible: true,
    shadowCast: true,
    boundsWarning: false,
    generatedAssetAvailable: true,
    chunkId: chunkIdForPosition(propPosition),
    position: propPosition,
    assetPath: asset.assetPath,
    transform: {
      position: propPosition,
      rotation: [0, rotationY, 0],
      scale: [scale, scale, scale],
    },
    material: asset.defaultMaterial,
    lodState: "High",
    collision: state.propBrushSettings.collisionCheck,
    placementRules: {
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
    },
  };
};

export function ViewportPanel({ onClose }: { readonly onClose?: () => void } = {}) {
  const editorState = useEditorStore();
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const activeMode = editorState.activeMode;
  const activeTool = editorState.activeTool;
  const overlays = editorState.viewportOverlays;
  const waterDebugPending = editorState.pendingCommandIds.some((commandId) => commandId.startsWith("editor.water.setDebug") || commandId === "editor.water.toggleReflectionMask");
  const waterProbePending = editorState.pendingCommandIds.includes("editor.water.runVisualProbe");
  const runtimeMetrics = editorState.runtimeMetrics;
  const runtimeWarnings = getRuntimeWarnings(editorState);
  const selectedObject = getSelectedObject(editorState);
  const selectedWaterBody = selectedObject && editorState.selection.kind === "water" && "reflectionStatus" in selectedObject ? selectedObject : undefined;
  const selectedProp = selectedObject && editorState.selection.kind === "prop" && "transform" in selectedObject ? (selectedObject as PropInstance) : undefined;
  const warningsByArea = getProtectedAreaWarnings(editorState);
  const isAreaSelected = editorState.selection.kind === "area";
  const selectedAreaWarnings = isAreaSelected ? warningsByArea[editorState.selection.id] ?? [] : [];
  const isWaterSelected = editorState.selection.kind === "water" && selectedWaterBody !== undefined && "name" in selectedWaterBody;
  const waterDebugCommandByMode: Record<WaterReflectionDebugViewMode, string> = {
    Off: "editor.water.setDebugOff",
    Mask: "editor.water.setDebugMask",
    ReflectionOnly: "editor.water.setDebugReflectionOnly",
    BlendFactor: "editor.water.setDebugBlendFactor",
  };

  const placePropInViewer = useCallback(
    async (position: readonly [number, number, number]) => {
      const state = useEditorStore.getState();
      const asset = state.propAssets.find((candidate) => candidate.id === state.selectedPropAssetId) ?? state.propAssets[0];
      if (!asset) {
        return;
      }

      const prop = buildPlacedProp(asset, state.props.length + 1, position, state);
      const result = await runtimeClient.scatterProps([prop]);
      if (!result.ok) {
        return;
      }

      useEditorStore.getState().addProps(result.data.props);
      useEditorStore.getState().setSelection({ kind: "prop", id: prop.id, label: prop.name });
      useEditorStore.getState().setActiveMode("props");
      useEditorStore.getState().setActiveTool("props");
      useEditorStore.getState().pushAgentTimelineEvent({
        kind: "command",
        message: `Placed ${prop.name} in viewport at ${prop.position.map((value) => value.toFixed(1)).join(", ")}.`,
      });
    },
    [runtimeClient],
  );

  const adjustSelectedPropInViewer = useCallback(
    (adjustment: { readonly rotationY?: number; readonly uniformScale?: number }) => {
      const state = useEditorStore.getState();
      if (state.selection.kind !== "prop") {
        return;
      }

      const selection = state.selection;
      const prop = state.props.find((candidate) => candidate.id === selection.id);
      if (!prop) {
        return;
      }

      const rotation: [number, number, number] =
        adjustment.rotationY === undefined
          ? [prop.transform.rotation[0], prop.transform.rotation[1], prop.transform.rotation[2]]
          : [prop.transform.rotation[0], adjustment.rotationY, prop.transform.rotation[2]];
      const scale: [number, number, number] =
        adjustment.uniformScale === undefined
          ? [prop.transform.scale[0], prop.transform.scale[1], prop.transform.scale[2]]
          : [adjustment.uniformScale, adjustment.uniformScale, adjustment.uniformScale];
      const nextProp: PropInstance = {
        ...prop,
        transform: {
          ...prop.transform,
          rotation,
          scale,
        },
      };

      useEditorStore.getState().updateProp(prop.id, {
        transform: nextProp.transform,
      });
      void runtimeClient.scatterProps([nextProp]);
    },
    [runtimeClient],
  );

  const selectVoxelInViewer = useCallback((voxel: LiteVoxelSelection) => {
    useEditorStore.getState().setSelection({
      kind: "voxel",
      chunkId: voxel.chunkId,
      position: voxel.position,
      label: voxelSelectionLabel(voxel.position),
    });
  }, []);

  const setVoxelInViewer = useCallback(
    async (edit: LiteVoxelEditRequest): Promise<LiteVoxelEditResponse> => {
      const result = await runtimeClient.setVoxel(edit.position, edit.block);
      if (!result.ok) {
        useEditorStore.getState().pushAgentTimelineEvent({
          kind: "warning",
          message: `Voxel edit rejected at ${edit.position.join(", ")}: ${result.message}`,
        });
        return { ok: false, message: result.message };
      }

      const mutation = result.data;
      const position: [number, number, number] = [mutation.position[0], mutation.position[1], mutation.position[2]];
      if (mutation.editResult !== "applied" && mutation.editResult !== "noChange") {
        const message = mutation.editResult.replace(/^rejected/, "rejected ");
        useEditorStore.getState().pushAgentTimelineEvent({
          kind: "warning",
          message: `Voxel edit ${message} at ${position.join(", ")}.`,
        });
        return {
          ok: false,
          message,
          chunkId: mutation.chunkId,
          voxel: mutation.currentVoxel ?? mutation.voxel,
        };
      }

      const state = useEditorStore.getState();
      if (mutation.editResult === "applied") {
        state.markDirty(mutation.chunkId);
      }
      state.setSelection({
        kind: "voxel",
        chunkId: mutation.chunkId,
        position,
        label: voxelSelectionLabel(position, mutation.currentVoxel ?? mutation.voxel),
      });
      state.pushAgentTimelineEvent({
        kind: "command",
        message: `Viewport voxel edit: set ${position.join(", ")} to ${mutation.currentVoxel ?? mutation.voxel}.`,
      });

      return {
        ok: true,
        chunkId: mutation.chunkId,
        voxel: mutation.currentVoxel ?? mutation.voxel,
      };
    },
    [runtimeClient],
  );

  const selectedObjectSummary = selectedObject
    ? "name" in selectedObject
      ? `${editorState.selection.kind}: ${selectedObject.name}`
      : `${editorState.selection.kind}: ${editorState.selection.label}`
    : "No object selected";

  const brushSummary = useMemo(
    () =>
      `Radius ${editorState.brushSettings.radius}m × Strength ${editorState.brushSettings.strength} × Shape ${editorState.brushSettings.brushShape} × ${editorState.brushSettings.materialBlockId} (${editorState.brushSettings.targetFace})`,
    [
      editorState.brushSettings.materialBlockId,
      editorState.brushSettings.radius,
      editorState.brushSettings.strength,
      editorState.brushSettings.brushShape,
      editorState.brushSettings.targetFace,
    ],
  );

  const overlayToggles = useMemo(
    () => [
      { id: "voxelGrid", label: "Voxel grid", command: "editor.view.toggleVoxelGrid", enabled: overlays.voxelGrid, testId: "viewport-toggle-voxel-grid" },
      { id: "chunkBounds", label: "Chunk bounds", command: "editor.view.toggleChunkBounds", enabled: overlays.chunkBounds, testId: "viewport-toggle-chunk-bounds" },
      {
        id: "protectedAreas",
        label: "Protected areas",
        command: "editor.view.toggleProtectedAreas",
        enabled: overlays.protectedAreas,
        testId: "viewport-toggle-protected-areas",
      },
      { id: "propBounds", label: "Prop bounds", command: "editor.view.togglePropBounds", enabled: overlays.propBounds, testId: "viewport-toggle-prop-bounds" },
      { id: "waterDebug", label: "Water debug", command: "editor.view.toggleWaterDebug", enabled: overlays.waterDebug, testId: "viewport-toggle-water-debug" },
      { id: "wireframe", label: "Wireframe", command: "editor.view.toggleWireframe", enabled: overlays.wireframe, testId: "viewport-toggle-wireframe" },
      { id: "agentTargets", label: "Agent targets", command: "editor.view.toggleAgentTargets", enabled: overlays.agentTargets, testId: "viewport-toggle-agent-targets" },
    ],
    [
      overlays.agentTargets,
      overlays.chunkBounds,
      overlays.propBounds,
      overlays.protectedAreas,
      overlays.voxelGrid,
      overlays.waterDebug,
      overlays.wireframe,
    ],
  );

  const toolShelf = [
    { id: "select", label: "Select", command: "editor.mode.select", icon: <MousePointer2 size={14} aria-hidden="true" />, iconAria: "Select" },
    { id: "sculpt", label: "Sculpt", command: "editor.mode.voxelSculpt", icon: <ShieldCheck size={14} aria-hidden="true" />, iconAria: "Sculpt" },
    { id: "paint", label: "Paint", command: "editor.mode.voxelPaint", icon: <Paintbrush size={14} aria-hidden="true" />, iconAria: "Paint" },
    { id: "area", label: "Area", command: "editor.mode.area", icon: <TestTube2 size={14} aria-hidden="true" />, iconAria: "Area" },
    { id: "props", label: "Props", command: "editor.mode.props", icon: <Grid3X3 size={14} aria-hidden="true" />, iconAria: "Props" },
    { id: "water", label: "Water", command: "editor.mode.water", icon: <Focus size={14} aria-hidden="true" />, iconAria: "Water" },
    { id: "measure", label: "Measure", command: "editor.palette.open", icon: <CheckSquare2 size={14} aria-hidden="true" />, iconAria: "Measure" },
    { id: "camera", label: "Camera", command: "editor.mode.lighting", icon: <Camera size={14} aria-hidden="true" />, iconAria: "Camera" },
  ];
  const activeToolShelfId =
    activeMode === "voxel_sculpt"
      ? "sculpt"
      : activeMode === "voxel_paint"
        ? "paint"
        : activeMode === "lighting"
          ? "camera"
          : activeMode;

  const areaKindOptions: readonly { readonly value: ProtectedAreaKind; readonly label: string }[] = [
    { value: "spawn", label: "Spawn" },
    { value: "story_lock", label: "Story Lock" },
    { value: "no_dig", label: "No-Dig" },
    { value: "no_build", label: "No-Build" },
    { value: "no_prop", label: "No-Prop" },
  ];

  const areaShapeOptions: readonly { readonly value: ProtectedAreaShape; readonly label: string }[] = [
    { value: "box", label: "Box" },
    { value: "sphere", label: "Sphere" },
    { value: "cylinder", label: "Cylinder" },
    { value: "chunk_set", label: "Chunk Set" },
    { value: "polygon", label: "Polygon" },
  ];

  const areaRulePresets = [
    {
      label: "Unbreakable",
      id: "unbreakable",
      rules: { canMine: false, canPlace: false, canPaint: false, canSpawnProps: false, canEditWater: false, canSaveModify: false },
    },
    {
      label: "No Build",
      id: "no-build",
      rules: { canMine: true, canPlace: false, canPaint: false, canSpawnProps: false, canEditWater: true, canSaveModify: true },
    },
    {
      label: "No Dig",
      id: "no-dig",
      rules: { canMine: false, canPlace: true, canPaint: false, canSpawnProps: true, canEditWater: true, canSaveModify: true },
    },
  ] as const;

  const brushShapeOptions: readonly { readonly value: "cube" | "sphere" | "cylinder"; readonly label: string }[] = [
    { value: "cube", label: "Cube" },
    { value: "sphere", label: "Sphere" },
    { value: "cylinder", label: "Cylinder" },
  ];

  const brushTargetFaceOptions: readonly { readonly value: "top" | "side" | "bottom" | "all"; readonly label: string }[] = [
    { value: "top", label: "Top" },
    { value: "side", label: "Side" },
    { value: "bottom", label: "Bottom" },
    { value: "all", label: "All" },
  ];

  const areaOverlays = useMemo<readonly AreaOverlayState[]>(() => {
    const entries: AreaOverlayState[] = [];

    for (const area of editorState.protectedAreas) {
      const nodeState = editorState.outlinerNodeState[`area:${area.id}`];
      if (nodeState?.visible === false) {
        continue;
      }

      const warnings = warningsByArea[area.id] ?? [];
      const hasWarning = warnings.length > 0;
      const isSelected = editorState.selection.kind === "area" && editorState.selection.id === area.id;
      const isAgentTarget =
        activeMode === "agent" && editorState.selection.kind === "area" && editorState.selection.id === area.id;

      const kind = isSelected ? "selected" : isAgentTarget ? "agent" : hasWarning ? "warning" : "default";

      entries.push({
        id: area.id,
        label: area.name,
        color: area.color,
        bounds: area.bounds,
        kind,
      });
    }

    return entries;
  }, [activeMode, editorState.outlinerNodeState, editorState.protectedAreas, editorState.selection, warningsByArea]);

  const cameraPosition: [number, number, number] = [84, 56, 112];
  const targetedVoxel: [number, number, number] =
    editorState.selection.kind === "voxel"
      ? editorState.selection.position
      : [Math.round(cameraPosition[0] + 6), Math.round(cameraPosition[1] - 12), Math.round(cameraPosition[2])];

  const selectedArea = selectedObject && editorState.selection.kind === "area" && "rules" in selectedObject ? selectedObject : undefined;
  const selectedAreaForTool = selectedArea as
    | {
        readonly id: string;
        readonly name: string;
        readonly kind: ProtectedAreaKind;
        readonly shape: ProtectedAreaShape;
        readonly priority: number;
        readonly locked: boolean;
        readonly rules: {
          readonly canMine: boolean;
          readonly canPlace: boolean;
          readonly canPaint: boolean;
          readonly canSpawnProps: boolean;
          readonly canEditWater: boolean;
          readonly canSaveModify: boolean;
        };
      }
    | undefined;

  return (
    <section className="panel-shell viewport-panel" data-testid="panel-viewport" aria-labelledby="viewport-title">
      <PanelTitleBar title="Viewport" titleId="viewport-title" onClose={onClose} />
      <div className="panel-body viewport-body">
        <div className="viewport-mode-switch" role="group" aria-label="Viewport mode" data-testid="viewport-mode-switch">
          <button
            type="button"
            className={`toolbar-button viewport-mode-button ${editorState.viewportRole === "authoring" ? "toolbar-button-active" : ""}`}
            aria-pressed={editorState.viewportRole === "authoring"}
            data-testid="viewport-mode-authoring"
            onClick={() => void runCommandById("editor.viewport.useAuthoring")}
          >
            <Boxes size={14} aria-hidden="true" />
            Author
          </button>
          <button
            type="button"
            className={`toolbar-button viewport-mode-button ${editorState.viewportRole === "validation" ? "toolbar-button-active" : ""}`}
            aria-pressed={editorState.viewportRole === "validation"}
            data-testid="viewport-mode-validation"
            onClick={() => void runCommandById("editor.viewport.useValidation")}
          >
            <TriangleAlert size={14} aria-hidden="true" />
            Validate
          </button>
        </div>
        <BevyCanvasHost
          chunks={editorState.chunks}
          props={editorState.props}
          worldViewport={editorState.worldViewport}
          viewportSnapshot={editorState.viewportSnapshot}
          atlasMapping={editorState.atlasMapping}
          viewportRole={editorState.viewportRole}
          runtimeState={editorState.runtimeState}
          activeMode={activeMode}
          brushSettings={editorState.brushSettings}
          selection={editorState.selection}
          targetedVoxel={targetedVoxel}
          viewportOverlays={overlays}
          areaOverlays={areaOverlays}
          showProtectedAreas={overlays.protectedAreas}
          waterDebug={overlays.waterDebug}
          waterDebugMode={
            selectedWaterBody && "reflectionStatus" in selectedWaterBody
              ? selectedWaterBody.reflectionStatus.debugViewMode
              : editorState.waterRuntimeSnapshot.reflectionStatus.debugViewMode
          }
          waterRuntimeSnapshot={editorState.waterRuntimeSnapshot}
          propPlacementEnabled={activeMode === "props"}
          onPlaceProp={placePropInViewer}
          onSelectVoxel={selectVoxelInViewer}
          onSetVoxel={setVoxelInViewer}
          selectedPropRotationY={selectedProp?.transform.rotation[1]}
          selectedPropUniformScale={selectedProp?.transform.scale[0]}
          propRotateDragModifier={editorState.propPlacementSettings.rotateDragModifier}
          propFineScaleModifier={editorState.propPlacementSettings.fineScaleModifier}
          propRotationSensitivity={editorState.propPlacementSettings.rotationSensitivity}
          propRotationSnapDegrees={editorState.propPlacementSettings.rotationSnapDegrees}
          propScaleStep={editorState.propPlacementSettings.scaleStep}
          propScaleMin={editorState.propPlacementSettings.minScale}
          propScaleMax={editorState.propPlacementSettings.maxScale}
          onAdjustSelectedProp={adjustSelectedPropInViewer}
        />
      </div>
    </section>
  );
}
