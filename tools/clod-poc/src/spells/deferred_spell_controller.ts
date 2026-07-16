import type { SpellVfxController } from "./spell_vfx_controller.js";

export type SpellTaskScheduler = (task: () => void) => number;
export type SpellTaskCanceller = (taskId: number) => void;

export interface DeferredSpellController {
  controller: SpellVfxController;
  dispose(): void;
}

export function createDeferredSpellController(
  target: SpellVfxController,
  ready: Promise<unknown> = Promise.resolve(),
  schedule: SpellTaskScheduler = (task) => window.setTimeout(task, 0),
  cancel: SpellTaskCanceller = (taskId) => window.clearTimeout(taskId),
): DeferredSpellController {
  const pending = new Set<number>();
  let disposed = false;

  const enqueue = (task: () => void): void => {
    void ready.finally(() => {
      if (disposed) return;
      const taskId = schedule(() => {
        pending.delete(taskId);
        if (!disposed) task();
      });
      pending.add(taskId);
    });
  };

  return {
    controller: {
      playFire: (durationMs) => enqueue(() => target.playFire(durationMs)),
      playWater: (durationMs) => enqueue(() => target.playWater(durationMs)),
      playAir: (durationMs) => enqueue(() => target.playAir(durationMs)),
      playEarth: (durationMs) => {
        enqueue(() => target.playEarth(durationMs));
        return true;
      },
      playLightning: (durationMs) => enqueue(() => target.playLightning(durationMs)),
      playFireball: (durationMs) => enqueue(() => target.playFireball(durationMs)),
      update: (nowMs) => target.update(nowMs),
      precompile: (renderer) => target.precompile(renderer),
      dispose: () => undefined,
    },
    dispose() {
      disposed = true;
      for (const taskId of pending) cancel(taskId);
      pending.clear();
    },
  };
}
