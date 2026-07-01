export function booleanQueryParam(searchParams: URLSearchParams, key: string): boolean {
  const raw = searchParams.get(key);
  return raw !== null && raw !== "0" && raw !== "false";
}

export function positiveNumberQueryParam(searchParams: URLSearchParams, key: string, fallback: number): number {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
