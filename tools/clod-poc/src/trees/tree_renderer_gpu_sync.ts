interface TreeRendererGpuQueue {
  onSubmittedWorkDone?: () => Promise<unknown>;
}

interface TreeRendererWithGpuQueue {
  backend?: {
    device?: {
      queue?: TreeRendererGpuQueue;
    };
  };
}

export async function waitForTreeRendererSubmittedWork(renderer: unknown): Promise<void> {
  const queue = (renderer as TreeRendererWithGpuQueue | null)?.backend?.device?.queue;
  if (typeof queue?.onSubmittedWorkDone !== "function") return;
  await queue.onSubmittedWorkDone();
}
