import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BROWSER_COMMANDS = [
  "chrome",
  "chrome.exe",
  "msedge",
  "msedge.exe",
  "chromium",
  "chromium.exe",
  "google-chrome",
  "chromium-browser",
] as const;

export function ensureBrowserExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.CHROME_PATH?.trim();
  if (explicit) {
    const resolved = resolveCandidate(explicit, platform);
    if (!resolved) throw new Error(`CHROME_PATH does not resolve to a browser executable: ${explicit}`);
    process.env.CHROME_PATH = normalizeBrowserPath(resolved, platform);
    return process.env.CHROME_PATH;
  }

  for (const candidate of browserExecutableCandidates(env, platform)) {
    const resolved = resolveCandidate(candidate, platform);
    if (!resolved) continue;
    process.env.CHROME_PATH = normalizeBrowserPath(resolved, platform);
    return process.env.CHROME_PATH;
  }

  throw new Error(
    "could not find Chrome/Chromium/Edge; install a browser or set CHROME_PATH to its executable",
  );
}

export function browserExecutableCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined): void => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    const programFiles = env.ProgramFiles ?? env.PROGRAMFILES;
    const programFilesX86 = env["ProgramFiles(x86)"] ?? env["PROGRAMFILES(X86)"];

    add(localAppData && join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));
    add(programFiles && join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
    add(programFilesX86 && join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
    add(localAppData && join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"));
    add(programFiles && join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
    add(programFilesX86 && join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));
  } else {
    add("/mnt/c/Program Files/Google/Chrome/Application/chrome.exe");
    add("/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe");
    add("/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe");
  }

  for (const command of BROWSER_COMMANDS) add(command);
  return candidates;
}

function resolveCandidate(candidate: string, platform: NodeJS.Platform): string | null {
  if (looksLikePath(candidate)) return existsSync(candidate) ? candidate : null;

  const command = platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(command, [candidate], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return resolved ?? null;
  } catch {
    return null;
  }
}

function looksLikePath(candidate: string): boolean {
  return candidate.includes("/") || candidate.includes("\\") || /^[A-Za-z]:/.test(candidate);
}

function normalizeBrowserPath(path: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.replaceAll("\\", "/") : path;
}
