import { rec709Luminance, type LinearImage } from "./image_linear.js";

export function sobelMagnitudes(image: LinearImage): Float32Array {
  const luminance = new Float32Array(image.width * image.height);
  for (let pixel = 0; pixel < luminance.length; pixel++) {
    const offset = pixel * 3;
    luminance[pixel] = rec709Luminance(image.rgb[offset] ?? 0, image.rgb[offset + 1] ?? 0, image.rgb[offset + 2] ?? 0);
  }
  const output = new Float32Array(luminance.length);
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const i = y * image.width + x;
      const tl = luminance[i - image.width - 1] ?? 0;
      const tc = luminance[i - image.width] ?? 0;
      const tr = luminance[i - image.width + 1] ?? 0;
      const ml = luminance[i - 1] ?? 0;
      const mr = luminance[i + 1] ?? 0;
      const bl = luminance[i + image.width - 1] ?? 0;
      const bc = luminance[i + image.width] ?? 0;
      const br = luminance[i + image.width + 1] ?? 0;
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      output[i] = Math.hypot(gx, gy);
    }
  }
  return output;
}
