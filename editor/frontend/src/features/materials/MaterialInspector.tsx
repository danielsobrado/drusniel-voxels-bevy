import type { BlockType, BlockAtlasMap, MaterialAsset } from "../../types/world";

interface MaterialInspectorProps {
  readonly atlasMapping: BlockAtlasMap;
  readonly material: MaterialAsset;
}

const materialShading: Record<MaterialAsset["kind"], string> = {
  blocky: "Blocky (PBR)",
  triplanar: "Triplanar",
  building: "Building",
  props: "Billboard props",
  water: "Water shader",
};

const detectAtlasBlock = (material: MaterialAsset): BlockType | null => {
  const id = material.id.toLowerCase();
  if (id.includes("grass")) {
    return "grass";
  }

  if (id.includes("dirt")) {
    return "dirt";
  }

  if (id.includes("rock")) {
    return "rock";
  }

  if (id.includes("sand")) {
    return "sand";
  }

  return null;
};

function ReadOnlyMetricRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="inspector-readonly-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MaterialInspector({ atlasMapping, material }: MaterialInspectorProps) {
  const selectedBlock = material.id.toLowerCase().includes("water")
    ? null
    : detectAtlasBlock(material);

  const mappingRows = selectedBlock ? atlasMapping[selectedBlock] : null;

  return (
    <div data-testid="inspector-material">
      <section className="inspector-section">
        <div className="inspector-section-title">Material profile</div>
        <div className="inspector-metric-grid">
          <ReadOnlyMetricRow label="Material" value={material.name} />
          <ReadOnlyMetricRow label="Kind" value={material.kind} />
          <ReadOnlyMetricRow label="Shading" value={materialShading[material.kind]} />
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">Source</div>
        <ReadOnlyMetricRow label="Source path" value={material.sourcePath} />
      </section>

      {mappingRows && (
        <section className="inspector-section">
          <div className="inspector-section-title">Atlas face mapping</div>
          <ReadOnlyMetricRow label="Atlas block" value={selectedBlock ?? "n/a"} />
          <ReadOnlyMetricRow label="Top" value={mappingRows.top} />
          <ReadOnlyMetricRow label="Side" value={mappingRows.side} />
          <ReadOnlyMetricRow label="Bottom" value={mappingRows.bottom} />
        </section>
      )}

      {!selectedBlock && material.kind === "building" ? (
        <section className="inspector-section">
          <div className="inspector-section-title">Building material notes</div>
          <p className="inspector-subnote">This material is mocked as a building material workflow.</p>
        </section>
      ) : null}

      {!selectedBlock && material.kind === "props" ? (
        <section className="inspector-section">
          <div className="inspector-section-title">Prop billboard profile</div>
          <p className="inspector-subnote">This material uses mocked billboard behavior in this sprint.</p>
        </section>
      ) : null}

      {!selectedBlock && material.kind === "water" ? (
        <section className="inspector-section">
          <div className="inspector-section-title">Water material notes</div>
          <p className="inspector-subnote">This material is mocked and managed by water simulation controls.</p>
        </section>
      ) : null}
    </div>
  );
}
