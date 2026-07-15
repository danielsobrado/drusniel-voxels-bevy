import type { ErodedMacroField } from "../types.js";

export interface ErosionParityResult {
  readonly mismatchCount: number;
  readonly firstMismatchIndex: number;
  readonly channel: "height" | "hardness" | "sediment" | "deposition" | null;
}

export function compareErosionFields(expected: ErodedMacroField, actual: ErodedMacroField): ErosionParityResult {
  if (expected.width !== actual.width || expected.height !== actual.height
    || expected.cellSizeM !== actual.cellSizeM || expected.originX !== actual.originX || expected.originZ !== actual.originZ) {
    return { mismatchCount: 1, firstMismatchIndex: -1, channel: "height" };
  }
  let mismatchCount = 0;
  let firstMismatchIndex = -1;
  let channel: ErosionParityResult["channel"] = null;
  for (let index = 0; index < expected.heightFixed.length; index++) {
    const mismatchChannel = expected.heightFixed[index] !== actual.heightFixed[index] ? "height"
      : expected.hardness[index] !== actual.hardness[index] ? "hardness"
      : expected.sediment[index] !== actual.sediment[index] ? "sediment"
      : expected.deposition[index] !== actual.deposition[index] ? "deposition"
      : null;
    if (!mismatchChannel) continue;
    mismatchCount++;
    if (firstMismatchIndex < 0) {
      firstMismatchIndex = index;
      channel = mismatchChannel;
    }
  }
  return { mismatchCount, firstMismatchIndex, channel };
}

export function assertErosionParity(expected: ErodedMacroField, actual: ErodedMacroField): void {
  const result = compareErosionFields(expected, actual);
  if (result.mismatchCount > 0) {
    throw new Error(`erosion CPU/GPU mismatch count=${result.mismatchCount} first=${result.firstMismatchIndex} channel=${result.channel}`);
  }
}
