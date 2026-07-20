import { describe, expect, it, vi } from "vitest";
import type { WaterClipmap } from "../../water/index.js";
import { installWaterFoamTimeFreeze } from "./water_foam_time_freeze.js";

function clipmapFixture() {
  const update = vi.fn();
  const clipmap = { update } as unknown as WaterClipmap;
  return { clipmap, update };
}

describe("water foam time freeze", () => {
  it("passes normal frame deltas while unfrozen", () => {
    const { clipmap, update } = clipmapFixture();
    const controller = installWaterFoamTimeFreeze(clipmap);
    const camera = {} as Parameters<WaterClipmap["update"]>[1];

    clipmap.update(0.25, camera);

    expect(controller.getState()).toEqual({ frozen: false });
    expect(update).toHaveBeenCalledWith(0.25, camera);
  });

  it("keeps camera updates while replacing only the delta with zero", () => {
    const { clipmap, update } = clipmapFixture();
    const controller = installWaterFoamTimeFreeze(clipmap);
    const camera = {} as Parameters<WaterClipmap["update"]>[1];

    expect(controller.setFrozen(true)).toEqual({ frozen: true });
    clipmap.update(0.25, camera);

    expect(update).toHaveBeenCalledWith(0, camera);
  });

  it("restores normal deltas immediately when unfrozen", () => {
    const { clipmap, update } = clipmapFixture();
    const controller = installWaterFoamTimeFreeze(clipmap);
    const camera = {} as Parameters<WaterClipmap["update"]>[1];

    controller.setFrozen(true);
    clipmap.update(0.25, camera);
    controller.setFrozen(false);
    clipmap.update(0.5, camera);

    expect(update.mock.calls).toEqual([[0, camera], [0.5, camera]]);
  });

  it("does not stack wrappers when installed more than once", () => {
    const { clipmap, update } = clipmapFixture();
    const first = installWaterFoamTimeFreeze(clipmap);
    const second = installWaterFoamTimeFreeze(clipmap);
    const camera = {} as Parameters<WaterClipmap["update"]>[1];

    expect(second).toBe(first);
    second.setFrozen(true);
    clipmap.update(1, camera);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(0, camera);
  });
});
