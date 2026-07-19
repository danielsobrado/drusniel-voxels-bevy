import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const vitestCli = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const TEST_FILES = [
  "src/gpu/webgpu_postprocess.test.ts",
  "src/gpu/postfx_atmosphere.test.ts",
  "src/gpu/postfx_cloud_shadow.test.ts",
  "src/gpu/postfx_auto_exposure.test.ts",
  "src/gpu/postfx_bounce.test.ts",
  "src/gpu/postfx_case_diagnostics.test.ts",
  "src/gpu/postfx_color_script.test.ts",
  "src/gpu/postfx_gtao.test.ts",
  "src/gpu/postfx_perf_gate.test.ts",
  "src/gpu/postfx_stage_flags.test.ts",
] as const;

interface CommandSpec {
  command: string;
  args: string[];
}

const COMMANDS: readonly CommandSpec[] = [
  { command: "npm", args: ["run", "typecheck"] },
  { command: process.execPath, args: [vitestCli, "run", ...TEST_FILES] },
] as const;

function runCommand(spec: CommandSpec): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${spec.command} ${spec.args.join(" ")} exited with ${code ?? "unknown"}`));
    });
  });
}

async function main(): Promise<void> {
  for (const spec of COMMANDS) {
    await runCommand(spec);
  }
}

main().catch((error: unknown) => {
  console.error("[verify-postfx] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
