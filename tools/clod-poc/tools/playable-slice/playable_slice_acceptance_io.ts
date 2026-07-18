import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { PlayableSliceAcceptanceReport } from "./playable_slice_acceptance_types.js";

export function playableSliceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function closePlayableSlicePageBestEffort(page: Page, label: string): Promise<void> {
  if (page.isClosed()) return;
  try {
    await page.close();
  } catch (error) {
    console.error(`[playable-slice] ${label} page close failed: ${playableSliceErrorMessage(error)}`);
  }
}

export async function closePlayableSliceContextBestEffort(
  context: BrowserContext,
  label: string,
): Promise<string | null> {
  try {
    await context.close();
    return null;
  } catch (error) {
    const message = `${label} context close failed: ${playableSliceErrorMessage(error)}`;
    console.error(`[playable-slice] ${message}`);
    return message;
  }
}

export async function capturePlayableSliceScreenshot(page: Page, path: string, label: string): Promise<void> {
  if (page.isClosed()) return;
  mkdirSync(dirname(path), { recursive: true });
  try {
    await page.screenshot({ path, fullPage: false });
  } catch (error) {
    console.error(`[playable-slice] ${label} screenshot failed: ${playableSliceErrorMessage(error)}`);
  }
}

export function writePlayableSliceAcceptanceReport(
  path: string,
  report: PlayableSliceAcceptanceReport,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
