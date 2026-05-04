import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getCurrentInspectorKind, getSelectedObject } from "../../state/editorSelectors";

export function InspectorPanel() {
  const editorState = useEditorStore();
  const selection = editorState.selection;
  const activeMode = editorState.activeMode;
  const inspectorKind = getCurrentInspectorKind(editorState);
  const selectedObject = getSelectedObject(editorState);
  const selectedSummary = selectedObject && "name" in selectedObject ? selectedObject.name : selection.label;

  return (
    <section className="panel-shell" data-testid="panel-inspector" aria-labelledby="inspector-title">
      <PanelTitleBar title="Inspector" />
      <div className="panel-body">
        <h2 id="inspector-title" className="placeholder-heading">Inspector</h2>
        <p className="agent-hint">Agent Hint: full inspector forms are deferred; this header mirrors current selection and mode.</p>
        <div className="inspector-card">
          <span className="inspector-kicker">Selected {inspectorKind}</span>
          <strong data-testid="inspector-selection-header">{selection.label}</strong>
          <small>Summary: {selectedSummary}</small>
        </div>
        <div className="inspector-card">
          <span className="inspector-kicker">Active mode</span>
          <strong>{activeMode}</strong>
          <small>No runtime edits are sent from Sprint 1.</small>
        </div>
      </div>
    </section>
  );
}
