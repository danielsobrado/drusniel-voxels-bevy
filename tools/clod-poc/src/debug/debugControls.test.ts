import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { createClodRuntime } from "../clod/runtime/clodRuntime.js";
import { createBorderCoastDebug } from "./borderCoastDebug.js";
import { createClodPageInputDebug } from "./clodPageInputDebug.js";
import { createOceanDebug } from "./oceanDebug.js";

class FakeController {
  onChangeCallback: ((value: unknown) => void) | null = null;
  name(): this { return this; }
  listen(): this { return this; }
  disable(): this { return this; }
  onChange(callback: (value: never) => void): this {
    this.onChangeCallback = callback as (value: unknown) => void;
    return this;
  }
}

class FakeFolder {
  controllers: FakeController[] = [];
  add(): FakeController {
    const controller = new FakeController();
    this.controllers.push(controller);
    return controller;
  }
  destroy(): void {}
}

class FakeGui {
  folders: FakeFolder[] = [];
  addFolder(): FakeFolder {
    const folder = new FakeFolder();
    this.folders.push(folder);
    return folder;
  }
}

describe("debug controls", () => {
  it("updates coast probe stats and creates visual overlays", () => {
    const gui = new FakeGui();
    const scene = new THREE.Scene();
    const rebuild = vi.fn();
    const debug = createBorderCoastDebug({
      gui: gui as never,
      scene,
      config: defaultBorderCoastOceanConfig,
      seed: 1,
      onCoastShapingChanged: rebuild,
    });

    debug.updateProbe({ x: 2040, z: 0 });
    expect(debug.stats.coastType).not.toBe("inland");
    expect(Number.isFinite(debug.stats.distanceToBorder)).toBe(true);
    expect(scene.getObjectByName("border-coast-debug")).toBeDefined();
    debug.dispose();
  });

  it("reports CLOD selection and page-source purity stats", () => {
    const runtime = createClodRuntime({
      selection: { errorThresholdPx: 1, hysteresisMergeFactor: 1.2, neighborLevelDeltaMax: 1 },
      crossfadeFrames: 0,
      debug: {
        showWireframe: false,
        showPageBoundaries: false,
        showLockedBorderVertices: false,
        showErrorLabels: false,
        showStatsPanel: false,
        lodColors: {},
      },
      nearField: { enabled: false, radiusChunks: 0, showMask: false },
    });
    runtime.stats.selectedNodeCount = 3;
    runtime.stats.nodesPerLevel = new Map([[0, 2], [1, 1]]);
    runtime.previousCut = {
      frame: 1,
      nodes: new Map([
        ["a", { nodeId: "a", level: 0, errorPx: 0, distanceToCamera: 0, reason: "accepted" }],
        ["b", { nodeId: "b", level: 0, errorPx: 0, distanceToCamera: 0, reason: "accepted" }],
        ["c", { nodeId: "c", level: 1, errorPx: 0, distanceToCamera: 0, reason: "accepted" }],
      ]),
    };
    runtime.nodeTriangleCounts.set("a", 100);
    runtime.nodeTriangleCounts.set("b", 120);
    runtime.nodeTriangleCounts.set("c", 80);
    const debug = createClodPageInputDebug({
      gui: new FakeGui() as never,
      runtimeState: runtime,
      setPageBoundariesVisible: vi.fn(),
      setLockedBorderVisible: vi.fn(),
      setPageSourcePurityVisible: vi.fn(),
      setWaterExclusionVisible: vi.fn(),
    });

    debug.update(1200, 640);
    expect(debug.stats.selectedNodes).toBe(3);
    expect(debug.stats.trianglesByLod).toBe("L0:220 L1:80");
    expect(debug.stats.pageSourceTerrainTriangles).toBe(1200);
    expect(debug.stats.excludedWaterOceanTriangles).toBe(640);
  });

  it("updates surf/ocean visibility, look, and stats through runtime hooks", () => {
    const surf = { setEnabled: vi.fn() };
    const ocean = {
      setEnabled: vi.fn(),
      updateLook: vi.fn(),
      stats: () => ({ drawCalls: 2, shaderTimeMs: 0.42 }),
    };
    const debug = createOceanDebug(
      new FakeGui() as never,
      defaultBorderCoastOceanConfig,
      surf as never,
      ocean as never,
    );

    expect(ocean.updateLook).toHaveBeenCalled();
    debug.update();
    expect(debug.stats.oceanDrawCalls).toBe(2);
    expect(debug.stats.shaderTimeMs).toBe("0.420");
  });
});
