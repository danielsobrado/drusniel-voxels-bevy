export function createSettleManager(
  hooks: { settle: ((frames?: number) => Promise<void>) | null; ready?: boolean; progress?: number; progressMsg?: string },
  settleReadyFrames: number,
) {
  const settleWaiters: { frames: number; resolve: () => void }[] = [];
  hooks.settle = (frames = 8) => new Promise((resolve) => settleWaiters.push({ frames, resolve }));

  return {
    update(frame: number) {
      for (const w of settleWaiters) w.frames -= 1;
      const done = settleWaiters.filter((w) => w.frames <= 0);
      for (const w of done) w.resolve();
      for (const w of done) settleWaiters.splice(settleWaiters.indexOf(w), 1);
      if (!hooks.ready && frame >= settleReadyFrames) {
        (hooks as Record<string, unknown>).ready = true;
        (hooks as Record<string, unknown>).progress = 1;
        (hooks as Record<string, unknown>).progressMsg = "ready";
      }
    },
  };
}
