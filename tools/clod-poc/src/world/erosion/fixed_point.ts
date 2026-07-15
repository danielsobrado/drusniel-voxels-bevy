import {
  FRACTION_Q16_ONE,
  HARDNESS_MAX,
  HEIGHT_UNITS_PER_METER,
  SEDIMENT_UNITS_PER_METER,
  VELOCITY_UNITS_PER_CELL,
  WATER_UNITS_PER_METER,
} from "./constants.js";

export interface U64Words { readonly hi: number; readonly lo: number }

export function clampU32(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 0xffffffff) return 0xffffffff;
  return Math.floor(value) >>> 0;
}

export function clampI32(value: number): number {
  if (!Number.isFinite(value)) return value < 0 ? -0x80000000 : 0x7fffffff;
  if (value <= -0x80000000) return -0x80000000;
  if (value >= 0x7fffffff) return 0x7fffffff;
  return Math.trunc(value) | 0;
}

export function metersToHeightFixed(value: number): number {
  return clampI32(Math.round(value * HEIGHT_UNITS_PER_METER));
}

export function heightFixedToMeters(value: number): number {
  return value / HEIGHT_UNITS_PER_METER;
}

export function metersToWaterFixed(value: number): number {
  return clampU32(Math.round(value * WATER_UNITS_PER_METER));
}

export function metersToSedimentFixed(value: number): number {
  return clampU32(Math.round(value * SEDIMENT_UNITS_PER_METER));
}

export function fractionToQ16(value: number): number {
  return clampU32(Math.round(value * FRACTION_Q16_ONE));
}

export function hardness01ToU16(value: number): number {
  return Math.min(HARDNESS_MAX, Math.max(0, Math.round(value * HARDNESS_MAX))) >>> 0;
}

export function velocityCellsToFixed(value: number): number {
  return clampI32(Math.round(value * VELOCITY_UNITS_PER_CELL));
}

export function multiplyU32Wide(a: number, b: number): U64Words {
  const ua = a >>> 0;
  const ub = b >>> 0;
  const a0 = ua & 0xffff;
  const a1 = ua >>> 16;
  const b0 = ub & 0xffff;
  const b1 = ub >>> 16;
  const p0 = a0 * b0;
  const p1 = a1 * b0 + a0 * b1;
  const p2 = a1 * b1;
  const carry = Math.floor(p0 / 0x10000) + (p1 & 0xffff);
  const lo = (((p0 & 0xffff) | ((carry & 0xffff) << 16)) >>> 0);
  const hi = (p2 + Math.floor(p1 / 0x10000) + Math.floor(carry / 0x10000)) >>> 0;
  return { hi, lo };
}

export function divideU64ByU32(value: U64Words, divisor: number): U64Words {
  const d = divisor >>> 0;
  if (d === 0) throw new Error("fixed-point division by zero");
  let quotientHi = 0;
  let quotientLo = 0;
  let remainder = 0;
  for (let bit = 63; bit >= 0; bit--) {
    const sourceBit = bit >= 32 ? (value.hi >>> (bit - 32)) & 1 : (value.lo >>> bit) & 1;
    remainder = remainder * 2 + sourceBit;
    if (remainder < d) continue;
    remainder -= d;
    if (bit >= 32) quotientHi = (quotientHi | (1 << (bit - 32))) >>> 0;
    else quotientLo = (quotientLo | (1 << bit)) >>> 0;
  }
  return { hi: quotientHi, lo: quotientLo };
}

export function ratioQ16U53(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) throw new Error("fixed-point numerator must be a non-negative safe integer");
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new Error("fixed-point denominator must be a positive safe integer");
  const scaled = numerator * FRACTION_Q16_ONE;
  if (!Number.isSafeInteger(scaled)) return numerator >= denominator ? FRACTION_Q16_ONE : 0;
  return clampU32(Math.floor(scaled / denominator));
}

export function mulDivU32(a: number, b: number, divisor: number): number {
  const quotient = divideU64ByU32(multiplyU32Wide(a, b), divisor);
  return quotient.hi === 0 ? quotient.lo : 0xffffffff;
}

export function mulQ16U32(value: number, factorQ16: number): number {
  return mulDivU32(value, factorQ16, FRACTION_Q16_ONE);
}

export function mulDivI32(a: number, b: number, divisor: number): number {
  if (divisor === 0) throw new Error("fixed-point division by zero");
  const negative = ((Number(a < 0) + Number(b < 0) + Number(divisor < 0)) & 1) !== 0;
  const ua = Math.abs(a);
  const ub = Math.abs(b);
  const ud = Math.abs(divisor);
  const quotient = mulDivU32(clampU32(ua), clampU32(ub), clampU32(ud));
  return clampI32(negative ? -quotient : quotient);
}

export function absI32(value: number): number {
  return value === -0x80000000 ? 0x7fffffff : Math.abs(value);
}

export function approximateHypotI32(x: number, z: number): number {
  const ax = absI32(x);
  const az = absI32(z);
  const high = Math.max(ax, az);
  const low = Math.min(ax, az);
  return clampI32(high + (low >>> 1));
}

export function hashU32(seed: number, x: number, z: number, iteration: number): number {
  let value = (seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77) ^ Math.imul(iteration | 0, 0xc2b2ae3d)) | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

export function bilinearWeightQ16(fractionXQ12: number, fractionZQ12: number, cornerX: 0 | 1, cornerZ: 0 | 1): number {
  const one = 1 << 12;
  const wx = cornerX === 0 ? one - fractionXQ12 : fractionXQ12;
  const wz = cornerZ === 0 ? one - fractionZQ12 : fractionZQ12;
  return mulDivU32(wx, wz, 1 << 8);
}
