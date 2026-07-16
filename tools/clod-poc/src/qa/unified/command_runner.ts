import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { QaCommandDefinition, QaPlaceholder } from "./orchestration_schema.js";

const LOG_TAIL_LIMIT = 16_384;

export interface QaCommandContext {
  repositoryRoot: string;
  outputDir: string;
  runIndex: number;
  sceneId: string;
  target: "clod-poc" | "bevy";
}

export interface QaCommandResult {
  command_id: string;
  scene_id: string;
  target: string;
  status: "PASS" | "FAIL" | "TIMEOUT" | "ARTIFACT_MISSING";
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  program: string;
  args: string[];
  cwd: string;
  stdout_log: string;
  stderr_log: string;
  missing_artifacts: string[];
  stdout_tail: string;
  stderr_tail: string;
}

export async function runQaCommand(command: QaCommandDefinition, context: QaCommandContext): Promise<QaCommandResult> {
  validateTarget(command, context);
  const values = placeholders(context);
  const program = platformProgram(command.program);
  const args = command.args.map((argument) => substitute(argument, values));
  const cwd = resolveInside(context.repositoryRoot, command.cwd, "command cwd");
  const commandOutput = resolveInside(context.outputDir, `commands/${safeName(command.id)}-${safeName(context.sceneId)}`, "command output");
  mkdirSync(commandOutput, { recursive: true });
  const stdoutLog = resolve(commandOutput, "stdout.log");
  const stderrLog = resolve(commandOutput, "stderr.log");
  const environment = Object.fromEntries(Object.entries(command.environment).map(([key, value]) => [key, substitute(value, values)]));

  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let exitCode: number | null = null;
  let signal: string | null = null;

  await new Promise<void>((done, reject) => {
    const child = spawn(program, args, {
      cwd,
      env: { ...process.env, ...environment },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child.pid);
    }, command.timeout_ms);
    child.stdout?.on("data", (chunk: Buffer | string) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: Buffer | string) => { stderr += String(chunk); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      clearTimeout(timeout);
      exitCode = code;
      signal = childSignal;
      done();
    });
  });

  writeFileSync(stdoutLog, stdout);
  writeFileSync(stderrLog, stderr);
  const missingArtifacts = command.artifacts
    .filter((artifact) => artifact.required)
    .map((artifact) => substitute(artifact.path, values))
    .filter((artifactPath) => !existsSync(resolveInside(context.repositoryRoot, artifactPath, "artifact path")));
  const status = timedOut ? "TIMEOUT" : exitCode !== 0 ? "FAIL" : missingArtifacts.length > 0 ? "ARTIFACT_MISSING" : "PASS";
  return {
    command_id: command.id,
    scene_id: context.sceneId,
    target: context.target,
    status,
    exit_code: exitCode,
    signal,
    duration_ms: Date.now() - started,
    program,
    args,
    cwd,
    stdout_log: stdoutLog,
    stderr_log: stderrLog,
    missing_artifacts: missingArtifacts,
    stdout_tail: tail(stdout),
    stderr_tail: tail(stderr),
  };
}

export function commandArtifactPaths(command: QaCommandDefinition, context: QaCommandContext): Array<{ path: string; kind: string; ignoreJsonKeys: string[]; numericTolerance: number }> {
  const values = placeholders(context);
  return command.artifacts
    .filter((artifact) => artifact.deterministic)
    .map((artifact) => ({
      path: resolveInside(context.repositoryRoot, substitute(artifact.path, values), "deterministic artifact"),
      kind: artifact.kind,
      ignoreJsonKeys: artifact.ignore_json_keys,
      numericTolerance: artifact.numeric_tolerance,
    }));
}

function validateTarget(command: QaCommandDefinition, context: QaCommandContext): void {
  if (command.target !== "all" && command.target !== context.target) throw new Error(`command ${command.id} target ${command.target} cannot run for ${context.target}`);
}

function placeholders(context: QaCommandContext): Record<QaPlaceholder, string> {
  return {
    OUTPUT_DIR: context.outputDir.replaceAll("\\", "/"),
    REPOSITORY_ROOT: context.repositoryRoot.replaceAll("\\", "/"),
    RUN_INDEX: String(context.runIndex),
    SCENE_ID: context.sceneId,
    TARGET: context.target,
  };
}

function substitute(template: string, values: Record<QaPlaceholder, string>): string {
  return template.replace(/\$\{([A-Z][A-Z0-9_]*)\}/gu, (_match, rawName: string) => {
    const name = rawName as QaPlaceholder;
    const value = values[name];
    if (value === undefined) throw new Error(`unresolved placeholder ${rawName}`);
    return value;
  });
}

function resolveInside(root: string, path: string, label: string): string {
  const normalizedRoot = resolve(root);
  const result = resolve(normalizedRoot, path);
  if (result !== normalizedRoot && !result.startsWith(`${normalizedRoot}${sep}`)) throw new Error(`${label} escapes root: ${path}`);
  return result;
}

function platformProgram(program: string): string {
  if (process.platform !== "win32") return program;
  if (program === "npm" || program === "npx") return `${program}.cmd`;
  if (program === "cargo") return "cargo.exe";
  return program;
}

function stopProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-pid, "SIGTERM"); }
  catch { try { process.kill(pid, "SIGTERM"); } catch { /* process already exited */ } }
}

function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/gu, "_"); }
function tail(value: string): string { return value.length <= LOG_TAIL_LIMIT ? value : value.slice(-LOG_TAIL_LIMIT); }
