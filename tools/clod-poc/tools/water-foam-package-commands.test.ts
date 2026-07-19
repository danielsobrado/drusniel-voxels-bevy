import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageJson;
const scripts = packageJson.scripts ?? {};

describe("water foam package commands", () => {
  it("exposes separate high and low WebGL acceptance lanes", () => {
    expect(scripts["water:foam:accept:webgl:high"]).toBe(
      "tsx tools/water-foam-visual-acceptance.ts --renderer=webgl --quality=high",
    );
    expect(scripts["water:foam:accept:webgl:low"]).toBe(
      "tsx tools/water-foam-visual-acceptance.ts --renderer=webgl --quality=low",
    );
  });

  it("runs both WebGL tiers through one stable command", () => {
    expect(scripts["water:foam:accept:webgl"]).toBe(
      "npm run water:foam:accept:webgl:high && npm run water:foam:accept:webgl:low",
    );
  });

  it("keeps lightweight verification unchanged and extends only the full workflow", () => {
    expect(scripts["water:verify"]).toBe(
      "npm run water:report && npm run water:find && npm run water:probe && npm run water:shot -- --scene all --out shots/water/verify",
    );
    expect(scripts["water:verify:full"]).toContain("npm run water:foam:accept:matrix");
    expect(scripts["water:verify:full"]).toContain("npm run water:foam:accept:shade");
    expect(scripts["water:verify:full"]).toContain("npm run water:foam:accept:webgl");
  });
});
