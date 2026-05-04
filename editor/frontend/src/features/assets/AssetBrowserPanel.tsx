import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import type { PropType } from "../../types/world";
import { useEditorStore } from "../../state/editorStore";

const propTypeLabels: Record<PropType, string> = {
  tree: "Tree",
  rock: "Rock",
  bush: "Bush",
  flower: "Flower",
  building: "Building",
};

const groupedPropAssets = (assets: readonly { readonly category: PropType; readonly id: string; readonly name: string }[]) =>
  assets.reduce<Record<PropType, typeof assets>>((acc, asset) => {
    const next = [...acc[asset.category]];
    next.push(asset);
    acc[asset.category] = next;
    return acc;
  }, {
    tree: [],
    rock: [],
    bush: [],
    flower: [],
    building: [],
  });

export function AssetBrowserPanel() {
  const propAssets = useEditorStore((state) => state.props);
  const selectedPropAssetId = useEditorStore((state) => state.selectedPropAssetId);
  const setSelectedPropAsset = useEditorStore((state) => state.setSelectedPropAsset);
  const materials = useEditorStore((state) => state.materials);
  const worldProps = useEditorStore((state) => state.props);
  const atlasMapping = useEditorStore((state) => state.atlasMapping);

  const propAssetCatalog = groupedPropAssets(worldProps);

  return (
    <section className="panel-shell" data-testid="panel-asset-browser" aria-labelledby="asset-browser-title">
      <PanelTitleBar title="Asset Browser" />
      <div className="panel-body" data-testid="bottom-dock">
        <h2 id="asset-browser-title" className="placeholder-heading">Asset Browser</h2>
        <p className="agent-hint">Agent Hint: assets are mocked; atlas and prop editing workflows are intentionally not implemented.</p>
        <div className="asset-card">
          <strong>Prop brush asset</strong>
          <small>
            Selected: {selectedPropAssetId ?? "none"}
          </small>
        </div>
        {(["tree", "rock", "bush", "flower", "building"] as const).map((type) => (
          <details key={type} className="outliner-details" open>
            <summary className="asset-card" style={{ listStyle: "revert", margin: 0 }}>
              {propTypeLabels[type]}
            </summary>
            <div className="outliner-subsection">
              {propAssetCatalog[type].length === 0 ? (
                <div className="outliner-placeholder">No {propTypeLabels[type].toLowerCase()} assets</div>
              ) : (
                propAssetCatalog[type].map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    className={`asset-card ${selectedPropAssetId === asset.id ? "asset-card-selected" : ""}`}
                    onClick={() => setSelectedPropAsset(asset.id)}
                    data-testid={`asset-browser-prop-${asset.id}`}
                  >
                    <strong>{asset.name}</strong>
                    <small>{asset.id}</small>
                  </button>
                ))
              )}
            </div>
          </details>
        ))}
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
          {worldProps.slice(0, 8).map((prop) => (
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
