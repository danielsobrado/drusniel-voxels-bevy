import { existsSync } from "node:fs";
import type {
  CliArgs,
  QaCheckThreshold,
  QaConfig,
  QaProbeConfig,
  QaSceneConfig,
  QaTimingThreshold,
} from "./qaTypes.js";
import { loadUnifiedRegistry, selectScenes } from "./unified/manifest.js";
import type {
  QaCounterGate,
  QaRegionProbe,
  QaTimingGate,
  UnifiedQaScene,
} from "./unified/schema.js";

const DEFAULT_VISUAL = "../../validation/manifests/visual-regression.yaml";
const DEFAULT_PERFORMANCE = "../../validation/manifests/performance-regression.yaml";
const DEFAULT_LEGACY_MAP = "../../validation/manifests/legacy-id-map.yaml";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    visual: DEFAULT_VISUAL,
    performance: DEFAULT_PERFORMANCE,
    legacyMap: DEFAULT_LEGACY_MAP,
    summary: "",
    tags: [],
    scenes: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--visual" && value) {
      args.visual = value;
      i++;
    } else if (arg === "--performance" && value) {
      args.performance = value;
      i++;
    } else if (arg === "--legacy-map" && value) {
      args.legacyMap = value;
      i++;
    } else if (arg === "--summary" && value) {
      args.summary = value;
      i++;
    } else if (arg === "--output" && value) {
      args.output = value;
      i++;
    } else if (arg === "--tags" && value) {
      args.tags.push(...value.split(",").filter(Boolean));
      i++;
    } else if (arg === "--scene" && value) {
      args.scenes.push(value);
      i++;
    } else if (arg === "--actual-root" && value) {
      args.actualRoot = value;
      i++;
    } else if (arg === "--config") {
      throw new Error("--config was removed; use canonical manifests with --tags or --scene");
    } else {
      throw new Error(`unknown or incomplete argument: ${arg}`);
    }
  }
  if (!args.summary) throw new Error("missing required --summary <path>");
  return args;
}

export function loadQaConfig(
  visualPath: string,
  performancePath = DEFAULT_PERFORMANCE,
  tags: readonly string[] = [],
): QaConfig {
  const canonicalVisual = existsSync(visualPath) ? visualPath : DEFAULT_VISUAL;
  const registry = loadUnifiedRegistry({
    visual: canonicalVisual,
    performance: performancePath,
  });
  const scenes = selectScenes(registry, tags).map(projectScene);
  return {
    output_root: registry.outputRoot,
    baseline_root: "../../validation/baselines",
    report_json_name: "qa-report.json",
    report_markdown_name: "qa-report.md",
    image_diff: { enabled: true, fail_when_baseline_missing: false },
    timing: { enabled: true, fail_on_threshold: true },
    scenes,
  };
}

export function validateConfig(config: QaConfig): void {
  const sceneIds = new Set<string>();
  for (const scene of config.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`duplicate QA scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    if (!scene.checkpoint) throw new Error(`scene ${scene.id} must name a checkpoint`);
    if (!scene.screenshots.length) throw new Error(`scene ${scene.id} must name screenshots`);
    const screenshotIds = new Set(scene.screenshots.map((screenshot) => screenshot.id));
    if (screenshotIds.size !== scene.screenshots.length) {
      throw new Error(`duplicate screenshot id in scene ${scene.id}`);
    }
    for (const probe of scene.probes ?? []) {
      if (!screenshotIds.has(probe.screenshot)) {
        throw new Error(`probe ${probe.id} references unknown screenshot ${probe.screenshot}`);
      }
      if ("region" in probe && !validRegion(probe.region)) {
        throw new Error(`probe ${probe.id} has invalid region`);
      }
      if ("pixel" in probe && !validPixel(probe.pixel)) {
        throw new Error(`probe ${probe.id} has invalid pixel`);
      }
    }
    const checkIds = new Set<string>();
    for (const check of scene.checks ?? []) {
      if (checkIds.has(check.id)) {
        throw new Error(`duplicate check id ${check.id} in scene ${scene.id}`);
      }
      checkIds.add(check.id);
      if (!check.area || !check.field) {
        throw new Error(`check ${check.id} must name an area and field`);
      }
      if (check.max === undefined && check.min === undefined && check.equals === undefined) {
        throw new Error(`check ${check.id} must set at least one of min/max/equals`);
      }
    }
  }
}

function validRegion(region: readonly number[]): boolean {
  return region.length === 4
    && region.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && region[0] < region[2]
    && region[1] < region[3];
}

function validPixel(pixel: readonly number[]): boolean {
  return regionValuesValid(pixel) && pixel.length === 2;
}

function regionValuesValid(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

function projectScene(scene: UnifiedQaScene): QaSceneConfig {
  return {
    id: scene.id,
    bench_scene: scene.launch.scene,
    checkpoint: scene.capture.checkpoint,
    screenshots: [
      {
        id: scene.capture.image,
        name: scene.capture.image,
        baseline: scene.baseline.image,
      },
    ],
    probes: scene.region_probes.flatMap((probe) => projectProbe(probe, scene.capture.image)),
    timing: scene.timing_gates.flatMap(projectTiming),
    checks: scene.counter_gates.flatMap(projectCounter),
  };
}

function projectProbe(probe: QaRegionProbe, screenshot: string): QaProbeConfig[] {
  const luminance = probe.gates.luminance_mean;
  if (!luminance) return [];
  const [x, y, width, height] = probe.rect_normalized;
  return [{
    id: probe.id,
    type: "region_luminance",
    screenshot,
    region: [x, y, x + width, y + height],
    min: luminance.min ?? 0,
    max: luminance.max ?? 1,
  }];
}

function projectTiming(gate: QaTimingGate): QaTimingThreshold[] {
  if (gate.metric === "frame_ms_p95") {
    return [{
      id: gate.id,
      area: "__frame",
      field: "p95_ms",
      max_ms: gate.max,
      optional: !gate.required,
    }];
  }
  const source = parseAreaKey(gate.metric);
  return source
    ? [{ id: gate.id, ...source, max_ms: gate.max, optional: !gate.required }]
    : [];
}

function projectCounter(gate: QaCounterGate): QaCheckThreshold[] {
  const source = parseAreaKey(gate.key);
  if (!source || gate.operator === "between") return [];
  const result: QaCheckThreshold = {
    id: gate.id,
    ...source,
    optional: !gate.required,
  };
  if (gate.operator === "equals") result.equals = gate.value;
  else if (gate.operator === "min") result.min = gate.value;
  else result.max = gate.value;
  return [result];
}

function parseAreaKey(key: string): { area: string; field: string } | null {
  if (!key.startsWith("areas.")) return null;
  const rest = key.slice("areas.".length);
  const separator = rest.indexOf(".");
  return separator > 0
    ? { area: rest.slice(0, separator), field: rest.slice(separator + 1) }
    : null;
}
