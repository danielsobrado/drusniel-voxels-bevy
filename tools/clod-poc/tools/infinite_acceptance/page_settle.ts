import type { Page } from "playwright";

const MIN_SETTLE_MS = 1_000;
const FRAME_SETTLE_MS = 80;
const MIN_RENDERED_FRAME_TIMEOUT_MS = 10_000;

function navigationContextWasLost(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Execution context was destroyed")
    || message.includes("Cannot find context with specified id")
    || message.includes("Most likely because of a navigation");
}

function renderedFrameTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes("rendered frame");
}

export async function settlePage(page: Page, frames: number, timeoutMs: number): Promise<void> {
  const frameCount = Math.max(1, Math.floor(frames));
  const fallbackMs = Math.min(timeoutMs, Math.max(MIN_SETTLE_MS, MIN_RENDERED_FRAME_TIMEOUT_MS, frameCount * FRAME_SETTLE_MS));

  const settleInPage = page.evaluate(async (args: { frames: number }) => {
    const hooks = (window as typeof window & {
      __drusnielClod?: { settle?: ((frames?: number) => Promise<void>) | null };
    }).__drusnielClod;

    const waitFrames = new Promise<void>((resolve) => {
      let remaining = Math.max(1, Math.floor(args.frames));
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
        else window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });

    await (hooks?.settle?.(args.frames) ?? waitFrames);
  }, { frames: frameCount });

  try {
    await Promise.race([
      settleInPage,
      page.waitForTimeout(fallbackMs).then(() => {
        throw new Error(`timed out waiting for ${frameCount} rendered frame(s)`);
      }),
    ]);
  } catch (error) {
    if (navigationContextWasLost(error)) {
      await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 10_000) }).catch(() => undefined);
      await page.waitForTimeout(MIN_SETTLE_MS);
    } else if (!renderedFrameTimeout(error)) {
      throw error;
    }
  }

  const appError = await page.evaluate(() => {
    const hooks = (window as typeof window & {
      __drusnielClod?: { error?: string | null };
    }).__drusnielClod;
    return hooks?.error ?? null;
  }).catch((error: unknown) => {
    if (navigationContextWasLost(error)) return null;
    throw error;
  });
  if (appError) throw new Error(`app reported fatal error after settle(${frameCount}): ${appError}`);
}
