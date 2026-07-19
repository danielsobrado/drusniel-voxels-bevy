const LEVEL_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0.36, 0.62, 0.95],
  [0.30, 0.86, 0.58],
  [0.94, 0.74, 0.30],
  [0.95, 0.42, 0.46],
  [0.66, 0.46, 0.94],
  [0.42, 0.78, 0.92],
];

export function waterLevelColor(level: number): [number, number, number] {
  const index = Math.max(0, Math.min(LEVEL_PALETTE.length - 1, Math.floor(level)));
  const color = LEVEL_PALETTE[index];
  return [color[0], color[1], color[2]];
}
