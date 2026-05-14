import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, ExternalLink, Eye, EyeOff, Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { AtlasMapping, BlockAtlasMap, BlockType, ChunkSummary, PropInstance, ViewportMeshBuffer, ViewportSnapshot, WorldSurfaceSample, WorldViewportPreview } from "../../types/world";
import type { BrushSettings, EditorMode, RuntimeState, Selection, ViewportModifierKey, ViewportOverlayState } from "../../types/editor";
import { LITE_VOXEL_VIEWPORT_CONTRACT } from "./viewportArchitecture";

export interface LiteVoxelViewportProps {
  readonly chunks: readonly ChunkSummary[];
  readonly props: readonly PropInstance[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
  readonly atlasMapping: BlockAtlasMap;
  readonly runtimeState: RuntimeState;
  readonly activeMode: EditorMode;
  readonly brushSettings: BrushSettings;
  readonly selection: Selection;
  readonly targetedVoxel: readonly [number, number, number];
  readonly viewportOverlays: ViewportOverlayState;
  readonly propPlacementEnabled?: boolean;
  readonly onPlaceProp?: (position: readonly [number, number, number]) => void;
  readonly onSelectVoxel?: (selection: LiteVoxelSelection) => void;
  readonly onSetVoxel?: (edit: LiteVoxelEditRequest) => Promise<LiteVoxelEditResponse>;
  readonly onToggleChunkBounds?: () => void;
  readonly selectedPropRotationY?: number;
  readonly selectedPropUniformScale?: number;
  readonly propRotateDragModifier?: ViewportModifierKey;
  readonly propFineScaleModifier?: ViewportModifierKey;
  readonly propRotationSensitivity?: number;
  readonly propRotationSnapDegrees?: number;
  readonly propScaleStep?: number;
  readonly propScaleMin?: number;
  readonly propScaleMax?: number;
  readonly onAdjustSelectedProp?: (adjustment: { readonly rotationY?: number; readonly uniformScale?: number }) => void;
}

export interface LiteVoxelSelection {
  readonly position: [number, number, number];
  readonly chunkId: string;
  readonly face: "top" | "side" | "bottom";
}

export interface LiteVoxelEditRequest extends LiteVoxelSelection {
  readonly block: BlockType;
}

export interface LiteVoxelEditResponse {
  readonly ok: boolean;
  readonly message?: string;
  readonly chunkId?: string;
  readonly voxel?: string;
}

interface ViewState {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly pitch: number;
  readonly heightOffset: number;
}

type CanvasDragState =
  | { readonly kind: "pan"; readonly x: number; readonly y: number; readonly view: ViewState }
  | { readonly kind: "orbit"; readonly x: number; readonly y: number; readonly view: ViewState }
  | { readonly kind: "prop-rotate"; readonly x: number; readonly startRotationY: number };

interface ModifierState {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

interface ChunkOverlayShape {
  readonly id: string;
  readonly label: string;
  readonly points: readonly ProjectedPoint[];
  readonly dirty: boolean;
  readonly selected: boolean;
}

interface BrushPreviewShape {
  readonly center: ProjectedPoint;
  readonly radius: number;
  readonly invalid: boolean;
  readonly affected: readonly ProjectedPoint[];
}

interface PropOverlayShape {
  readonly id: string;
  readonly label: string;
  readonly point: ProjectedPoint;
  readonly radius: number;
  readonly selected: boolean;
}

interface SurfaceWallFace {
  readonly points: readonly ProjectedPoint[];
  readonly material: WorldSurfaceSample["material"];
  readonly sortKey: number;
}

export interface GameCameraState {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
}

export interface DetachedGameCameraSnapshot {
  readonly camera: GameCameraState;
  readonly samples: readonly WorldSurfaceSample[];
  readonly cellSize: number;
  readonly updatedAt: number;
}

interface PendingVoxelEdit {
  readonly id: string;
  readonly position: [number, number, number];
  readonly block: BlockType;
  readonly status: "pending" | "applied" | "rejected";
  readonly message?: string;
}

type ViewportKeyAction =
  | "panForward"
  | "panBackward"
  | "panLeft"
  | "panRight"
  | "orbitLeft"
  | "orbitRight"
  | "tiltDown"
  | "tiltUp"
  | "fit"
  | "reset"
  | "zoomIn"
  | "zoomOut";

type ViewportKeyBindings = Record<ViewportKeyAction, string>;

const MATERIAL_COLORS: Record<string, string> = {
  Air: "#171923",
  TopSoil: "#4d8f4e",
  SubSoil: "#80613c",
  Rock: "#7f8792",
  Bedrock: "#4a4d55",
  Sand: "#d5bd82",
  Clay: "#b07f61",
  Water: "#2a8ecf",
  Wood: "#7a5132",
  Leaves: "#3f8b4d",
  DungeonWall: "#4f5363",
  DungeonFloor: "#585562",
};

const ATLAS_IMAGE_URLS = ["/assets/textures/atlas.png", "http://127.0.0.1:17777/assets/textures/atlas.png"] as const;
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 8;
const ATLAS_TILE_COUNT = ATLAS_COLUMNS * ATLAS_ROWS;
const LEGACY_ATLAS_TILE_IDS: Readonly<Record<string, string>> = {
  "atlas/terrain_grass_top": "tile-3",
  "atlas/terrain_grass_side": "tile-7",
  "atlas/terrain_grass_side_alt": "tile-7",
  "atlas/terrain_dirt": "tile-0",
  "atlas/terrain_rock": "tile-1",
  "atlas/terrain_sand": "tile-4",
};

const DEFAULT_VIEW: ViewState = { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, pitch: 0.5, heightOffset: 0 };
export const DETACHED_GAME_CAMERA_CHANNEL = "drusniel-game-camera-preview";
export const DETACHED_GAME_CAMERA_STORAGE_KEY = "drusniel.editor.detachedGameCamera";
const DETACHED_GAME_CAMERA_WINDOW_LABEL = "game-camera-preview";
const MIN_VIEW_PITCH = 0.08;
const MAX_VIEW_PITCH = 0.92;
const VIEW_HEIGHT_STEP = 8;
const DEFAULT_VIEWPORT_KEY_BINDINGS: ViewportKeyBindings = {
  panForward: "w",
  panBackward: "s",
  panLeft: "a",
  panRight: "d",
  orbitLeft: "q",
  orbitRight: "e",
  tiltDown: "z",
  tiltUp: "x",
  fit: "f",
  reset: "r",
  zoomIn: "=",
  zoomOut: "-",
};

const VIEWPORT_KEY_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "w", label: "W" },
  { value: "a", label: "A" },
  { value: "s", label: "S" },
  { value: "d", label: "D" },
  { value: "q", label: "Q" },
  { value: "e", label: "E" },
  { value: "z", label: "Z" },
  { value: "x", label: "X" },
  { value: "r", label: "R" },
  { value: "f", label: "F" },
  { value: "=", label: "+" },
  { value: "-", label: "-" },
  { value: "arrowup", label: "Up" },
  { value: "arrowdown", label: "Down" },
  { value: "arrowleft", label: "Left" },
  { value: "arrowright", label: "Right" },
];

const VIEWPORT_BINDING_LABELS: readonly { readonly action: ViewportKeyAction; readonly label: string }[] = [
  { action: "panForward", label: "Pan forward" },
  { action: "panBackward", label: "Pan back" },
  { action: "panLeft", label: "Pan left" },
  { action: "panRight", label: "Pan right" },
  { action: "orbitLeft", label: "Orbit left" },
  { action: "orbitRight", label: "Orbit right" },
  { action: "tiltDown", label: "Tilt down" },
  { action: "tiltUp", label: "Tilt up" },
  { action: "fit", label: "Fit world" },
  { action: "reset", label: "Reset view" },
  { action: "zoomIn", label: "Zoom in" },
  { action: "zoomOut", label: "Zoom out" },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const normalizeKeyboardKey = (key: string) => (key === "+" ? "=" : key.toLowerCase());

const normalizeQuarterTurn = (rotation: number) => ((rotation % 4) + 4) % 4;

const rotateHorizontal = (x: number, z: number, rotation: number): readonly [number, number] => {
  const radians = normalizeQuarterTurn(rotation) * Math.PI * 0.5;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos - z * sin, x * sin + z * cos];
};

