import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.js";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "../..");

describe("GitHub Pages deployment contract", () => {
  it("builds assets beneath the repository project path", async () => {
    // Config is command-aware (root base in dev, repo sub-path for builds). The deployment
    // contract is about the production build, so resolve it for the "build" command.
    const built = await (typeof viteConfig === "function"
      ? viteConfig({ command: "build", mode: "production" })
      : viteConfig);
    expect(built).toMatchObject({ base: "/drusniel-voxels-web/" });
  });

  it("serves dev from root so the local URL needs no base path", async () => {
    const served = await (typeof viteConfig === "function"
      ? viteConfig({ command: "serve", mode: "development" })
      : viteConfig);
    expect(served).toMatchObject({ base: "/" });
  });

  it("provides standard static build and preview scripts", () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.build).toBe("vite build");
    expect(packageJson.scripts?.preview).toBe("vite preview");
  });

  it("launches the local dev server at the configured root URL", () => {
    const rootLauncher = readFileSync(resolve(repoRoot, "scripts/startClodPoc.ps1"), "utf8");
    const localLauncher = readFileSync(resolve(projectRoot, "scripts/startLocal.ps1"), "utf8");

    for (const launcher of [rootLauncher, localLauncher]) {
      expect(launcher).toContain("$Port = 5180");
      expect(launcher).toContain('$Url = "http://127.0.0.1:$Port/"');
      expect(launcher).toContain('"--port", "$Port", "--strictPort"');
      expect(launcher).not.toContain("drusniel-voxels-bevy/");
      expect(launcher).not.toContain("drusniel-voxels-web/");
    }
  });

  it("deploys the static build through GitHub Pages", () => {
    const workflow = readFileSync(resolve(projectRoot, ".github/workflows/deploy-pages.yml"), "utf8");
    const parsed = load(workflow) as { jobs?: { build?: unknown; deploy?: unknown } };
    expect(parsed.jobs).toMatchObject({ build: expect.any(Object), deploy: expect.any(Object) });
    expect(workflow).toContain("path: dist");
    expect(workflow).toContain("actions/deploy-pages");
  });

  it("renders exactly four accessible top-bar controls with the requested community links", () => {
    const html = readFileSync(resolve(projectRoot, "index.html"), "utf8");
    const toolbar = html.match(/<nav id="project-toolbar"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(toolbar.match(/<(?:button|a)\b/g)).toHaveLength(4);
    expect(toolbar).toContain('aria-label="Import project"');
    expect(toolbar).toContain('aria-label="Export project"');
    expect(toolbar).toContain('href="https://discord.gg/JXrSfsDVF"');
    expect(toolbar).toContain('href="https://github.com/danielsobrado/drusniel-voxels-web"');
    expect(toolbar).toContain('title="Star the repo"');
    expect(toolbar.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(2);
  });
});
