import { projectPropsToPropPlacementScene, propPlacementSceneToProjectProps, type ProjectPropInstance } from "../project/project_props.js";
import type { PropAssetDef, PropPlacementScene } from "../props/prop_types.js";
import { createSaveIdFactory, isFactorySaveId } from "./save_ids.js";
import { regionKeyForWorld } from "./region_key.js";
import type { SavedPropInstance, SavedPropState } from "./save_schema.js";
import { assertSavedPropInstance } from "./save_schema.js";

export interface SavedPropConversionOptions {
  nextId?: () => string;
  assetDefs?: readonly Pick<PropAssetDef, "id" | "category">[];
  defaultState?: SavedPropState;
  migrateLegacyIds?: boolean;
}

export interface SavedPropSceneResult {
  savedProps: SavedPropInstance[];
  migratedIds: number;
  skippedVegetation: number;
}

function cloneVec3(value: readonly [number, number, number]): [number, number, number] {
  return [value[0], value[1], value[2]];
}

function cloneVec4(value: readonly [number, number, number, number]): [number, number, number, number] {
  return [value[0], value[1], value[2], value[3]];
}

function assetCategoryMap(assetDefs: readonly Pick<PropAssetDef, "id" | "category">[] | undefined): ReadonlyMap<string, PropAssetDef["category"]> {
  return new Map((assetDefs ?? []).map((asset) => [asset.id, asset.category]));
}

function isScatterVegetation(prefabId: string, categories: ReadonlyMap<string, PropAssetDef["category"]>): boolean {
  return categories.get(prefabId) === "vegetation";
}

function createStablePropId(prop: ProjectPropInstance, nextId: () => string, migrateLegacyIds: boolean): { id: string; migrated: boolean } {
  if (!migrateLegacyIds || isFactorySaveId(prop.id)) return { id: prop.id, migrated: false };
  return { id: nextId(), migrated: true };
}

export function savedPropFromProjectProp(
  prop: ProjectPropInstance,
  options: SavedPropConversionOptions = {},
): { prop: SavedPropInstance | null; migrated: boolean; skippedVegetation: boolean } {
  const categories = assetCategoryMap(options.assetDefs);
  if (isScatterVegetation(prop.prefabId, categories)) return { prop: null, migrated: false, skippedVegetation: true };

  const nextId = options.nextId ?? createSaveIdFactory(0);
  const { id, migrated } = createStablePropId(prop, nextId, options.migrateLegacyIds ?? true);
  const savedProp: SavedPropInstance = {
    id,
    prefabId: prop.prefabId,
    position: cloneVec3(prop.position),
    rotation: cloneVec4(prop.rotation),
    scale: cloneVec3(prop.scale),
    anchor: prop.anchor,
    seed: prop.seed,
    variationId: prop.variationId,
    flags: prop.flags,
    revision: prop.revision,
    regionKey: regionKeyForWorld(prop.position[0], prop.position[2]),
    state: options.defaultState ?? "active",
    tags: [],
  };
  assertSavedPropInstance(savedProp);
  return { prop: savedProp, migrated, skippedVegetation: false };
}

export function savedPropsFromProjectProps(
  props: readonly ProjectPropInstance[],
  options: SavedPropConversionOptions = {},
): SavedPropSceneResult {
  const savedProps: SavedPropInstance[] = [];
  const nextId = options.nextId ?? createSaveIdFactory(0);
  const conversionOptions = { ...options, nextId };
  let migratedIds = 0;
  let skippedVegetation = 0;
  for (const prop of props) {
    const result = savedPropFromProjectProp(prop, conversionOptions);
    if (result.skippedVegetation) skippedVegetation++;
    if (result.migrated) migratedIds++;
    if (result.prop) savedProps.push(result.prop);
  }
  return { savedProps: savedProps.sort((a, b) => a.id.localeCompare(b.id)), migratedIds, skippedVegetation };
}

export function savedPropsFromPlacementScene(scene: PropPlacementScene, options: SavedPropConversionOptions = {}): SavedPropSceneResult {
  return savedPropsFromProjectProps(propPlacementSceneToProjectProps(scene), options);
}

export function partitionSavedPropsByRegion(props: readonly SavedPropInstance[]): Map<string, SavedPropInstance[]> {
  const byRegion = new Map<string, SavedPropInstance[]>();
  for (const prop of props) {
    assertSavedPropInstance(prop);
    const regionKey = regionKeyForWorld(prop.position[0], prop.position[2]);
    if (prop.regionKey !== regionKey) throw new Error(`saved prop ${prop.id} belongs to ${regionKey}, not ${prop.regionKey}`);
    const copy = { ...prop, position: cloneVec3(prop.position), rotation: cloneVec4(prop.rotation), scale: cloneVec3(prop.scale), tags: [...prop.tags], environmental: prop.environmental ? { ...prop.environmental, tileKey: { ...prop.environmental.tileKey } } : undefined };
    const region = byRegion.get(regionKey);
    if (region) region.push(copy);
    else byRegion.set(regionKey, [copy]);
  }
  for (const region of byRegion.values()) region.sort((a, b) => a.id.localeCompare(b.id));
  return byRegion;
}

export function mergeSavedPropsFromRegions(regions: Iterable<readonly SavedPropInstance[]>): SavedPropInstance[] {
  const byId = new Map<string, SavedPropInstance>();
  for (const region of regions) {
    for (const prop of region) {
      assertSavedPropInstance(prop);
      if (byId.has(prop.id)) throw new Error(`duplicate saved prop id: ${prop.id}`);
      byId.set(prop.id, { ...prop, position: cloneVec3(prop.position), rotation: cloneVec4(prop.rotation), scale: cloneVec3(prop.scale), tags: [...prop.tags], environmental: prop.environmental ? { ...prop.environmental, tileKey: { ...prop.environmental.tileKey } } : undefined });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function savedPropsToPlacementScene(props: readonly SavedPropInstance[], sceneId = "saved-world"): PropPlacementScene {
  const activeProjectProps: ProjectPropInstance[] = props.filter((prop) => prop.state === "active").map((prop) => ({
    id: prop.id,
    prefabId: prop.prefabId,
    position: cloneVec3(prop.position),
    rotation: cloneVec4(prop.rotation),
    scale: cloneVec3(prop.scale),
    anchor: prop.anchor,
    seed: prop.seed,
    variationId: prop.variationId,
    flags: prop.flags,
    revision: prop.revision,
  }));
  return projectPropsToPropPlacementScene(activeProjectProps, sceneId);
}