const viewWithCamera = (view: ViewState, patch: Partial<ViewState>): ViewState => ({
  ...view,
  ...patch,
  rotation: patch.rotation === undefined ? view.rotation : normalizeQuarterTurn(patch.rotation),
  pitch: clamp(patch.pitch ?? view.pitch, MIN_VIEW_PITCH, MAX_VIEW_PITCH),
});

const gameYawForView = (view: ViewState) => normalizeQuarterTurn(view.rotation) * Math.PI * 0.5 + Math.PI * 0.25;

const modifierMatches = (event: ModifierState, key: ViewportModifierKey = "none") => {
  switch (key) {
    case "shift":
      return event.shiftKey;
    case "alt":
      return event.altKey;
    case "control":
      return event.ctrlKey;
    case "meta":
      return event.metaKey;
    case "none":
      return true;
  }
};

const sampleGridKey = (x: number, z: number) => `${x}:${z}`;

const sampleColumnKey = (sample: WorldSurfaceSample, chunkSize: number) =>
  `${Math.floor(sample.x / chunkSize)}:${Math.floor(sample.z / chunkSize)}`;

const fallbackSamplesFromChunks = (chunks: readonly ChunkSummary[]): readonly WorldSurfaceSample[] =>
  chunks.map((chunk) => {
    const [x, y, z] = chunk.coordinate;
    const material = chunk.waterMeshCount > 0 ? "Water" : chunk.blockCount > 2000 ? "Rock" : "TopSoil";
    return {
      x: x * 16 + 8,
      z: z * 16 + 8,
      height: y * 16 + clamp(Math.round(chunk.blockCount / 220), 2, 15),
      material,
      water: material === "Water",
    };
  });

export const collectSamples = (chunks: readonly ChunkSummary[], worldViewport: WorldViewportPreview | null): readonly WorldSurfaceSample[] => {
  const samples = worldViewport?.chunks.flatMap((chunk) => [...chunk.samples]) ?? [];
  if (samples.length === 0) {
    return fallbackSamplesFromChunks(chunks);
  }

  const byColumn = new Map<string, WorldSurfaceSample>();
  for (const sample of samples) {
    if (sample.material === "Air" && !sample.water) {
      continue;
    }

    const key = sampleGridKey(sample.x, sample.z);
    const current = byColumn.get(key);
    if (!current || sample.height > current.height) {
      byColumn.set(key, sample);
    }
  }

  const mergedSamples = [...byColumn.values()];
  return mergedSamples.length > 0 ? mergedSamples : fallbackSamplesFromChunks(chunks);
};

const buildSurfaceWallFaces = (
  samples: readonly WorldSurfaceSample[],
  cellSize: number,
  view: ViewState,
): readonly SurfaceWallFace[] => {
  if (samples.length === 0) {
    return [];
  }

  const byPosition = new Map(samples.map((sample) => [sampleGridKey(sample.x, sample.z), sample]));
  const faces: SurfaceWallFace[] = [];
  const isViewerFacingWallDirection = (dx: number, dz: number) => {
    const [rotatedX, rotatedZ] = rotateHorizontal(dx, dz, view.rotation);
    return rotatedX > 0 || rotatedZ > 0;
  };
  const addWall = (
    high: WorldSurfaceSample,
    low: WorldSurfaceSample,
    direction: readonly [number, number],
    highStart: readonly [number, number, number],
    highEnd: readonly [number, number, number],
    lowEnd: readonly [number, number, number],
    lowStart: readonly [number, number, number],
  ) => {
    if (high.height <= low.height || !isViewerFacingWallDirection(direction[0], direction[1])) {
      return;
    }

    const [rotatedX, rotatedZ] = rotateHorizontal(high.x, high.z, view.rotation);
    faces.push({
      points: [
        projectIso(highStart, view),
        projectIso(highEnd, view),
        projectIso(lowEnd, view),
        projectIso(lowStart, view),
      ],
      material: high.material,
      sortKey: rotatedX + rotatedZ + high.height - (high.height - low.height) * 0.5,
    });
  };

  for (const sample of samples) {
    const east = byPosition.get(sampleGridKey(sample.x + cellSize, sample.z));
    const south = byPosition.get(sampleGridKey(sample.x, sample.z + cellSize));

    if (east) {
      addWall(
        sample,
        east,
        [cellSize, 0],
        [sample.x + cellSize, sample.height, sample.z],
        [sample.x + cellSize, sample.height, sample.z + cellSize],
        [east.x, east.height, east.z + cellSize],
        [east.x, east.height, east.z],
      );
      addWall(
        east,
        sample,
        [-cellSize, 0],
        [east.x, east.height, east.z + cellSize],
        [east.x, east.height, east.z],
        [sample.x + cellSize, sample.height, sample.z],
        [sample.x + cellSize, sample.height, sample.z + cellSize],
      );
    }

    if (south) {
      addWall(
        sample,
        south,
        [0, cellSize],
        [sample.x + cellSize, sample.height, sample.z + cellSize],
        [sample.x, sample.height, sample.z + cellSize],
        [south.x, south.height, south.z],
        [south.x + cellSize, south.height, south.z],
      );
      addWall(
        south,
        sample,
        [0, -cellSize],
        [south.x, south.height, south.z],
        [south.x + cellSize, south.height, south.z],
        [sample.x + cellSize, sample.height, sample.z + cellSize],
        [sample.x, sample.height, sample.z + cellSize],
      );
    }
  }

  return faces.sort((left, right) => left.sortKey - right.sortKey);
};

const fitViewForSamples = (samples: readonly WorldSurfaceSample[], width: number, height: number, current: ViewState = DEFAULT_VIEW): ViewState => {
  if (samples.length === 0 || width <= 0 || height <= 0) {
    return viewWithCamera(DEFAULT_VIEW, {
      rotation: current.rotation,
      pitch: current.pitch,
      heightOffset: current.heightOffset,
    });
  }

  const iso = samples.map((sample) => {
    const [x, z] = rotateHorizontal(sample.x, sample.z, current.rotation);
    return {
      x: (x - z) * 0.72,
      y: (x + z) * 0.72 * current.pitch - (sample.height - current.heightOffset) * 1.35,
    };
  });
  const minX = Math.min(...iso.map((point) => point.x));
  const maxX = Math.max(...iso.map((point) => point.x));
  const minY = Math.min(...iso.map((point) => point.y));
  const maxY = Math.max(...iso.map((point) => point.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const zoom = clamp(Math.min((width * 0.7) / spanX, (height * 0.64) / spanY), 0.28, 4.4);

  return {
    zoom,
    offsetX: width / 2 - ((minX + maxX) / 2) * zoom,
    offsetY: height / 2 - ((minY + maxY) / 2) * zoom + height * 0.05,
    rotation: normalizeQuarterTurn(current.rotation),
    pitch: clamp(current.pitch, MIN_VIEW_PITCH, MAX_VIEW_PITCH),
    heightOffset: current.heightOffset,
  };
};

const drawDiamond = (ctx: CanvasRenderingContext2D, x: number, y: number, radiusX: number, radiusY: number, fill: string, stroke: string) => {
  ctx.beginPath();
  ctx.moveTo(x, y - radiusY);
  ctx.lineTo(x + radiusX, y);
  ctx.lineTo(x, y + radiusY);
  ctx.lineTo(x - radiusX, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
};

const tracePolygon = (ctx: CanvasRenderingContext2D, points: readonly ProjectedPoint[]) => {
  const [first, ...rest] = points;
  if (!first) {
    return false;
  }

  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const point of rest) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  return true;
};

const fillPolygon = (ctx: CanvasRenderingContext2D, points: readonly ProjectedPoint[], fill: string, stroke: string) => {
  if (!tracePolygon(ctx, points)) {
    return;
  }

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
};

const drawTexturedPolygon = (
  ctx: CanvasRenderingContext2D,
  atlasImage: HTMLImageElement,
  tileIndex: number,
  points: readonly ProjectedPoint[],
  stroke: string,
) => {
  const tileWidth = atlasImage.naturalWidth / ATLAS_COLUMNS;
  const tileHeight = atlasImage.naturalHeight / ATLAS_ROWS;
  if (!Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || tileWidth <= 0 || tileHeight <= 0) {
    return false;
  }

  const column = tileIndex % ATLAS_COLUMNS;
  const row = Math.floor(tileIndex / ATLAS_COLUMNS);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) {
    return false;
  }

  ctx.save();
  if (!tracePolygon(ctx, points)) {
    ctx.restore();
    return false;
  }
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlasImage,
    column * tileWidth,
    row * tileHeight,
    tileWidth,
    tileHeight,
    minX,
    minY,
    width,
    height,
  );
  ctx.restore();

  if (tracePolygon(ctx, points)) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  return true;
};

