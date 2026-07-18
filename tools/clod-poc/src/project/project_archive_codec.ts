import type { Zippable } from "fflate";
import {
  assertProjectArchiveInputSize,
  createProjectArchiveExtractionGuard,
} from "./project_archive_limits.js";

export async function encodeProjectArchive(files: Zippable): Promise<Uint8Array> {
  const { zip } = await import("fflate");
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
  assertProjectArchiveInputSize(archive.byteLength);
  return archive;
}

export async function decodeProjectArchive(
  bytes: Uint8Array,
): Promise<Record<string, Uint8Array>> {
  assertProjectArchiveInputSize(bytes.byteLength);
  const { unzip } = await import("fflate");
  const extraction = createProjectArchiveExtractionGuard();
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, { filter: (entry) => extraction.filter(entry) }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
  extraction.verify(files);
  return files;
}
