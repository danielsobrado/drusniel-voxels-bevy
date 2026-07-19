import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserExecutableCandidates,
  ensureBrowserExecutable,
} from "./browser-executable.js";

const originalChromePath = process.env.CHROME_PATH;

afterEach(() => {
  if (originalChromePath === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = originalChromePath;
});

describe("browser executable discovery", () => {
  it("includes standard Windows Chrome and Edge install locations", () => {
    const candidates = browserExecutableCandidates({
      LOCALAPPDATA: "C:\\Users\\Daniel\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    }, "win32");

    expect(candidates).toContain("C:\\Users\\Daniel\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
    expect(candidates).toContain("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(candidates).toContain("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(candidates).toContain("msedge.exe");
  });

  it("honours an explicit executable and publishes it for the shared harness", () => {
    const directory = mkdtempSync(join(tmpdir(), "clod-browser-discovery-"));
    const executable = join(directory, process.platform === "win32" ? "chrome.exe" : "chrome");
    writeFileSync(executable, "");

    try {
      const resolved = ensureBrowserExecutable({ CHROME_PATH: executable }, process.platform);
      expect(resolved).toBe(process.platform === "win32" ? executable.replaceAll("\\", "/") : executable);
      expect(process.env.CHROME_PATH).toBe(resolved);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
