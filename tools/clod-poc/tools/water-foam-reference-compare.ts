import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compareWaterFoamToFableReference } from "./water-foam-reference-contract.js";
import {
  assertWaterFoamReferenceManifest,
  type WaterFoamReferenceManifest,
} from "./water-foam-reference-manifest.js";

interface CliArgs {
  readonly reference: string;
  readonly candidate: string;
  readonly out: string;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const reference = readManifest(args.reference);
  const candidate = readManifest(args.candidate);
  const comparison = compareWaterFoamToFableReference(reference, candidate);
  const report = {
    schemaVersion: 1,
    referenceSource: reference.source,
    candidateSource: candidate.source,
    comparison,
  };
  const output = resolve(args.out);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`water foam Fable reference report: ${output}`);
  if (!comparison.passed) {
    throw new Error(`water foam Fable reference gate failed:\n- ${comparison.failures.join("\n- ")}`);
  }
  console.log("water foam Fable reference gate passed");
}

function readManifest(path: string): WaterFoamReferenceManifest {
  const resolved = resolve(path);
  const value: unknown = JSON.parse(readFileSync(resolved, "utf8"));
  assertWaterFoamReferenceManifest(value);
  return value;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (const item of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(item);
    if (!match) throw new Error(`invalid argument: ${item}; expected --name=value`);
    values.set(match[1]!, match[2]!);
  }
  return {
    reference: requiredArg(values, "reference"),
    candidate: requiredArg(values, "candidate"),
    out: values.get("out")?.trim() || "shots/water/foam-reference/report.json",
  };
}

function requiredArg(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`missing required --${name}=... argument`);
  return value;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
