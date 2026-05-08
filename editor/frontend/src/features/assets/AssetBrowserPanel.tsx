import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import type { PropAsset, PropType } from "../../types/world";
import { useEditorStore } from "../../state/editorStore";

const propTypeLabels: Record<PropType, string> = {
  tree: "Tree",
  rock: "Rock",
  bush: "Bush",
  flower: "Flower",
  building: "Building",
};

const groupedPropAssets = (assets: readonly PropAsset[]) =>
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
  const selectedPropAssetId = useEditorStore((state) => state.selectedPropAssetId);
  const setSelectedPropAsset = useEditorStore((state) => state.setSelectedPropAsset);
  const materials = useEditorStore((state) => state.materials);
  const worldProps = useEditorStore((state) => state.props);
  const propAssets = useEditorStore((state) => state.propAssets);
  const atlasMapping = useEditorStore((state) => state.atlasMapping);

  const propAssetCatalog = groupedPropAssets(propAssets);

  return (
    <section className="panel-shell" data-testid="panel-asset-browser" aria-labelledby="asset-browser-title">
      <PanelTitleBar title="Asset Browser" />
      <div className="panel-body" data-testid="bottom-dock">
        <div className="asset-browser-header">
          <h2 id="asset-browser-title" className="asset-browser-heading">
            <span>Asset</span>
            <span>Explore</span>
          </h2>
          <div className="asset-browser-tabs" aria-label="Asset browser filters">
            <button type="button" className="asset-browser-tab asset-browser-tab-active">
              Featured
            </button>
            <button type="button" className="asset-browser-tab">
              Mine
            </button>
            <button type="button" className="asset-browser-tab">
              Liked
            </button>
          </div>
        </div>
        <p className="agent-hint">Agent Hint: atlas mapping routes through runtime commands; prop brush assets use the editor catalog.</p>
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
