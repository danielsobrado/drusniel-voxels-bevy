let understoryDepthPrepassEnabled = false;

export function setUnderstoryDepthPrepassEnabled(enabled: boolean): void {
  understoryDepthPrepassEnabled = enabled;
}

export function getUnderstoryDepthPrepassEnabled(): boolean {
  return understoryDepthPrepassEnabled;
}

export function understoryDepthPrepassFromQuery(searchParams: URLSearchParams): boolean {
  const raw = searchParams.get("understoryDepthPrepass") ?? searchParams.get("understoryPrepass");
  return raw === "1" || raw === "true";
}
