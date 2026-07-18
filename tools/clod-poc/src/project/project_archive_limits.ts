export interface ProjectArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxProjectJsonBytes: number;
  readonly maxPathLength: number;
}

export const PROJECT_ARCHIVE_LIMITS: ProjectArchiveLimits = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 64,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxProjectJsonBytes: 4 * 1024 * 1024,
  maxPathLength: 240,
});

export interface ProjectArchiveEntryInfo {
  readonly name: string;
  readonly size: number;
  readonly originalSize: number;
}

export interface ProjectArchiveExtractionGuard {
  readonly filter: (entry: ProjectArchiveEntryInfo) => boolean;
  readonly verify: (files: Readonly<Record<string, Uint8Array>>) => void;
}

function assertSafePath(path: string, limits: ProjectArchiveLimits): void {
  if (path.length < 1 || path.length > limits.maxPathLength) throw new Error("project archive contains an invalid path length");
  if (path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`project archive contains an unsafe path: ${path}`);
  }
  if (path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`project archive contains an unsafe path: ${path}`);
  }
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) throw new Error(`project archive contains an unsafe path: ${path}`);
  }
}

export function assertProjectArchiveInputSize(
  byteLength: number,
  limits: ProjectArchiveLimits = PROJECT_ARCHIVE_LIMITS,
): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error("project archive size is invalid");
  if (byteLength > limits.maxArchiveBytes) {
    throw new Error(`project archive exceeds the ${limits.maxArchiveBytes}-byte compressed size limit`);
  }
}

export function createProjectArchiveExtractionGuard(
  limits: ProjectArchiveLimits = PROJECT_ARCHIVE_LIMITS,
): ProjectArchiveExtractionGuard {
  const expectedSizes = new Map<string, number>();
  let totalUncompressedBytes = 0;

  const filter = (entry: ProjectArchiveEntryInfo): boolean => {
    assertSafePath(entry.name, limits);
    if (expectedSizes.has(entry.name)) throw new Error(`project archive contains duplicate path ${entry.name}`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
      throw new Error(`project archive contains invalid size metadata for ${entry.name}`);
    }
    if (expectedSizes.size + 1 > limits.maxEntries) throw new Error("project archive contains too many entries");
    const entryLimit = entry.name === "project.json" ? limits.maxProjectJsonBytes : limits.maxEntryUncompressedBytes;
    if (entry.originalSize > entryLimit) throw new Error(`project archive entry ${entry.name} exceeds its uncompressed size limit`);
    totalUncompressedBytes += entry.originalSize;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error("project archive exceeds the total uncompressed size limit");
    }
    expectedSizes.set(entry.name, entry.originalSize);
    return true;
  };

  const verify = (files: Readonly<Record<string, Uint8Array>>): void => {
    if (!expectedSizes.has("project.json")) throw new Error("The archive is missing project.json");
    if (Object.keys(files).length !== expectedSizes.size) throw new Error("project archive extracted entry count is inconsistent");
    for (const [path, expectedSize] of expectedSizes) {
      const file = files[path];
      if (!file || file.byteLength !== expectedSize) throw new Error(`project archive extracted size is inconsistent for ${path}`);
    }
  };

  return Object.freeze({ filter, verify });
}
