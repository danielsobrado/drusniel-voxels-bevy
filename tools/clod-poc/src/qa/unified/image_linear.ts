import sharp from "sharp";

export interface LinearImage {
  width: number;
  height: number;
  rgb: Float32Array;
}

export function srgb8ToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb8(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

export function rec709Luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function loadLinearImage(path: string): Promise<LinearImage> {
  const { data, info } = await sharp(path).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected RGB image at ${path}, got ${info.channels} channels`);
  const rgb = new Float32Array(info.width * info.height * 3);
  for (let i = 0; i < data.length; i++) rgb[i] = srgb8ToLinear(data[i] ?? 0);
  return { width: info.width, height: info.height, rgb };
}

export async function loadMask(path: string, width: number, height: number): Promise<Float32Array> {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error(`mask dimensions ${info.width}x${info.height} do not match ${width}x${height}`);
  const weights = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) weights[i] = (data[i] ?? 0) / 255;
  return weights;
}
