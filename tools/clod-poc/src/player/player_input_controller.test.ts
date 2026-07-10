import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = dirname(fileURLToPath(import.meta.url));

describe("player input controller", () => {
  it("requires active terrain editing for orbit pointer down and commit", () => {
    const source = readFileSync(resolve(sourceDir, "player_input_controller.ts"), "utf8");
    const orbitPointerDown = source.indexOf('deps.interaction.mode === "orbit"');
    const pointerUp = source.indexOf('addEventListener("pointerup"');
    const orbitCommit = source.indexOf('deps.interaction.mode !== "orbit"', pointerUp);

    expect(orbitPointerDown).toBeGreaterThanOrEqual(0);
    expect(source.slice(orbitPointerDown, pointerUp)).toContain("deps.getTerraformEditActive()");
    expect(orbitCommit).toBeGreaterThan(pointerUp);
    expect(source.slice(orbitCommit, source.indexOf("const rect", orbitCommit))).toContain("!deps.getTerraformEditActive()");
  });
});
