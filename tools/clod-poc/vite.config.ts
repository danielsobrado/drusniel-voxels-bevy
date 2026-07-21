/// <reference types="vitest" />
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

function commandOutput(args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd: import.meta.dirname,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

function packageLockSha256(): string {
  try {
    return createHash("sha256")
      .update(readFileSync(resolve(import.meta.dirname, "package-lock.json")))
      .digest("hex");
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ command, mode }) => {
  const status = commandOutput(["status", "--porcelain", "--untracked-files=normal"]);
  const buildIdentity = {
    commitSha: commandOutput(["rev-parse", "HEAD"]),
    workingTreeDirty: status !== "" && status !== "unknown",
    packageLockSha256: packageLockSha256(),
    mode: `${command}:${mode}`,
  };

  return {
    // Production (GitHub Pages) is served from a repo sub-path, so builds need that base.
    // Dev serves from root so the local URL is simply http://localhost:5173/ — no base-path
    // to mistype, and no confusion with the clod-poc project (base "/drusniel-voxels-bevy/").
    base: command === "build" ? "/drusniel-voxels-web/" : "/",
    publicDir: "public",
    define: {
      __DRUSNIEL_QA_BUILD_IDENTITY__: JSON.stringify(buildIdentity),
    },
    server: {
      // Pinned + strict so this project never silently lands on a different port, and so a
      // clash with another local Vite project fails loudly instead of serving the wrong app.
      port: 5180,
      strictPort: true,
      watch: {
        ignored: ["**/perf-runs/**", "**/validation-runs/**", "**/qa-runs/**"],
      },
    },
    build: {
      target: "es2022",
    },
    test: {
      setupFiles: ["./src/test-setup.ts"],
      testTimeout: 120000,
      // Keep Windows runs below the process/memory pressure that makes Vitest forks exit.
      maxWorkers: 4,
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/reference/**",
        "**/.{idea,git,cache,output,temp}/**",
      ],
    },
  };
});
