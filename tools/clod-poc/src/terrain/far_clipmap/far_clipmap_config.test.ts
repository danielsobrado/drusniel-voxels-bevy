import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_FAR_CLIPMAP_CONFIG,
  createFarClipmapController,
  farClipmapConfigFromSearchParams,
  farClipmapSnap,
  farClipmapTileKeysForSnap,
  resolveFarClipmapConfig,
} from "./index.js";

function query(text: string): URLSearchParams {
  return new URLSearchParams(text);
}

describe("far clipmap config", () => {
  it("uses deterministic defaults", () => {
    expect(resolveFarClipmapConfig()).toEqual(DEFAULT_FAR_CLIPMAP_CONFIG);
  });

  it("accepts query params and clamps outer radius to CLOD coverage", () => {
    const config = farClipmapConfigFromSearchParams(
      query("farClipmap=1&farClipmapInnerRadius=384&farClipmapOuterRadius=1024&farClipmapRingCount=3"),
      { liveCollisionRadiusM: 200, clodCoverageRadiusM: 2048 },
    );

    expect(config.enabled).toBe(true);
    expect(config.innerRadiusM).toBe(384);
    expect(config.outerRadiusM).toBeGreaterThanOrEqual(2048);
    expect(config.ringCount).toBe(3);
  });
});

describe("far clipmap snapping", () => {
  it("keeps the same keys inside a snap cell", () => {
    const config = resolveFarClipmapConfig({ ringCount: 2, snapSizeM: 128 });
    const a = farClipmapTileKeysForSnap(config, farClipmapSnap(5, 7, config.snapSizeM));
    const b = farClipmapTileKeysForSnap(config, farClipmapSnap(120, 126, config.snapSizeM));
    expect(a).toEqual(b);
  });

  it("changes keys deterministically across snap boundaries", () => {
    const config = resolveFarClipmapConfig({ ringCount: 2, snapSizeM: 128 });
    const a = farClipmapTileKeysForSnap(config, farClipmapSnap(127, 0, config.snapSizeM));
    const b = farClipmapTileKeysForSnap(config, farClipmapSnap(128, 0, config.snapSizeM));
    expect(a).not.toEqual(b);
  });

  it("snaps negative coordinates down", () => {
    const snap = farClipmapSnap(-1, -129, 128);
    expect(snap.snapX).toBe(-128);
    expect(snap.snapZ).toBe(-256);
  });
});

describe("far clipmap controller", () => {
  it("updates uniforms and becomes ready across budgeted frames", () => {
    const scene = new THREE.Scene();
    const config = resolveFarClipmapConfig({ ringCount: 3, maxRebuildsPerFrame: 2 });
    const controller = createFarClipmapController(scene, config);

    const first = controller.update(new THREE.Vector3(1, 0, 1));
    const second = controller.update(new THREE.Vector3(1, 0, 1));

    expect(first.readyTiles).toBe(2);
    expect(first.pendingTiles).toBe(1);
    expect(second.readyTiles).toBe(3);
    expect(controller.ownershipSnapshot().ready).toBe(true);
    controller.setDebugMode("ownership");
    controller.setVisible(false);
    controller.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
