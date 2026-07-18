const RIVER_COBBLE_QUERY_KEYS = [
  "riverCobbles",
  "underwaterCobbles",
  "stoneRiverCobbles",
] as const;

export function riverCobbleGpuEnabled(search = currentSearch()): boolean {
  const params = new URLSearchParams(search);
  for (const key of RIVER_COBBLE_QUERY_KEYS) {
    if (!params.has(key)) continue;
    return parseFlag(params.get(key));
  }
  return false;
}

function currentSearch(): string {
  const location = (globalThis as typeof globalThis & { location?: { search?: string } }).location;
  return typeof location?.search === "string" ? location.search : "";
}

function parseFlag(value: string | null): boolean {
  if (value === null || value === "") return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}
