import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";

export interface OwnershipRingDescriptor {
  name: "live" | "clod" | "far-shell-start";
  radiusM: number;
}

export function ownershipRingDescriptors(ownership: StreamingOwnershipRadii): OwnershipRingDescriptor[] {
  return [
    { name: "live", radiusM: ownership.liveRadiusM },
    { name: "clod", radiusM: ownership.clodRadiusM },
    { name: "far-shell-start", radiusM: ownership.farShellInnerM },
  ];
}
