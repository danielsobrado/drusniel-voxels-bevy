import * as THREE from "three";
import type { ProbeGiCascadeConfig, ProbeGiCascadeId } from "./types.js";

export interface ProbeGiShTextureSet {
  readonly shR: THREE.Data3DTexture;
  readonly shG: THREE.Data3DTexture;
  readonly shB: THREE.Data3DTexture;
}

export interface ProbeGiPublishedCascade {
  readonly id: ProbeGiCascadeId;
  readonly active: ProbeGiShTextureSet;
  readonly generation: number;
}

interface CascadePublicationState {
  readonly config: ProbeGiCascadeConfig;
  readonly sets: readonly [ProbeGiShTextureSet, ProbeGiShTextureSet];
  activeIndex: 0 | 1;
  queuedFrame: number | null;
  generation: number;
}

export class ProbeGiPublication {
  private readonly cascades = new Map<ProbeGiCascadeId, CascadePublicationState>();

  constructor(configs: readonly ProbeGiCascadeConfig[]) {
    for (const config of configs) {
      this.cascades.set(config.id, {
        config,
        sets: [createTextureSet(config), createTextureSet(config)],
        activeIndex: 0,
        queuedFrame: null,
        generation: 0,
      });
    }
  }

  queueEmptyPublish(frame: number): void {
    for (const state of this.cascades.values()) {
      const next = state.sets[state.activeIndex === 0 ? 1 : 0];
      clearTextureSet(next);
      state.queuedFrame = frame;
    }
  }

  publishAtFrameBoundary(frame: number): boolean {
    let published = false;
    for (const state of this.cascades.values()) {
      if (state.queuedFrame === null || frame <= state.queuedFrame) continue;
      state.activeIndex = state.activeIndex === 0 ? 1 : 0;
      state.queuedFrame = null;
      state.generation++;
      published = true;
    }
    return published;
  }

  read(id: ProbeGiCascadeId): ProbeGiPublishedCascade {
    const state = this.cascades.get(id);
    if (!state) throw new Error(`unknown probe GI cascade: ${id}`);
    return { id, active: state.sets[state.activeIndex], generation: state.generation };
  }

  byteSize(): number {
    let total = 0;
    for (const state of this.cascades.values()) {
      const [x, y, z] = state.config.dimensions;
      total += x * y * z * 4 * Uint16Array.BYTES_PER_ELEMENT * 3 * 2;
    }
    return total;
  }

  dispose(): void {
    for (const state of this.cascades.values()) {
      disposeTextureSet(state.sets[0]);
      disposeTextureSet(state.sets[1]);
    }
    this.cascades.clear();
  }
}

function createTextureSet(config: ProbeGiCascadeConfig): ProbeGiShTextureSet {
  return {
    shR: createEmptyTexture(config, `${config.id} probe GI SH R`),
    shG: createEmptyTexture(config, `${config.id} probe GI SH G`),
    shB: createEmptyTexture(config, `${config.id} probe GI SH B`),
  };
}

function createEmptyTexture(config: ProbeGiCascadeConfig, name: string): THREE.Data3DTexture {
  const [width, height, depth] = config.dimensions;
  const texture = new THREE.Data3DTexture(new Uint16Array(width * height * depth * 4), width, height, depth);
  texture.name = name;
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function clearTextureSet(set: ProbeGiShTextureSet): void {
  for (const texture of [set.shR, set.shG, set.shB]) {
    (texture.image.data as Uint16Array).fill(0);
    texture.needsUpdate = true;
  }
}

function disposeTextureSet(set: ProbeGiShTextureSet): void {
  set.shR.dispose();
  set.shG.dispose();
  set.shB.dispose();
}
