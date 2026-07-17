import type { ProjectPropInstance } from "../project/project_props.js";
import type { SavedPropInstance } from "./save_schema.js";
import { assertSavedPropInstance } from "./save_schema.js";

function cloneVec3(value: readonly [number, number, number]): [number, number, number] {
  return [value[0], value[1], value[2]];
}

function cloneVec4(value: readonly [number, number, number, number]): [number, number, number, number] {
  return [value[0], value[1], value[2], value[3]];
}

function cloneSavedProp(prop: SavedPropInstance): SavedPropInstance {
  return {
    ...prop,
    position: cloneVec3(prop.position),
    rotation: cloneVec4(prop.rotation),
    scale: cloneVec3(prop.scale),
    tags: [...prop.tags],
    environmental: prop.environmental ? { ...prop.environmental, tileKey: { ...prop.environmental.tileKey } } : undefined,
  };
}

export class SavedPropStore {
  private readonly props = new Map<string, SavedPropInstance>();
  private mutationRevision = 0;

  revision(): number {
    return this.mutationRevision;
  }

  restore(props: readonly SavedPropInstance[]): void {
    const restored = new Map<string, SavedPropInstance>();
    for (const prop of props) {
      assertSavedPropInstance(prop);
      if (restored.has(prop.id)) throw new Error(`duplicate saved prop id: ${prop.id}`);
      restored.set(prop.id, cloneSavedProp(prop));
    }

    this.props.clear();
    for (const [id, prop] of restored) this.props.set(id, prop);
    this.mutationRevision++;
  }

  clear(): void {
    if (this.props.size === 0) return;
    this.props.clear();
    this.mutationRevision++;
  }

  hasProps(): boolean {
    return this.props.size > 0;
  }

  count(): number {
    return this.props.size;
  }

  upsert(prop: SavedPropInstance): SavedPropInstance | null {
    assertSavedPropInstance(prop);
    const previous = this.props.get(prop.id);
    this.props.set(prop.id, cloneSavedProp(prop));
    this.mutationRevision++;
    return previous ? cloneSavedProp(previous) : null;
  }

  remove(id: string): SavedPropInstance | null {
    const previous = this.props.get(id);
    if (!previous) return null;
    this.props.delete(id);
    this.mutationRevision++;
    return cloneSavedProp(previous);
  }

  snapshot(): SavedPropInstance[] {
    return [...this.props.values()].map(cloneSavedProp).sort((a, b) => a.id.localeCompare(b.id));
  }

  activeProjectProps(): ProjectPropInstance[] {
    return this.snapshot()
      .filter((prop) => prop.state === "active")
      .map((prop) => ({
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
  }
}

export const savedPropStore = new SavedPropStore();
