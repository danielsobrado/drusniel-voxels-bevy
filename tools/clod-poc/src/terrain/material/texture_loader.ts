import * as THREE from "three";

export interface TerrainTextureLoadOptions {
  textureMipmapsEnabled: boolean;
  maxAnisotropy: number;
}

export function extensionForTexture(name: string, mimeType: string): string {
  const fromName = name.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

export function configureTerrainTexture(texture: THREE.Texture, options: TerrainTextureLoadOptions): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = options.textureMipmapsEnabled;
  texture.minFilter = options.textureMipmapsEnabled ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = options.textureMipmapsEnabled ? options.maxAnisotropy : 1;
  texture.needsUpdate = true;
}

// Normal maps are linear data, not colour — decoding them as sRGB skews the vectors.
export function configureNormalTexture(texture: THREE.Texture, options: TerrainTextureLoadOptions): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = options.textureMipmapsEnabled;
  texture.minFilter = options.textureMipmapsEnabled ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = options.textureMipmapsEnabled ? options.maxAnisotropy : 1;
  texture.needsUpdate = true;
}

export async function loadNormalMap(
  file: File,
  options: TerrainTextureLoadOptions,
): Promise<{
  texture: THREE.Texture;
  previewUrl: string;
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
} | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        configureNormalTexture(texture, options);
        const mimeType = file.type || "application/octet-stream";
        resolve({ texture, previewUrl: url, bytes, mimeType, extension: extensionForTexture(file.name, mimeType) });
      },
      undefined,
      () => {
        URL.revokeObjectURL(url);
        resolve(null);
      },
    );
  });
}

export function loadTerrainTextureUrl(
  url: string,
  options: TerrainTextureLoadOptions,
): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (texture) => {
        configureTerrainTexture(texture, options);
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });
}

export async function loadTerrainTexture(
  file: File,
  options: TerrainTextureLoadOptions,
): Promise<{
  texture: THREE.Texture;
  previewUrl: string;
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
} | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        configureTerrainTexture(texture, options);
        const mimeType = file.type || "application/octet-stream";
        resolve({
          texture,
          previewUrl: url,
          bytes,
          mimeType,
          extension: extensionForTexture(file.name, mimeType),
        });
      },
      undefined,
      () => {
        URL.revokeObjectURL(url);
        resolve(null);
      },
    );
  });
}
