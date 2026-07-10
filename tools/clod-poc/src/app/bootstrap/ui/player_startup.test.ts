import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = dirname(fileURLToPath(import.meta.url));

describe("player startup", () => {
  it("updates the terrain brush preview from the live interaction loop", () => {
    const source = readFileSync(resolve(sourceDir, "player_startup.ts"), "utf8");
    const loop = source.indexOf("const updatePlayerInteraction");
    const previewUpdate = source.indexOf("brushPreview.update({");
    const nextFrame = source.indexOf("requestAnimationFrame(updatePlayerInteraction)", previewUpdate);

    expect(loop).toBeGreaterThanOrEqual(0);
    expect(previewUpdate).toBeGreaterThan(loop);
    expect(nextFrame).toBeGreaterThan(previewUpdate);
  });
});
