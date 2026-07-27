/** Shared Azgaar campaign → local minimap marker selection (north-up u/v). */

export const MINIMAP_BURG_EDGE_FACTOR = 2.5;
const MINIMAP_BURG_EDGE_RADIUS = 0.44;
const DEFAULT_BURG_COLOR = "#f0cf68";

export interface MinimapBurgSource {
  sourceWidth: number;
  sourceHeight: number;
  target: {
    minCellX: number;
    minCellZ: number;
    widthCells: number;
    heightCells: number;
  };
}

export interface MinimapCampaign {
  source?: MinimapBurgSource & Record<string, unknown>;
  burgs?: Array<{
    i?: number;
    name?: string;
    x?: number;
    y?: number;
    state?: number;
    capital?: unknown;
    removed?: boolean;
  }>;
  states?: Array<{ i?: number; color?: string }>;
}

export interface MinimapBurgMarker {
  id: number;
  name: string;
  capital: boolean;
  color: string;
  u: number;
  v: number;
  offscreen: boolean;
  distanceCells: number;
}

export function burgToNormalized(
  burg: { x: number; y: number },
  source: { sourceWidth: number; sourceHeight: number },
): { nx: number; nz: number } {
  return {
    nx: burg.x / source.sourceWidth,
    nz: burg.y / source.sourceHeight,
  };
}

/**
 * Picks Azgaar burgs worth drawing on the local minimap.
 * Positions are normalised to the minimap window — `u`/`v` in `0..1`, north-up.
 */
export function selectMinimapBurgs({
  campaign,
  center,
  cells,
  maxMarkers = 6,
  edgeFactor = MINIMAP_BURG_EDGE_FACTOR,
}: {
  campaign: MinimapCampaign | null | undefined;
  center: { x: number; z: number };
  cells: number;
  maxMarkers?: number;
  edgeFactor?: number;
}): MinimapBurgMarker[] {
  const source = campaign?.source;
  const bounds = source?.target;
  if (!bounds || !Array.isArray(campaign?.burgs) || !(cells > 0) || !center) {
    return [];
  }
  if (!(source.sourceWidth > 0) || !(source.sourceHeight > 0)) {
    return [];
  }

  const stateColors = new Map(
    (campaign.states ?? []).map((state) => [Number(state.i), state.color]),
  );
  const halfCells = cells / 2;
  const rangeCells = halfCells * edgeFactor;
  const markers: MinimapBurgMarker[] = [];

  for (const burg of campaign.burgs) {
    if (!burg || burg.removed) continue;
    const sourceX = Number(burg.x);
    const sourceY = Number(burg.y);
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) continue;

    const { nx, nz } = burgToNormalized({ x: sourceX, y: sourceY }, source);
    const cellX = Math.floor(bounds.minCellX + nx * bounds.widthCells);
    const cellZ = Math.floor(bounds.minCellZ + nz * bounds.heightCells);
    const offsetX = cellX - center.x;
    const offsetZ = cellZ - center.z;
    const distanceCells = Math.hypot(offsetX, offsetZ);
    if (distanceCells > rangeCells) continue;

    const offscreen = Math.abs(offsetX) > halfCells || Math.abs(offsetZ) > halfCells;
    let u = 0.5 + offsetX / cells;
    let v = 0.5 + offsetZ / cells;
    if (offscreen) {
      const scale = (MINIMAP_BURG_EDGE_RADIUS * cells) / distanceCells;
      u = 0.5 + (offsetX / cells) * scale;
      v = 0.5 + (offsetZ / cells) * scale;
    }

    markers.push({
      id: Number(burg.i),
      name: String(burg.name ?? ""),
      capital: Boolean(burg.capital),
      color: stateColors.get(Number(burg.state)) ?? DEFAULT_BURG_COLOR,
      u,
      v,
      offscreen,
      distanceCells,
    });
  }

  markers.sort((left, right) => left.distanceCells - right.distanceCells);
  return markers.slice(0, maxMarkers);
}
