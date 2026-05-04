interface TextureAtlasGridProps {
  readonly selectedTileId: string;
  readonly tileCount?: number;
  readonly onSelectTile: (tileId: string, index: number) => void;
}

const DEFAULT_TILE_COUNT = 64;

function parseTileIndex(tileId: string): number {
  return Number.parseInt(tileId.replace("tile-", ""), 10);
}

export function TextureAtlasGrid({ selectedTileId, tileCount = DEFAULT_TILE_COUNT, onSelectTile }: TextureAtlasGridProps) {
  const selectedIndex = parseTileIndex(selectedTileId);

  return (
    <div className="atlas-grid" data-testid="texture-atlas-grid">
      {Array.from({ length: tileCount }, (_, index) => {
        const tileId = `tile-${index}`;
        const isSelected = index === selectedIndex;
        return (
          <button
            key={tileId}
            type="button"
            className={`atlas-tile ${isSelected ? "atlas-tile-active" : ""}`}
            data-testid={`atlas-tile-${index}`}
            onClick={() => onSelectTile(tileId, index)}
            aria-label={`Select atlas tile ${index}`}
          >
            {index}
          </button>
        );
      })}
    </div>
  );
}
