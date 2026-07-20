export const OCEAN_RIM_QUERY_KEY = "oceanRim";
export const OCEAN_RIM_QUERY_ALIAS = "ocean_rim";

function queryBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false";
}

export function oceanRimEnabled(params: URLSearchParams, fallback = false): boolean {
  return queryBoolean(
    params.get(OCEAN_RIM_QUERY_KEY) ?? params.get(OCEAN_RIM_QUERY_ALIAS),
    fallback,
  );
}

export function setOceanRimQuery(params: URLSearchParams, enabled: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(OCEAN_RIM_QUERY_KEY, enabled ? "1" : "0");
  next.delete(OCEAN_RIM_QUERY_ALIAS);
  return next;
}

export function ensureOceanRimQueryDefault(params: URLSearchParams): URLSearchParams {
  if (params.has(OCEAN_RIM_QUERY_KEY) || params.has(OCEAN_RIM_QUERY_ALIAS)) {
    return new URLSearchParams(params);
  }
  return setOceanRimQuery(params, false);
}

export function installOceanRimQueryDefault(): void {
  const current = new URLSearchParams(location.search);
  const next = ensureOceanRimQueryDefault(current);
  if (next.toString() === current.toString()) return;

  const query = next.toString();
  history.replaceState(
    null,
    "",
    `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
  );
}
