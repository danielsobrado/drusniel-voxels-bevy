export function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readNumberTuple(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1])];
  }
  return [...fallback] as [number, number];
}

export function readColorTuple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1]), readNumber(value[2], fallback[2])];
  }
  return [...fallback] as [number, number, number];
}

export function readNumberArray(value: unknown, fallback: number[]): number[] {
  if (Array.isArray(value)) {
    const numbers = value.map((entry, index) => readNumber(entry, fallback[index] ?? 0));
    return numbers.length > 0 ? numbers : [...fallback];
  }
  return [...fallback];
}

export function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
