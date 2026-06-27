import type { PropPlacementScene } from "../props/prop_types.js";
import {
  projectPropsToPropPlacementScene,
  type ProjectPropInstance,
} from "./project_props.js";

const DEFAULT_ANCHOR: ProjectPropInstance["anchor"] = "terrain";
const DEFAULT_ROTATION: ProjectPropInstance["rotation"] = [0, 0, 0, 1];
const DEFAULT_SCALE: ProjectPropInstance["scale"] = [1, 1, 1];

export interface AddProjectPropInput {
  id?: string;
  prefabId: string;
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number, number];
  scale?: readonly [number, number, number];
  anchor?: ProjectPropInstance["anchor"];
  seed?: number;
  variationId?: number;
  flags?: number;
}

export interface UpdateProjectPropInput {
  prefabId?: string;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number, number];
  scale?: readonly [number, number, number];
  anchor?: ProjectPropInstance["anchor"];
  seed?: number;
  variationId?: number;
  flags?: number;
}

export interface PropEditResult {
  revision: number;
  changedPropIds: readonly string[];
}

export type PropEditListener = (result: PropEditResult) => void;

export interface PropEditStoreOptions {
  idFactory?: () => string;
}

function defaultIdFactory(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUuid ? randomUuid() : `prop-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function assertFiniteVector(name: string, values: readonly number[], size: number): void {
  if (values.length !== size || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${name} must be a finite ${size}D vector`);
  }
}

function normalizeAnchor(anchor: ProjectPropInstance["anchor"] | undefined): ProjectPropInstance["anchor"] {
  return anchor === "world" || anchor === "voxel" || anchor === "terrain" ? anchor : DEFAULT_ANCHOR;
}

function cloneProp(prop: ProjectPropInstance): ProjectPropInstance {
  return {
    id: prop.id,
    prefabId: prop.prefabId,
    position: [...prop.position],
    rotation: [...prop.rotation],
    scale: [...prop.scale],
    anchor: normalizeAnchor(prop.anchor),
    seed: prop.seed,
    variationId: prop.variationId,
    flags: prop.flags,
    revision: prop.revision,
  };
}

function normalizeProp(prop: ProjectPropInstance): ProjectPropInstance {
  if (!prop.id.trim()) throw new Error("prop id is required");
  if (!prop.prefabId.trim()) throw new Error("prop prefabId is required");
  assertFiniteVector("prop position", prop.position, 3);
  assertFiniteVector("prop rotation", prop.rotation, 4);
  assertFiniteVector("prop scale", prop.scale, 3);
  if (prop.scale.some((value) => value <= 0)) throw new Error("prop scale must be positive");
  return cloneProp({ ...prop, anchor: normalizeAnchor(prop.anchor) });
}

function nextProp(
  id: string,
  input: AddProjectPropInput,
  revision: number,
): ProjectPropInstance {
  return normalizeProp({
    id,
    prefabId: input.prefabId,
    position: [...input.position],
    rotation: [...(input.rotation ?? DEFAULT_ROTATION)],
    scale: [...(input.scale ?? DEFAULT_SCALE)],
    anchor: normalizeAnchor(input.anchor),
    seed: input.seed,
    variationId: input.variationId,
    flags: input.flags,
    revision,
  });
}

export class PropEditStore {
  private readonly props = new Map<string, ProjectPropInstance>();
  private readonly listeners = new Set<PropEditListener>();
  private readonly idFactory: () => string;
  private currentRevision = 0;

  constructor(options: PropEditStoreOptions = {}) {
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  revision(): number {
    return this.currentRevision;
  }

  hasProps(): boolean {
    return this.props.size > 0;
  }

  get(id: string): ProjectPropInstance | undefined {
    const prop = this.props.get(id);
    return prop ? cloneProp(prop) : undefined;
  }

  snapshot(): ProjectPropInstance[] {
    return [...this.props.values()].map(cloneProp);
  }

  restore(props: readonly ProjectPropInstance[]): PropEditResult {
    this.props.clear();
    let maxRevision = 0;
    for (const prop of props) {
      const normalized = normalizeProp(prop);
      maxRevision = Math.max(maxRevision, normalized.revision ?? 0);
      this.props.set(normalized.id, normalized);
    }
    this.currentRevision = maxRevision + 1;
    return this.emit([...this.props.keys()]);
  }

  clear(): PropEditResult {
    if (this.props.size === 0) return { revision: this.currentRevision, changedPropIds: [] };
    const ids = [...this.props.keys()];
    this.props.clear();
    this.currentRevision++;
    return this.emit(ids);
  }

  add(input: AddProjectPropInput): ProjectPropInstance {
    const id = input.id ?? this.idFactory();
    if (this.props.has(id)) throw new Error(`prop id already exists: ${id}`);
    const revision = this.currentRevision + 1;
    const prop = nextProp(id, input, revision);
    this.props.set(id, prop);
    this.currentRevision = revision;
    this.emit([id]);
    return cloneProp(prop);
  }

  update(id: string, patch: UpdateProjectPropInput): ProjectPropInstance {
    const existing = this.props.get(id);
    if (!existing) throw new Error(`prop not found: ${id}`);
    const revision = this.currentRevision + 1;
    const prop = normalizeProp({
      ...existing,
      prefabId: patch.prefabId ?? existing.prefabId,
      position: patch.position ? [...patch.position] : [...existing.position],
      rotation: patch.rotation ? [...patch.rotation] : [...existing.rotation],
      scale: patch.scale ? [...patch.scale] : [...existing.scale],
      anchor: normalizeAnchor(patch.anchor ?? existing.anchor),
      seed: patch.seed ?? existing.seed,
      variationId: patch.variationId ?? existing.variationId,
      flags: patch.flags ?? existing.flags,
      revision,
    });
    this.props.set(id, prop);
    this.currentRevision = revision;
    this.emit([id]);
    return cloneProp(prop);
  }

  remove(id: string): PropEditResult {
    if (!this.props.delete(id)) throw new Error(`prop not found: ${id}`);
    this.currentRevision++;
    return this.emit([id]);
  }

  toPlacementScene(sceneId = "project-props"): PropPlacementScene {
    return projectPropsToPropPlacementScene(this.snapshot(), sceneId);
  }

  subscribe(listener: PropEditListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(changedPropIds: readonly string[]): PropEditResult {
    const result: PropEditResult = {
      revision: this.currentRevision,
      changedPropIds: [...changedPropIds],
    };
    for (const listener of this.listeners) listener(result);
    return result;
  }
}

export const projectPropEditStore = new PropEditStore();
