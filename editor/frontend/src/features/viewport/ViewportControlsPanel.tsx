import { Boxes, Camera, CheckSquare2, Download, Focus, Grid3X3, MousePointer2, Paintbrush, Save, ShieldCheck, SkipBack, SkipForward, TestTube2, TriangleAlert, Upload } from "lucide-react";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getRuntimeWarnings, getSelectedObject } from "../../state/editorSelectors";
import type { EditorCameraTemplate } from "../../runtime/runtimeSchemas";

export function ViewportControlsPanel() {
  const editorState = useEditorStore();
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const activeMode = editorState.activeMode;
  const activeTool = editorState.activeTool;
  const overlays = editorState.viewportOverlays;
  const runtimeMetrics = editorState.runtimeMetrics;
  const runtimeWarnings = getRuntimeWarnings(editorState);
  const selectedObject = getSelectedObject(editorState);
  const selectedObjectSummary = selectedObject
    ? "name" in selectedObject
      ? `${editorState.selection.kind}: ${selectedObject.name}`
      : `${editorState.selection.kind}: ${editorState.selection.label}`
    : "No object selected";

  const toolShelf = [
    { id: "select", label: "Select", command: "editor.mode.select", icon: <MousePointer2 size={14} aria-hidden="true" /> },
    { id: "sculpt", label: "Sculpt", command: "editor.mode.voxelSculpt", icon: <ShieldCheck size={14} aria-hidden="true" /> },
    { id: "paint", label: "Paint", command: "editor.mode.voxelPaint", icon: <Paintbrush size={14} aria-hidden="true" /> },
    { id: "area", label: "Area", command: "editor.mode.area", icon: <TestTube2 size={14} aria-hidden="true" /> },
    { id: "props", label: "Props", command: "editor.mode.props", icon: <Grid3X3 size={14} aria-hidden="true" /> },
    { id: "water", label: "Water", command: "editor.mode.water", icon: <Focus size={14} aria-hidden="true" /> },
    { id: "measure", label: "Measure", command: "editor.palette.open", icon: <CheckSquare2 size={14} aria-hidden="true" /> },
    { id: "camera", label: "Camera", command: "editor.camera.open", icon: <Camera size={14} aria-hidden="true" /> },
  ];
  const activeToolShelfId =
    activeMode === "voxel_sculpt" ? "sculpt" : activeMode === "voxel_paint" ? "paint" : activeMode === "lighting" ? "camera" : activeMode;

  const overlayToggles = [
    { id: "voxelGrid", label: "Voxel grid", command: "editor.view.toggleVoxelGrid", enabled: overlays.voxelGrid },
    { id: "chunkBounds", label: "Chunk bounds", command: "editor.view.toggleChunkBounds", enabled: overlays.chunkBounds },
    { id: "protectedAreas", label: "Protected areas", command: "editor.view.toggleProtectedAreas", enabled: overlays.protectedAreas },
    { id: "propBounds", label: "Prop bounds", command: "editor.view.togglePropBounds", enabled: overlays.propBounds },
    { id: "waterDebug", label: "Water debug", command: "editor.view.toggleWaterDebug", enabled: overlays.waterDebug },
    { id: "wireframe", label: "Wireframe", command: "editor.view.toggleWireframe", enabled: overlays.wireframe },
    { id: "agentTargets", label: "Agent targets", command: "editor.view.toggleAgentTargets", enabled: overlays.agentTargets },
  ] as const;
  const editorCamera = editorState.editorCamera;
  const activeSavedCamera = editorCamera.savedCameras.find((camera) => camera.id === editorCamera.activeSavedCameraId);

  const applyEditorCamera = async (operation: Promise<{ readonly ok: true; readonly data: typeof editorCamera } | { readonly ok: false; readonly message: string }>) => {
    const result = await operation;
    if (result.ok) {
      useEditorStore.getState().setEditorCamera(result.data);
    }
  };

  const saveCurrentCamera = async () => {
    const result = await runtimeClient.addSavedEditorCamera();
    if (result.ok) {
      useEditorStore.getState().setEditorCamera(result.data.editorCamera);
    }
  };

  const exportCameraTemplate = async () => {
    const result = await runtimeClient.exportEditorCameraTemplate();
    if (!result.ok) {
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "drusniel-cameras.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCameraTemplate = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      void file.text().then(async (text) => {
        const template = JSON.parse(text) as EditorCameraTemplate;
        const result = await runtimeClient.importEditorCameraTemplate(template);
        if (result.ok) {
          useEditorStore.getState().setEditorCamera(result.data);
        }
      });
    };
    input.click();
  };

  return (
    <section className="panel-shell" data-testid="panel-viewport-controls" aria-labelledby="viewport-controls-title">
      <PanelTitleBar title="Viewport Controls" />
      <div className="panel-body viewport-controls-panel">
        <h2 id="viewport-controls-title" className="placeholder-heading">
          Viewport Controls
        </h2>
        <p className="agent-hint">Viewport controls are kept outside the native Bevy viewport so the viewer stays clean and clickable.</p>

        <div className="viewport-controls-summary">
          <article className="viewport-controls-card">
            <span>Viewport</span>
            <strong>{editorState.viewportRole}</strong>
            <small>{editorState.viewportRole === "authoring" ? "LiteVoxelViewport" : "Native Bevy"}</small>
          </article>
          <article className="viewport-controls-card">
            <span>Mode</span>
            <strong>{activeMode}</strong>
            <small>Tool {activeTool}</small>
          </article>
          <article className="viewport-controls-card">
            <span>Selection</span>
            <strong>{selectedObjectSummary}</strong>
            <small>{editorState.selection.kind}</small>
          </article>
          <article className="viewport-controls-card">
            <span>Runtime</span>
            <strong>
              {runtimeMetrics.fps} FPS / {runtimeMetrics.frameMs} ms
            </strong>
            <small>
              {editorState.runtimeState}, {runtimeWarnings.length} warnings
            </small>
          </article>
        </div>

        <section className="viewport-controls-section">
          <h3>Viewport</h3>
          <div className="viewport-controls-tool-grid" role="toolbar" aria-label="Viewport mode">
            <button
              type="button"
              className={`toolbar-button viewport-tool-button ${editorState.viewportRole === "authoring" ? "toolbar-button-active" : ""}`}
              aria-pressed={editorState.viewportRole === "authoring"}
              onClick={() => void runCommandById("editor.viewport.useAuthoring")}
            >
              <Boxes size={14} aria-hidden="true" />
              Author
            </button>
            <button
              type="button"
              className={`toolbar-button viewport-tool-button ${editorState.viewportRole === "validation" ? "toolbar-button-active" : ""}`}
              aria-pressed={editorState.viewportRole === "validation"}
              onClick={() => void runCommandById("editor.viewport.useValidation")}
            >
              <TriangleAlert size={14} aria-hidden="true" />
              Validate
            </button>
          </div>
        </section>

        <section className="viewport-controls-section">
          <h3>Tools</h3>
          <div className="viewport-controls-tool-grid" role="toolbar" aria-label="Viewport tools">
            {toolShelf.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={`toolbar-button viewport-tool-button ${tool.id === activeToolShelfId ? "toolbar-button-active" : ""}`}
                aria-pressed={tool.id === activeToolShelfId}
                onClick={() => void runCommandById(tool.command)}
              >
                {tool.icon}
                {tool.label}
              </button>
            ))}
          </div>
        </section>

        <section className="viewport-controls-section">
          <h3>Overlays</h3>
          <div className="viewport-controls-toggle-grid" data-testid="viewport-controls-overlay-toggles">
            {overlayToggles.map((toggle) => (
              <label className="viewport-toggle" key={toggle.id}>
                <input type="checkbox" checked={toggle.enabled} onChange={() => void runCommandById(toggle.command)} />
                <span>{toggle.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="viewport-controls-section" data-testid="viewport-camera-controls">
          <h3>Camera</h3>
          <div className="viewport-controls-toggle-grid">
            <label className="viewport-toggle">
              <input
                type="checkbox"
                checked={editorCamera.interactionMode === "movement"}
                onChange={(event) => void applyEditorCamera(runtimeClient.setEditorCameraMode({ interactionMode: event.currentTarget.checked ? "movement" : "menu" }))}
              />
              <span>{editorCamera.interactionMode === "movement" ? "Movement mode" : "Menu mode"}</span>
            </label>
            <label className="viewport-toggle">
              <input
                type="checkbox"
                checked={editorCamera.cameraKind === "arcball"}
                onChange={(event) => void applyEditorCamera(runtimeClient.setEditorCameraMode({ cameraKind: event.currentTarget.checked ? "arcball" : "firstPerson" }))}
              />
              <span>{editorCamera.cameraKind === "arcball" ? "Arcball" : "First Person"}</span>
            </label>
            <label className="viewport-toggle">
              <input
                type="checkbox"
                checked={editorCamera.projection === "orthographic"}
                onChange={(event) =>
                  void applyEditorCamera(
                    runtimeClient.setEditorCameraProjection(event.currentTarget.checked ? "orthographic" : "perspective", {
                      fovDegrees: editorCamera.pose.fovDegrees,
                      orthographicScale: editorCamera.pose.orthographicScale,
                    }),
                  )
                }
              />
              <span>{editorCamera.projection === "orthographic" ? "Orthographic" : "Perspective"}</span>
            </label>
          </div>
          <div className="viewport-controls-tool-grid" role="toolbar" aria-label="Camera presets">
            <button type="button" className="toolbar-button viewport-tool-button" onClick={() => void applyEditorCamera(runtimeClient.alignEditorCameraToAxes("nearest", true))}>
              <Camera size={14} aria-hidden="true" />
              Align
            </button>
            <button type="button" className="toolbar-button viewport-tool-button" onClick={() => void applyEditorCamera(runtimeClient.alignEditorCameraToAxes("isometric", false))}>
              <Camera size={14} aria-hidden="true" />
              Isometric
            </button>
            <button type="button" className="toolbar-button viewport-tool-button" onClick={() => void applyEditorCamera(runtimeClient.alignEditorCameraToAxes("dimetric", false))}>
              <Camera size={14} aria-hidden="true" />
              Dimetric
            </button>
          </div>
          <div className="viewport-controls-tool-grid" role="toolbar" aria-label="Saved cameras">
            <button type="button" className="toolbar-button viewport-tool-button" data-testid="camera-save-current" onClick={() => void saveCurrentCamera()}>
              <Save size={14} aria-hidden="true" />
              Add
            </button>
            <button type="button" className="toolbar-button viewport-tool-button" disabled={editorCamera.savedCameras.length === 0} onClick={() => void applyEditorCamera(runtimeClient.stepSavedEditorCamera(-1))}>
              <SkipBack size={14} aria-hidden="true" />
              Previous
            </button>
            <button type="button" className="toolbar-button viewport-tool-button" disabled={editorCamera.savedCameras.length === 0} onClick={() => void applyEditorCamera(runtimeClient.stepSavedEditorCamera(1))}>
              <SkipForward size={14} aria-hidden="true" />
              Next
            </button>
            <button type="button" className="toolbar-button viewport-tool-button" onClick={importCameraTemplate}>
              <Upload size={14} aria-hidden="true" />
              Import
            </button>
            <button type="button" className="toolbar-button viewport-tool-button" onClick={() => void exportCameraTemplate()}>
              <Download size={14} aria-hidden="true" />
              Export
            </button>
          </div>
          <div className="viewport-controls-summary">
            <article className="viewport-controls-card">
              <span>Saved</span>
              <strong>{editorCamera.savedCameras.length}</strong>
              <small>{activeSavedCamera?.name ?? "No camera selected"}</small>
            </article>
            <article className="viewport-controls-card">
              <span>Pose</span>
              <strong>{editorCamera.pose.position.map((value) => value.toFixed(1)).join(", ")}</strong>
              <small>Yaw {(editorCamera.pose.yaw * 180 / Math.PI).toFixed(1)} / Pitch {(editorCamera.pose.pitch * 180 / Math.PI).toFixed(1)}</small>
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}
