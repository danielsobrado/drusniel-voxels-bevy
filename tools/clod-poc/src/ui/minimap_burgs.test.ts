import { describe, expect, it } from "vitest";
import { selectMinimapBurgs, type MinimapCampaign } from "./minimap_burgs.js";

function createCampaign(burgs: MinimapCampaign["burgs"], states: MinimapCampaign["states"] = []): MinimapCampaign {
  return {
    source: {
      sourceWidth: 1000,
      sourceHeight: 800,
      target: {
        minCellX: -500,
        minCellZ: -400,
        widthCells: 1000,
        heightCells: 800,
      },
    },
    states,
    burgs,
  };
}

describe("selectMinimapBurgs", () => {
  it("places an in-window burg at its normalized position", () => {
    const campaign = createCampaign([{ i: 1, name: "Harborwatch", x: 550, y: 400 }]);
    const [marker] = selectMinimapBurgs({
      campaign,
      center: { x: 0, z: 0 },
      cells: 192,
    });
    expect(marker?.name).toBe("Harborwatch");
    expect(marker?.offscreen).toBe(false);
    expect(Math.abs((marker?.u ?? 0) - (0.5 + 50 / 192))).toBeLessThan(1e-9);
    expect(Math.abs((marker?.v ?? 0) - 0.5)).toBeLessThan(1e-9);
  });

  it("clamps nearby offscreen burgs to the rim", () => {
    const campaign = createCampaign([{ i: 1, name: "Farhold", x: 650, y: 400 }]);
    const [marker] = selectMinimapBurgs({
      campaign,
      center: { x: 0, z: 0 },
      cells: 192,
    });
    expect(marker?.offscreen).toBe(true);
    expect(Math.abs((marker?.distanceCells ?? 0) - 150)).toBeLessThan(1);
    expect(Math.abs((marker?.u ?? 0) - 0.94)).toBeLessThan(1e-6);
    expect(Math.abs((marker?.v ?? 0) - 0.5)).toBeLessThan(1e-9);
  });

  it("drops burgs beyond the edge range", () => {
    const campaign = createCampaign([{ i: 1, name: "Distant", x: 900, y: 400 }]);
    expect(selectMinimapBurgs({ campaign, center: { x: 0, z: 0 }, cells: 192 })).toEqual([]);
  });

  it("orders nearest first and respects the marker cap", () => {
    const campaign = createCampaign([
      { i: 1, name: "Far", x: 560, y: 400 },
      { i: 2, name: "Near", x: 505, y: 400 },
      { i: 3, name: "Middle", x: 530, y: 400 },
    ]);
    const markers = selectMinimapBurgs({
      campaign,
      center: { x: 0, z: 0 },
      cells: 192,
      maxMarkers: 2,
    });
    expect(markers.map((marker) => marker.name)).toEqual(["Near", "Middle"]);
  });

  it("uses state colour and skips removed or invalid burgs", () => {
    const campaign = createCampaign(
      [
        { i: 1, name: "Crownrest", x: 510, y: 400, state: 3, capital: 1 },
        { i: 2, name: "Ruin", x: 512, y: 400, removed: true },
        { i: 3, name: "Nowhere", x: Number.NaN, y: 400 },
      ],
      [{ i: 3, color: "#6a8fd0" }],
    );
    const markers = selectMinimapBurgs({
      campaign,
      center: { x: 0, z: 0 },
      cells: 192,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]?.name).toBe("Crownrest");
    expect(markers[0]?.color).toBe("#6a8fd0");
    expect(markers[0]?.capital).toBe(true);
  });
});
