const reportedFallbacks = new Set<string>();

export function reportGpuCpuFallback(
  scope: string,
  reason: unknown,
  dedupeKey?: string,
): void {
  const message = fallbackReason(reason);
  const key = `${scope}:${dedupeKey ?? message}`;
  if (reportedFallbacks.has(key)) return;
  reportedFallbacks.add(key);

  const prefix = `[${scope}] GPU path failed; falling back to CPU: ${message}`;
  if (reason instanceof Error) console.error(prefix, reason);
  else console.error(prefix);
}

export function resetGpuCpuFallbackLogForTests(): void {
  reportedFallbacks.clear();
}

function fallbackReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  const message = String(reason).trim();
  return message || "unknown GPU failure";
}
