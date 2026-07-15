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
