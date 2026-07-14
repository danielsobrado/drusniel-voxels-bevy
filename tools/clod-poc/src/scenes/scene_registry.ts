import { NAADF_SCENES } from "../naadf/integration.js";
import { RIVER_PARITY_TEST_SCENE } from "../water/riverParityScene.js";

export type EarlySceneRoute = "sanity" | "phase1-terrain" | "phase2";
export type ShadowProxySceneMode = "enabled" | "off" | "debug-visible" | "low-sun";

export interface SceneRegistryEntry {
  readonly id: string;
  readonly label: string;
  readonly showInGui?: boolean;
  readonly earlyRoute?: EarlySceneRoute;
  readonly phase0ConfigKey?: string;
  readonly grassPerf?: boolean;
  readonly treePerf?: boolean;
  readonly forestFloor?: boolean;
  readonly borderOcean?: boolean;
  readonly longView?: boolean;
  readonly naadf?: boolean;
  readonly shadowProxyMode?: ShadowProxySceneMode;
}

export interface SceneOption {
  readonly label: string;
  readonly value: string;
}

const NAADF_PHASE0_CONFIG_KEYS: Record<string, string> = {
  "infinite-naadf-flat": "infinite_stream_straight",
  "infinite-naadf-hills": "infinite_stream_straight",
  "infinite-naadf-mountains": "infinite_far_shell_mountain_approach",
  "infinite-naadf-fast-flight": "infinite_stream_straight",
  "infinite-naadf-fast-turn": "infinite_stream_fast_turn",
  "infinite-naadf-forest": "long_view_forest_4km",
  "infinite-naadf-sun-visibility": "long_view_4km",
  "infinite-naadf-stress-missing": "infinite_stream_slow_builds",
  "infinite-naadf-far": "infinite_far_shell_straight",
};

const BASE_SCENE_REGISTRY: readonly SceneRegistryEntry[] = [
  { id: "", label: "default" },
  { id: "sanity", label: "sanity", earlyRoute: "sanity", showInGui: false },
  { id: "phase1-terrain", label: "phase1 terrain", earlyRoute: "phase1-terrain", showInGui: false },
  { id: "phase2", label: "phase2", earlyRoute: "phase2", showInGui: false },
  { id: "grass-perf", label: "grass perf", grassPerf: true },
  { id: "trees-perf", label: "trees perf", treePerf: true },
  { id: "forest-floor", label: "forest floor", forestFloor: true },
  { id: "border-ocean", label: "border ocean", borderOcean: true },
  {
    id: RIVER_PARITY_TEST_SCENE,
    label: "river parity test",
    phase0ConfigKey: "long_view_forest_4km",
    longView: true,
  },
  { id: "long-view-4km", label: "long view 4 km", phase0ConfigKey: "long_view_4km", longView: true },
  {
    id: "long-view-forest-4km",
    label: "long view forest 4 km",
    phase0ConfigKey: "long_view_forest_4km",
    longView: true,
  },
  {
    id: "long-view-edit-stress",
    label: "long view edit stress",
    phase0ConfigKey: "long_view_edit_stress",
    longView: true,
  },
  { id: "long-view-8km", label: "long view 8 km", phase0ConfigKey: "long_view_8km", longView: true },
  { id: "long-view-16km", label: "long view 16 km", phase0ConfigKey: "long_view_16km", longView: true },
  {
    id: "infinite-stream-straight",
    label: "stream straight",
    phase0ConfigKey: "infinite_stream_straight",
    longView: true,
  },
  {
    id: "infinite-stream-fast-turn",
    label: "stream fast turn",
    phase0ConfigKey: "infinite_stream_fast_turn",
    longView: true,
  },
  {
    id: "infinite-stream-far-summary",
    label: "stream far summary",
    phase0ConfigKey: "infinite_stream_far_summary",
    longView: true,
  },
  {
    id: "infinite-stream-slow-builds",
    label: "stream slow builds",
    phase0ConfigKey: "infinite_stream_slow_builds",
    longView: true,
  },
  {
    id: "infinite-islands",
    label: "infinite islands",
    phase0ConfigKey: "infinite_islands",
    longView: true,
  },
  {
    id: "continent",
    label: "continent",
    phase0ConfigKey: "infinite_islands",
    longView: true,
  },
  {
    id: "cave-test",
    label: "cave test",
    phase0ConfigKey: "cave_test",
    longView: true,
  },
  {
    id: "infinite-far-shell-straight",
    label: "far shell straight",
    phase0ConfigKey: "infinite_far_shell_straight",
    longView: true,
  },
  {
    id: "infinite-far-shell-fast-turn",
    label: "far shell fast turn",
    phase0ConfigKey: "infinite_far_shell_fast_turn",
    longView: true,
  },
  {
    id: "infinite-far-shell-mountain-approach",
    label: "far shell mountain approach",
    phase0ConfigKey: "infinite_far_shell_mountain_approach",
    longView: true,
  },
  {
    id: "long-view-shadow-proxy-basic",
    label: "shadow proxy basic",
    phase0ConfigKey: "long_view_4km",
    longView: true,
    shadowProxyMode: "enabled",
  },
  {
    id: "long-view-shadow-proxy-off",
    label: "shadow proxy off",
    phase0ConfigKey: "long_view_4km",
    longView: true,
    shadowProxyMode: "off",
  },
  {
    id: "long-view-shadow-proxy-debug-visible",
    label: "shadow proxy debug visible",
    phase0ConfigKey: "long_view_4km",
    longView: true,
    shadowProxyMode: "debug-visible",
  },
  {
    id: "long-view-shadow-proxy-forest",
    label: "shadow proxy forest",
    phase0ConfigKey: "long_view_forest_4km",
    longView: true,
    shadowProxyMode: "enabled",
  },
  {
    id: "long-view-shadow-proxy-low-sun",
    label: "shadow proxy low sun",
    phase0ConfigKey: "long_view_4km",
    longView: true,
    shadowProxyMode: "low-sun",
  },
];

