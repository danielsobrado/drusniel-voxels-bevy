import type { AtlasMapping, BlockType } from "../../types/world";

interface BlockFaceMappingEditorProps {
  readonly disabled?: boolean;
  readonly selectedTileId: string;
  readonly onAssign: (block: BlockType, face: keyof AtlasMapping) => void;
}

const blockFaceMap: readonly {
  readonly block: BlockType;
  readonly display: string;
  readonly faces: ReadonlyArray<keyof AtlasMapping>;
}[] = [
  {
    block: "grass",
    display: "Grass",
    faces: ["top", "side", "bottom"],
  },
  {
    block: "dirt",
    display: "Dirt",
    faces: ["top", "side", "bottom"],
  },
  {
    block: "rock",
    display: "Rock",
    faces: ["top", "side", "bottom"],
  },
  {
    block: "sand",
    display: "Sand",
    faces: ["top", "side", "bottom"],
  },
];

export function BlockFaceMappingEditor({ disabled = false, onAssign, selectedTileId }: BlockFaceMappingEditorProps) {
  return (
    <section className="atlas-face-editor" data-testid="texture-atlas-face-editor">
      <h3 className="inspector-section-title">Assign selected tile</h3>
      <p className="inspector-subnote">Tile selected: {selectedTileId}</p>
      <div className="atlas-face-matrix">
        {blockFaceMap.map((block) => (
          <div className="atlas-face-block" key={block.block}>
            <strong>{block.display}</strong>
            <div className="atlas-face-actions">
              {block.faces.map((face) => (
                <button
                  key={`${block.block}-${face}`}
                  type="button"
                  className="toolbar-button atlas-face-button"
                  data-testid={`atlas-assign-${block.block}-${face}`}
                  disabled={disabled}
                  onClick={() => onAssign(block.block, face)}
                >
                  {face}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
