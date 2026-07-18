import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConstructionMaterial } from "./materials.js";

describe("construction PBR texture loading", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not queue unloaded textures for a WebGPU upload", () => {
    const pending: THREE.Texture[] = [];
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(() => {
      const texture = new THREE.Texture(null as unknown as HTMLImageElement);
      pending.push(texture);
      return texture;
    });

    createConstructionMaterial("wood");

    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((texture) => texture.version === 0)).toBe(true);
  });
});
