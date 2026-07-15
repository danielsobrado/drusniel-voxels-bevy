import { afterEach, describe, expect, it } from "vitest";
import { bindBootstrapDisposal } from "./disposal_startup.js";
import type { UiStartupContext } from "./ui_startup_context.js";

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

function disposable(calls: string[], name: string): { dispose: () => void } {
  return { dispose: () => { calls.push(name); } };
}

describe("bindBootstrapDisposal", () => {
  it("stops the animation loop before destroying frame-owned resources", () => {
    const listeners = new Map<string, () => void>();
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener);
      },
    };

    const calls: string[] = [];
    const ctx = {
      session: {
        frameLoopAbortController: { abort: () => { calls.push("abort"); } },
      },
      input: {
        renderer: { setAnimationLoop: (callback: unknown) => { calls.push(callback === null ? "stop-loop" : "set-loop"); } },
        clodWorker: { dispose: () => { calls.push("worker"); } },
        getClodErrorCompute: () => ({ destroy: () => { calls.push("clod-compute"); } }),
        runtime: {
          grassSystem: disposable(calls, "grass"),
          forestLightingController: disposable(calls, "forest-lighting"),
          treeController: disposable(calls, "trees"),
          dressingSystem: disposable(calls, "dressing"),
          stoneSystem: disposable(calls, "stones"),
          waterController: disposable(calls, "water"),
          weatherController: disposable(calls, "weather"),
          customProps: null,
        },
        terrainView: {
          nearFieldBubbleController: disposable(calls, "near-field"),
          renderNodeCache: disposable(calls, "render-cache"),
          pageGeometryCache: disposable(calls, "geometry-cache"),
          lockedBorderOverlay: disposable(calls, "locked-border"),
          skyEnvironment: disposable(calls, "sky"),
          postProcess: disposable(calls, "post-process"),
          farShellController: disposable(calls, "far-shell"),
          shadowProxyController: null,
        },
        longView: {
          infiniteFarShell: disposable(calls, "infinite-far-shell"),
        },
      },
    } as unknown as UiStartupContext;

    bindBootstrapDisposal(ctx);
    listeners.get("beforeunload")?.();

    expect(calls.slice(0, 2)).toEqual(["abort", "stop-loop"]);
    expect(calls).toContain("clod-compute");
    expect(calls).toContain("dressing");
  });
});
