import type { BrushSettings } from "../../types/editor";

interface VoxelPaletteProps {
  readonly selectedMaterial: BrushSettings["materialBlockId"];
  readonly onMaterialChange: (nextMaterial: BrushSettings["materialBlockId"]) => void;
}

const paletteBlocks: readonly BrushSettings["materialBlockId"][] = [
  "topSoil",
  "subSoil",
  "rock",
  "sand",
  "clay",
  "water",
  "wood",
  "leaves",
  "dungeonWall",
  "dungeonFloor",
];

export function VoxelPalette({ selectedMaterial, onMaterialChange }: VoxelPaletteProps) {
  return (
    <section className="voxel-palette" data-testid="voxel-palette">
      <h3 className="inspector-section-title">Voxel palette</h3>
      <div className="voxel-palette-row">
        {paletteBlocks.map((block) => (
          <button
            key={block}
            type="button"
            className={`toolbar-button ${selectedMaterial === block ? "toolbar-button-active" : ""}`}
            data-testid={`voxel-palette-${block}`}
            onClick={() => onMaterialChange(block)}
          >
            {block}
          </button>
        ))}
      </div>
    </section>
  );
}
