import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.js";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "../..");

describe("GitHub Pages deployment contract", () => {
  it("builds assets beneath the repository project path", () => {
    expect(viteConfig).toMatchObject({ base: "/drusniel-voxels-bevy/" });
  });

  it("provides standard static build and preview scripts", () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.build).toBe("vite build");
    expect(packageJson.scripts?.preview).toBe("vite preview");
  });

  it("deploys only the CLOD dist directory through GitHub Pages", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/deploy-clod-poc-pages.yml"), "utf8");
    const parsed = load(workflow) as { jobs?: { build?: unknown; deploy?: unknown } };
    expect(parsed.jobs).toMatchObject({ build: expect.any(Object), deploy: expect.any(Object) });
    expect(workflow).toContain("working-directory: tools/clod-poc");
    expect(workflow).toContain("path: tools/clod-poc/dist");
    expect(workflow).toContain("actions/deploy-pages");
  });
});
