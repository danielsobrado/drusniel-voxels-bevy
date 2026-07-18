import type { AsyncZippable, Zippable } from "fflate";
import {
  assertProjectArchiveInputSize,
  createProjectArchiveExtractionGuard,
} from "./project_archive_limits.js";

export async function encodeProjectArchive(files: Zippable): Promise<Uint8Array> {
  const { zip } = await import("fflate");
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files as AsyncZippable, (error, data) => {
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
  let filterError: unknown = null;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, {
      filter: (entry) => {
        if (filterError) return false;
        try {
          return extraction.filter(entry);
        } catch (error) {
          filterError = error;
          return false;
        }
      },
    }, (error, data) => {
      if (filterError) reject(filterError);
      else if (error) reject(error);
      else resolve(data);
    });
  });
  extraction.verify(files);
  return files;
}