const NAADF_SCENE_REGISTRY: readonly SceneRegistryEntry[] = Array.from(NAADF_SCENES).map((scene) => ({
  id: scene,
  label: scene.replaceAll("-", " "),
  phase0ConfigKey: NAADF_PHASE0_CONFIG_KEYS[scene],
  longView: true,
  naadf: true,
}));

export const SCENE_REGISTRY: readonly SceneRegistryEntry[] = [
  ...BASE_SCENE_REGISTRY,
  ...NAADF_SCENE_REGISTRY,
];

const SCENES_BY_ID = new Map(SCENE_REGISTRY.map((scene) => [scene.id, scene]));

export function sceneFromSearchParams(searchParams: URLSearchParams): string | null {
  return searchParams.get("scene");
}

export function sceneRegistryEntry(scene: string | null): SceneRegistryEntry | undefined {
  return scene === null ? undefined : SCENES_BY_ID.get(scene);
}

export function sceneOptions(): readonly SceneOption[] {
  return SCENE_REGISTRY
    .filter((scene) => scene.showInGui !== false)
    .map((scene) => ({ label: scene.label, value: scene.id }));
}

export function sceneOptionsByLabel(): Record<string, string> {
  return Object.fromEntries(sceneOptions().map((scene) => [scene.label, scene.value]));
}

export function earlySceneRoute(scene: string | null): EarlySceneRoute | undefined {
  return sceneRegistryEntry(scene)?.earlyRoute;
}

export function isGrassPerfScene(scene: string | null): boolean {
  return sceneRegistryEntry(scene)?.grassPerf === true;
}

export function isTreePerfScene(scene: string | null): boolean {
  return sceneRegistryEntry(scene)?.treePerf === true;
}

export function isForestFloorScene(scene: string | null): boolean {
  return sceneRegistryEntry(scene)?.forestFloor === true;
}

export function isBorderOceanScene(scene: string | null): boolean {
  return sceneRegistryEntry(scene)?.borderOcean === true;
}

export function isLongViewScene(scene: string | null): boolean {
  return sceneRegistryEntry(scene)?.longView === true;
}

export function isRegisteredNaadfScene(scene: string | null): boolean {
  return sceneRegistryEntry(scene)?.naadf === true;
}

export function phase0ConfigKeyForScene(scene: string | null): string | undefined {
  return sceneRegistryEntry(scene)?.phase0ConfigKey;
}

export function shadowProxySceneMode(scene: string | null): ShadowProxySceneMode | undefined {
  return sceneRegistryEntry(scene)?.shadowProxyMode;
}

export function isLowSunScene(scene: string | null): boolean {
  return shadowProxySceneMode(scene) === "low-sun";
}
