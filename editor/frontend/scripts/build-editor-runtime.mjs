import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..");
const repoRoot = resolve(frontendDir, "..", "..");
const tauriDir = resolve(frontendDir, "src-tauri");
const binariesDir = resolve(tauriDir, "binaries");

const release = !process.argv.includes("--debug");
const profile = release ? "release" : "debug";
const targetTriple = process.env.CARGO_BUILD_TARGET || rustHostTriple();
const exeSuffix = process.platform === "win32" ? ".exe" : "";

run("cargo", ["build", "--bin", "voxel_builder", ...(release ? ["--release"] : [])], repoRoot);

const sourceBinary = resolve(repoRoot, "target", profile, `voxel_builder${exeSuffix}`);
if (!existsSync(sourceBinary)) {
  throw new Error(`expected editor runtime binary at ${sourceBinary}`);
}

mkdirSync(binariesDir, { recursive: true });

const sidecarBinary = join(
  binariesDir,
  `drusniel-editor-runtime-${targetTriple}${exeSuffix}`,
);
copyFileSync(sourceBinary, sidecarBinary);

const sizeMb = (statSync(sidecarBinary).size / 1024 / 1024).toFixed(1);
console.log(
  `Prepared Tauri editor runtime sidecar ${basename(sidecarBinary)} (${sizeMb} MiB)`,
);

function rustHostTriple() {
  const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (rustc.status !== 0) {
    throw new Error(rustc.stderr || "failed to query rustc host triple");
  }

  const hostLine = rustc.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("host: "));
  if (!hostLine) {
    throw new Error("rustc -vV did not report a host triple");
  }

  return hostLine.slice("host: ".length).trim();
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}