const drawSurfaceWallFace = (ctx: CanvasRenderingContext2D, face: SurfaceWallFace) => {
  const materialColor = MATERIAL_COLORS[face.material] ?? MATERIAL_COLORS.Rock;
  ctx.save();
  ctx.globalAlpha = 0.66;
  fillPolygon(ctx, face.points, materialColor, "rgba(8, 10, 14, 0.78)");
  ctx.restore();
};

const drawIsoSurfaceCell = (
  ctx: CanvasRenderingContext2D,
  sample: WorldSurfaceSample,
  atlasMapping: BlockAtlasMap,
  atlasImage: HTMLImageElement | null,
  cellSize: number,
  view: ViewState,
) => {
  const materialColor = MATERIAL_COLORS[sample.material] ?? MATERIAL_COLORS.Rock;
  const stroke = "rgba(11, 14, 20, 0.86)";
  const sideDepth = clamp(cellSize * 0.34 * view.zoom, 3 * view.zoom, 14 * view.zoom);
  const topNorth = projectIso([sample.x, sample.height, sample.z], view);
  const topEast = projectIso([sample.x + cellSize, sample.height, sample.z], view);
  const topSouth = projectIso([sample.x + cellSize, sample.height, sample.z + cellSize], view);
  const topWest = projectIso([sample.x, sample.height, sample.z + cellSize], view);
  const top: readonly ProjectedPoint[] = [
    topNorth,
    topEast,
    topSouth,
    topWest,
  ];
  const leftSide: readonly ProjectedPoint[] = [
    topWest,
    topSouth,
    { x: topSouth.x, y: topSouth.y + sideDepth },
    { x: topWest.x, y: topWest.y + sideDepth },
  ];
  const rightSide: readonly ProjectedPoint[] = [
    topEast,
    topSouth,
    { x: topSouth.x, y: topSouth.y + sideDepth },
    { x: topEast.x, y: topEast.y + sideDepth },
  ];

  fillPolygon(ctx, leftSide, "rgba(15, 18, 24, 0.44)", stroke);
  ctx.save();
  ctx.globalAlpha = 0.64;
  fillPolygon(ctx, leftSide, materialColor, stroke);
  ctx.globalAlpha = 0.52;
  fillPolygon(ctx, rightSide, materialColor, stroke);
  ctx.restore();

  const topTileIndex = atlasImage ? atlasTileIndexForSample(atlasMapping, sample.material, "top") : null;
  if (!(atlasImage && topTileIndex !== null && drawTexturedPolygon(ctx, atlasImage, topTileIndex, top, stroke))) {
    fillPolygon(ctx, top, materialColor, stroke);
  }
};

const projectIso = (position: readonly [number, number, number], view: ViewState) => {
  const [x, z] = rotateHorizontal(position[0], position[2], view.rotation);
  return {
    x: view.offsetX + (x - z) * 0.72 * view.zoom,
    y: view.offsetY + ((x + z) * 0.72 * view.pitch - (position[1] - view.heightOffset) * 1.35) * view.zoom,
  };
};

const normalizeAtlasTileId = (tileId: string) => LEGACY_ATLAS_TILE_IDS[tileId] ?? tileId;

const parseAtlasTileIndex = (tileId: string): number | null => {
  const match = /^tile-(\d+)$/.exec(normalizeAtlasTileId(tileId));
  if (!match) {
    return null;
  }

  const index = Number.parseInt(match[1], 10);
  return Number.isInteger(index) && index >= 0 && index < ATLAS_TILE_COUNT ? index : null;
};

const blockForViewportMaterial = (material: WorldSurfaceSample["material"]): BlockType | null => {
  switch (material) {
    case "TopSoil":
      return "grass";
    case "SubSoil":
      return "dirt";
    case "Sand":
      return "sand";
    case "Rock":
    case "Bedrock":
    case "Clay":
    case "DungeonWall":
    case "DungeonFloor":
      return "rock";
    default:
      return null;
  }
};

const atlasTileIndexForSample = (
  atlasMapping: BlockAtlasMap,
  material: WorldSurfaceSample["material"],
  face: keyof AtlasMapping = "top",
): number | null => {
  const block = blockForViewportMaterial(material);
  return block ? parseAtlasTileIndex(atlasMapping[block][face]) : null;
};

const chunkIdForVoxel = (position: readonly [number, number, number]) =>
  `chunk-${Math.floor(position[0] / 16)}-${Math.floor(position[1] / 16)}-${Math.floor(position[2] / 16)}`;

const pointsToSvg = (points: readonly ProjectedPoint[]) => points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

const buildChunkOverlayShapes = (
  chunks: readonly ChunkSummary[],
  selection: Selection,
  view: ViewState,
): readonly ChunkOverlayShape[] =>
  chunks.map((chunk) => {
    const [chunkX, chunkY, chunkZ] = chunk.coordinate;
    const minX = chunkX * 16;
    const minZ = chunkZ * 16;
    const maxX = minX + 16;
    const maxZ = minZ + 16;
    const y = chunkY * 16 + 1;

    return {
      id: chunk.id,
      label: chunk.label,
      points: [
        projectIso([minX, y, minZ], view),
        projectIso([maxX, y, minZ], view),
        projectIso([maxX, y, maxZ], view),
        projectIso([minX, y, maxZ], view),
      ],
      dirty: chunk.dirty || chunk.meshStatus === "dirty" || chunk.meshStatus === "queued",
      selected: selection.kind === "chunk" && selection.id === chunk.id,
    };
  });

const buildBrushPreviewShape = (
  brushSettings: BrushSettings,
  targetedVoxel: readonly [number, number, number],
  activeMode: EditorMode,
  view: ViewState,
): BrushPreviewShape | null => {
  if (activeMode !== "voxel_sculpt" && activeMode !== "voxel_paint") {
    return null;
  }

  const center = projectIso(targetedVoxel, view);
  const radius = clamp(brushSettings.radius * 5.4 * view.zoom, 8, 120);
  const invalid = targetedVoxel[1] <= 0;
  const affected: ProjectedPoint[] = [];
  const previewStep = Math.max(1, Math.round(brushSettings.radius / 3));

  for (let x = -previewStep; x <= previewStep; x += previewStep) {
    for (let z = -previewStep; z <= previewStep; z += previewStep) {
      const distance = Math.sqrt(x * x + z * z);
      if (brushSettings.brushShape === "sphere" && distance > previewStep * 1.35) {
        continue;
      }
      affected.push(projectIso([targetedVoxel[0] + x, targetedVoxel[1], targetedVoxel[2] + z], view));
    }
  }

  return { center, radius, invalid, affected };
};

