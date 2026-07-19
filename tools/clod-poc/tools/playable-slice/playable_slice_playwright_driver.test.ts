import { execFileSync } from "node:child_process";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  PlaywrightPlayableSliceDriver,
  setDownwardAimInPage,
} from "./playable_slice_playwright_driver.js";

describe("playable slice frame probe serialization", () => {
  it("does not depend on Node-side transpiler helpers in the browser callback", () => {
    const source = execFileSync(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      "import { installFrameProbeInPage } from './tools/playable-slice/playable_slice_playwright_driver.ts'; process.stdout.write(installFrameProbeInPage.toString())",
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(source).not.toContain("__name");
  });
});

describe("playable slice unlocked aiming", () => {
  it("changes pitch through the pose hook without changing yaw", () => {
    const setPose = vi.fn();
    const getPose = vi.fn()
      .mockReturnValueOnce({ p: [10, 20, 30], yaw: 1.25, pitch: 0, fov: 60 })
      .mockReturnValueOnce({ p: [10, 20, 30], yaw: 1.25, pitch: -0.9, fov: 60 });
    vi.stubGlobal("window", { __drusnielClod: { getPose, setPose } });

    expect(setDownwardAimInPage({ yaw: 1.25, pitch: -0.9 })).toEqual({ yaw: 1.25, pitch: -0.9 });
    expect(setPose).toHaveBeenCalledWith({ p: [10, 20, 30], yaw: 1.25, pitch: -0.9, fov: 60 });
    vi.unstubAllGlobals();
  });

  it("uses an unobstructed canvas point for both movement and clicking", async () => {
    const move = vi.fn(async () => undefined);
    const click = vi.fn(async () => undefined);
    const page = {
      evaluate: vi.fn(async () => false),
      viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
      mouse: { move, click },
    } as unknown as Page;

    const driver = new PlaywrightPlayableSliceDriver(page);
    await driver.pointerMoveToCenter();
    await driver.pointerClick("left");

    expect(move.mock.calls).toEqual([[641, 180], [640, 180]]);
    expect(click).toHaveBeenCalledWith(640, 180, { button: "left" });
  });
});
