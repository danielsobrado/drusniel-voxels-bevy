import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RENDER_RESOLUTION_CONFIG } from "../render_resolution_config.js";
import {
  RENDER_RESOLUTION_CHANGED_EVENT,
  createRenderResolutionRuntime,
} from "../render_resolution_runtime.js";

class TestCustomEvent<T> extends Event {
  readonly detail: T;

  constructor(type: string, init: CustomEventInit<T>) {
    super(type);
    this.detail = init.detail as T;
  }
}

function installWindow(width: number, height: number, devicePixelRatio: number): void {
  const target = new EventTarget();
  vi.stubGlobal("CustomEvent", TestCustomEvent);
  vi.stubGlobal("window", {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
}

describe("createRenderResolutionRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies viewport changes and emits one change event", () => {
    installWindow(1920, 1080, 2);
    const runtime = createRenderResolutionRuntime(DEFAULT_RENDER_RESOLUTION_CONFIG, new URLSearchParams());
    const renderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    };
    const camera = {
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
    };
    const events: unknown[] = [];
    window.addEventListener(RENDER_RESOLUTION_CHANGED_EVENT, (event) => events.push((event as CustomEvent).detail));

    const first = runtime.applyCurrentViewport({ renderer, camera });
    const second = runtime.applyCurrentViewport({ renderer, camera });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(events).toHaveLength(1);
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(1);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(0.85);
    expect(renderer.setSize).toHaveBeenCalledTimes(1);
    expect(renderer.setSize).toHaveBeenCalledWith(1920, 1080);
    expect(camera.aspect).toBe(1920 / 1080);
    expect(camera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
  });

  it("preset changes force a new renderer apply", () => {
    installWindow(1920, 1080, 2);
    const runtime = createRenderResolutionRuntime(DEFAULT_RENDER_RESOLUTION_CONFIG, new URLSearchParams("quality_preset=high"));
    const renderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    };
    const camera = {
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
    };

    runtime.applyCurrentViewport({ renderer, camera });
    runtime.applyPreset("performance100");
    const next = runtime.applyCurrentViewport({ renderer, camera });

    expect(next.changed).toBe(true);
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(0.85);
    expect(runtime.current().physicalWidth).toBe(1632);
    expect(runtime.current().physicalHeight).toBe(918);
  });
});
