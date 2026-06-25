import type { ProjectSessionState } from "../../project_archive.js";

export function assignArchiveFields<T extends object>(
  target: T,
  archive: ProjectSessionState,
  keys: readonly (keyof ProjectSessionState)[],
): void {
  const record = target as Record<string, unknown>;
  for (const key of keys) {
    record[key as string] = archive[key];
  }
}