const buildPropOverlayShapes = (
  props: readonly PropInstance[],
  selection: Selection,
  view: ViewState,
): readonly PropOverlayShape[] =>
  props.map((prop) => {
    const position = prop.transform.position ?? prop.position;
    const scale = prop.transform.scale[0] ?? 1;
    return {
      id: prop.id,
      label: prop.name,
      point: projectIso(position, view),
      radius: clamp((6 + scale * 8) * view.zoom, 5, 28),
      selected: selection.kind === "prop" && selection.id === prop.id,
    };
  });

const nearestPlacementSample = (
  samples: readonly WorldSurfaceSample[],
  view: ViewState,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): readonly [number, number, number] | null => {
  if (samples.length === 0) {
    return null;
  }

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let nearest = samples[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    const projected = projectIso([sample.x, sample.height, sample.z], view);
    const dx = projected.x - x;
    const dy = projected.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }

  return [nearest.x, nearest.height + 1, nearest.z];
};

const nearestVoxelSelection = (
  samples: readonly WorldSurfaceSample[],
  view: ViewState,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  targetFace: "top" | "side" | "bottom" | "all",
): LiteVoxelSelection | null => {
  if (samples.length === 0) {
    return null;
  }

  const position = nearestPlacementSample(samples, view, clientX, clientY, rect);
  if (!position) {
    return null;
  }

  const voxelPosition: [number, number, number] = [
    Math.round(position[0]),
    Math.max(0, Math.round(position[1] - 1)),
    Math.round(position[2]),
  ];
  const face = targetFace === "all" ? "top" : targetFace;

  return {
    position: voxelPosition,
    chunkId: chunkIdForVoxel(voxelPosition),
    face,
  };
};

