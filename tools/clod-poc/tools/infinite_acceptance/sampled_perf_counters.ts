type JsonRecord = Record<string, unknown>;

export function withSampledPerfCounters(
  counters: Readonly<Record<string, number>>,
  phase0: JsonRecord,
): Record<string, number> {
  const report = phase0["report"];
  if (!report || typeof report !== "object") return { ...counters };
  const metrics = (report as JsonRecord)["metrics"];
  if (!metrics || typeof metrics !== "object") return { ...counters };
  const sampledP95 = Number((metrics as JsonRecord)["framePerf.p95.frameMs"]);
  if (!Number.isFinite(sampledP95) || sampledP95 < 0) return { ...counters };
  return { ...counters, frame_ms_p95: sampledP95 };
}
