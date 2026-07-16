export interface MovementSegment {
  label: string;
  frames: number;
  dx: number;
  dz: number;
}

export interface MovementRouteProfile {
  name: "walk" | "long-route";
  segments: readonly MovementSegment[];
  minHorizontalDistanceM: number;
  minFrameSamples: number;
  maxLiveBubbleEvictions: number;
  maxStreamEvictions: number;
}

const WALK_ROUTE: readonly MovementSegment[] = Object.freeze([
  { label: "east-a", frames: 180, dx: 160, dz: 0 },
  { label: "south-east", frames: 160, dx: 96, dz: 96 },
  { label: "east-b", frames: 120, dx: 128, dz: 0 },
]);

const LONG_ROUTE: readonly MovementSegment[] = Object.freeze([
  { label: "east-long-a", frames: 480, dx: 1_200, dz: 0 },
  { label: "south-east-long", frames: 360, dx: 600, dz: 600 },
  { label: "east-long-b", frames: 480, dx: 1_200, dz: 0 },
]);

export function resolveMovementRouteProfile(longRoute: boolean): MovementRouteProfile {
  return longRoute
    ? {
      name: "long-route",
      segments: LONG_ROUTE,
      minHorizontalDistanceM: 3_000,
      minFrameSamples: 1_024,
      maxLiveBubbleEvictions: 4_096,
      maxStreamEvictions: 4_096,
    }
    : {
      name: "walk",
      segments: WALK_ROUTE,
      minHorizontalDistanceM: 48,
      minFrameSamples: 460,
      maxLiveBubbleEvictions: 4_096,
      maxStreamEvictions: 4_096,
    };
}
