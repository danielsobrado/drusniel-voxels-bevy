export interface MovementSegment {
  label: string;
  frames: number;
  dx: number;
  dz: number;
  phase?: "outbound" | "revisit";
  landmark?: "biome-transition" | "river" | "village-site" | "coast";
}

export type MovementRouteName = "walk" | "long-route" | "continent-short" | "coast-to-coast" | "coast-to-coast-revisit";
export type MovementContentProfile = "infrastructure" | "representative";

export interface MovementRouteProfile {
  name: MovementRouteName;
  contentProfile: MovementContentProfile;
  scene: "infinite-islands" | "rpg-village";
  sceneParams: Readonly<Record<string, string>>;
  segments: readonly MovementSegment[];
  start?: readonly [number, number, number];
  minHorizontalDistanceM: number;
  minFrameSamples: number;
  maxFrontierLagP95M: number;
  maxRegionDrainFrames: number;
  maxLiveBubbleEvictions: number;
  maxStreamEvictions: number;
}

export function sceneForMovementCase(
  profile: MovementRouteProfile,
  movementRoute: boolean,
): MovementRouteProfile["scene"] {
  return movementRoute ? profile.scene : "infinite-islands";
}

export function requiresDedicatedMovementPage(
  profile: MovementRouteProfile,
  movementRoute: boolean,
): boolean {
  return movementRoute && profile.contentProfile === "representative";
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
const LONG_ROUTE_FRAMES = LONG_ROUTE.reduce((sum, segment) => sum + segment.frames, 0);

const CONTINENT_SHORT_ROUTE: readonly MovementSegment[] = Object.freeze([
  { label: "west-coast-to-forest", frames: 1_200, dx: 1_200, dz: 300, phase: "outbound", landmark: "coast" },
  { label: "forest-boundary", frames: 1_200, dx: 1_200, dz: -300, phase: "outbound", landmark: "biome-transition" },
  { label: "river-crossing", frames: 1_200, dx: 1_200, dz: 300, phase: "outbound", landmark: "river" },
  { label: "content-cell-boundary", frames: 1_200, dx: 1_200, dz: -300, phase: "outbound", landmark: "village-site" },
]);

const COAST_TO_COAST_ROUTE: readonly MovementSegment[] = Object.freeze([
  { label: "west-coast-to-forest", frames: 1_280, dx: 3_200, dz: 600, phase: "outbound", landmark: "biome-transition" },
  { label: "forest-to-river", frames: 1_280, dx: 3_200, dz: -800, phase: "outbound", landmark: "river" },
  { label: "river-to-village-site", frames: 1_280, dx: 3_200, dz: 700, phase: "outbound", landmark: "village-site" },
  { label: "village-to-meadow", frames: 1_280, dx: 3_200, dz: -500, phase: "outbound", landmark: "biome-transition" },
  { label: "meadow-to-east-coast", frames: 1_280, dx: 3_200, dz: 0, phase: "outbound", landmark: "coast" },
]);

const REVISIT_ROUTE: readonly MovementSegment[] = Object.freeze([
  ...COAST_TO_COAST_ROUTE,
  { label: "revisit-east-to-interior", frames: 1_200, dx: -3_000, dz: 0, phase: "revisit" },
  { label: "revisit-interior-to-east", frames: 1_200, dx: 3_000, dz: 0, phase: "revisit" },
]);

function routeFrames(segments: readonly MovementSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.frames, 0);
}

export function resolveMovementRouteProfile(
  route: boolean | MovementRouteName,
  contentProfile: MovementContentProfile = "infrastructure",
): MovementRouteProfile {
  const name = typeof route === "boolean" ? (route ? "long-route" : "walk") : route;
  const scene = contentProfile === "representative" ? "rpg-village" : "infinite-islands";
  const sceneParams: Readonly<Record<string, string>> = contentProfile === "representative"
    ? {
        world: "32",
        startupWorld: "2",
        liveBubble: "1",
        liveBubbleRadius: "200",
        liveClodRootRadius: "768",
        farClipmapInnerRadius: "768",
        sceneCompileWarm: "1",
        agentEnvelope: "1",
        agentCount: "40",
        agentSkin: "1",
      }
    : {};
  const maxRegionDrainFrames = contentProfile === "representative" ? 600 : 240;
  const maxFrontierLagP95M = contentProfile === "representative" ? 768 : 384;
  if (name === "coast-to-coast" || name === "coast-to-coast-revisit") {
    const segments = name === "coast-to-coast" ? COAST_TO_COAST_ROUTE : REVISIT_ROUTE;
    return {
      name,
      contentProfile,
      scene,
      sceneParams,
      segments,
      start: [-8_000, 96, 0],
      minHorizontalDistanceM: 16_000,
      minFrameSamples: routeFrames(segments),
      maxFrontierLagP95M,
      maxRegionDrainFrames,
      maxLiveBubbleEvictions: 4_096,
      maxStreamEvictions: 4_096,
    };
  }
  if (name === "continent-short") {
    return {
      name,
      contentProfile,
      scene,
      sceneParams,
      segments: CONTINENT_SHORT_ROUTE,
      start: [-8_000, 96, 0],
      minHorizontalDistanceM: 4_800,
      minFrameSamples: routeFrames(CONTINENT_SHORT_ROUTE),
      maxFrontierLagP95M,
      maxRegionDrainFrames,
      maxLiveBubbleEvictions: 4_096,
      maxStreamEvictions: 4_096,
    };
  }
  return name === "long-route"
    ? {
      name: "long-route",
      contentProfile,
      scene,
      sceneParams,
      segments: LONG_ROUTE,
      minHorizontalDistanceM: 3_000,
      minFrameSamples: LONG_ROUTE_FRAMES,
      maxFrontierLagP95M,
      maxRegionDrainFrames,
      maxLiveBubbleEvictions: 4_096,
      maxStreamEvictions: 4_096,
    }
    : {
      name: "walk",
      contentProfile,
      scene,
      sceneParams,
      segments: WALK_ROUTE,
      minHorizontalDistanceM: 48,
      minFrameSamples: 460,
      maxFrontierLagP95M,
      maxRegionDrainFrames,
      maxLiveBubbleEvictions: 4_096,
      maxStreamEvictions: 4_096,
    };
}
