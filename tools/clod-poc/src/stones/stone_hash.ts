// Deterministic integer hash for stone scatter. Mirrors the Rust project's
// `deterministic_hash` (src/props/mod.rs) so the eventual Rust port produces the same
// accept/jitter decisions from the same grid coords. Stable integer mixing (not sin-based)
// so it does not band at large world coordinates.

/** Hash a 2D grid cell + 32-bit salt to a uniform value in [0, 1). */
export function hash2(x: number, z: number, salt: number): number {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(z | 0, 668265263) +
      Math.imul(salt | 0, 1274126177)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

/** Hash to a signed value in [-1, 1). */
export function hashSigned(x: number, z: number, salt: number): number {
  return hash2(x, z, salt) * 2 - 1;
}

/** Hash a 2D grid cell + salt to a 32-bit unsigned integer (e.g. to seed an Rng). */
export function hashU32(x: number, z: number, salt: number): number {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(z | 0, 668265263) +
      Math.imul(salt | 0, 1274126177)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return n >>> 0;
}
