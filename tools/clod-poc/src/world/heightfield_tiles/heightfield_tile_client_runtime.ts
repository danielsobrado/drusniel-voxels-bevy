import { ClodWorkerClient } from "../../clod_worker_client.js";
import { createHeightfieldTileRuntime, type HeightfieldTileRuntime } from "./heightfield_tile_runtime.js";

interface ActiveRuntime {
  runtime: HeightfieldTileRuntime;
  animationFrameId: number;
  lastEngineFrame: number;
  lastUpdateMs: number;
  fallbackFrame: number;
}

interface ClientPrototype {
  buildWorld: ClodWorkerClient["buildWorld"];
  buildHeightfieldTiles: ClodWorkerClient["buildHeightfieldTiles"];
  dispose: ClodWorkerClient["dispose"];
}

const activeRuntimes = new WeakMap<ClodWorkerClient, ActiveRuntime>();
let installed = false;

function stopRuntime(client: ClodWorkerClient): void {
  const active = activeRuntimes.get(client);
  if (!active) return;
  cancelAnimationFrame(active.animationFrameId);
  active.runtime.dispose();
  activeRuntimes.delete(client);
}

function scheduleRuntimeUpdate(client: ClodWorkerClient, active: ActiveRuntime): void {
  active.animationFrameId = requestAnimationFrame((nowMs) => {
    if (activeRuntimes.get(client) !== active) return;
    const hooks = window.__drusnielClod;
    const pose = hooks?.getPose?.();
    const stats = hooks?.stats;
    const engineFrame = stats?.frame;
    const hasEngineFrame = typeof engineFrame === "number" && Number.isFinite(engineFrame);
    const frameIndex = hasEngineFrame ? engineFrame : active.fallbackFrame++;

    if (pose && frameIndex !== active.lastEngineFrame) {
      const counters = stats?.counters;
      const originX = counters?.["floatingOriginOffsetX"] ?? 0;
      const originZ = counters?.["floatingOriginOffsetZ"] ?? 0;
      active.runtime.update({
        x: pose.p[0] + originX,
        z: pose.p[2] + originZ,
        frameIndex,
        deltaSeconds: Math.max(0, (nowMs - active.lastUpdateMs) / 1000),
      });
      active.lastEngineFrame = frameIndex;
      active.lastUpdateMs = nowMs;
    }

    scheduleRuntimeUpdate(client, active);
  });
}

export function installHeightfieldTileClientRuntime(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const prototype = ClodWorkerClient.prototype as ClientPrototype;
  const originalBuildWorld = prototype.buildWorld;
  const originalDispose = prototype.dispose;

  prototype.buildWorld = async function (
    this: ClodWorkerClient,
    ...args: Parameters<ClodWorkerClient["buildWorld"]>
  ) {
    stopRuntime(this);
    const result = await originalBuildWorld.apply(this, args);
    const terrainSource = args[9];
    const startupHeightfield = args[10] ?? null;
    const runtime = await createHeightfieldTileRuntime({
      terrainSource,
      startupHeightfield,
      buildTiles: (keys, sourceRevision) => this.buildHeightfieldTiles(keys, sourceRevision),
    });
    if (runtime) {
      const active: ActiveRuntime = {
        runtime,
        animationFrameId: 0,
        lastEngineFrame: -1,
        lastUpdateMs: performance.now(),
        fallbackFrame: 0,
      };
      activeRuntimes.set(this, active);
      scheduleRuntimeUpdate(this, active);
    }
    return result;
  };

  prototype.dispose = function (this: ClodWorkerClient) {
    stopRuntime(this);
    originalDispose.call(this);
  };
}
