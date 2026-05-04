import type { MockWaterRuntimeSnapshot, ProtectedArea, WaterReflectionDebugViewMode } from "../../types/world";

export interface AreaOverlayState {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly bounds: ProtectedArea["bounds"];
  readonly kind: "selected" | "warning" | "agent" | "default";
}

interface BevyCanvasHostProps {
  readonly areaOverlays: readonly AreaOverlayState[];
  readonly showProtectedAreas: boolean;
  readonly waterDebug: boolean;
  readonly waterDebugMode: WaterReflectionDebugViewMode;
  readonly waterRuntimeSnapshot: MockWaterRuntimeSnapshot;
}

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

export function BevyCanvasHost({
  areaOverlays,
  showProtectedAreas,
  waterDebug,
  waterDebugMode,
  waterRuntimeSnapshot,
}: BevyCanvasHostProps) {
  return (
    <div className="bevy-canvas-host" data-testid="bevy-canvas-host" aria-label="Mocked Bevy canvas host">
      <div className="voxel-sky" />
      <div className="voxel-world">
        {Array.from({ length: 36 }, (_, index) => (
          <span key={index} className={`voxel-block voxel-block-${index % 4}`} />
        ))}
      </div>

      {waterDebug ? (
        <div className="viewport-water-overlay" aria-label="Water debug overlay" data-testid="viewport-water-overlay">
          <div>Mode: {waterDebugMode}</div>
          <div>Reflection active: {waterRuntimeSnapshot.reflectionStatus.active ? "on" : "off"}</div>
          <div>Nearest body: {waterRuntimeSnapshot.probe.nearestBodyKind}</div>
          <div>Reason: {waterRuntimeSnapshot.reflectionStatus.reason}</div>
        </div>
      ) : null}

      {showProtectedAreas ? (
        <svg
          className="viewport-area-overlay-canvas"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 360 240"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {areaOverlays.map((area) => {
            const rect = boundsToRect(area.bounds);
            const style = stateToStyle(area.kind);
            return (
              <g key={area.id} data-testid={`viewport-area-overlay-${area.id}`}>
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx={rect.rx}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={rect.strokeWidth}
                  strokeDasharray={style.dasharray}
                />
                <text x={rect.x + 6} y={rect.y + 16} fontSize={8} fill={area.color} className="viewport-area-overlay-label">
                  {area.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      <div className="canvas-reticle" aria-hidden="true" />
      <div className="canvas-label">Mock voxel viewport. Runtime bridge intentionally disabled.</div>
      <div className="minimap-canvas" aria-label="Minimap placeholder">
        <div className="minimap-grid">Minimap</div>
      </div>
    </div>
  );
}
