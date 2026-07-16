import { createHash } from "node:crypto";
import { dump, load } from "js-yaml";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { UnifiedQaRegistry, UnifiedQaScene } from "./schema.js";

export interface QaBaselineUpdateOptions {
  repositoryRoot: string;
  runRoot: string;
  visualManifest: string;
  performanceManifest: string;
  sceneIds: string[];
  approve: boolean;
  allowCi: boolean;
}

export interface QaBaselineAuthority {
  schema_version: 1;
  scene_id: string;
  target: string;
  repository_commit_sha: string;
  branch: string;
  working_tree_dirty: false;
  baseline_version: number;
  image_sha256: string;
  manifest_sha256: string;
  environment: Record<string, unknown>;
  promoted_utc: string;
}

export function updateQaBaselines(registry: UnifiedQaRegistry, options: QaBaselineUpdateOptions): QaBaselineAuthority[] {
  if (!options.approve) throw new Error("baseline update requires --approve");
  if (process.env["CI"] && !options.allowCi) throw new Error("baseline updates are forbidden in CI without --allow-ci");
  const git = verifyGitAuthority(options.repositoryRoot);
  const environmentPath = resolve(options.runRoot, "environment.json");
  if (!existsSync(environmentPath)) throw new Error(`authoritative run environment is missing: ${environmentPath}`);
  const environment = JSON.parse(readFileSync(environmentPath, "utf8")) as Record<string, unknown>;
  if (environment["authoritative"] !== true) throw new Error("run environment is not authoritative");
  if (environment["repository_commit_sha"] !== git.head) {
    throw new Error(`captured commit ${String(environment["repository_commit_sha"])} does not match current main ${git.head}`);
  }
  if (environment["working_tree_dirty"] !== false) throw new Error("authoritative capture reports a dirty working tree");
  const selected = registry.scenes.filter((scene) => options.sceneIds.length === 0 || options.sceneIds.includes(scene.id));
  if (selected.length === 0) throw new Error("no scenes selected for baseline promotion");
  const unknown = options.sceneIds.filter((id) => !selected.some((scene) => scene.id === id));
  if (unknown.length > 0) throw new Error(`unknown baseline scenes: ${unknown.join(", ")}`);
  const selectedTargets = new Set(selected.map((scene) => scene.target));
  if (selectedTargets.size !== 1) throw new Error("promote one target per authoritative run root");
  const selectedTarget = selected[0]?.target;
  if (environment["target"] !== selectedTarget) throw new Error(`run target ${String(environment["target"])} does not match selected target ${selectedTarget}`);
  for (const key of ["os_version", "gpu_adapter", "gpu_backend"]) if (environment[key] === null || environment[key] === undefined || environment[key] === "") throw new Error(`authoritative environment is missing ${key}`);
  if (selectedTarget === "clod-poc" && !environment["browser_version"]) throw new Error("authoritative CLOD environment is missing browser_version");
  const nextVersion = registry.baselineVersion + 1;
  const manifestHash = sha256Files([options.visualManifest, options.performanceManifest]);
  const authorities: QaBaselineAuthority[] = [];
  const sceneHashes = new Map<string, string>();

  for (const scene of selected) {
    const source = resolveStagedScene(options.runRoot, scene);
    requireFile(source.image, `${scene.id} actual image`);
    requireFile(source.stats, `${scene.id} actual stats`);
    requireFile(source.metrics, `${scene.id} actual metrics`);
    const imageTarget = resolve(options.repositoryRoot, scene.baseline.image);
    const statsTarget = resolve(options.repositoryRoot, scene.baseline.stats);
    const metricsTarget = resolve(options.repositoryRoot, scene.baseline.metrics);
    mkdirSync(dirname(imageTarget), { recursive: true });
    copyFileSync(source.image, imageTarget);
    copyFileSync(source.stats, statsTarget);
    copyFileSync(source.metrics, metricsTarget);
    const imageSha256 = sha256File(imageTarget);
    sceneHashes.set(scene.id, imageSha256);
    const authority: QaBaselineAuthority = {
      schema_version: 1,
      scene_id: scene.id,
      target: scene.target,
      repository_commit_sha: git.head,
      branch: git.branch,
      working_tree_dirty: false,
      baseline_version: nextVersion,
      image_sha256: imageSha256,
      manifest_sha256: manifestHash,
      environment,
      promoted_utc: new Date().toISOString(),
    };
    writeFileSync(resolve(dirname(imageTarget), "authority.json"), `${JSON.stringify(authority, null, 2)}\n`);
    writeFileSync(resolve(dirname(imageTarget), "baseline.sha256"), `${imageSha256}  baseline.png\n`);
    authorities.push(authority);
  }

  const visualUpdate = updateManifest(options.visualManifest, sceneHashes, nextVersion, "visual_regression");
  const performanceUpdate = updateManifest(options.performanceManifest, sceneHashes, null, "performance_regression");
  const updated = new Set([...visualUpdate.updated, ...performanceUpdate.updated]);
  const missing = [...sceneHashes.keys()].filter((sceneId) => !updated.has(sceneId));
  if (missing.length > 0) throw new Error(`selected scenes are missing from canonical manifests: ${missing.join(", ")}`);
  writeFileSync(options.visualManifest, visualUpdate.text);
  writeFileSync(options.performanceManifest, performanceUpdate.text);
  return authorities;
}

