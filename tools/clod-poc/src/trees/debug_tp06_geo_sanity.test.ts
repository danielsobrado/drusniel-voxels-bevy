// [DEBUG-tp06] temporary diagnostic — dump per-variant near/far geometry attribute sanity
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS } from "./tree_config_defaults.js";
import { createTreeGeometryMap } from "./tree_geometry.js";

const lines: string[] = [];

describe("[DEBUG-tp06] tree geometry sanity", () => {
  it("dumps near/far/impostor attribute stats", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS) as Record<string, Record<string, unknown>>;
    const stats = (attr: { count: number; getX(i: number): number } | null | undefined) => {
      if (!attr) return "none";
      let min = Infinity;
      let max = -Infinity;
      const buckets = new Map<number, number>();
      for (let i = 0; i < attr.count; i++) {
        const v = attr.getX(i);
        if (v < min) min = v;
        if (v > max) max = v;
        const key = Math.round(v * 4) / 4;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, n]) => `${k}:${n}`).join(",");
      return `${min.toFixed(3)}..${max.toFixed(3)}(${top})`;
    };
    for (const species of ["oak", "birch", "dead", "pine"]) {
      for (const lod of ["near", "far", "impostor"]) {
        const entry = map[species]?.[lod];
        const list = Array.isArray(entry) ? entry : [entry];
        list.forEach((geo: any, vi: number) => {
          if (!geo) {
            lines.push(`${species}/${lod}[${vi}]: MISSING`);
            return;
          }
          const pos = geo.getAttribute("position");
          let minY = Infinity;
          let maxY = -Infinity;
          if (pos) {
            for (let i = 1; i < pos.array.length; i += 3) {
              const v = pos.array[i];
              if (v < minY) minY = v;
              if (v > maxY) maxY = v;
            }
          }
          lines.push(
            `${species}/${lod}[${vi}] verts=${pos?.count} idx=${geo.getIndex()?.count ?? 0} posY=${minY.toFixed(2)}..${maxY.toFixed(2)}` +
              ` variant=${stats(geo.getAttribute("treeVariant"))} h01=${stats(geo.getAttribute("treeHeight01"))}` +
              ` card=${stats(geo.getAttribute("treeFoliageCard"))} color=${stats(geo.getAttribute("color"))}`,
          );
        });
      }
    }
    writeFileSync("F:/drusniel-cache/tmp/claude/tp06-geo.txt", lines.join("\n"));
    expect(true).toBe(true);
  });
});
