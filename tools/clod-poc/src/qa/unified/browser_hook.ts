import type { ClodHooks } from "../../core/hooks.js";
import { DeterministicSequenceClock } from "../sequence/sequence_clock.js";
import type { DrusnielQaHook, QaEnvironment, QaWorldState } from "./browser_contract.js";
import { readinessBlockers } from "./readiness.js";

export function installBrowserQaHook(): DrusnielQaHook {
  if (window.__drusnielQa) return window.__drusnielQa;
  let checkpoint: string | null = null;
  let frozen = false;
  let sequenceClock: DeterministicSequenceClock | null = null;
  const runtime = (): ClodHooks => {
    const hooks = window.__drusnielClod;
    if (!hooks) throw new Error("window.__drusnielClod is not initialized");
    return hooks;
  };
  const hook: DrusnielQaHook = {
    schemaVersion: 1,
    ready: () => readinessBlockers(window.__drusnielClod).length === 0,
    readinessBlockers: () => readinessBlockers(window.__drusnielClod),
    error: () => window.__drusnielClod?.error ?? null,
    environment: (): QaEnvironment => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      viewport: [window.innerWidth, window.innerHeight],
      devicePixelRatio: window.devicePixelRatio,
      gpu: window.__drusnielClod?.diag ? { ...window.__drusnielClod.diag } : null,
    }),
    getPose: () => {
      const getPose = runtime().getPose;
      if (!getPose) throw new Error("runtime pose getter is not ready");
      return getPose();
    },
    setPose: async (pose) => {
      const setPose = runtime().setPose;
      if (!setPose) throw new Error("runtime pose setter is not ready");
      setPose(pose);
      await nextFrame();
    },
    setWorldState: async (state: QaWorldState) => {
      runtime().setAcceptanceSceneOptions?.({
        freeze: state.freeze ?? frozen,
        proceduralDebug: state.proceduralDebug,
      });
      if (state.freeze !== undefined) frozen = state.freeze;
      await nextFrame();
    },
    settle: async (frames) => {
      const settle = runtime().settle;
      if (!settle) throw new Error("runtime settle hook is not ready");
      await settle(frames);
    },
    freeze: async () => {
      const blockers = readinessBlockers(runtime());
      if (blockers.length > 0) throw new Error(`cannot freeze before readiness: ${blockers.join("; ")}`);
      runtime().flyCamEnabled?.(false);
      runtime().setAcceptanceSceneOptions?.({ freeze: true });
      frozen = true;
      await nextFrame();
    },
    unfreeze: async () => {
      runtime().setAcceptanceSceneOptions?.({ freeze: false });
      frozen = false;
      await nextFrame();
    },
    captureStats: async () => {
      const stats = runtime().stats;
      if (!stats) throw new Error("runtime stats are missing");
      return structuredClone(stats);
    },
    captureScreenshot: async (name) => {
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("render canvas is missing");
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error(`failed to capture screenshot ${name}`);
      return dataUrl;
    },
    runCheckpoint: async (name) => {
      if (!name.trim()) throw new Error("checkpoint name is required");
      checkpoint = name;
      await nextFrame();
    },
    lastCheckpoint: () => checkpoint,
    beginSequence: async (config) => {
      const blockers = readinessBlockers(runtime());
      if (blockers.length > 0) throw new Error(`cannot begin sequence before readiness: ${blockers.join("; ")}`);
      sequenceClock = new DeterministicSequenceClock(config);
      runtime().flyCamEnabled?.(false);
      runtime().setAcceptanceSceneOptions?.({ freeze: true });
      frozen = true;
      await settleRuntime(runtime(), 1);
    },
    getCameraMatrices: () => {
      const getCameraMatrices = runtime().getCameraMatrices;
      if (!getCameraMatrices) throw new Error("runtime camera matrices are not ready");
      return getCameraMatrices();
    },
    stepSequence: async (index) => {
      if (!sequenceClock) throw new Error("sequence clock is not active");
      const state = sequenceClock.step(index);
      const setPose = runtime().setPose;
      if (!setPose) throw new Error("runtime pose setter is not ready");
      setPose(state.pose);
      await settleRuntime(runtime(), 1);
      return state;
    },
    endSequence: async () => {
      sequenceClock = null;
      runtime().setQaDiagnosticBuffer?.("final");
      await settleRuntime(runtime(), 1);
    },
    captureDiagnosticBuffer: async (kind) => {
      const setBuffer = runtime().setQaDiagnosticBuffer;
      if (!setBuffer) throw new Error("runtime diagnostic-buffer capture is unavailable");
      setBuffer(kind);
      await settleRuntime(runtime(), 1);
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("render canvas is missing");
      const dataUrl = canvas.toDataURL("image/png");
      if (kind !== "final") {
        setBuffer("final");
        await settleRuntime(runtime(), 1);
      }
      return dataUrl;
    },
    setDiagnosticBuffer: async (kind) => {
      const setBuffer = runtime().setQaDiagnosticBuffer;
      if (!setBuffer) throw new Error("runtime diagnostic-buffer capture is unavailable");
      setBuffer(kind);
      await settleRuntime(runtime(), 1);
    },
    runSequenceEvent: async (action) => {
      if (action === "streaming-off") runtime().setTerrainStreamingEnabled?.(false);
      else if (action === "streaming-on") runtime().setTerrainStreamingEnabled?.(true);
      else if (action === "ownership-debug") runtime().setAcceptanceSceneOptions?.({ proceduralDebug: "ownership" });
      else runtime().setAcceptanceSceneOptions?.({ proceduralDebug: "final" });
      await settleRuntime(runtime(), 1);
    },
  };
  window.__drusnielQa = hook;
  return hook;
}

async function settleRuntime(runtime: ClodHooks, frames: number): Promise<void> {
  if (!runtime.settle) throw new Error("runtime settle hook is not ready");
  await runtime.settle(frames);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
