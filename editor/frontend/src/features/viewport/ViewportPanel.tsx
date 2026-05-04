import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getDirtyChunks, getRuntimeWarnings } from "../../state/editorSelectors";
import { BevyCanvasHost } from "./BevyCanvasHost";

export function ViewportPanel() {
  const editorState = useEditorStore();
  const activeMode = editorState.activeMode;
  const overlays = editorState.viewportOverlays;
  const runtimeMetrics = editorState.runtimeMetrics;
  const dirtyChunks = getDirtyChunks(editorState);
  const runtimeWarnings = getRuntimeWarnings(editorState);

  return (
    <section className="panel-shell viewport-panel" data-testid="panel-viewport" aria-labelledby="viewport-title">
      <PanelTitleBar title="Viewport" />
      <div className="panel-body viewport-body">
        <h2 id="viewport-title" className="sr-only">Viewport</h2>
        <BevyCanvasHost />
        <div className="viewport-overlay-card" data-testid="viewport-overlay-summary">
          <strong>Mode: {activeMode}</strong>
          <span>{runtimeMetrics.fps} FPS / {runtimeMetrics.frameMs} ms frame</span>
          <span>Dirty chunks: {dirtyChunks.length}</span>
          <span>Runtime warnings: {runtimeWarnings.length}</span>
          <span>Overlays: {Object.entries(overlays).filter(([, enabled]) => enabled).map(([name]) => name).join(", ")}</span>
        </div>
        <p className="agent-hint viewport-agent-hint">Agent Hint: viewport is mocked; use command buttons and outliner selections for shell operations.</p>
      </div>
    </section>
  );
}
