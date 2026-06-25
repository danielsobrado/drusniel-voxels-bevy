import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadAcceptanceConfig, DEFAULT_ACCEPTANCE_CONFIG_PATH } from "./acceptanceConfig.js";
import { runAcceptance } from "./acceptanceRunner.js";
import { createLogger } from "./logger.js";
import { normalizeError } from "./acceptanceTypes.js";

export interface CliOptions {
  configPath: string;
  scene?: string;
  noScreenshots: boolean;
  jsonOnly: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: DEFAULT_ACCEPTANCE_CONFIG_PATH,
    noScreenshots: false,
    jsonOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" && i + 1 < argv.length) {
      options.configPath = argv[++i];
    } else if (arg === "--scene" && i + 1 < argv.length) {
      options.scene = argv[++i];
    } else if (arg === "--no-screenshots") {
      options.noScreenshots = true;
    } else if (arg === "--json") {
      options.jsonOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log("CLOD Phase 3 Acceptance Gate");
  console.log("");
  console.log("Usage:");
  console.log("  npm run acceptance:clod [options]");
  console.log("");
  console.log("Options:");
  console.log("  --config <path>       Path to acceptance config YAML (default: config/clod_acceptance.yaml)");
  console.log("  --scene <name>        Run a single stress scene (ridge_border, cliff_corner, cave_mouth, thin_bridge)");
  console.log("  --no-screenshots      Skip screenshot generation");
  console.log("  --json                Output summary JSON to stdout");
  console.log("  --help, -h            Show this help");
}

export function printSummary(
  report: { status: string; gates: { id: string; name: string; status: string; message: string }[] },
  runDir: string,
  jsonOnly: boolean,
): void {
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const statusText = report.status === "pass" ? "PASS" : report.status === "warn" ? "WARN" : "FAIL";
  console.log("");
  console.log(`CLOD Phase 3 Acceptance Gate`);
  console.log("");
  for (const gate of report.gates) {
    const statusStr = gate.status === "pass" ? "PASS" : gate.status === "warn" ? "WARN" : "FAIL";
    console.log(`  ${statusStr} ${gate.id} ${gate.name}`);
  }
  console.log("");
  console.log(`Result: ${statusText}`);
  console.log(`Report: ${runDir}/summary.json`);
  console.log("");
}

export async function runAcceptanceCli(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (!existsSync(options.configPath)) {
    console.error(`Config file not found: ${options.configPath}`);
    process.exit(2);
  }

  const configPath = resolve(options.configPath);
  const config = loadAcceptanceConfig(configPath);

  if (options.noScreenshots) {
    config.visual.enabled = false;
  }

  const logger = createLogger(config.logging.level);

  logger.info("CLOD Phase 3 Acceptance Gate");
  logger.info(`Config: ${configPath}`);

  const { report, runDir } = await runAcceptance(config, logger);

  printSummary(report, runDir, options.jsonOnly);

  if (report.status === "fail") {
    process.exit(1);
  }
}
