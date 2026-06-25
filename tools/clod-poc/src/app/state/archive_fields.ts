export function assignArchiveFields<T extends object, S extends object>(
  target: T,
  archive: S,
  keys: readonly (keyof T & keyof S)[],
): void {
  const record = target as Record<string, unknown>;
  for (const key of keys) {
    record[key as string] = archive[key];
  }
}
