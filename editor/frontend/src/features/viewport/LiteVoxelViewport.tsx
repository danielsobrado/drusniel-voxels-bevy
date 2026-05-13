import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
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
}

type CanvasDragState =
  | { readonly kind: "pan"; readonly x: number; readonly y: number; readonly view: ViewState }
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

interface PendingVoxelEdit {
  readonly id: string;
  readonly position: [number, number, number];
  readonly block: BlockType;
  readonly status: "pending" | "applied" | "rejected";
  readonly message?: string;
}

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

const DEFAULT_VIEW: ViewState = { zoom: 1, offsetX: 0, offsetY: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

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

const collectSamples = (chunks: readonly ChunkSummary[], worldViewport: WorldViewportPreview | null): readonly WorldSurfaceSample[] => {
  const samples = worldViewport?.chunks.flatMap((chunk) => [...chunk.samples]) ?? [];
  return samples.length > 0 ? samples : fallbackSamplesFromChunks(chunks);
};

const fitViewForSamples = (samples: readonly WorldSurfaceSample[], width: number, height: number): ViewState => {
  if (samples.length === 0 || width <= 0 || height <= 0) {
    return DEFAULT_VIEW;
  }

  const iso = samples.map((sample) => ({
    x: (sample.x - sample.z) * 0.72,
    y: (sample.x + sample.z) * 0.36 - sample.height * 1.35,
  }));
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

const drawTexturedDiamond = (
  ctx: CanvasRenderingContext2D,
  atlasImage: HTMLImageElement,
  tileIndex: number,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  stroke: string,
) => {
  const tileWidth = atlasImage.naturalWidth / ATLAS_COLUMNS;
  const tileHeight = atlasImage.naturalHeight / ATLAS_ROWS;
  if (!Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || tileWidth <= 0 || tileHeight <= 0) {
    return false;
  }

  const column = tileIndex % ATLAS_COLUMNS;
  const row = Math.floor(tileIndex / ATLAS_COLUMNS);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - radiusY);
  ctx.lineTo(x + radiusX, y);
  ctx.lineTo(x, y + radiusY);
  ctx.lineTo(x - radiusX, y);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlasImage,
    column * tileWidth,
    row * tileHeight,
    tileWidth,
    tileHeight,
    x - radiusX,
    y - radiusY,
    radiusX * 2,
    radiusY * 2,
  );
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(x, y - radiusY);
  ctx.lineTo(x + radiusX, y);
  ctx.lineTo(x, y + radiusY);
  ctx.lineTo(x - radiusX, y);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.stroke();
  return true;
};

