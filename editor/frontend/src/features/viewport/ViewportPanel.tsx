import { ChangeEvent, useCallback, useMemo } from "react";
import { Boxes, Camera, CheckSquare2, Focus, Grid3X3, MousePointer2, Paintbrush, ShieldCheck, TestTube2, TriangleAlert } from "lucide-react";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getProtectedAreaWarnings, getRuntimeWarnings, getSelectedObject } from "../../state/editorSelectors";
import { BevyCanvasHost, type AreaOverlayState } from "./BevyCanvasHost";
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

export function ViewportPanel() {
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
      <PanelTitleBar title="Viewport" />
      <div className="panel-body viewport-body">
        <h2 id="viewport-title" className="sr-only">
          Viewport
        </h2>
        <div className="viewport-overlay viewport-overlay-toolbar" data-testid="viewport-tools">
          <div className="viewport-breadcrumbs" data-testid="viewport-breadcrumbs">
            <span>{breadcrumbPath(editorState.selection.kind, editorState.selection.label)}</span>
          </div>

          <div className="viewport-top-strip">
            <span data-testid="viewport-active-mode" className="viewport-badge">
              Mode {activeMode}
            </span>
            <span className="viewport-badge" data-testid="viewport-active-tool">
              Tool {activeTool}
            </span>
          </div>

          <div className="viewport-tool-shelf" role="toolbar" aria-label="Viewport tool shelf">
            {toolShelf.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className="toolbar-button viewport-tool-button"
                data-tool-id={tool.id}
                aria-label={tool.iconAria}
                onClick={() => void runCommandById(tool.command)}
              >
                {tool.icon}
                {tool.label}
              </button>
            ))}
          </div>

          <div className="viewport-overlay-grid">
            <div className="viewport-summary-card">
              <div className="viewport-overlay-title">Selection</div>
              <strong>{selectedObjectSummary}</strong>
              <div data-testid="viewport-targeted-voxel">Voxel: ({targetedVoxel.join(", ")})</div>
              <div>Brush: {brushSummary}</div>
            </div>

            <div className="viewport-summary-card">
              <div className="viewport-overlay-title">Camera</div>
              <strong>{cameraPosition.join(", ")}</strong>
              <div>Runtime warnings: {runtimeWarnings.length}</div>
              <div>Runtime mode: {editorState.runtimeState}</div>
            </div>

            <div className="viewport-summary-card">
              <div className="viewport-overlay-title">Performance</div>
              <strong>
                {runtimeMetrics.fps} FPS / {runtimeMetrics.frameMs} ms
              </strong>
              <div>Overlays enabled: {Object.entries(overlays).filter(([, value]) => value).length}</div>
            </div>
          </div>

          <div className="viewport-overlay-toggle-group" data-testid="viewport-overlay-toggles">
            {overlayToggles.map((toggle) => (
              <label className="viewport-toggle" key={toggle.id}>
                <input
                  type="checkbox"
                  checked={toggle.enabled}
                  onChange={() => void runCommandById(toggle.command)}
                  data-testid={toggle.testId}
                />
                <span>{toggle.label}</span>
              </label>
            ))}
          </div>

          <div className="viewport-bottom-strip" data-testid="viewport-bottom-strip">
            {activeMode === "voxel_paint" ? (
              <div className="viewport-brush-toolbar" data-testid="viewport-voxel-paint-toolbar">
                <div className="viewport-section-title">Voxel Paint Controls</div>
                <label>
                  <span>Brush shape</span>
                  <select
                    data-testid="viewport-brush-shape"
                    value={editorState.brushSettings.brushShape}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.updateBrushSettings({
                        brushShape: event.target.value as "cube" | "sphere" | "cylinder",
                      })
                    }
                  >
                    {brushShapeOptions.map((shape) => (
                      <option key={shape.value} value={shape.value}>
                        {shape.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Target face</span>
                  <select
                    data-testid="viewport-brush-target-face"
                    value={editorState.brushSettings.targetFace}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.updateBrushSettings({
                        targetFace: event.target.value as "top" | "side" | "bottom" | "all",
                      })
                    }
                  >
                    {brushTargetFaceOptions.map((targetFace) => (
                      <option key={targetFace.value} value={targetFace.value}>
                        {targetFace.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Brush size</span>
                  <input
                    type="range"
                    min={1}
                    max={16}
                    value={editorState.brushSettings.radius}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => editorState.updateBrushSettings({ radius: Number(event.target.value) })}
                    data-testid="viewport-brush-radius"
                  />
                </label>
                <label>
                  <span>Strength</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={editorState.brushSettings.strength}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => editorState.updateBrushSettings({ strength: Number(event.target.value) })}
                    data-testid="viewport-brush-strength"
                  />
                </label>
                <label>
                  <span>Falloff</span>
                  <select
                    data-testid="viewport-brush-falloff"
                    value={editorState.brushSettings.falloff}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.updateBrushSettings({
                        falloff: event.target.value as "linear" | "smooth" | "constant",
                      })
                    }
                  >
                    <option value="linear">Linear</option>
                    <option value="smooth">Smooth</option>
                    <option value="constant">Constant</option>
                  </select>
                </label>
              </div>
            ) : null}

            {activeMode === "props" ? (
              <div className="viewport-prop-toolbar" data-testid="viewport-prop-toolbar">
                <div className="viewport-section-title">Prop Placement</div>
                <label>
                  <span>Rotate drag key</span>
                  <select
                    data-testid="viewport-prop-rotate-key"
                    value={editorState.propPlacementSettings.rotateDragModifier}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.setPropPlacementSettings({ rotateDragModifier: event.target.value as ViewportModifierKey })
                    }
                  >
                    {modifierKeyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Fine size key</span>
                  <select
                    data-testid="viewport-prop-fine-scale-key"
                    value={editorState.propPlacementSettings.fineScaleModifier}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.setPropPlacementSettings({ fineScaleModifier: event.target.value as ViewportModifierKey })
                    }
                  >
                    {modifierKeyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Wheel size step</span>
                  <input
                    data-testid="viewport-prop-scale-step"
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={editorState.propPlacementSettings.scaleStep}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const scaleStep = Number(event.target.value);
                      if (Number.isFinite(scaleStep)) {
                        editorState.setPropPlacementSettings({ scaleStep });
                      }
                    }}
                  />
                </label>
                <label>
                  <span>Rotation snap</span>
                  <input
                    data-testid="viewport-prop-rotation-snap"
                    type="number"
                    min={0}
                    max={90}
                    step={1}
                    value={editorState.propPlacementSettings.rotationSnapDegrees}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const rotationSnapDegrees = Number(event.target.value);
                      if (Number.isFinite(rotationSnapDegrees)) {
                        editorState.setPropPlacementSettings({ rotationSnapDegrees });
                      }
                    }}
                  />
                </label>
                <span className="viewport-prop-readout" data-testid="viewport-prop-scale-value">
                  Scale {selectedProp ? formatPropNumber(selectedProp.transform.scale[0]) : "-"}
                </span>
                <span className="viewport-prop-readout" data-testid="viewport-prop-rotation-value">
                  Yaw {selectedProp ? formatPropNumber(selectedProp.transform.rotation[1]) : "-"}
                </span>
              </div>
            ) : null}

            {isAreaSelected && selectedAreaForTool ? (
              <div className="viewport-area-toolbar">
                <div className="viewport-section-title">Area Mode Toolbar</div>
                <label>
                  <span>Shape</span>
                  <select
                    value={selectedAreaForTool.shape}
                    data-testid="viewport-area-shape"
                    disabled={selectedAreaForTool.locked}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.updateProtectedArea(selectedAreaForTool.id, { shape: event.target.value as ProtectedAreaShape })
                    }
                  >
                    {areaShapeOptions.map((shape) => (
                      <option key={shape.value} value={shape.value}>
                        {shape.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Kind</span>
                  <select
                    value={selectedAreaForTool.kind}
                    data-testid="viewport-area-kind"
                    disabled={selectedAreaForTool.locked}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      editorState.updateProtectedArea(selectedAreaForTool.id, { kind: event.target.value as ProtectedAreaKind })
                    }
                  >
                    {areaKindOptions.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={selectedAreaForTool.priority}
                    data-testid="viewport-area-priority"
                    disabled={selectedAreaForTool.locked}
                    onChange={(event) => {
                      const priority = Number(event.target.value);
                      if (Number.isFinite(priority)) {
                        editorState.updateProtectedArea(selectedAreaForTool.id, { priority });
                      }
                    }}
                  />
                </label>
                <label>
                  <span>Locked</span>
                  <input
                    type="checkbox"
                    checked={selectedAreaForTool.locked}
                    data-testid="viewport-area-locked"
                    onChange={(event) => editorState.updateProtectedArea(selectedAreaForTool.id, { locked: event.target.checked })}
                  />
                </label>
                <div className="viewport-area-rule-presets">
                  {areaRulePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="toolbar-button"
                      disabled={selectedAreaForTool.locked}
                      data-testid={`viewport-area-preset-${preset.id}`}
                      onClick={() => editorState.updateProtectedArea(selectedAreaForTool.id, { rules: preset.rules })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {selectedAreaWarnings.length > 0 ? (
                  <div className="viewport-area-warnings" data-testid="viewport-area-warnings">
                    <div className="viewport-section-title">Warnings</div>
                    {selectedAreaWarnings.map((item) => (
                      <span key={item}>
                        <TriangleAlert size={12} aria-hidden="true" /> {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isWaterSelected && selectedWaterBody ? (
              <div className="viewport-water-toolbar">
                <div className="viewport-section-title">Water overlay controls</div>
                <button
                  type="button"
                  className="toolbar-button"
                  data-testid="viewport-water-open-reflection-debug"
                  onClick={() => void runCommandById("editor.water.openReflectionDebug")}
                >
                  Open reflection debug
                </button>
                <label>
                  <span>Debug mode</span>
                  <select
                    data-testid="viewport-water-debug-mode"
                    value={selectedWaterBody.reflectionStatus.debugViewMode}
                    disabled={waterDebugPending}
                    onChange={(event) => {
                      const nextMode = event.target.value as WaterReflectionDebugViewMode;
                      void runCommandById(waterDebugCommandByMode[nextMode]);
                    }}
                  >
                    <option value="Off">Off</option>
                    <option value="Mask">Mask</option>
                    <option value="ReflectionOnly">ReflectionOnly</option>
                    <option value="BlendFactor">BlendFactor</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="toolbar-button"
                  data-testid="viewport-water-run-probe"
                  disabled={waterProbePending}
                  onClick={() => void runCommandById("editor.water.runVisualProbe")}
                >
                  {waterProbePending ? "Probe running" : "Run visual probe"}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <BevyCanvasHost
          chunks={editorState.chunks}
          worldViewport={editorState.worldViewport}
          viewportSnapshot={editorState.viewportSnapshot}
          runtimeState={editorState.runtimeState}
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

        <p className="agent-hint viewport-agent-hint">Agent Hint: area commands route through the runtime bridge and inspector fields update editor state.</p>
      </div>
    </section>
  );
}
