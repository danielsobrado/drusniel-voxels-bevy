const PROJECT_IMPORT_RECOVERY_KEY = "drusniel:project-import-recovery:v1";
const PROJECT_IMPORT_RECOVERY_MAX_AGE_MS = 30 * 60 * 1000;

interface ProjectImportRecoveryRecord {
  token: string;
  fallbackSearch: string;
  createdAtMs: number;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function normalizedFallbackSearch(value: string): string {
  if (value === "") return "";
  if (!value.startsWith("?")) throw new Error("project import fallback search is invalid");
  const params = new URLSearchParams(value.slice(1));
  params.delete("import");
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseRecord(raw: string | null, nowMs: number): ProjectImportRecoveryRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ProjectImportRecoveryRecord>;
    if (typeof value.token !== "string" || value.token.length < 1 || value.token.length > 256) return null;
    if (typeof value.fallbackSearch !== "string") return null;
    if (typeof value.createdAtMs !== "number" || !Number.isFinite(value.createdAtMs)) return null;
    if (nowMs - value.createdAtMs > PROJECT_IMPORT_RECOVERY_MAX_AGE_MS) return null;
    return {
      token: value.token,
      fallbackSearch: normalizedFallbackSearch(value.fallbackSearch),
      createdAtMs: value.createdAtMs,
    };
  } catch {
    return null;
  }
}

export function armProjectImportRecovery(
  token: string,
  fallbackSearch: string,
  nowMs = Date.now(),
): void {
  if (token.length < 1 || token.length > 256) throw new Error("project import token is invalid");
  if (!Number.isFinite(nowMs)) throw new Error("project import recovery timestamp is invalid");
  const target = storage();
  if (!target) return;
  const record: ProjectImportRecoveryRecord = {
    token,
    fallbackSearch: normalizedFallbackSearch(fallbackSearch),
    createdAtMs: nowMs,
  };
  target.setItem(PROJECT_IMPORT_RECOVERY_KEY, JSON.stringify(record));
}

export function confirmProjectImportRecoveryToken(token: string, nowMs = Date.now()): boolean {
  const target = storage();
  if (!target) return false;
  const record = parseRecord(target.getItem(PROJECT_IMPORT_RECOVERY_KEY), nowMs);
  if (!record || record.token !== token) {
    target.removeItem(PROJECT_IMPORT_RECOVERY_KEY);
    return false;
  }
  return true;
}

export function completeProjectImportRecovery(): void {
  storage()?.removeItem(PROJECT_IMPORT_RECOVERY_KEY);
}

export function recoverFailedProjectImport(nowMs = Date.now()): boolean {
  const target = storage();
  if (!target) return false;
  const record = parseRecord(target.getItem(PROJECT_IMPORT_RECOVERY_KEY), nowMs);
  target.removeItem(PROJECT_IMPORT_RECOVERY_KEY);
  if (!record || typeof location === "undefined") return false;

  const fallbackUrl = `${location.pathname}${record.fallbackSearch}${location.hash}`;
  const currentUrl = `${location.pathname}${location.search}${location.hash}`;
  if (fallbackUrl === currentUrl) return false;
  location.replace(fallbackUrl);
  return true;
}
