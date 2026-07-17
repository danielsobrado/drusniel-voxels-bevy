export function expandClodOwnershipToLevelZero(keys: readonly string[]): string[] {
  const expanded = new Map<string, { px: number; pz: number }>();
  for (const key of keys) {
    const page = parseClodPageKey(key);
    if (!page) continue;
    const scale = 2 ** page.level;
    for (let z = 0; z < scale; z++) {
      for (let x = 0; x < scale; x++) {
        const px = page.px * scale + x;
        const pz = page.pz * scale + z;
        expanded.set(`L0:${px},${pz}`, { px, pz });
      }
    }
  }
  return [...expanded.values()]
    .sort((a, b) => a.px - b.px || a.pz - b.pz)
    .map(({ px, pz }) => `L0:${px},${pz}`);
}

function parseClodPageKey(key: string): { level: number; px: number; pz: number } | null {
  const [levelText, coordText] = key.split(":");
  const [pxText, pzText] = (coordText ?? "").split(",");
  const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
  const px = Number(pxText);
  const pz = Number(pzText);
  if (!Number.isInteger(level) || level < 0 || !Number.isInteger(px) || !Number.isInteger(pz)) return null;
  return { level, px, pz };
}
