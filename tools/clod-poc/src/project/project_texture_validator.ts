import { BUILTIN_TERRAIN_TEXTURES } from "../terrain/material/terrain_builtin_textures.js";
import type { ProjectArchiveContents } from "../project/project_archive.js";

export async function validateProjectArchiveTextures(contents: ProjectArchiveContents): Promise<void> {
  for (const slot of contents.manifest.textures) {
    if (slot.source === "builtin" && !BUILTIN_TERRAIN_TEXTURES.some((texture) => texture.id === slot.selectedId)) {
      throw new Error(`project.json references unknown built-in texture ${slot.selectedId}`);
    }
    if (slot.source !== "custom" || !slot.customPath) continue;
    const bytes = contents.customTextures.get(slot.customPath);
    if (!bytes) throw new Error(`The archive is missing ${slot.customPath}`);
    const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
      type: slot.mimeType ?? "application/octet-stream",
    });
    const previewUrl = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        const timeout = window.setTimeout(() => reject(new Error("image decode timed out")), 5_000);
        image.onload = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        image.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("image decode failed"));
        };
        image.src = previewUrl;
      });
    } catch {
      throw new Error(`Custom texture ${slot.name} is not a decodable image`);
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  }
}
