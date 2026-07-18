import { BUILTIN_TERRAIN_TEXTURES } from "../terrain/material/terrain_builtin_textures.js";
import type { VoxelProjectArchiveContents } from "../project/voxel_project_archive.js";

export const PROJECT_TEXTURE_MAX_DIMENSION = 8192;
export const PROJECT_TEXTURE_MAX_PIXELS = 32 * 1024 * 1024;
const PROJECT_TEXTURE_DECODE_TIMEOUT_MS = 5_000;
const ALLOWED_PROJECT_TEXTURE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

interface ProjectTexturePayload {
  readonly path: string;
  readonly label: string;
  readonly mimeType: string | undefined;
}

function normalizedMimeType(value: string | undefined, label: string): string {
  const mimeType = value ?? "application/octet-stream";
  if (value !== undefined && !ALLOWED_PROJECT_TEXTURE_MIME_TYPES.has(value.toLowerCase())) {
    throw new Error(`${label} has unsupported MIME type ${value}`);
  }
  return mimeType;
}

async function validateDecodedTexture(
  bytes: Uint8Array,
  payload: ProjectTexturePayload,
): Promise<void> {
  const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
    type: normalizedMimeType(payload.mimeType, payload.label),
  });
  const previewUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error(`${payload.label} decode timed out`)),
        PROJECT_TEXTURE_DECODE_TIMEOUT_MS,
      );
      image.onload = () => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
          finish(new Error(`${payload.label} has invalid dimensions`));
          return;
        }
        if (width > PROJECT_TEXTURE_MAX_DIMENSION || height > PROJECT_TEXTURE_MAX_DIMENSION) {
          finish(new Error(`${payload.label} exceeds the ${PROJECT_TEXTURE_MAX_DIMENSION}px dimension limit`));
          return;
        }
        const pixels = width * height;
        if (!Number.isSafeInteger(pixels) || pixels > PROJECT_TEXTURE_MAX_PIXELS) {
          finish(new Error(`${payload.label} exceeds the decoded pixel budget`));
          return;
        }
        finish();
      };
      image.onerror = () => finish(new Error(`${payload.label} is not a decodable image`));
      image.src = previewUrl;
    });
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

export async function validateProjectArchiveTextures(contents: VoxelProjectArchiveContents): Promise<void> {
  const payloads = new Map<string, ProjectTexturePayload>();
  for (const slot of contents.manifest.textures) {
    if (slot.source === "builtin" && !BUILTIN_TERRAIN_TEXTURES.some((texture) => texture.id === slot.selectedId)) {
      throw new Error(`project.json references unknown built-in texture ${slot.selectedId}`);
    }
    if (slot.source !== "custom" && slot.customPath) {
      throw new Error(`project.json texture slot ${slot.index} has custom bytes without custom ownership`);
    }
    if (slot.source === "custom") {
      if (!slot.customPath) throw new Error(`project.json texture slot ${slot.index} is missing customPath`);
      payloads.set(slot.customPath, {
        path: slot.customPath,
        label: `Custom texture ${slot.name}`,
        mimeType: slot.mimeType,
      });
    }
    if (slot.normalPath) {
      payloads.set(slot.normalPath, {
        path: slot.normalPath,
        label: `Normal map ${slot.name}`,
        mimeType: slot.normalMimeType,
      });
    }
  }

  for (const payload of payloads.values()) {
    const bytes = contents.customTextures.get(payload.path);
    if (!bytes) throw new Error(`The archive is missing ${payload.path}`);
    await validateDecodedTexture(bytes, payload);
  }
}
