import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getVisibleOutlinerNodes } from "../../state/editorSelectors";
import type { Selection } from "../../types/editor";

export function WorldOutlinerPanel() {
  const editorState = useEditorStore();
  const nodes = getVisibleOutlinerNodes(editorState);
  const selection = editorState.selection;
  const setSelection = editorState.setSelection;
  const groups = [
    { title: "Chunks", kind: "chunk" },
    { title: "Protected Areas", kind: "area" },
    { title: "Water", kind: "water" },
    { title: "Props", kind: "prop" },
    { title: "Materials", kind: "material" },
  ] as const;

  return (
    <section className="panel-shell" data-testid="panel-world-outliner" aria-labelledby="outliner-title">
      <PanelTitleBar title="World Outliner" />
      <div className="panel-body">
        <h2 id="outliner-title" className="placeholder-heading">World Outliner</h2>
        <p className="agent-hint">Agent Hint: select mocked chunks, areas, props, and water bodies to update the inspector header.</p>
        {groups.map((group) => (
          <div key={group.kind} className="outliner-group" aria-label={`Mocked ${group.title}`}>
            <h3>{group.title}</h3>
            {nodes.filter((node) => node.kind === group.kind).map((node) => (
              <button key={node.id} type="button" className={"id" in selection && selection.id === node.id ? "outliner-row active" : "outliner-row"} aria-label={`Select ${node.label}`} onClick={() => setSelection({ kind: node.kind, id: node.id, label: node.label } as Selection)}>
                <span>{node.label}</span>
                <small>{node.detail}</small>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
