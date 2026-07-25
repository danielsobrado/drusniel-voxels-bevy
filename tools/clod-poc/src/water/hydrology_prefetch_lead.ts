/** Seconds of travel to lead the hydrology tile prefetch by, so the async worker builds
 *  tiles before the player reaches them. */
export const HYDROLOGY_PREFETCH_LEAD_SECONDS = 2;

/**
 * Bias the hydrology tile prefetch center ahead of the direction of travel so tiles stream
 * in before movement reaches them (tiles build asynchronously on a worker, so requesting
 * them only once the camera is on top of them lets a fast walker outrun streaming and hit
 * "unknown" water — which fails closed and freezes movement).
 *
 * The lead is capped to half the prefetch radius so the current cell always stays inside
 * the prefetched footprint: the fail-closed water gate guarding it must never be starved by
 * leading too far. A stationary (or purely rotating) camera leads by zero — identical to the
 * previous camera-centered behavior.
 */
export function leadHydrologyPrefetchCenter(
  camX: number,
  camZ: number,
  prevX: number,
  prevZ: number,
  deltaSeconds: number,
  radiusM: number,
  leadSeconds: number = HYDROLOGY_PREFETCH_LEAD_SECONDS,
): { x: number; z: number } {
  if (radiusM <= 0) return { x: camX, z: camZ };
  const dt = deltaSeconds > 1e-4 ? deltaSeconds : 1e-4;
  const vx = (camX - prevX) / dt;
  const vz = (camZ - prevZ) / dt;
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-3) return { x: camX, z: camZ };
  const lead = Math.min(speed * Math.max(0, leadSeconds), radiusM * 0.5);
  return { x: camX + (vx / speed) * lead, z: camZ + (vz / speed) * lead };
}
