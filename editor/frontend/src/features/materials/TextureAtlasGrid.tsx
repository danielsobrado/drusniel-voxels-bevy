import type { CSSProperties } from "react";

interface TextureAtlasGridProps {
  readonly selectedTileId: string;
  readonly tileCount?: number;
  readonly columns?: number;
  readonly rows?: number;
  readonly atlasImageUrl?: string;
  readonly onSelectTile: (tileId: string, index: number) => void;
}

const DEFAULT_ATLAS_COLUMNS = 8;
const DEFAULT_ATLAS_ROWS = 8;
const DEFAULT_TILE_COUNT = DEFAULT_ATLAS_COLUMNS * DEFAULT_ATLAS_ROWS;
const DEFAULT_ATLAS_IMAGE_URL = "http://127.0.0.1:17777/assets/textures/atlas.png";

function parseTileIndex(tileId: string): number {
  return Number.parseInt(tileId.replace("tile-", ""), 10);
}

function tileBackgroundPosition(index: number, columns: number, rows: number): string {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = columns <= 1 ? 0 : (column / (columns - 1)) * 100;
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  return `${x}% ${y}%`;
}

export function TextureAtlasGrid({
  selectedTileId,
  tileCount = DEFAULT_TILE_COUNT,
  columns = DEFAULT_ATLAS_COLUMNS,
  rows = DEFAULT_ATLAS_ROWS,
  atlasImageUrl = DEFAULT_ATLAS_IMAGE_URL,
  onSelectTile,
}: TextureAtlasGridProps) {
  const selectedIndex = parseTileIndex(selectedTileId);

  return (
    <div className="atlas-grid" style={{ "--atlas-column-count": columns } as CSSProperties} data-testid="texture-atlas-grid">
      {Array.from({ length: tileCount }, (_, index) => {
        const tileId = `tile-${index}`;
        const isSelected = index === selectedIndex;
        const tileStyle: CSSProperties = atlasImageUrl
          ? {
              backgroundImage: `linear-gradient(rgba(8, 11, 16, 0.08), rgba(8, 11, 16, 0.2)), url("${atlasImageUrl}")`,
              backgroundPosition: `0 0, ${tileBackgroundPosition(index, columns, rows)}`,
              backgroundSize: `100% 100%, ${columns * 100}% ${rows * 100}%`,
            }
          : {};
        return (
          <button
            key={tileId}
            type="button"
            className={`atlas-tile ${isSelected ? "atlas-tile-active" : ""}`}
            data-testid={`atlas-tile-${index}`}
            style={tileStyle}
            onClick={() => onSelectTile(tileId, index)}
            aria-label={`Select atlas tile ${index}`}
          >
            <span className="atlas-tile-index">{index}</span>
          </button>
        );
      })}
    </div>
  );
}
