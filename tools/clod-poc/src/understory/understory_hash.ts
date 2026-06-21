export function understoryHash2(x: number, z: number, seed: number): number {
  let value = seed | 0;
  value ^= Math.imul(Math.floor(x) | 0, 0x27d4eb2d);
  value ^= Math.imul(Math.floor(z) | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function understoryRandomSigned(x: number, z: number, seed: number): number {
  return understoryHash2(x, z, seed) * 2 - 1;
}
