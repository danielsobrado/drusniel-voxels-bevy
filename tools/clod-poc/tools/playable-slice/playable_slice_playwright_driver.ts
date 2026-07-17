import type { Page } from "playwright";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import type {
  DiagnosticPlayableSliceDriver,
  PublicPlayableSliceDriver,
} from "./playable_slice_route.js";
import type { PlayableSliceActionRecord } from "./playable_slice_contract.js";

const READY_TIMEOUT_MS = 180_000;
const POLL_MS = 100;
const AIM_PITCH = -0.45;

async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hooks = window.__drusnielClod;
    return hooks?.error !== null && hooks?.error !== undefined
      ? true
      : hooks?.ready === true
        && typeof hooks.getPlayableSliceSnapshot === "function"
        && document.body.dataset.playerMode === "playing";
  }, undefined, { timeout: READY_TIMEOUT_MS, polling: 100 });
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

export class PlaywrightPlayableSliceDriver implements PublicPlayableSliceDriver {
  readonly actions: PlayableSliceActionRecord[] = [];
  maxFrameMs = 0;
  maxFrameP95Ms = 0;
  protected readonly page: Page;
  private readonly startedAtMs: number;

  constructor(page: Page) {
    this.page = page;
    this.startedAtMs = performance.now();
  }

  nowMs(): number {
    return performance.now() - this.startedAtMs;
  }

  async prepareDownwardAim(): Promise<void> {
    const edit = this.page.locator(".tf-edit-toggle input");
    const canvas = this.page.locator("canvas").first();
    await edit.waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
    await edit.uncheck();
    this.record("pointer", "disable terrain editing for aim capture");

    const box = await canvas.boundingBox();
    if (!box) throw new Error("renderer canvas has no visible bounds");
    const centerX = box.x + box.width * 0.5;
    const centerY = box.y + box.height * 0.5;
    await this.page.mouse.click(centerX, centerY, { button: "left" });
    this.record("pointer", "capture look pointer");
    await this.page.mouse.move(centerX, centerY);
    await this.page.mouse.move(centerX, centerY + Math.min(320, box.height * 0.35), { steps: 8 });
    this.record("pointer", "aim down at terrain");
    await this.page.waitForFunction(
      (pitch) => (window.__drusnielClod?.getPose?.().pitch ?? 0) <= pitch,
      AIM_PITCH,
      { timeout: 10_000, polling: 50 },
    );

    await this.page.keyboard.down("Tab");
    this.record("keyboard", "hold Tab for UI access");
    await edit.check();
    this.record("pointer", "enable terrain editing");
    await this.page.keyboard.up("Tab");
    this.record("keyboard", "release Tab and resume look");
  }

  async snapshot(): Promise<PlayableSliceSnapshot> {
    const snapshot = await this.page.evaluate(() => {
      const read = window.__drusnielClod?.getPlayableSliceSnapshot;
      if (!read) throw new Error("playable slice snapshot hook is unavailable");
      return read();
    });
    this.maxFrameMs = Math.max(this.maxFrameMs, snapshot.frameMs);
    this.maxFrameP95Ms = Math.max(this.maxFrameP95Ms, snapshot.frameMsP95);
    return snapshot;
  }

  async keyDown(key: string): Promise<void> {
    await this.page.keyboard.down(key);
    this.record("keyboard", `down:${key}`);
  }

  async keyUp(key: string): Promise<void> {
    await this.page.keyboard.up(key);
    this.record("keyboard", `up:${key}`);
  }

  async press(key: string, modifiers: readonly string[] = []): Promise<void> {
    for (const modifier of modifiers) await this.page.keyboard.down(modifier);
    await this.page.keyboard.press(key);
    for (const modifier of [...modifiers].reverse()) await this.page.keyboard.up(modifier);
    this.record("keyboard", `${modifiers.length > 0 ? `${modifiers.join("+")}+` : ""}${key}`);
  }

  async pointerMoveToCenter(): Promise<void> {
    const viewport = this.page.viewportSize();
    if (!viewport) throw new Error("playable slice requires a fixed viewport");
    await this.page.mouse.move(viewport.width * 0.5, viewport.height * 0.5);
    this.record("pointer", "move:center");
  }

  async pointerClick(button: "left" | "right"): Promise<void> {
    const viewport = this.page.viewportSize();
    if (!viewport) throw new Error("playable slice requires a fixed viewport");
    await this.page.mouse.click(viewport.width * 0.5, viewport.height * 0.5, { button });
    this.record("pointer", `click:${button}`);
  }

  async reload(): Promise<void> {
    this.record("navigation", "reload saved world");
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
    await waitForAppReady(this.page);
  }

  async waitUntil(
    label: string,
    predicate: (snapshot: PlayableSliceSnapshot) => boolean,
    timeoutMs = 30_000,
  ): Promise<PlayableSliceSnapshot> {
    const deadline = performance.now() + timeoutMs;
    let latest = await this.snapshot();
    while (!predicate(latest)) {
      if (performance.now() >= deadline) {
        throw new Error(`${label} timed out after ${timeoutMs}ms; latest=${JSON.stringify(latest)}`);
      }
      await this.page.waitForTimeout(POLL_MS);
      latest = await this.snapshot();
    }
    return latest;
  }

  protected record(channel: PlayableSliceActionRecord["channel"], action: string): void {
    this.actions.push({ channel, action, atMs: this.nowMs() });
  }
}

export class PlaywrightDiagnosticSliceDriver
  extends PlaywrightPlayableSliceDriver
  implements DiagnosticPlayableSliceDriver {
  async diagnosticBarrier(label: string): Promise<void> {
    this.record("diagnostic_barrier", label);
    await this.page.evaluate(async () => {
      await window.__drusnielClod?.settle?.(30);
    });
  }
}

export async function preparePlayableSlicePage(page: Page): Promise<void> {
  await waitForAppReady(page);
}
