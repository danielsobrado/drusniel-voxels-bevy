import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChunkSummary, PropInstance, ProtectedArea, ViewportSnapshot, WaterReflectionDebugViewMode, WaterRuntimeSnapshot, WorldViewportPreview } from "../../types/world";
import type { BrushSettings, EditorMode, RuntimeState, Selection, ViewportModifierKey, ViewportOverlayState } from "../../types/editor";
import { LiteVoxelViewport, type LiteVoxelEditRequest, type LiteVoxelEditResponse, type LiteVoxelSelection } from "./LiteVoxelViewport";
import { LITE_VOXEL_VIEWPORT_CONTRACT, NATIVE_BEVY_VIEWPORT_CONTRACT } from "./viewportArchitecture";

export interface AreaOverlayState {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly bounds: ProtectedArea["bounds"];
  readonly kind: "selected" | "warning" | "agent" | "default";
}

interface BevyCanvasHostProps {
  readonly chunks: readonly ChunkSummary[];
  readonly props: readonly PropInstance[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
  readonly runtimeState: RuntimeState;
  readonly activeMode: EditorMode;
  readonly brushSettings: BrushSettings;
  readonly selection: Selection;
  readonly targetedVoxel: readonly [number, number, number];
  readonly viewportOverlays: ViewportOverlayState;
  readonly areaOverlays: readonly AreaOverlayState[];
  readonly showProtectedAreas: boolean;
  readonly waterDebug: boolean;
  readonly waterDebugMode: WaterReflectionDebugViewMode;
  readonly waterRuntimeSnapshot: WaterRuntimeSnapshot;
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

type NativeViewportState = "unsupported" | "pending" | "attached" | "fallback";

interface NativeViewportAttachment {
  readonly attached: boolean;
  readonly hwnd?: number | null;
  readonly message: string;
}

interface NativeViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const hasTauriGlobals = () => typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
const NATIVE_VIEWPORT_RESIZE_SETTLE_MS = 1000;

const readNativeViewportRect = (host: HTMLElement): NativeViewportRect => {
  const rect = host.getBoundingClientRect();
  const x = Math.floor(rect.left);
  const y = Math.floor(rect.top);

  return {
    x,
    y,
    width: Math.max(1, Math.ceil(rect.right) - x + 2),
    height: Math.max(1, Math.ceil(rect.bottom) - y + 2),
  };
};

const nativeRectsEqual = (left: NativeViewportRect, right: NativeViewportRect): boolean =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;

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

const nativeViewportDebug = (...items: unknown[]) => {
  const enabled =
    typeof window !== "undefined" &&
    window.localStorage.getItem("drusniel.editorDiagnostics") === "1";
  if (import.meta.env.DEV && enabled) {
    console.info("[native-viewport]", ...items);
  }
};

export function BevyCanvasHost({
  chunks,
  props,
  worldViewport,
  viewportSnapshot,
  runtimeState,
  activeMode,
  brushSettings,
  selection,
  targetedVoxel,
  viewportOverlays,
  areaOverlays,
  showProtectedAreas,
  waterDebug,
  waterDebugMode,
  waterRuntimeSnapshot,
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
}: BevyCanvasHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const nativeResizeTimerRef = useRef<number | undefined>(undefined);
  const [nativeViewportRect, setNativeViewportRect] = useState<NativeViewportRect | null>(null);
  const desktopRuntime = hasTauriGlobals();
  const browserPreviewEnabled = !desktopRuntime;
  const activeViewportContract = browserPreviewEnabled ? LITE_VOXEL_VIEWPORT_CONTRACT : NATIVE_BEVY_VIEWPORT_CONTRACT;
  const [nativeViewportState, setNativeViewportState] = useState<NativeViewportState>(() => (desktopRuntime ? "pending" : "unsupported"));
  const [nativeViewportMessage, setNativeViewportMessage] = useState("Native Bevy viewport is starting.");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const updateNativeRect = () => {
      if (!desktopRuntime) {
        return;
      }

      const nextRect = readNativeViewportRect(host);
      nativeViewportDebug("rect", nextRect);
      setNativeViewportRect((current) => (current && nativeRectsEqual(current, nextRect) ? current : nextRect));
    };

    const scheduleNativeRectUpdate = () => {
      if (!desktopRuntime) {
        return;
      }

      if (nativeResizeTimerRef.current !== undefined) {
        window.clearTimeout(nativeResizeTimerRef.current);
      }

      nativeResizeTimerRef.current = window.setTimeout(() => {
        nativeResizeTimerRef.current = undefined;
        updateNativeRect();
      }, NATIVE_VIEWPORT_RESIZE_SETTLE_MS);
    };

    const observer = new ResizeObserver(() => scheduleNativeRectUpdate());
    observer.observe(host);

    updateNativeRect();
    scheduleNativeRectUpdate();
    window.addEventListener("resize", scheduleNativeRectUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleNativeRectUpdate);
      if (nativeResizeTimerRef.current !== undefined) {
        window.clearTimeout(nativeResizeTimerRef.current);
        nativeResizeTimerRef.current = undefined;
      }
    };
  }, [desktopRuntime]);

  useEffect(() => {
    if (!desktopRuntime) {
      setNativeViewportState(desktopRuntime ? "fallback" : "unsupported");
      setNativeViewportMessage(desktopRuntime ? "Native viewport host is not ready." : "Browser preview mode.");
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;

    const attach = () => {
      if (cancelled) {
        return;
      }

      if (!nativeViewportRect || nativeViewportRect.width < 16 || nativeViewportRect.height < 16) {
        nativeViewportDebug("attach skipped: host rect not ready", nativeViewportRect);
        setNativeViewportState("fallback");
        setNativeViewportMessage("Native viewport host is not ready.");
        return;
      }

      nativeViewportDebug("attach request", nativeViewportRect);
      setNativeViewportState((current) => (current === "attached" ? current : "pending"));
      void invoke<NativeViewportAttachment>("attach_native_viewport", {
        rect: {
          x: nativeViewportRect.x,
          y: nativeViewportRect.y,
          width: nativeViewportRect.width,
          height: nativeViewportRect.height,
        },
      })
        .then((attachment) => {
          if (!cancelled) {
            nativeViewportDebug("attach result", attachment);
            setNativeViewportState(attachment.attached ? "attached" : "fallback");
            setNativeViewportMessage(attachment.message);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            nativeViewportDebug("attach failed", error);
            setNativeViewportState("fallback");
            setNativeViewportMessage(error instanceof Error ? error.message : "Native Bevy viewport is not ready.");
            retryTimer = window.setTimeout(attach, 250);
          }
        });
    };

    const frame = window.requestAnimationFrame(attach);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [desktopRuntime, nativeViewportRect, runtimeState]);

  useEffect(() => {
    return () => {
      void invoke("detach_native_viewport").catch(() => undefined);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`bevy-canvas-host world-viewport-host ${nativeViewportState === "attached" ? "world-viewport-host-native" : ""}`}
      data-testid="bevy-canvas-host"
      data-viewport-role={activeViewportContract.role}
      data-viewport-implementation={activeViewportContract.implementation}
      data-viewport-runtime-renderer={String(activeViewportContract.ownsRuntimeRendering)}
      aria-label="Runtime world viewport"
    >
      {browserPreviewEnabled ? (
        <LiteVoxelViewport
          chunks={chunks}
          props={props}
          worldViewport={worldViewport}
          viewportSnapshot={viewportSnapshot}
          runtimeState={runtimeState}
          activeMode={activeMode}
          brushSettings={brushSettings}
          selection={selection}
          targetedVoxel={targetedVoxel}
          viewportOverlays={viewportOverlays}
          propPlacementEnabled={propPlacementEnabled}
          onPlaceProp={onPlaceProp}
          onSelectVoxel={onSelectVoxel}
          onSetVoxel={onSetVoxel}
          selectedPropRotationY={selectedPropRotationY}
          selectedPropUniformScale={selectedPropUniformScale}
          propRotateDragModifier={propRotateDragModifier}
          propFineScaleModifier={propFineScaleModifier}
          propRotationSensitivity={propRotationSensitivity}
          propRotationSnapDegrees={propRotationSnapDegrees}
          propScaleStep={propScaleStep}
          propScaleMin={propScaleMin}
          propScaleMax={propScaleMax}
          onAdjustSelectedProp={onAdjustSelectedProp}
        />
      ) : nativeViewportState !== "attached" ? (
        <div className="native-viewport-status" data-testid="native-viewport-status">
          <strong>Native Bevy viewport</strong>
          <span>{nativeViewportMessage}</span>
        </div>
      ) : null}

      {browserPreviewEnabled && waterDebug ? (
        <div className="viewport-water-overlay" aria-label="Water debug overlay" data-testid="viewport-water-overlay">
          <div>Mode: {waterDebugMode}</div>
          <div>Reflection active: {waterRuntimeSnapshot.reflectionStatus.active ? "on" : "off"}</div>
          <div>Nearest body: {waterRuntimeSnapshot.probe.nearestBodyKind}</div>
          <div>Reason: {waterRuntimeSnapshot.reflectionStatus.reason}</div>
        </div>
      ) : null}

      {browserPreviewEnabled && showProtectedAreas ? (
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

    </div>
  );
}