const drawMeshBuffer = (ctx: CanvasRenderingContext2D, mesh: ViewportMeshBuffer, view: ViewState, fill: string, stroke: string) => {
  if (!mesh.positions || !mesh.indices || mesh.indices.length < 3) {
    return false;
  }

  ctx.save();
  ctx.lineWidth = Math.max(0.5, 0.8 * view.zoom);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;

  const triangleLimit = Math.min(mesh.indices.length - (mesh.indices.length % 3), 18000);
  for (let index = 0; index < triangleLimit; index += 3) {
    const a = mesh.positions[mesh.indices[index]];
    const b = mesh.positions[mesh.indices[index + 1]];
    const c = mesh.positions[mesh.indices[index + 2]];
    if (!a || !b || !c) {
      continue;
    }

    const pa = projectIso(a, view);
    const pb = projectIso(b, view);
    const pc = projectIso(c, view);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.lineTo(pc.x, pc.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
  return true;
};

export const drawGameCameraPreview = (
  ctx: CanvasRenderingContext2D,
  samples: readonly WorldSurfaceSample[],
  camera: GameCameraState,
  cellSize: number,
  width: number,
  height: number,
) => {
  ctx.clearRect(0, 0, width, height);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#182636");
  sky.addColorStop(0.55, "#101821");
  sky.addColorStop(1, "#0a0d12");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const horizon = height * 0.48;
  ctx.fillStyle = "rgba(5, 7, 10, 0.52)";
  ctx.fillRect(0, horizon, width, height - horizon);

  const sampleMap = new Map(samples.map((sample) => [sampleGridKey(sample.x, sample.z), sample]));
  const forwardX = Math.cos(camera.yaw);
  const forwardZ = Math.sin(camera.yaw);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const focal = width * 0.74;
  const drawItems = samples
    .map((sample) => {
      const dx = sample.x + cellSize * 0.5 - camera.position[0];
      const dz = sample.z + cellSize * 0.5 - camera.position[2];
      const depth = dx * forwardX + dz * forwardZ;
      if (depth <= 2 || depth > 160) {
        return null;
      }
      const lateral = dx * rightX + dz * rightZ;
      const screenX = width * 0.5 + (lateral / depth) * focal;
      const size = clamp((cellSize / depth) * focal, 2, 52);
      if (screenX < -size || screenX > width + size) {
        return null;
      }

      const neighbors = [
        sampleMap.get(sampleGridKey(sample.x + cellSize, sample.z)),
        sampleMap.get(sampleGridKey(sample.x - cellSize, sample.z)),
        sampleMap.get(sampleGridKey(sample.x, sample.z + cellSize)),
        sampleMap.get(sampleGridKey(sample.x, sample.z - cellSize)),
      ].filter((neighbor): neighbor is WorldSurfaceSample => Boolean(neighbor));
      const baseHeight = Math.min(sample.height - 1, ...neighbors.map((neighbor) => neighbor.height));
      const topY = horizon + ((camera.position[1] - sample.height) / depth) * focal * 0.62;
      const bottomY = horizon + ((camera.position[1] - baseHeight) / depth) * focal * 0.62;
      return { sample, depth, screenX, size, topY, bottomY };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.depth - left.depth);

  for (const item of drawItems) {
    const materialColor = MATERIAL_COLORS[item.sample.material] ?? MATERIAL_COLORS.Rock;
    const half = item.size * 0.5;
    const topHeight = item.size * 0.24;
    const bottomY = Math.max(item.topY + 2, item.bottomY);

    ctx.fillStyle = item.sample.water ? "rgba(74, 184, 234, 0.7)" : materialColor;
    ctx.strokeStyle = "rgba(4, 6, 10, 0.78)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(item.screenX - half, item.topY, item.size, bottomY - item.topY);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = item.sample.water ? 0.72 : 1;
    ctx.beginPath();
    ctx.moveTo(item.screenX, item.topY - topHeight);
    ctx.lineTo(item.screenX + half, item.topY);
    ctx.lineTo(item.screenX, item.topY + topHeight);
    ctx.lineTo(item.screenX - half, item.topY);
    ctx.closePath();
    ctx.fillStyle = item.sample.water ? "#65c7ff" : materialColor;
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.beginPath();
  ctx.moveTo(width * 0.5 - 10, height * 0.5);
  ctx.lineTo(width * 0.5 + 10, height * 0.5);
  ctx.moveTo(width * 0.5, height * 0.5 - 10);
  ctx.lineTo(width * 0.5, height * 0.5 + 10);
  ctx.stroke();
};

export const LiteVoxelViewport = Object.assign(
  function LiteVoxelViewport({
    chunks,
    props,
    worldViewport,
    viewportSnapshot,
    atlasMapping,
    runtimeState,
    activeMode,
    brushSettings,
    selection,
    targetedVoxel,
    viewportOverlays,
    propPlacementEnabled = false,
    onPlaceProp,
    onSelectVoxel,
    onSetVoxel,
    onToggleChunkBounds,
    selectedPropRotationY,
    selectedPropUniformScale,
    propRotateDragModifier = "shift",
    propFineScaleModifier = "alt",
    propRotationSensitivity = 0.45,
    propRotationSnapDegrees = 5,
    propScaleStep = 0.1,
    propScaleMin = 0.25,
    propScaleMax = 4,
    onAdjustSelectedProp,
  }: LiteVoxelViewportProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameCameraCanvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<CanvasDragState | null>(null);
    const suppressClickRef = useRef(false);
    const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
    const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
    const [cameraSlots, setCameraSlots] = useState<ReadonlyArray<ViewState | null>>([null, null, null]);
    const [keysPanelOpen, setKeysPanelOpen] = useState(false);
    const [keyBindings, setKeyBindings] = useState<ViewportKeyBindings>(DEFAULT_VIEWPORT_KEY_BINDINGS);
    const [gameCameraEnabled, setGameCameraEnabled] = useState(false);
    const [gameCameraPlacementArmed, setGameCameraPlacementArmed] = useState(false);
    const [gameCamera, setGameCamera] = useState<GameCameraState | null>(null);
    const [hoveredVoxel, setHoveredVoxel] = useState<LiteVoxelSelection | null>(null);
    const [pendingVoxelEdits, setPendingVoxelEdits] = useState<readonly PendingVoxelEdit[]>([]);
    const [atlasImage, setAtlasImage] = useState<HTMLImageElement | null>(null);
    const samples = useMemo(() => collectSamples(chunks, worldViewport), [chunks, worldViewport]);
    const viewportChunkSize = viewportSnapshot?.chunkSize ?? worldViewport?.chunkSize ?? 16;
    const sampleCellSize = useMemo(() => {
      const sampleResolution = viewportSnapshot?.sampleResolution ?? worldViewport?.sampleResolution ?? 1;
      return sampleResolution > 0 ? viewportChunkSize / sampleResolution : viewportChunkSize;
    }, [viewportChunkSize, viewportSnapshot, worldViewport]);
    const hasBackendPreview = Boolean(worldViewport && worldViewport.chunks.length > 0);
    const meshChunks = useMemo(() => viewportSnapshot?.chunks.filter((chunk) => chunk.mesh.included) ?? [], [viewportSnapshot]);
    const hasRenderableMesh = meshChunks.some((chunk) => Boolean(chunk.mesh.terrain.positions?.length || chunk.mesh.water.positions?.length));
    const meshBackedColumns = useMemo(() => {
      const columns = new Set<string>();
      for (const chunk of meshChunks) {
        if (chunk.mesh.terrain.positions?.length || chunk.mesh.water.positions?.length) {
          columns.add(`${chunk.coordinate[0]}:${chunk.coordinate[2]}`);
        }
      }
      return columns;
    }, [meshChunks]);
    const visibleSamples = useMemo(() => {
      if (!hasRenderableMesh || meshBackedColumns.size === 0) {
        return samples;
      }

      return samples.filter((sample) => {
        return !meshBackedColumns.has(sampleColumnKey(sample, viewportChunkSize));
      });
    }, [hasRenderableMesh, meshBackedColumns, samples, viewportChunkSize]);
    const visibleSurfaceWallFaces = useMemo(
      () => buildSurfaceWallFaces(visibleSamples, sampleCellSize, view),
      [sampleCellSize, view, visibleSamples],
    );
    const atlasPreviewEnabled = viewportOverlays.atlasPreview || activeMode === "voxel_paint" || activeMode === "material";
    const waterSampleCount = samples.filter((sample) => sample.water).length;
    const chunkOverlayShapes = useMemo(() => buildChunkOverlayShapes(chunks, selection, view), [chunks, selection, view]);
    const brushPreviewShape = useMemo(() => buildBrushPreviewShape(brushSettings, targetedVoxel, activeMode, view), [activeMode, brushSettings, targetedVoxel, view]);
    const propOverlayShapes = useMemo(() => buildPropOverlayShapes(props, selection, view), [props, selection, view]);
    const selectedVoxelPoint = selection.kind === "voxel" ? projectIso(selection.position, view) : null;
    const hoveredVoxelPoint = hoveredVoxel ? projectIso(hoveredVoxel.position, view) : null;

    const updateKeyBinding = useCallback((action: ViewportKeyAction, nextKey: string) => {
      setKeyBindings((current) => {
        const next = normalizeKeyboardKey(nextKey);
        const previous = current[action];
        const conflictingAction = VIEWPORT_BINDING_LABELS.find((binding) => binding.action !== action && current[binding.action] === next)?.action;
        return {
          ...current,
          ...(conflictingAction ? { [conflictingAction]: previous } : {}),
          [action]: next,
        };
      });
    }, []);

    const placeGameCamera = useCallback(
      (position: readonly [number, number, number]) => {
        setGameCamera({
          position: [position[0], position[1] + 1.7, position[2]],
          yaw: gameYawForView(view),
        });
        setGameCameraEnabled(true);
        setGameCameraPlacementArmed(false);
      },
      [view],
    );

    const placeGameCameraAtTarget = useCallback(() => {
      const target = hoveredVoxel?.position ?? targetedVoxel;
      placeGameCamera([target[0], target[1], target[2]]);
    }, [hoveredVoxel, placeGameCamera, targetedVoxel]);

    const queueVoxelEdit = useCallback(
      async (voxelSelection: LiteVoxelSelection) => {
        if (!onSetVoxel) {
          return;
        }

        const block = brushSettings.materialBlockId;
        const editId = `voxel-edit-${Date.now()}-${voxelSelection.position.join("-")}`;
        setPendingVoxelEdits((current) => [
          ...current,
          {
            id: editId,
            position: voxelSelection.position,
            block,
            status: "pending",
          },
        ]);

        let result: LiteVoxelEditResponse;
        try {
          result = await onSetVoxel({ ...voxelSelection, block });
        } catch (error) {
          result = { ok: false, message: error instanceof Error ? error.message : "runtime edit failed" };
        }
        setPendingVoxelEdits((current) =>
          current.map((edit) =>
            edit.id === editId
              ? {
                  ...edit,
                  status: result.ok ? "applied" : "rejected",
                  message: result.message,
                }
              : edit,
          ),
        );
        window.setTimeout(() => {
          setPendingVoxelEdits((current) => current.filter((edit) => edit.id !== editId));
        }, result.ok ? 900 : 2200);
      },
      [brushSettings.materialBlockId, onSetVoxel],
    );

    const fitView = useCallback(() => {
      setView((current) => fitViewForSamples(samples, canvasSize.width, canvasSize.height, current));
    }, [canvasSize.height, canvasSize.width, samples]);

    const publishDetachedGameCameraSnapshot = useCallback(
      (camera: GameCameraState) => {
        const snapshot: DetachedGameCameraSnapshot = {
          camera,
          samples,
          cellSize: sampleCellSize,
          updatedAt: Date.now(),
        };

        try {
          window.localStorage.setItem(DETACHED_GAME_CAMERA_STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
          // Detached preview is best-effort; the inline preview still works without storage.
        }

        if ("BroadcastChannel" in window) {
          const channel = new BroadcastChannel(DETACHED_GAME_CAMERA_CHANNEL);
          channel.postMessage(snapshot);
          channel.close();
        }
      },
      [sampleCellSize, samples],
    );

    const openDetachedGameCamera = useCallback(async () => {
      setGameCameraEnabled(true);

      if (gameCamera) {
        publishDetachedGameCameraSnapshot(gameCamera);
      }

      const url = new URL(window.location.href);
      url.searchParams.set("window", "game-camera");
      url.hash = "";

      const isTauriDesktop = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
      if (isTauriDesktop) {
        try {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const existingWindow = await WebviewWindow.getByLabel(DETACHED_GAME_CAMERA_WINDOW_LABEL);
          if (existingWindow) {
            await existingWindow.setFocus();
            return;
          }

          const detachedWindow = new WebviewWindow(DETACHED_GAME_CAMERA_WINDOW_LABEL, {
            url: `${url.pathname}${url.search}`,
            title: "Game Camera",
            width: 640,
            height: 360,
            minWidth: 360,
            minHeight: 220,
            resizable: true,
            focus: true,
            center: true,
          });
          void detachedWindow.once("tauri://error", () => {
            window.open(url.toString(), DETACHED_GAME_CAMERA_WINDOW_LABEL, "popup,width=640,height=360,resizable=yes");
          });
          return;
        } catch {
          // Browser fallback below also covers test runs.
        }
      }

      window.open(url.toString(), DETACHED_GAME_CAMERA_WINDOW_LABEL, "popup,width=640,height=360,resizable=yes");
    }, [gameCamera, publishDetachedGameCameraSnapshot]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const host = canvas?.parentElement;
      if (!host) {
        return;
      }

      const observer = new ResizeObserver(([entry]) => {
        const rect = entry.contentRect;
        setCanvasSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
      });
      observer.observe(host);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      setView((current) => fitViewForSamples(samples, canvasSize.width, canvasSize.height, current));
    }, [canvasSize.height, canvasSize.width, samples]);

    useEffect(() => {
      let cancelled = false;
      let nextUrlIndex = 0;

      const loadNextAtlasUrl = () => {
        if (!cancelled) {
          const image = new Image();
          image.onload = () => {
            if (!cancelled) {
              setAtlasImage(image);
            }
          };
          image.onerror = () => {
            nextUrlIndex += 1;
            if (nextUrlIndex < ATLAS_IMAGE_URLS.length) {
              loadNextAtlasUrl();
            } else if (!cancelled) {
              setAtlasImage(null);
            }
          };
          image.src = ATLAS_IMAGE_URLS[nextUrlIndex];
        }
      };

      loadNextAtlasUrl();

      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(canvasSize.width * dpr));
      canvas.height = Math.max(1, Math.floor(canvasSize.height * dpr));
      canvas.style.width = `${canvasSize.width}px`;
      canvas.style.height = `${canvasSize.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
      const gradient = ctx.createLinearGradient(0, 0, 0, canvasSize.height);
      gradient.addColorStop(0, "#151821");
      gradient.addColorStop(0.58, "#101218");
      gradient.addColorStop(1, "#0b0d12");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

      ctx.save();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.28;
      for (let line = -40; line < 80; line += 1) {
        const startX = view.offsetX + line * 26 * view.zoom;
        ctx.strokeStyle = line % 8 === 0 ? "#4a5361" : "#29303a";
        ctx.beginPath();
        ctx.moveTo(startX - 900 * view.zoom, view.offsetY - 280 * view.zoom);
        ctx.lineTo(startX + 900 * view.zoom, view.offsetY + 620 * view.zoom);
        ctx.stroke();
      }
      ctx.restore();

      for (const chunk of meshChunks) {
        drawMeshBuffer(ctx, chunk.mesh.terrain, view, "rgba(92, 101, 111, 0.28)", "rgba(15, 18, 24, 0.34)");
        drawMeshBuffer(ctx, chunk.mesh.water, view, "rgba(55, 159, 220, 0.32)", "rgba(157, 221, 255, 0.42)");
      }

      const orderedSamples = [...visibleSamples].sort((left, right) => {
        const [leftX, leftZ] = rotateHorizontal(left.x, left.z, view.rotation);
        const [rightX, rightZ] = rotateHorizontal(right.x, right.z, view.rotation);
        return leftX + leftZ + left.height - (rightX + rightZ + right.height);
      });
      for (const face of visibleSurfaceWallFaces) {
        drawSurfaceWallFace(ctx, face);
      }
      for (const sample of orderedSamples) {
        const { x: screenX, y: screenY } = projectIso([sample.x, sample.height, sample.z], view);
        const radiusX = sampleCellSize * 0.72 * view.zoom;
        const radiusY = sampleCellSize * 0.36 * view.zoom;
        const materialColor = MATERIAL_COLORS[sample.material] ?? MATERIAL_COLORS.Rock;
        const stroke = sample.water ? "rgba(157, 221, 255, 0.75)" : "rgba(11, 14, 20, 0.85)";

        if (!sample.water) {
          drawIsoSurfaceCell(ctx, sample, atlasMapping, atlasImage, sampleCellSize, view);
        } else {
          drawDiamond(ctx, screenX, screenY, radiusX, radiusY, materialColor, stroke);
          ctx.globalAlpha = 0.45;
          drawDiamond(ctx, screenX, screenY - 1.5 * view.zoom, radiusX * 0.82, radiusY * 0.72, "#65c7ff", "rgba(187, 237, 255, 0.8)");
          ctx.globalAlpha = 1;
        }
      }

      if (samples.length === 0) {
        ctx.fillStyle = "#d5d9e2";
        ctx.font = "12px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No world chunks loaded", canvasSize.width / 2, canvasSize.height / 2);
      }
    }, [atlasImage, atlasMapping, atlasPreviewEnabled, canvasSize.height, canvasSize.width, meshChunks, sampleCellSize, samples.length, view, visibleSamples, visibleSurfaceWallFaces]);

    useEffect(() => {
      const canvas = gameCameraCanvasRef.current;
      if (!canvas || !gameCameraEnabled || !gameCamera) {
        return;
      }

      const width = 320;
      const height = 180;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGameCameraPreview(ctx, samples, gameCamera, sampleCellSize, width, height);
    }, [gameCamera, gameCameraEnabled, sampleCellSize, samples]);

    useEffect(() => {
      if (!gameCamera) {
        return;
      }

      publishDetachedGameCameraSnapshot(gameCamera);
    }, [gameCamera, publishDetachedGameCameraSnapshot]);

    useEffect(() => {
      if (!keysPanelOpen) {
        return;
      }

      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") {
          return;
        }

        event.preventDefault();
        setKeysPanelOpen(false);
      };

      document.addEventListener("keydown", closeOnEscape, true);
      return () => document.removeEventListener("keydown", closeOnEscape, true);
    }, [keysPanelOpen]);

    return (
      <>
        <canvas
          ref={canvasRef}
          className="world-viewport-canvas"
          data-testid="world-viewport-canvas"
          data-atlas-preview-enabled={String(atlasPreviewEnabled)}
          data-renderable-mesh={String(hasRenderableMesh)}
          data-surface-preview-mode={hasRenderableMesh ? "mesh-filtered" : "sampled"}
          data-visible-surface-samples={visibleSamples.length}
          data-visible-surface-walls={visibleSurfaceWallFaces.length}
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            suppressClickRef.current = false;
            if (
              propPlacementEnabled &&
              onAdjustSelectedProp &&
              selectedPropRotationY !== undefined &&
              modifierMatches(event, propRotateDragModifier)
            ) {
              event.preventDefault();
              dragRef.current = { kind: "prop-rotate", x: event.clientX, startRotationY: selectedPropRotationY };
              return;
            }

            if (event.button === 1 || event.button === 2 || event.altKey || event.ctrlKey) {
              event.preventDefault();
              dragRef.current = { kind: "orbit", x: event.clientX, y: event.clientY, view };
              return;
            }

            dragRef.current = { kind: "pan", x: event.clientX, y: event.clientY, view };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            const voxelSelection = nearestVoxelSelection(samples, view, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), brushSettings.targetFace);
            setHoveredVoxel(voxelSelection);
            if (!drag) {
              return;
            }
            const dragDistance = drag.kind === "pan"
              ? Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y)
              : Math.abs(event.clientX - drag.x);
            if (dragDistance > 4) {
              suppressClickRef.current = true;
            }
            if (drag.kind === "prop-rotate") {
              event.preventDefault();
              const rawRotation = drag.startRotationY + (event.clientX - drag.x) * propRotationSensitivity;
              const snappedRotation =
                propRotationSnapDegrees > 0 ? Math.round(rawRotation / propRotationSnapDegrees) * propRotationSnapDegrees : rawRotation;
              onAdjustSelectedProp?.({ rotationY: normalizeDegrees(snappedRotation) });
              return;
            }
            if (drag.kind === "orbit") {
              event.preventDefault();
              setView(
                viewWithCamera(drag.view, {
                  rotation: drag.view.rotation + (event.clientX - drag.x) / 180,
                  pitch: drag.view.pitch + (event.clientY - drag.y) / 360,
                }),
              );
              return;
            }

            setView({ ...drag.view, offsetX: drag.view.offsetX + event.clientX - drag.x, offsetY: drag.view.offsetY + event.clientY - drag.y });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setHoveredVoxel(null);
          }}
          onPointerLeave={() => {
            dragRef.current = null;
            setHoveredVoxel(null);
          }}
          onWheel={(event) => {
            event.preventDefault();
            if (propPlacementEnabled && onAdjustSelectedProp && selectedPropUniformScale !== undefined) {
              const direction = event.deltaY < 0 ? 1 : -1;
              const fineMultiplier = propFineScaleModifier !== "none" && modifierMatches(event, propFineScaleModifier) ? 0.25 : 1;
              const nextScale = clamp(selectedPropUniformScale + direction * propScaleStep * fineMultiplier, propScaleMin, propScaleMax);
              onAdjustSelectedProp({ uniformScale: nextScale });
              return;
            }

            if (event.altKey) {
              const direction = event.deltaY < 0 ? 1 : -1;
              setView((current) => viewWithCamera(current, { heightOffset: current.heightOffset + direction * VIEW_HEIGHT_STEP }));
              return;
            }

            if (event.ctrlKey) {
              const direction = event.deltaY < 0 ? 1 : -1;
              setView((current) => viewWithCamera(current, { pitch: current.pitch + direction * 0.04 }));
              return;
            }

            const zoomMultiplier = event.deltaY < 0 ? 1.1 : 0.9;
            const nextZoom = clamp(view.zoom * zoomMultiplier, 0.18, 8);
            setView({ ...view, zoom: nextZoom });
          }}
          onDoubleClick={(event) => {
            if (!propPlacementEnabled || !onPlaceProp) {
              return;
            }

            const position = nearestPlacementSample(samples, view, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
            if (position) {
              onPlaceProp(position);
            }
          }}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            if (propPlacementEnabled) {
              return;
            }

            const voxelSelection = nearestVoxelSelection(samples, view, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), brushSettings.targetFace);
            if (!voxelSelection) {
              return;
            }

            if (gameCameraPlacementArmed) {
              placeGameCamera(voxelSelection.position);
              return;
            }

            onSelectVoxel?.(voxelSelection);
            if (activeMode === "voxel_paint" || activeMode === "voxel_sculpt") {
              void queueVoxelEdit(voxelSelection);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && keysPanelOpen) {
              event.preventDefault();
              setKeysPanelOpen(false);
              return;
            }

            const key = normalizeKeyboardKey(event.key);
            if (event.key === "Home" || key === keyBindings.fit) {
              event.preventDefault();
              fitView();
              return;
            }
            if (key === keyBindings.zoomIn) {
              event.preventDefault();
              setView((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, 0.18, 8) }));
              return;
            }
            if (key === keyBindings.zoomOut) {
              event.preventDefault();
              setView((current) => ({ ...current, zoom: clamp(current.zoom * 0.85, 0.18, 8) }));
              return;
            }
            const panStep = event.altKey ? 18 : event.shiftKey ? 96 : 48;
            const rotateStep = event.shiftKey ? 0.5 : 1 / 6;
            const tiltStep = event.shiftKey ? 0.12 : 0.04;
            const digitSlotMatch = /^digit([1-3])$/.exec(event.code.toLowerCase());
            if (event.ctrlKey && digitSlotMatch) {
              event.preventDefault();
              const slotIndex = Number.parseInt(digitSlotMatch[1], 10) - 1;
              setCameraSlots((current) => current.map((slot, index) => (index === slotIndex ? view : slot)));
              return;
            }
            if (!event.ctrlKey && !event.metaKey && digitSlotMatch) {
              const slotIndex = Number.parseInt(digitSlotMatch[1], 10) - 1;
              const slot = cameraSlots[slotIndex];
              if (slot) {
                event.preventDefault();
                setView(slot);
                return;
              }
            }
            if (event.ctrlKey && (key === "arrowleft" || key === "arrowright")) {
              event.preventDefault();
              const direction = key === "arrowleft" ? -1 : 1;
              setView((current) => viewWithCamera(current, { rotation: current.rotation + direction * rotateStep }));
              return;
            }
            if (event.ctrlKey && (key === "arrowup" || key === "arrowdown")) {
              event.preventDefault();
              const direction = key === "arrowup" ? -1 : 1;
              setView((current) => viewWithCamera(current, { pitch: current.pitch + direction * tiltStep }));
              return;
            }
            if (event.altKey && (key === "arrowup" || key === "arrowdown")) {
              event.preventDefault();
              const direction = key === "arrowup" ? 1 : -1;
              setView((current) => viewWithCamera(current, { heightOffset: current.heightOffset + direction * VIEW_HEIGHT_STEP }));
              return;
            }
            const panByKey: Record<string, readonly [number, number]> = {
              arrowup: [0, panStep],
              arrowdown: [0, -panStep],
              arrowleft: [panStep, 0],
              arrowright: [-panStep, 0],
              [keyBindings.panForward]: [0, panStep],
              [keyBindings.panBackward]: [0, -panStep],
              [keyBindings.panLeft]: [panStep, 0],
              [keyBindings.panRight]: [-panStep, 0],
            };
            const pan = panByKey[key];
            if (pan && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              setView((current) => ({ ...current, offsetX: current.offsetX + pan[0], offsetY: current.offsetY + pan[1] }));
              return;
            }
            if ((key === keyBindings.orbitLeft || key === keyBindings.orbitRight) && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              const direction = key === keyBindings.orbitLeft ? -1 : 1;
              setView((current) => viewWithCamera(current, { rotation: current.rotation + direction * rotateStep }));
              return;
            }
            if ((key === keyBindings.tiltDown || key === keyBindings.tiltUp) && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              const direction = key === keyBindings.tiltDown ? -1 : 1;
              setView((current) => viewWithCamera(current, { pitch: current.pitch + direction * tiltStep }));
              return;
            }
            if ((key === keyBindings.reset) && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              setView((current) => fitViewForSamples(samples, canvasSize.width, canvasSize.height, { ...DEFAULT_VIEW, rotation: current.rotation }));
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
        />

        {viewportOverlays.voxelGrid ? <div className="lite-viewport-grid-overlay" aria-hidden="true" data-testid="viewport-voxel-grid-overlay" /> : null}

        {viewportOverlays.wireframe ? <div className="lite-viewport-wire-overlay" aria-hidden="true" data-testid="viewport-wireframe-overlay" /> : null}

        <svg
          className="lite-viewport-authoring-overlay"
          data-testid="lite-viewport-authoring-overlay"
          data-chunk-bounds-visible={String(viewportOverlays.chunkBounds)}
          aria-hidden="true"
        >
          {viewportOverlays.chunkBounds &&
            chunkOverlayShapes.map((shape) => (
              <g key={shape.id} data-testid={`viewport-chunk-overlay-${shape.id}`}>
                {shape.dirty ? (
                  <polygon className="lite-viewport-dirty-chunk" points={pointsToSvg(shape.points)} />
                ) : null}
                <polygon className={shape.selected ? "lite-viewport-selected-chunk" : "lite-viewport-chunk-bound"} points={pointsToSvg(shape.points)} />
              </g>
            ))}

          {selectedVoxelPoint ? (
            <g data-testid="viewport-selected-voxel-overlay">
              <circle className="lite-viewport-selected-voxel-ring" cx={selectedVoxelPoint.x} cy={selectedVoxelPoint.y} r={9 * view.zoom} />
              <circle className="lite-viewport-selected-voxel-dot" cx={selectedVoxelPoint.x} cy={selectedVoxelPoint.y} r={2.5} />
            </g>
          ) : null}

          {hoveredVoxelPoint ? (
            <g data-testid="viewport-hovered-voxel-overlay">
              <circle className="lite-viewport-hovered-voxel-ring" cx={hoveredVoxelPoint.x} cy={hoveredVoxelPoint.y} r={7 * view.zoom} />
              <line className="lite-viewport-hovered-voxel-face" x1={hoveredVoxelPoint.x - 8} y1={hoveredVoxelPoint.y} x2={hoveredVoxelPoint.x + 8} y2={hoveredVoxelPoint.y} />
              <line className="lite-viewport-hovered-voxel-face" x1={hoveredVoxelPoint.x} y1={hoveredVoxelPoint.y - 8} x2={hoveredVoxelPoint.x} y2={hoveredVoxelPoint.y + 8} />
            </g>
          ) : null}

          {pendingVoxelEdits.map((edit) => {
            const point = projectIso(edit.position, view);
            return (
              <g key={edit.id} data-testid={`viewport-optimistic-voxel-${edit.status}`}>
                <circle className={`lite-viewport-optimistic-voxel lite-viewport-optimistic-voxel-${edit.status}`} cx={point.x} cy={point.y} r={10 * view.zoom} />
                {edit.status === "rejected" ? <text className="lite-viewport-edit-rejection-label" x={point.x + 12} y={point.y - 12}>{edit.message ?? "rejected"}</text> : null}
              </g>
            );
          })}

          {(viewportOverlays.propBounds || propOverlayShapes.some((shape) => shape.selected)) &&
            propOverlayShapes.map((shape) => (
              <g key={shape.id} data-testid={`viewport-prop-bound-overlay-${shape.id}`}>
                <circle className={shape.selected ? "lite-viewport-selected-prop-bound" : "lite-viewport-prop-bound"} cx={shape.point.x} cy={shape.point.y} r={shape.radius} />
                {shape.selected ? <circle className="lite-viewport-selected-prop-dot" cx={shape.point.x} cy={shape.point.y} r={2.5} /> : null}
              </g>
            ))}

          {brushPreviewShape ? (
            <g data-testid="viewport-brush-preview-overlay">
              {brushPreviewShape.invalid ? (
                <circle className="lite-viewport-invalid-target" cx={brushPreviewShape.center.x} cy={brushPreviewShape.center.y} r={brushPreviewShape.radius} />
              ) : null}
              {brushPreviewShape.affected.map((point, index) => (
                <circle key={`${point.x}-${point.y}-${index}`} className="lite-viewport-affected-voxel" cx={point.x} cy={point.y} r={2.4} />
              ))}
              <circle className="lite-viewport-brush-radius" cx={brushPreviewShape.center.x} cy={brushPreviewShape.center.y} r={brushPreviewShape.radius} />
              <circle className="lite-viewport-brush-center" cx={brushPreviewShape.center.x} cy={brushPreviewShape.center.y} r={3.2} />
            </g>
          ) : null}
        </svg>

        <div className="viewport-canvas-controls" aria-label="Viewport controls">
          <button type="button" className="icon-button" title="Fit loaded world" aria-label="Fit loaded world" onClick={fitView}>
            <Maximize2 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Orbit left"
            aria-label="Orbit left"
            onClick={() => setView((current) => viewWithCamera(current, { rotation: current.rotation - 1 / 6 }))}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Orbit right"
            aria-label="Orbit right"
            onClick={() => setView((current) => viewWithCamera(current, { rotation: current.rotation + 1 / 6 }))}
          >
            <RotateCw size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => setView((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, 0.18, 8) }))}>
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => setView((current) => ({ ...current, zoom: clamp(current.zoom * 0.85, 0.18, 8) }))}>
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-button ${gameCameraEnabled ? "icon-button-active" : ""}`}
            title="Toggle game camera preview"
            aria-label="Toggle game camera preview"
            aria-pressed={gameCameraEnabled}
            data-testid="viewport-game-camera-toggle"
            onClick={() => {
              if (!gameCamera) {
                placeGameCameraAtTarget();
                return;
              }
              setGameCameraEnabled((enabled) => !enabled);
            }}
          >
            <Camera size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`viewport-keys-badge ${keysPanelOpen ? "viewport-keys-badge-active" : ""}`}
            aria-expanded={keysPanelOpen}
            aria-controls="viewport-key-bindings-panel"
            onClick={() => setKeysPanelOpen((open) => !open)}
          >
            Keys
          </button>
        </div>

        {keysPanelOpen ? (
          <section
            id="viewport-key-bindings-panel"
            className="viewport-key-bindings-panel"
            aria-label="Author viewport key bindings"
            data-testid="viewport-key-bindings-panel"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setKeysPanelOpen(false);
              }
            }}
          >
            <div className="viewport-key-bindings-header">
              <strong>Author Keys</strong>
              <button type="button" className="viewport-key-reset" onClick={() => setKeyBindings(DEFAULT_VIEWPORT_KEY_BINDINGS)}>
                Reset
              </button>
            </div>
            <div className="viewport-key-bindings-list">
              {VIEWPORT_BINDING_LABELS.map((binding) => (
                <label key={binding.action} className="viewport-key-binding-row">
                  <span>{binding.label}</span>
                  <select value={keyBindings[binding.action]} onChange={(event) => updateKeyBinding(binding.action, event.target.value)}>
                    {VIEWPORT_KEY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="viewport-fixed-bindings">
              <span>Alt/Ctrl drag: orbit + tilt</span>
              <span>Alt wheel: vertical offset</span>
              <span>Ctrl + 1/2/3: save view</span>
              <span>1/2/3: recall view</span>
            </div>
          </section>
        ) : null}

        {onToggleChunkBounds ? (
          <div className={`viewport-chunk-bounds-badge ${viewportOverlays.chunkBounds ? "viewport-chunk-bounds-badge-active" : ""}`} data-testid="viewport-chunk-bounds-badge">
            <span className="viewport-chunk-bounds-swatch" aria-hidden="true" />
            <span>{viewportOverlays.chunkBounds ? "Chunk bounds" : "Bounds hidden"}</span>
            <button
              type="button"
              className="icon-button viewport-chunk-bounds-toggle"
              title={viewportOverlays.chunkBounds ? "Hide chunk bounds" : "Show chunk bounds"}
              aria-label={viewportOverlays.chunkBounds ? "Hide chunk bounds" : "Show chunk bounds"}
              data-testid="viewport-chunk-bounds-badge-toggle"
              onClick={onToggleChunkBounds}
            >
              {viewportOverlays.chunkBounds ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
            </button>
          </div>
        ) : null}

        {gameCameraEnabled ? (
          <section className="viewport-game-camera-preview" data-testid="viewport-game-camera-preview" aria-label="Game camera voxel preview">
            <div className="viewport-game-camera-header">
              <strong>Game Camera</strong>
              <div className="viewport-game-camera-actions">
                <button
                  type="button"
                  className={gameCameraPlacementArmed ? "viewport-game-camera-action viewport-game-camera-action-active" : "viewport-game-camera-action"}
                  data-testid="viewport-game-camera-place"
                  onClick={() => setGameCameraPlacementArmed((armed) => !armed)}
                >
                  {gameCameraPlacementArmed ? "Click map" : "Place"}
                </button>
                <button type="button" className="viewport-game-camera-action" onClick={placeGameCameraAtTarget}>
                  Target
                </button>
                <button
                  type="button"
                  className="viewport-game-camera-action"
                  data-testid="viewport-game-camera-detach"
                  title="Open game camera in a separate window"
                  aria-label="Open game camera in a separate window"
                  onClick={() => void openDetachedGameCamera()}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Detach
                </button>
              </div>
            </div>
            <canvas ref={gameCameraCanvasRef} className="viewport-game-camera-canvas" data-testid="viewport-game-camera-canvas" />
            {gameCamera ? (
              <div className="viewport-game-camera-readout">
                {gameCamera.position.map((value) => value.toFixed(1)).join(", ")}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="canvas-reticle" aria-hidden="true" />
        <div className="canvas-label">
          {hasRenderableMesh ? "Runtime mesh viewport" : hasBackendPreview ? "Loaded world viewport" : "World summary viewport"} / {runtimeState}
        </div>
        <div className="minimap-canvas" aria-label="World viewport summary">
          <div className="minimap-grid">
            <strong>{chunks.length}</strong>
            <span>chunks</span>
            <span>{samples.length} samples</span>
            <span>{meshChunks.length} mesh payloads</span>
            <span>{waterSampleCount} water</span>
          </div>
        </div>
      </>
    );
  },
  { contract: LITE_VOXEL_VIEWPORT_CONTRACT },
);
