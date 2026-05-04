import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";

export function AssetBrowserPanel() {
  const materials = useEditorStore((state) => state.materials);
  const props = useEditorStore((state) => state.props);
  const atlasMapping = useEditorStore((state) => state.atlasMapping);

  return (
    <section className="panel-shell" data-testid="panel-asset-browser" aria-labelledby="asset-browser-title">
      <PanelTitleBar title="Asset Browser" />
      <div className="panel-body" data-testid="bottom-dock">
        <h2 id="asset-browser-title" className="placeholder-heading">Asset Browser</h2>
        <p className="agent-hint">Agent Hint: assets are mocked; atlas and prop editing workflows are intentionally not implemented.</p>
        <div className="asset-card">
          <strong>Atlas mapping</strong>
          <small>{Object.keys(atlasMapping).join(", ")}</small>
        </div>
        <div className="asset-grid">
          {materials.map((material) => (
            <article key={material.id} className="asset-card">
              <strong>{material.name}</strong>
              <small>{material.kind}</small>
            </article>
          ))}
          {props.map((prop) => (
            <article key={prop.id} className="asset-card">
              <strong>{prop.name}</strong>
              <small>{prop.type} / {prop.billboardMode}</small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
