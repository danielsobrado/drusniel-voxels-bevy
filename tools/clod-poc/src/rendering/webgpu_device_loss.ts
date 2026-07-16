import { failLoud } from "../core/diagnostics.js";

export type DeviceLossReporter = (title: string, details: readonly string[]) => void;

export interface WebGpuDeviceLossActions {
  pauseSimulation(): void;
  preserveSave(): Promise<void>;
  reporter?: DeviceLossReporter;
  installControlledReload(callback: () => Promise<void>): void;
  reload(): void;
}

const SAVE_PRESERVATION_TIMEOUT_MS = 10_000;

function withTimeout(work: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    work.then(
      () => { clearTimeout(timer); resolve(); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

export async function handleWebGpuDeviceLoss(
  info: Pick<GPUDeviceLostInfo, "reason" | "message">,
  actions: WebGpuDeviceLossActions,
): Promise<void> {
  actions.pauseSimulation();
  let preservationLine = "Simulation paused and pending save regions flushed.";
  try {
    // A stalled flush must not block the fail-loud report — automation waits on it.
    await withTimeout(actions.preserveSave(), SAVE_PRESERVATION_TIMEOUT_MS);
  } catch (error) {
    preservationLine = `Save preservation failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  actions.installControlledReload(async () => {
    await actions.preserveSave();
    actions.reload();
  });
  (actions.reporter ?? failLoud)("WebGPU device lost", [
    `Reason: ${info.reason || "unknown"}`,
    info.message ? `Message: ${info.message}` : "No device-loss message was provided.",
    preservationLine,
    "Rendering cannot continue. Use the controlled recovery hook to flush once more and reload the current save.",
  ]);
}
