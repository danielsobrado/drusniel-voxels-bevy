import type { Page } from "playwright";
import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import type {
  DiagnosticPlayableSliceDriver,
  PublicPlayableSliceDriver,
} from "./playable_slice_route.js";
import type {
  PlayableSliceActionRecord,
  PlayableSliceStepEvidence,
} from "./playable_slice_contract.js";
import { frameP95Ms } from "./playable_slice_frame_metrics.js";

const READY_TIMEOUT_MS = 180_000;
const POINTER_LOCK_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
const AIM_PITCH = -0.9;
const AIM_POINTER_DELTA_PX = 600;

interface PlayableSliceFrameProbe {
  maxFrameMs: number;
  lastFrameAtMs: number;
  samplesMs: number[];
  tick(): void;
}

interface DrainedFrameProbe {
  maxFrameMs: number;
  samplesMs: number[];
}

export function installFrameProbeInPage(): void {
  const target = window as typeof window & {
    __drusnielPlayableSliceFrameProbe?: PlayableSliceFrameProbe;
  };
  if (target.__drusnielPlayableSliceFrameProbe) return;
  const state: PlayableSliceFrameProbe = {
    maxFrameMs: 0,
    lastFrameAtMs: 0,
    samplesMs: [],
    tick() {
      // Prefer the app's measured frame time over rAF interval (rAF ≠ GPU/render frame).
      const stats = window.__drusnielClod?.stats;
      const frameMs = typeof stats?.frameMs === "number" ? stats.frameMs : null;
      if (frameMs !== null && Number.isFinite(frameMs) && frameMs >= 0) {
        state.maxFrameMs = Math.max(state.maxFrameMs, frameMs);
        state.samplesMs.push(frameMs);
        state.lastFrameAtMs = performance.now();
      }
      requestAnimationFrame(state.tick);
    },
  };
  target.__drusnielPlayableSliceFrameProbe = state;
  requestAnimationFrame(state.tick);
}

function drainFrameProbeInPage(): DrainedFrameProbe {
  const probe = (window as typeof window & {
    __drusnielPlayableSliceFrameProbe?: PlayableSliceFrameProbe;
  }).__drusnielPlayableSliceFrameProbe;
  if (!probe) throw new Error("playable slice frame probe is unavailable");
  const result = { maxFrameMs: probe.maxFrameMs, samplesMs: probe.samplesMs.splice(0) };
  probe.maxFrameMs = 0;
  return result;
}

async function ensureFrameProbe(page: Page): Promise<void> {
  await page.evaluate(installFrameProbeInPage);
}

async function resetFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as typeof window & {
      __drusnielPlayableSliceFrameProbe?: PlayableSliceFrameProbe;
    }).__drusnielPlayableSliceFrameProbe;
    if (!probe) throw new Error("playable slice frame probe is unavailable");
    probe.maxFrameMs = 0;
    probe.samplesMs.length = 0;
    probe.lastFrameAtMs = performance.now();
  });
}

async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hooks = window.__drusnielClod;
    if (!hooks) return false;
    if (hooks.error !== null) return true;
    return hooks.ready === true
      && typeof hooks.getPlayableSliceSnapshot === "function"
      && document.body.dataset.playerMode === "playing";
  }, undefined, { timeout: READY_TIMEOUT_MS, polling: 100 });
  const error = await page.evaluate(() => window.__drusnielClod?.error ?? null);
  if (error) throw new Error(error);
}

export class PlaywrightPlayableSliceDriver implements PublicPlayableSliceDriver {
  readonly actions: PlayableSliceActionRecord[] = [];
  readonly evidence: PlayableSliceStepEvidence[] = [];
  maxFrameMs = 0;
  maxFrameP95Ms = 0;
  protected readonly page: Page;
  private readonly startedAtMs: number;
  private readonly frameSamplesMs: number[] = [];
  private unlockedAimPoint: { x: number; y: number } | null = null;

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
    await this.waitForPointerLock(true);

