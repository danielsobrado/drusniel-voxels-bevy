import type { Page } from "playwright";

const MIN_SETTLE_MS = 1_000;
const FRAME_SETTLE_MS = 80;
const IN_PAGE_TIMEOUT_MS = 15_000;

function navigationContextWasLost(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Execution context was destroyed")
    || message.includes("Cannot find context with specified id")
    || message.includes("Most likely because of a navigation");
}

export async function settlePage(page: Page, frames: number, timeoutMs: number): Promise<void> {
  const fallbackMs = Math.min(timeoutMs, Math.max(MIN_SETTLE_MS, frames * FRAME_SETTLE_MS));
  // The evaluated closure must be self-contained: it runs in the page, where
  // module-scope constants do not exist, so every input is passed as the arg.
  const settleInPage = page.evaluate(async (args: { frames: number; safetyMs: number }) => {
    const hooks = (window as typeof window & {
      __drusnielClod?: { settle?: ((frames?: number) => Promise<void>) | null };
    }).__drusnielClod;

    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const waitFrames = new Promise<void>((resolve) => {
      let remaining = Math.max(1, Math.floor(args.frames));
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
        else window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });
    const hookWait = hooks?.settle?.(args.frames) ?? waitFrames;
    const safetyWait = sleep(args.safetyMs);

    await Promise.race([hookWait, waitFrames, safetyWait]);
  }, { frames, safetyMs: Math.min(IN_PAGE_TIMEOUT_MS, Math.max(MIN_SETTLE_MS, frames * FRAME_SETTLE_MS)) });

  try {
    await Promise.race([settleInPage, page.waitForTimeout(fallbackMs)]);
  } catch (error) {
    if (!navigationContextWasLost(error)) throw error;
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 10_000) }).catch(() => undefined);
    await page.waitForTimeout(MIN_SETTLE_MS);
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
  if (appError) throw new Error(`app reported fatal error after settle(${frames}): ${appError}`);
}
