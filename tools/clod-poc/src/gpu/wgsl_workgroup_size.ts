export function normalizeGpuWorkgroupSize(size: number, fallback = 64): number {
  return size === 32 || size === 64 || size === 128 || size === 256 ? size : fallback;
}

export function replaceConstU32(source: string, constName: string, value: number): string {
  return source.replace(
    new RegExp(`const ${constName}: u32 = \\d+u;`),
    `const ${constName}: u32 = ${normalizeGpuWorkgroupSize(value)}u;`,
  );
}
