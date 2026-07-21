import type { ClodHooks } from "../../core/hooks.js";
import { DeterministicSequenceClock } from "../sequence/sequence_clock.js";
import { qaBuildIdentity } from "./build_identity.js";
import type { DrusnielQaHook, QaEnvironment, QaWorldState } from "./browser_contract.js";
import { readinessBlockers } from "./readiness.js";

export function installBrowserQaHook(): DrusnielQaHook {
  if (window.__drusnielQa) return window.__drusnielQa;
  let checkpoint: string | null = null;
  let frozen = false;
  let sequenceClock: DeterministicSequenceClock | null = null;
  let appliedWorldState: QaWorldState = {};
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
      build: qaBuildIdentity(),
    }),
    worldState: () => structuredClone(appliedWorldState),
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
      appliedWorldState = { ...appliedWorldState, ...validateWorldState(state) };
      runtime().setAcceptanceSceneOptions?.({
        freeze: state.freeze ?? frozen,
        proceduralDebug: state.proceduralDebug,
        farClipmapDebug: state.farClipmapDebug,
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
      appliedWorldState = { ...appliedWorldState, freeze: true };
      await nextFrame();
    },
    unfreeze: async () => {
      runtime().setAcceptanceSceneOptions?.({ freeze: false });
      frozen = false;
      appliedWorldState = { ...appliedWorldState, freeze: false };
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
      appliedWorldState = { ...appliedWorldState, freeze: true };
      await settleRuntime(runtime(), 1);
    },
    getCameraMatrices: () => {
      const getCameraMatrices = runtime().getCameraMatrices;
      if (!getCameraMatrices) throw new Error("runtime camera matrices are not ready");
      return getCameraMatrices();
    },
    stepSequence: async (index, applyPose = true) => {
      if (!sequenceClock) throw new Error("sequence clock is not active");
      const state = sequenceClock.step(index);
      const setPose = runtime().setPose;
      if (!setPose) throw new Error("runtime pose setter is not ready");
      const currentPose = runtime().getPose?.();
      if (applyPose && (!currentPose || !samePose(currentPose, state.pose))) setPose(state.pose);
      await settleRuntime(runtime(), 1);
      return state;
    },
    endSequence: async () => {
      sequenceClock = null;
      setFinalDiagnosticState(runtime());
      await settleRuntime(runtime(), 1);
    },
    captureDiagnosticBuffer: async (kind) => {
      if (kind === "ownership" || kind === "coverage") {
        runtime().setAcceptanceSceneOptions?.({ farClipmapDebug: "ownership" });
        await settleRuntime(runtime(), 1);
        const canvas = document.querySelector("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("render canvas is missing");
        const dataUrl = canvas.toDataURL("image/png");
        setFinalDiagnosticState(runtime());
        await settleRuntime(runtime(), 1);
        return dataUrl;
      }
      const setBuffer = runtime().setQaDiagnosticBuffer;
      if (!setBuffer) throw new Error("runtime diagnostic-buffer capture is unavailable");
      if (kind === "final") setFinalDiagnosticState(runtime());
      else setBuffer(kind);
      await settleRuntime(runtime(), 1);
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("render canvas is missing");
      const dataUrl = canvas.toDataURL("image/png");
      if (kind !== "final") {
        setFinalDiagnosticState(runtime());
        await settleRuntime(runtime(), 1);
      }
      return dataUrl;
    },
    setDiagnosticBuffer: async (kind) => {
      if (kind === "ownership" || kind === "coverage") {
        runtime().setAcceptanceSceneOptions?.({ farClipmapDebug: "ownership" });
        await settleRuntime(runtime(), 1);
        return;
      }
      const setBuffer = runtime().setQaDiagnosticBuffer;
      if (!setBuffer) throw new Error("runtime diagnostic-buffer capture is unavailable");
      if (kind === "final") setFinalDiagnosticState(runtime());
      else setBuffer(kind);
      await settleRuntime(runtime(), 1);
    },
    runSequenceEvent: async (action) => {
      if (action === "streaming-off") runtime().setTerrainStreamingEnabled?.(false);
      else if (action === "streaming-off-reset") {
        runtime().setTerrainStreamingEnabled?.(false);
        const pose = runtime().getPose?.();
        if (pose) runtime().resetAcceptanceSceneForPose?.(pose);
      }
      else if (action === "streaming-on") runtime().setTerrainStreamingEnabled?.(true);
      else if (action === "ownership-debug") runtime().setAcceptanceSceneOptions?.({ farClipmapDebug: "ownership" });
      else setFinalDiagnosticState(runtime());
      await settleRuntime(runtime(), 1);
    },
  };
  window.__drusnielQa = hook;
  return hook;
}

function validateWorldState(state: QaWorldState): QaWorldState {
  const numericFields: Array<keyof QaWorldState> = [
    "timeOfDayHours",
    "sunElevationDeg",
    "sunAzimuthDeg",
    "windTimeS",
    "cloudTimeS",
    "particleTimeS",
  ];
  for (const field of numericFields) {
    const value = state[field];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`QA world state ${field} must be finite`);
    }
  }
  if (state.precipitation !== undefined && state.precipitation.trim().length === 0) {
    throw new Error("QA world state precipitation must not be empty");
  }
  return { ...state };
}

function setFinalDiagnosticState(runtime: ClodHooks): void {
  runtime.setAcceptanceSceneOptions?.({ farClipmapDebug: "final", proceduralDebug: "final" });
  runtime.setQaDiagnosticBuffer?.("final");
}

async function settleRuntime(runtime: ClodHooks, frames: number): Promise<void> {
  if (!runtime.settle) throw new Error("runtime settle hook is not ready");
  await runtime.settle(frames);
}

function samePose(a: { p: [number, number, number]; yaw: number; pitch: number; fov?: number }, b: { p: [number, number, number]; yaw: number; pitch: number; fov?: number }): boolean {
  const epsilon = 1e-6;
  return a.p.every((value, index) => Math.abs(value - b.p[index]!) <= epsilon)
    && Math.abs(a.yaw - b.yaw) <= epsilon
    && Math.abs(a.pitch - b.pitch) <= epsilon
    && Math.abs((a.fov ?? 60) - (b.fov ?? 60)) <= epsilon;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
