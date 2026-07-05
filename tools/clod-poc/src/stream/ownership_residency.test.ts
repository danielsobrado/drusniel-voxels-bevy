import { describe, expect, it } from "vitest";
import { packLiveKey } from "./live_chunk_keys.js";
import { packPageKey, pageKey } from "./page_plan.js";
import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";
import {
  countSnapshotResidencyMissing,
  createRendererOwnershipResidencyFeeds,
  createSnapshotOwnershipResidencyFeeds,
  packedLiveKeySet,
  packedPageKeySet,
} from "./ownership_residency.js";

function snapshot(): TerrainOwnershipRuntimeSnapshot {
  return {
    center: { x: 0, z: 0 },
    live: {
      center: { x: 0, z: 0 },
      required: ["-1,2", "0,0"],
      loaded: ["0,0"],
      evictable: [],
    },
    visualPages: {
      center: { x: 0, z: 0 },
      required: [pageKey(0, 1, 1), pageKey(1, -1, 0)],
      loaded: [pageKey(1, -1, 0)],
      evictable: [],
    },
    ownership: { liveRadiusM: 32, clodRadiusM: 128 },
    farShell: { innerRadiusM: 128, outerRadiusM: 512 },
  };
}

describe("ownership residency feeds", () => {
  it("packs live and page snapshot keys into numeric ready sets", () => {
    expect(packedLiveKeySet(["-1,2"])).toEqual(new Set([packLiveKey(-1, 2)]));
    expect(packedPageKeySet([pageKey(1, -1, 0)])).toEqual(new Set([packPageKey(1, -1, 0)]));
  });

  it("reports missing required residency through the feed abstraction", () => {
    const snap = snapshot();
    const feeds = createSnapshotOwnershipResidencyFeeds(snap);

    expect(feeds.liveReady()).toEqual(new Set([packLiveKey(0, 0)]));
    expect(feeds.clodReady()).toEqual(new Set([packPageKey(1, -1, 0)]));
    expect(countSnapshotResidencyMissing(snap, feeds)).toEqual({ liveMissing: 1, clodMissing: 1 });
  });

  it("adapts renderer live pages and CLOD page ids into oracle-ready sets", () => {
    const feeds = createRendererOwnershipResidencyFeeds({
      liveReadyPageKeys: () => ["L0:-1,2"],
      clodReadyPageKeys: () => ["L0:3,-4", "L2:-1,1"],
      liveChunksPerPage: 2,
    });

    expect(feeds.liveReady()).toEqual(new Set([
      packLiveKey(-2, 4),
      packLiveKey(-2, 5),
      packLiveKey(-1, 4),
      packLiveKey(-1, 5),
    ]));
    expect(feeds.clodReady()).toEqual(new Set([
      packPageKey(0, 3, -4),
      packPageKey(2, -1, 1),
    ]));
  });
});
