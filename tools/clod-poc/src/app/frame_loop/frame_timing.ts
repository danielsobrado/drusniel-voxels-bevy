export const submitMsChanged = (a: number | null, b: number | null): boolean =>
  a === b ? false : a === null || b === null ? true : Math.abs(a - b) >= 0.05;
