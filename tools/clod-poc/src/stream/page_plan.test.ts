import { describe, expect, it } from "vitest";
import { isVisualPageDistance } from "./page_filter.js";
import { pageRangeForRadius } from "./page_range.js";
import { pageHasRequiredNotReadyDescendant, pageKey, parsePageKey, VisualClodPageStreamer, visualPageKeys } from "./page_plan.js";

describe("visual page planning", () => {
  it("keeps visual pages outside live radius and inside CLOD radius", () => {
    expect(isVisualPageDistance(199, 200, 2048, 64)).toBe(false);
    expect(isVisualPageDistance(256, 200, 2048, 64)).toBe(true);
    expect(isVisualPageDistance(4096, 200, 2048, 64)).toBe(false);
  });

  it("plans deterministic page ranges", () => {
    expect(pageRangeForRadius(0, 0, 128, 64)).toEqual({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 });
  });

  it("returns coarse-to-fine visual page keys", () => {
    const keys = visualPageKeys(0, 0, 64, 192, 64, 1);
    expect(keys.length).toBeGreaterThan(0);
    const levels = keys.map((key) => parsePageKey(key).level);
    expect(levels[0]).toBe(1);
    expect(levels.lastIndexOf(1)).toBeLessThan(levels.indexOf(0));
  });

  it("retains a parent page while a required descendant is not ready", () => {
    const parent = pageKey(1, 0, 0);
    const loaded = new Set<string>([parent]);
    const required = [parent, pageKey(0, 1, 1)];

    expect(pageHasRequiredNotReadyDescendant(parent, required, loaded)).toBe(true);
    loaded.add(pageKey(0, 1, 1));
    expect(pageHasRequiredNotReadyDescendant(parent, required, loaded)).toBe(false);
  });

  it("tracks loaded visual pages and evicts distant pages", () => {
    const streamer = new VisualClodPageStreamer(64, 192, { pageSizeM: 64, maxLevel: 1, hysteresisM: 64 });
    const first = streamer.update(0, 0);
    expect(first.loaded).toEqual(first.required);

    const second = streamer.update(2048, 0);
    expect(second.evictable.length).toBeGreaterThan(0);
    expect(second.loaded).toEqual(second.required);
  });

  it("returns a stable snapshot without moving the stream center", () => {
    const streamer = new VisualClodPageStreamer(64, 192, { pageSizeM: 64, maxLevel: 1, hysteresisM: 64 });
    const first = streamer.update(0, 0);
    const snapshot = streamer.snapshot();

    expect(snapshot.center).toEqual({ x: 0, z: 0 });
    expect(snapshot.required).toEqual(first.required);
    expect(snapshot.loaded).toEqual(first.loaded);
  });
});
