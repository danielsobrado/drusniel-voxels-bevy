import { load } from "js-yaml";
import benchmarkProfilesYamlText from "../../config/benchmark_content_profiles.yaml?raw";
import {
  WORKLOAD_DESCRIPTOR_KEYS,
  type WorkloadDescriptorValues,
} from "../diagnostics/workload_descriptors.js";

/**
 * Benchmark content profiles (rpg-content-density-scaling D1a): cost-bearing
 * benchmark workloads keyed by scene. A benchmark-config concept — deliberately not
 * a production content-registry abstraction; whether any of this graduates into the
 * content registry is decided after D1b/D1c prove the model.
 */
export interface BenchmarkContentProfile {
  readonly id: string;
  readonly scene: string;
  readonly description: string;
  readonly composition: Readonly<Record<string, unknown>>;
  readonly descriptors: WorkloadDescriptorValues;
}

export interface BenchmarkProfileIssue {
  readonly path: string;
  readonly message: string;
}

export interface ParsedBenchmarkContentProfiles {
  readonly profiles: ReadonlyMap<string, BenchmarkContentProfile>;
  readonly issues: readonly BenchmarkProfileIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DESCRIPTOR_KEY_SET = new Set<string>(WORKLOAD_DESCRIPTOR_KEYS);

export function parseBenchmarkContentProfiles(yamlText: string): ParsedBenchmarkContentProfiles {
  const issues: BenchmarkProfileIssue[] = [];
  const profiles = new Map<string, BenchmarkContentProfile>();

  let parsed: unknown;
  try {
    parsed = load(yamlText);
  } catch (error) {
    issues.push({ path: "root", message: `YAML syntax error: ${error instanceof Error ? error.message : String(error)}` });
    return { profiles, issues };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.profiles)) {
    issues.push({ path: "root", message: "expected a top-level `profiles` list" });
    return { profiles, issues };
  }

  parsed.profiles.forEach((entry, index) => {
    const path = `profiles[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: "profile entry must be an object" });
      return;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) {
      issues.push({ path, message: "profile id must be a non-empty string" });
      return;
    }
    if (profiles.has(id)) {
      issues.push({ path: `${path}.id`, message: `duplicate profile id: ${id}` });
      return;
    }
    const scene = typeof entry.scene === "string" ? entry.scene.trim() : "";
    if (!scene) {
      issues.push({ path: `${path}.scene`, message: "profile scene must be a non-empty string" });
      return;
    }
    if (!isRecord(entry.descriptors)) {
      issues.push({ path: `${path}.descriptors`, message: "profile descriptors must be an object" });
      return;
    }

    let descriptorsValid = true;
    const descriptors = {} as WorkloadDescriptorValues;
    for (const key of WORKLOAD_DESCRIPTOR_KEYS) {
      const value = entry.descriptors[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        issues.push({ path: `${path}.descriptors.${key}`, message: "descriptor must be a finite non-negative number" });
        descriptorsValid = false;
        continue;
      }
      descriptors[key] = value;
    }
    for (const key of Object.keys(entry.descriptors)) {
      if (!DESCRIPTOR_KEY_SET.has(key)) {
        issues.push({ path: `${path}.descriptors.${key}`, message: "unknown descriptor key" });
        descriptorsValid = false;
      }
    }
    if (!descriptorsValid) return;

    profiles.set(id, {
      id,
      scene,
      description: typeof entry.description === "string" ? entry.description.trim() : "",
      composition: isRecord(entry.composition) ? entry.composition : {},
      descriptors,
    });
  });

  return { profiles, issues };
}

/** Loads the bundled config; benchmark config is load-bearing for gates, so it fails loud. */
export function loadBenchmarkContentProfiles(): ReadonlyMap<string, BenchmarkContentProfile> {
  const { profiles, issues } = parseBenchmarkContentProfiles(benchmarkProfilesYamlText);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`benchmark_content_profiles.yaml is invalid: ${detail}`);
  }
  return profiles;
}
