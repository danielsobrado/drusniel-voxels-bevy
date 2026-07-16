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
  it("returns from the input event before starting the spell", async () => {
    const target = fakeController();
    const tasks = new Map<number, () => void>();
    let nextId = 1;
    const deferred = createDeferredSpellController(
      target,
      Promise.resolve(),
      (task) => {
        const id = nextId++;
        tasks.set(id, task);
        return id;
      },
      (id) => { tasks.delete(id); },
    );

    deferred.controller.playFire(750);
    expect(target.playFire).not.toHaveBeenCalled();

    await Promise.resolve();
    tasks.get(1)?.();
    expect(target.playFire).toHaveBeenCalledWith(750);
  });

  it("waits for pipeline readiness before scheduling the cast", async () => {
    const target = fakeController();
    const tasks = new Map<number, () => void>();
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const deferred = createDeferredSpellController(
      target,
      ready,
      (task) => {
        tasks.set(1, task);
        return 1;
      },
    );

    deferred.controller.playLightning(500);
    await Promise.resolve();
    expect(tasks.size).toBe(0);

    resolveReady();
    await ready;
    await Promise.resolve();
    expect(tasks.size).toBe(1);
  });

  it("cancels queued casts when disposed", async () => {
    const target = fakeController();
    const tasks = new Map<number, () => void>();
    const deferred = createDeferredSpellController(
      target,
      Promise.resolve(),
      (task) => {
        tasks.set(1, task);
        return 1;
      },
      (id) => { tasks.delete(id); },
    );

    deferred.controller.playWater(500);
    await Promise.resolve();
    deferred.dispose();
    tasks.get(1)?.();

    expect(target.playWater).not.toHaveBeenCalled();
  });
});
