import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { ChunkSummary, ProtectedArea, ViewportMeshBuffer, ViewportSnapshot, WaterReflectionDebugViewMode, WaterRuntimeSnapshot, WorldSurfaceSample, WorldViewportPreview } from "../../types/world";
import type { RuntimeState } from "../../types/editor";

export interface AreaOverlayState {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly bounds: ProtectedArea["bounds"];
  readonly kind: "selected" | "warning" | "agent" | "default";
}

interface BevyCanvasHostProps {
  readonly chunks: readonly ChunkSummary[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
  readonly runtimeState: RuntimeState;
  readonly areaOverlays: readonly AreaOverlayState[];
  readonly showProtectedAreas: boolean;
  readonly waterDebug: boolean;
  readonly waterDebugMode: WaterReflectionDebugViewMode;
  readonly waterRuntimeSnapshot: WaterRuntimeSnapshot;
}

interface ViewState {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

type NativeViewportState = "unsupported" | "pending" | "attached" | "fallback";

interface NativeViewportAttachment {
  readonly attached: boolean;
  readonly hwnd?: number | null;
  readonly message: string;
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

const DEFAULT_VIEW: ViewState = { zoom: 1, offsetX: 0, offsetY: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hasTauriGlobals = () => typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const boundsToRect = (bounds: ProtectedArea["bounds"]) => {
  const minX = bounds.min[0];
  const minZ = bounds.min[2];
  const maxX = bounds.max[0];
  const maxZ = bounds.max[2];
  const xSpan = maxX - minX;
  const zSpan = maxZ - minZ;
  const scale = 2.6;
  const originX = 150;
  const originZ = 80;

  return {
    x: originX + minX * scale,
    y: originZ + minZ * scale,
    width: Math.max(8, xSpan * scale),
    height: Math.max(8, zSpan * scale),
    strokeWidth: 2,
    rx: 4,
  };
};

const stateToStyle = (kind: AreaOverlayState["kind"]) =>
  kind === "selected"
    ? {
        stroke: "#2cb8ff",
        fill: "rgba(44, 184, 255, 0.22)",
        dasharray: "0",
      }
    : kind === "warning"
      ? {
          stroke: "#f5a524",
          fill: "rgba(245, 165, 36, 0.22)",
          dasharray: "0",
        }
      : kind === "agent"
        ? {
            stroke: "#a26cff",
            fill: "rgba(162, 108, 255, 0.2)",
            dasharray: "6 4",
          }
        : {
            stroke: "rgba(143, 149, 163, 0.55)",
            fill: "rgba(143, 149, 163, 0.12)",
            dasharray: "0",
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

const projectIso = (position: readonly [number, number, number], view: ViewState) => ({
  x: view.offsetX + (position[0] - position[2]) * 0.72 * view.zoom,
  y: view.offsetY + ((position[0] + position[2]) * 0.36 - position[1] * 1.35) * view.zoom,
});

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

export function BevyCanvasHost({
  chunks,
  worldViewport,
  viewportSnapshot,
  runtimeState,
  areaOverlays,
  showProtectedAreas,
  waterDebug,
  waterDebugMode,
  waterRuntimeSnapshot,
}: BevyCanvasHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ readonly x: number; readonly y: number; readonly view: ViewState } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const desktopRuntime = hasTauriGlobals();
  const browserPreviewEnabled = !desktopRuntime;
  const [nativeViewportState, setNativeViewportState] = useState<NativeViewportState>(() => (desktopRuntime ? "pending" : "unsupported"));
  const [nativeViewportMessage, setNativeViewportMessage] = useState("Native Bevy viewport is starting.");
  const samples = useMemo(() => (browserPreviewEnabled ? collectSamples(chunks, worldViewport) : []), [browserPreviewEnabled, chunks, worldViewport]);
  const hasBackendPreview = Boolean(worldViewport && worldViewport.chunks.length > 0);
  const meshChunks = useMemo(() => viewportSnapshot?.chunks.filter((chunk) => chunk.mesh.included) ?? [], [viewportSnapshot]);
  const hasRenderableMesh = meshChunks.some((chunk) => Boolean(chunk.mesh.terrain.positions?.length || chunk.mesh.water.positions?.length));
  const viewportStateLabel = runtimeState === "mock" ? "offline preview" : runtimeState;
  const waterSampleCount = samples.filter((sample) => sample.water).length;

  const fitView = useCallback(() => {
    setView(fitViewForSamples(samples, canvasSize.width, canvasSize.height));
  }, [canvasSize.height, canvasSize.width, samples]);

  useEffect(() => {
    const host = hostRef.current;
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
    const host = hostRef.current;
    if (!host || !desktopRuntime) {
      setNativeViewportState(desktopRuntime ? "fallback" : "unsupported");
      setNativeViewportMessage(desktopRuntime ? "Native viewport host is not ready." : "Browser preview mode.");
      return;
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 16) {
        return;
      }

      const scale = window.devicePixelRatio || 1;
      setNativeViewportState((current) => (current === "attached" ? current : "pending"));
      void invoke<NativeViewportAttachment>("attach_native_viewport", {
        rect: {
          x: Math.round(rect.left * scale),
          y: Math.round(rect.top * scale),
          width: Math.round(rect.width * scale),
          height: Math.round(rect.height * scale),
        },
      })
        .then((attachment) => {
          if (!cancelled) {
            setNativeViewportState(attachment.attached ? "attached" : "fallback");
            setNativeViewportMessage(attachment.message);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setNativeViewportState("fallback");
            setNativeViewportMessage(error instanceof Error ? error.message : "Native Bevy viewport is not ready.");
          }
        });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [canvasSize.height, canvasSize.width, desktopRuntime, runtimeState]);

  useEffect(() => {
    return () => {
      void invoke("detach_native_viewport").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !browserPreviewEnabled) {
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
      if (renderedMesh && !sample.water) {
        continue;
      }
      const isoX = (sample.x - sample.z) * 0.72;
      const isoY = (sample.x + sample.z) * 0.36 - sample.height * 1.35;
      const screenX = view.offsetX + isoX * view.zoom;
      const screenY = view.offsetY + isoY * view.zoom;
      const radiusX = (hasBackendPreview ? 8 : 16) * view.zoom;
      const radiusY = (hasBackendPreview ? 4 : 8) * view.zoom;
      const materialColor = MATERIAL_COLORS[sample.material] ?? MATERIAL_COLORS.Rock;

      drawDiamond(ctx, screenX, screenY, radiusX, radiusY, materialColor, sample.water ? "rgba(157, 221, 255, 0.75)" : "rgba(11, 14, 20, 0.85)");
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
  }, [browserPreviewEnabled, canvasSize.height, canvasSize.width, hasBackendPreview, meshChunks, samples, view]);

  return (
    <div
      ref={hostRef}
      className={`bevy-canvas-host world-viewport-host ${nativeViewportState === "attached" ? "world-viewport-host-native" : ""}`}
      data-testid="bevy-canvas-host"
      aria-label="Runtime world viewport"
    >
      {browserPreviewEnabled ? (
        <>
          <canvas
            ref={canvasRef}
            className="world-viewport-canvas"
            data-testid="world-viewport-canvas"
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { x: event.clientX, y: event.clientY, view };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag) {
                return;
              }
              setView({ ...drag.view, offsetX: drag.view.offsetX + event.clientX - drag.x, offsetY: drag.view.offsetY + event.clientY - drag.y });
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onWheel={(event) => {
              event.preventDefault();
              const zoomMultiplier = event.deltaY < 0 ? 1.1 : 0.9;
              const nextZoom = clamp(view.zoom * zoomMultiplier, 0.18, 8);
              setView({ ...view, zoom: nextZoom });
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
        </>
      ) : nativeViewportState !== "attached" ? (
        <div className="native-viewport-status" data-testid="native-viewport-status">
          <strong>Native Bevy viewport</strong>
          <span>{nativeViewportMessage}</span>
        </div>
      ) : null}

      {waterDebug ? (
        <div className="viewport-water-overlay" aria-label="Water debug overlay" data-testid="viewport-water-overlay">
          <div>Mode: {waterDebugMode}</div>
          <div>Reflection active: {waterRuntimeSnapshot.reflectionStatus.active ? "on" : "off"}</div>
          <div>Nearest body: {waterRuntimeSnapshot.probe.nearestBodyKind}</div>
          <div>Reason: {waterRuntimeSnapshot.reflectionStatus.reason}</div>
        </div>
      ) : null}

      {showProtectedAreas ? (
        <svg className="viewport-area-overlay-canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" preserveAspectRatio="none" aria-hidden="true">
          {areaOverlays.map((area) => {
            const rect = boundsToRect(area.bounds);
            const style = stateToStyle(area.kind);
            return (
              <g key={area.id} data-testid={`viewport-area-overlay-${area.id}`}>
                <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={rect.rx} fill={style.fill} stroke={style.stroke} strokeWidth={rect.strokeWidth} strokeDasharray={style.dasharray} />
                <text x={rect.x + 6} y={rect.y + 16} fontSize={8} fill={area.color} className="viewport-area-overlay-label">
                  {area.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      <div className="canvas-reticle" aria-hidden="true" />
      <div className="canvas-label">
        {desktopRuntime
          ? nativeViewportState === "attached"
            ? "Native Bevy viewport"
            : "Native viewport pending"
          : hasRenderableMesh
            ? "Runtime mesh viewport"
            : hasBackendPreview
              ? "Loaded world viewport"
              : "World summary viewport"}{" "}
        / {viewportStateLabel}
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
    </div>
  );
}