const projectIso = (position: readonly [number, number, number], view: ViewState) => ({
  x: view.offsetX + (position[0] - position[2]) * 0.72 * view.zoom,
  y: view.offsetY + ((position[0] + position[2]) * 0.36 - position[1] * 1.35) * view.zoom,
});

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
    const dragRef = useRef<CanvasDragState | null>(null);
    const suppressClickRef = useRef(false);
    const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
    const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
    const [hoveredVoxel, setHoveredVoxel] = useState<LiteVoxelSelection | null>(null);
    const [pendingVoxelEdits, setPendingVoxelEdits] = useState<readonly PendingVoxelEdit[]>([]);
    const [atlasImage, setAtlasImage] = useState<HTMLImageElement | null>(null);
    const samples = useMemo(() => collectSamples(chunks, worldViewport), [chunks, worldViewport]);
    const hasBackendPreview = Boolean(worldViewport && worldViewport.chunks.length > 0);
    const meshChunks = useMemo(() => viewportSnapshot?.chunks.filter((chunk) => chunk.mesh.included) ?? [], [viewportSnapshot]);
    const hasRenderableMesh = meshChunks.some((chunk) => Boolean(chunk.mesh.terrain.positions?.length || chunk.mesh.water.positions?.length));
    const atlasPreviewEnabled = viewportOverlays.atlasPreview || activeMode === "voxel_paint" || activeMode === "material";
    const waterSampleCount = samples.filter((sample) => sample.water).length;
    const chunkOverlayShapes = useMemo(() => buildChunkOverlayShapes(chunks, selection, view), [chunks, selection, view]);
    const brushPreviewShape = useMemo(() => buildBrushPreviewShape(brushSettings, targetedVoxel, activeMode, view), [activeMode, brushSettings, targetedVoxel, view]);
    const propOverlayShapes = useMemo(() => buildPropOverlayShapes(props, selection, view), [props, selection, view]);
    const selectedVoxelPoint = selection.kind === "voxel" ? projectIso(selection.position, view) : null;
    const hoveredVoxelPoint = hoveredVoxel ? projectIso(hoveredVoxel.position, view) : null;

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
      setView(fitViewForSamples(samples, canvasSize.width, canvasSize.height));
    }, [canvasSize.height, canvasSize.width, samples]);

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
      setView(fitViewForSamples(samples, canvasSize.width, canvasSize.height));
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

      let renderedMesh = false;
      for (const chunk of meshChunks) {
        renderedMesh =
          drawMeshBuffer(ctx, chunk.mesh.terrain, view, "rgba(92, 101, 111, 0.72)", "rgba(15, 18, 24, 0.7)") ||
          renderedMesh;
        renderedMesh =
          drawMeshBuffer(ctx, chunk.mesh.water, view, "rgba(55, 159, 220, 0.55)", "rgba(157, 221, 255, 0.55)") ||
          renderedMesh;
      }

      const orderedSamples = [...samples].sort((left, right) => left.x + left.z + left.height - (right.x + right.z + right.height));
      for (const sample of orderedSamples) {
        if (renderedMesh && !sample.water && !atlasPreviewEnabled) {
          continue;
        }
        const isoX = (sample.x - sample.z) * 0.72;
        const isoY = (sample.x + sample.z) * 0.36 - sample.height * 1.35;
        const screenX = view.offsetX + isoX * view.zoom;
        const screenY = view.offsetY + isoY * view.zoom;
        const radiusX = (hasBackendPreview ? 8 : 16) * view.zoom;
        const radiusY = (hasBackendPreview ? 4 : 8) * view.zoom;
        const materialColor = MATERIAL_COLORS[sample.material] ?? MATERIAL_COLORS.Rock;
        const stroke = sample.water ? "rgba(157, 221, 255, 0.75)" : "rgba(11, 14, 20, 0.85)";
        const atlasTileIndex = atlasPreviewEnabled && !sample.water && atlasImage ? atlasTileIndexForSample(atlasMapping, sample.material, "top") : null;

        if (!(atlasImage && atlasTileIndex !== null && drawTexturedDiamond(ctx, atlasImage, atlasTileIndex, screenX, screenY, radiusX, radiusY, stroke))) {
          drawDiamond(ctx, screenX, screenY, radiusX, radiusY, materialColor, stroke);
        }
        if (sample.water) {
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
    }, [atlasImage, atlasMapping, atlasPreviewEnabled, canvasSize.height, canvasSize.width, hasBackendPreview, meshChunks, samples, view]);

    return (
      <>
        <canvas
          ref={canvasRef}
          className="world-viewport-canvas"
          data-testid="world-viewport-canvas"
          tabIndex={0}
          onPointerDown={(event) => {
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

            onSelectVoxel?.(voxelSelection);
            if (activeMode === "voxel_paint" || activeMode === "voxel_sculpt") {
              void queueVoxelEdit(voxelSelection);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Home" || event.key.toLowerCase() === "f") {
              fitView();
            }
            if (event.key === "+" || event.key === "=") {
              setView((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, 0.18, 8) }));
            }
            if (event.key === "-" || event.key === "_") {
              setView((current) => ({ ...current, zoom: clamp(current.zoom * 0.85, 0.18, 8) }));
            }
          }}
        />

        {viewportOverlays.voxelGrid ? <div className="lite-viewport-grid-overlay" aria-hidden="true" data-testid="viewport-voxel-grid-overlay" /> : null}

        {viewportOverlays.wireframe ? <div className="lite-viewport-wire-overlay" aria-hidden="true" data-testid="viewport-wireframe-overlay" /> : null}

        <svg className="lite-viewport-authoring-overlay" data-testid="lite-viewport-authoring-overlay" aria-hidden="true">
          {(viewportOverlays.chunkBounds || chunkOverlayShapes.some((shape) => shape.dirty || shape.selected)) &&
            chunkOverlayShapes.map((shape) => (
              <g key={shape.id} data-testid={`viewport-chunk-overlay-${shape.id}`}>
                {shape.dirty ? (
                  <polygon className="lite-viewport-dirty-chunk" points={pointsToSvg(shape.points)} />
                ) : null}
                {viewportOverlays.chunkBounds || shape.selected ? (
                  <polygon className={shape.selected ? "lite-viewport-selected-chunk" : "lite-viewport-chunk-bound"} points={pointsToSvg(shape.points)} />
                ) : null}
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
          <button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => setView((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, 0.18, 8) }))}>
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => setView((current) => ({ ...current, zoom: clamp(current.zoom * 0.85, 0.18, 8) }))}>
            <ZoomOut size={14} aria-hidden="true" />
          </button>
        </div>

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
