export interface StreamCenter {
  x: number;
  z: number;
}

export function streamCenterKey(center: StreamCenter): string {
  return `${Math.round(center.x)},${Math.round(center.z)}`;
}
