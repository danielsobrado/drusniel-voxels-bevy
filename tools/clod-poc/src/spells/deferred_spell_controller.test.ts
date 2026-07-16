import { describe, expect, it, vi } from "vitest";
import { createDeferredSpellController } from "./deferred_spell_controller.js";
import type { SpellVfxController } from "./spell_vfx_controller.js";

function fakeController(): SpellVfxController {
  return {
    playFire: vi.fn(),
    playWater: vi.fn(),
    playAir: vi.fn(),
    playEarth: vi.fn(() => true),
    playLightning: vi.fn(),
    playFireball: vi.fn(),
    update: vi.fn(),
    precompile: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("deferred spell controller", () => {
  it("returns from the input event before starting the spell", () => {
    const target = fakeController();
    const tasks = new Map<number, () => void>();
    let nextId = 1;
    const deferred = createDeferredSpellController(
      target,
      (task) => {
        const id = nextId++;
        tasks.set(id, task);
        return id;
      },
      (id) => { tasks.delete(id); },
    );

    deferred.controller.playFire(750);
    expect(target.playFire).not.toHaveBeenCalled();

    tasks.get(1)?.();
    expect(target.playFire).toHaveBeenCalledWith(750);
  });

  it("cancels queued casts when disposed", () => {
    const target = fakeController();
    const tasks = new Map<number, () => void>();
    const deferred = createDeferredSpellController(
      target,
      (task) => {
        tasks.set(1, task);
        return 1;
      },
      (id) => { tasks.delete(id); },
    );

    deferred.controller.playWater(500);
    deferred.dispose();
    tasks.get(1)?.();

    expect(target.playWater).not.toHaveBeenCalled();
  });
});