export function verifyGitAuthority(repositoryRoot: string): { branch: string; head: string } {
  const branch = git(repositoryRoot, ["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`baseline updates require branch main, got ${branch || "detached HEAD"}`);
  const status = git(repositoryRoot, ["status", "--porcelain", "--untracked-files=normal"]);
  if (status !== "") throw new Error("baseline updates require a clean working tree");
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const originMain = tryGit(repositoryRoot, ["rev-parse", "refs/remotes/origin/main"]);
  if (originMain && originMain !== head) throw new Error(`HEAD ${head} does not match origin/main ${originMain}`);
  return { branch, head };
}

function resolveStagedScene(runRoot: string, scene: UnifiedQaScene): { image: string; stats: string; metrics: string } {
  const roots = [
    resolve(runRoot, "scenes", scene.target, scene.id),
    resolve(runRoot, scene.target, scene.id),
    resolve(runRoot, scene.id),
  ];
  for (const root of roots) {
    const image = resolve(root, "actual.png");
    const stats = resolve(root, "actual.stats.json");
    const metrics = resolve(root, "actual.metrics.json");
    if (existsSync(image) || existsSync(stats) || existsSync(metrics)) return { image, stats, metrics };
  }
  throw new Error(`no staged baseline artifacts found for ${scene.id}`);
}

function updateManifest(
  path: string,
  hashes: ReadonlyMap<string, string>,
  baselineVersion: number | null,
  rootKey: "visual_regression" | "performance_regression",
): { text: string; updated: string[] } {
  const document = asRecord(load(String(readFileSync(path, "utf8"))), path);
  const root = asRecord(document[rootKey], `${path}.${rootKey}`);
  if (baselineVersion !== null) root["baseline_version"] = baselineVersion;
  const scenes = root["scenes"];
  if (!Array.isArray(scenes)) throw new Error(`${path}.${rootKey}.scenes must be an array`);
  const updated: string[] = [];
  for (const rawScene of scenes) {
    const scene = asRecord(rawScene, `${path}.${rootKey}.scenes[]`);
    const id = scene["id"];
    if (typeof id !== "string") continue;
    const hash = hashes.get(id);
    if (!hash) continue;
    const baseline = asRecord(scene["baseline"], `${path}.${rootKey}.${id}.baseline`);
    const imageGates = asRecord(scene["image_gates"], `${path}.${rootKey}.${id}.image_gates`);
    baseline["sha256"] = hash;
    imageGates["required"] = true;
    updated.push(id);
  }
  return {
    text: dump(document, { noRefs: true, lineWidth: -1, sortKeys: false }),
    updated,
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function git(root: string, args: string[]): string { return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
function tryGit(root: string, args: string[]): string | null { try { return git(root, args); } catch { return null; } }
function requireFile(path: string, label: string): void { if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`); }
function sha256File(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function sha256Files(paths: readonly string[]): string { const hash = createHash("sha256"); for (const path of paths) hash.update(readFileSync(path)); return hash.digest("hex"); }
