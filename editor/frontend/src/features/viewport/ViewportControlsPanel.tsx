import { Boxes, Camera, CheckSquare2, Focus, Grid3X3, MousePointer2, Paintbrush, ShieldCheck, TestTube2, TriangleAlert } from "lucide-react";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getRuntimeWarnings, getSelectedObject } from "../../state/editorSelectors";

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
    { id: "camera", label: "Camera", command: "editor.mode.lighting", icon: <Camera size={14} aria-hidden="true" /> },
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
      </div>
    </section>
  );
}
