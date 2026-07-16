import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadQaOrchestration } from "./orchestration_manifest.js";

const COMMANDS = `
command_allowlist:
  schema_version: 1
  commands:
    - id: validate
      target: all
      lane: static
      program: node
      args: [--version]
      cwd: .
      timeout_ms: 1000
      continue_on_failure: false
      environment: {}
      placeholders: []
      artifacts: []
`;
const BATTERIES = `
qa_batteries:
  schema_version: 1
  lanes:
    - id: lane-a
      target: all
      authoritative: false
      commands: [validate]
  batteries:
    - id: smoke
      description: smoke
      targets: [clod-poc, bevy]
      lanes: [lane-a]
      scenes: []
      tags: []
`;

describe("QA orchestration manifests", () => {
  it("loads a strict command and battery registry", () => {
    const root = mkdtempSync(resolve(tmpdir(), "qa-orchestration-"));
    const commands = resolve(root, "commands.yaml");
    const batteries = resolve(root, "batteries.yaml");
    writeFileSync(commands, COMMANDS);
    writeFileSync(batteries, BATTERIES);
    const registry = loadQaOrchestration({ commands, batteries });
    expect(registry.commands.has("validate")).toBe(true);
    expect(registry.batteries.has("smoke")).toBe(true);
  });

  it("rejects shell programs", () => {
    const root = mkdtempSync(resolve(tmpdir(), "qa-orchestration-"));
    const commands = resolve(root, "commands.yaml");
    const batteries = resolve(root, "batteries.yaml");
    writeFileSync(commands, COMMANDS.replace("program: node", "program: bash"));
    writeFileSync(batteries, BATTERIES);
    expect(() => loadQaOrchestration({ commands, batteries })).toThrow(/not allowlisted/u);
  });

  it("rejects undeclared placeholders", () => {
    const root = mkdtempSync(resolve(tmpdir(), "qa-orchestration-"));
    const commands = resolve(root, "commands.yaml");
    const batteries = resolve(root, "batteries.yaml");
    writeFileSync(commands, COMMANDS.replace("args: [--version]", 'args: ["${OUTPUT_DIR}"]'));
    writeFileSync(batteries, BATTERIES);
    expect(() => loadQaOrchestration({ commands, batteries })).toThrow(/undeclared placeholder/u);
  });
});
