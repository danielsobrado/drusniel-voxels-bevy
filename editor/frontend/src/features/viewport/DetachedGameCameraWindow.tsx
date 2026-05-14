import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldSurfaceSample } from "../../types/world";
import {
  DETACHED_GAME_CAMERA_CHANNEL,
  DETACHED_GAME_CAMERA_STORAGE_KEY,
  drawGameCameraPreview,
  type DetachedGameCameraSnapshot,
  type GameCameraState,
} from "./LiteVoxelViewport";

const isGameCameraState = (value: unknown): value is GameCameraState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GameCameraState>;
  return Array.isArray(candidate.position) && candidate.position.length === 3 && typeof candidate.yaw === "number";
};

const isSurfaceSample = (value: unknown): value is WorldSurfaceSample => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorldSurfaceSample>;
  return (
    typeof candidate.x === "number" &&
    typeof candidate.z === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.material === "string" &&
    typeof candidate.water === "boolean"
  );
};

const isDetachedSnapshot = (value: unknown): value is DetachedGameCameraSnapshot => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DetachedGameCameraSnapshot>;
  return (
    isGameCameraState(candidate.camera) &&
    Array.isArray(candidate.samples) &&
    candidate.samples.every(isSurfaceSample) &&
    typeof candidate.cellSize === "number"
  );
};

const readStoredSnapshot = (): DetachedGameCameraSnapshot | null => {
  try {
    const stored = window.localStorage.getItem(DETACHED_GAME_CAMERA_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as unknown;
    return isDetachedSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export function DetachedGameCameraWindow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<DetachedGameCameraSnapshot | null>(() => readStoredSnapshot());
  const [size, setSize] = useState({ width: 1, height: 1 });
  const cameraReadout = useMemo(
    () => snapshot?.camera.position.map((value) => value.toFixed(1)).join(", ") ?? "Waiting for camera",
    [snapshot],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(DETACHED_GAME_CAMERA_CHANNEL) : null;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (isDetachedSnapshot(event.data)) {
        setSnapshot(event.data);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === DETACHED_GAME_CAMERA_STORAGE_KEY) {
        setSnapshot(readStoredSnapshot());
      }
    };

    channel?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (snapshot) {
      drawGameCameraPreview(ctx, snapshot.samples, snapshot.camera, snapshot.cellSize, size.width, size.height);
      return;
    }

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#d9e1ee";
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for game camera", size.width / 2, size.height / 2);
  }, [size.height, size.width, snapshot]);

  return (
    <main className="detached-game-camera-root" data-testid="detached-game-camera-window">
      <header className="detached-game-camera-header">
        <strong>Game Camera</strong>
        <span>{cameraReadout}</span>
      </header>
      <div ref={viewportRef} className="detached-game-camera-viewport">
        <canvas ref={canvasRef} className="detached-game-camera-canvas" data-testid="detached-game-camera-canvas" />
      </div>
    </main>
  );
}