    await this.page.mouse.move(centerX, centerY);
    await this.page.mouse.move(centerX, centerY + AIM_POINTER_DELTA_PX, { steps: 12 });
    this.record("pointer", "aim steeply down at terrain");
    await this.page.waitForFunction(
      (pitch) => (window.__drusnielClod?.getPose?.().pitch ?? 0) <= pitch,
      AIM_PITCH,
      { timeout: POINTER_LOCK_TIMEOUT_MS, polling: 50 },
    );

    await this.page.keyboard.down("Tab");
    this.record("keyboard", "hold Tab for UI access");
    await this.waitForPointerLock(false);
    await edit.check();
    this.record("pointer", "enable terrain editing");
    await this.page.keyboard.up("Tab");
    this.record("keyboard", "release Tab; gameplay click reacquires pointer lock if needed");
    await resetFrameProbe(this.page);
    this.frameSamplesMs.length = 0;
    this.maxFrameMs = 0;
    this.maxFrameP95Ms = 0;
  }

  async collectFrameMetrics(): Promise<void> {
    const drained = await this.page.evaluate(drainFrameProbeInPage);
    this.maxFrameMs = Math.max(this.maxFrameMs, drained.maxFrameMs);
    this.frameSamplesMs.push(...drained.samplesMs);
    this.maxFrameP95Ms = frameP95Ms(this.frameSamplesMs);
  }

  async snapshot(): Promise<PlayableSliceSnapshot> {
    const result = await this.page.evaluate(() => {
      const read = window.__drusnielClod?.getPlayableSliceSnapshot;
      if (!read) throw new Error("playable slice snapshot hook is unavailable");
      return read();
    });
    await this.collectFrameMetrics();
    this.maxFrameMs = Math.max(this.maxFrameMs, result.frameMs);
    return result;
  }

  recordEvidence(item: PlayableSliceStepEvidence): void {
    this.evidence.push(item);
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
    try {
      await this.page.keyboard.press(key);
    } finally {
      for (const modifier of [...modifiers].reverse()) await this.page.keyboard.up(modifier);
    }
    this.record("keyboard", `${modifiers.length > 0 ? `${modifiers.join("+")}+` : ""}${key}`);
  }

  async pointerMoveToCenter(): Promise<void> {
    const pointerLocked = await this.page.evaluate(() => document.pointerLockElement !== null);
    if (!pointerLocked) {
      const viewport = this.page.viewportSize();
      if (!viewport) throw new Error("playable slice requires a fixed viewport");
      const centerX = viewport.width * 0.5;
      const aimY = viewport.height * 0.25;
      this.unlockedAimPoint = { x: centerX, y: aimY };
      await this.page.mouse.move(centerX + 1, aimY);
      await this.page.mouse.move(centerX, aimY);
    }
    this.record("pointer", pointerLocked ? "retain locked center aim" : "move:center");
  }

  async pointerClick(button: "left" | "right"): Promise<void> {
    const pointerLocked = await this.page.evaluate(() => document.pointerLockElement !== null);
    if (pointerLocked) {
      await this.page.mouse.down({ button });
      await this.page.mouse.up({ button });
    } else {
      const viewport = this.page.viewportSize();
      if (!viewport) throw new Error("playable slice requires a fixed viewport");
      const aim = this.unlockedAimPoint ?? { x: viewport.width * 0.5, y: viewport.height * 0.5 };
      await this.page.mouse.click(aim.x, aim.y, { button });
    }
    this.record("pointer", `click:${button}`);
  }

  async waitForPointerLock(locked: boolean): Promise<void> {
    await this.page.waitForFunction(
      (expected) => (document.pointerLockElement !== null) === expected,
      locked,
      { timeout: POINTER_LOCK_TIMEOUT_MS, polling: 50 },
    );
  }

  async reload(): Promise<void> {
    await this.collectFrameMetrics();
    this.record("navigation", "reload saved world");
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
    await waitForAppReady(this.page);
    await ensureFrameProbe(this.page);
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
      const settle = window.__drusnielClod?.settle;
      if (!settle) throw new Error("diagnostic settle hook is unavailable");
      await settle(30);
    });
  }
}

export async function preparePlayableSlicePage(page: Page): Promise<void> {
  await page.addInitScript(installFrameProbeInPage);
  await waitForAppReady(page);
  await ensureFrameProbe(page);
}
