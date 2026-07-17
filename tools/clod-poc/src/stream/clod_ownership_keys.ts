let renderedRootKeySource: (() => readonly string[]) | null = null;

export function setRenderedClodOwnershipKeySource(
  source: (() => readonly string[]) | null,
): void {
  renderedRootKeySource = source;
}

export function expandClodOwnershipToLevelZero(keys: readonly string[]): string[] {
  const expanded = new Set<string>();
  const sourceKeys = renderedRootKeySource?.() ?? keys;
  for (const key of sourceKeys) {
    const page = parseClodPageKey(key);
    if (!page) continue;
    const scale = 2 ** page.level;
    for (let z = 0; z < scale; z++) {
      for (let x = 0; x < scale; x++) {
        const px = page.px * scale + x;
        const pz = page.pz * scale + z;
        expanded.add(`L0:${px},${pz}`);
      }
    }
  }
  return [...expanded].sort();
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
