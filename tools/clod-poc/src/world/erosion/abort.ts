export function isErosionAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

export function throwErosionAbort(error: unknown, signal?: AbortSignal): never {
  if (signal?.reason instanceof Error) throw signal.reason;
  if (error instanceof Error) throw error;
  throw new DOMException("Erosion build cancelled", "AbortError");
}

export function assertErosionNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throwErosionAbort(signal.reason, signal);
}

export async function yieldErosionTask(signal?: AbortSignal): Promise<void> {
  assertErosionNotAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertErosionNotAborted(signal);
}
