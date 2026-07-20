export type TreeMorphologyEvidenceMode = "off" | "age" | "competition";

export interface TreeImpostorCompetitionResponse {
  readonly effectiveAge: number;
  readonly crownWidthScale: number;
  readonly crownHeightScale: number;
  readonly foliageRetention: number;
  readonly health: number;
}

export function resolveTreeMorphologyEvidenceMode(
  searchParams: URLSearchParams | undefined,
): TreeMorphologyEvidenceMode {
  const value = searchParams?.get("treeMorphologyEvidence");
  return value === "age" || value === "competition" ? value : "off";
}

export function applyTreeImpostorCompetition(
  age: number,
  health: number,
  foliageRetention: number,
  competition: number,
): TreeImpostorCompetitionResponse {
  const pressure = clamp01(competition);
  const effectiveAge = clamp01(age - pressure * 0.12);
  return {
    effectiveAge,
    crownWidthScale: 1 - pressure * 0.16,
    crownHeightScale: 1 - pressure * 0.06,
    foliageRetention: clamp01(foliageRetention * (1 - pressure * 0.14)),
    health: clamp01(health * (1 - pressure * 0.10)),
  };
}

export function treeMorphologyEvidenceColor(
  mode: TreeMorphologyEvidenceMode,
  age: number,
  competition: number,
): readonly [number, number, number] {
  if (mode === "age") {
    const value = clamp01(age);
    return value < 0.5
      ? [0.1 + value * 1.2, 0.75, 0.16]
      : [0.7 + (value - 0.5) * 0.6, 0.75 - (value - 0.5) * 1.1, 0.12];
  }
  if (mode === "competition") {
    const pressure = clamp01(competition);
    return [0.15 + pressure * 0.85, 0.75 - pressure * 0.65, 0.12 + (1 - pressure) * 0.25];
  }
  return [1, 1, 1];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
