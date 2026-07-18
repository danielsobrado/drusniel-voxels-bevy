import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  assertProjectArchiveInputSize,
  createProjectArchiveExtractionGuard,
  type ProjectArchiveLimits,
} from "./project_archive_limits.js";

const TEST_LIMITS: ProjectArchiveLimits = {
  maxArchiveBytes: 1024,
  maxEntries: 3,
  maxTotalUncompressedBytes: 32,
  maxEntryUncompressedBytes: 16,
  maxProjectJsonBytes: 16,
  maxPathLength: 40,
};

function extractWithGuard(files: Record<string, Uint8Array>, limits = TEST_LIMITS): Record<string, Uint8Array> {
  const archive = zipSync(files);
  assertProjectArchiveInputSize(archive.byteLength, limits);
  const guard = createProjectArchiveExtractionGuard(limits);
  const extracted = unzipSync(archive, { filter: (entry) => guard.filter(entry) });
  guard.verify(extracted);
  return extracted;
}

describe("project archive extraction limits", () => {
  it("accepts a bounded archive and verifies inflated sizes", () => {
    const extracted = extractWithGuard({
      "project.json": strToU8("{}"),
      "textures/a.png": new Uint8Array([1, 2, 3]),
    });
    expect(extracted["project.json"]).toEqual(strToU8("{}"));
  });

  it("rejects oversized compressed input before extraction", () => {
    expect(() => assertProjectArchiveInputSize(9, { ...TEST_LIMITS, maxArchiveBytes: 8 }))
      .toThrow(/compressed size limit/i);
  });

  it("rejects an oversized entry through the pre-extraction filter", () => {
    expect(() => extractWithGuard({
      "project.json": strToU8("{}"),
      "textures/a.png": new Uint8Array(17),
    })).toThrow(/uncompressed size limit/i);
  });

  it("rejects excessive total output and entry counts", () => {
    expect(() => extractWithGuard({
      "project.json": new Uint8Array(16),
      "textures/a.png": new Uint8Array(16),
      "textures/b.png": new Uint8Array(1),
    })).toThrow(/total uncompressed size limit/i);

    expect(() => extractWithGuard({
      "project.json": strToU8("{}"),
      "textures/a.png": new Uint8Array([1]),
      "textures/b.png": new Uint8Array([2]),
      "textures/c.png": new Uint8Array([3]),
    })).toThrow(/too many entries/i);
  });

  it("rejects traversal and platform-specific paths", () => {
    expect(() => extractWithGuard({
      "project.json": strToU8("{}"),
      "../outside.png": new Uint8Array([1]),
    })).toThrow(/unsafe path/i);
    expect(() => extractWithGuard({
      "project.json": strToU8("{}"),
      "C:/outside.png": new Uint8Array([1]),
    })).toThrow(/unsafe path/i);
  });
});
