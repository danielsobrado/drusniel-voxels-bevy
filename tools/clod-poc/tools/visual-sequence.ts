import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { clodUrl, launchWebGPU } from "./launch.js";
import { detectPopComponents, residualMetrics, temporalMetrics, type ImagePlane } from "./visual-sequence/metrics.js";
import { reprojectedResidual } from "./visual-sequence/reprojection.js";
import {
  validateVisualSequenceConfig,
  type VisualSequenceEvent,
  type VisualSequenceFrameRecord,
  type VisualSequenceManifest,
} from "./visual-sequence/schema.js";

type Args = Record<string, string | boolean>;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pair = stringArg(args, "pair");
  if (pair) {
    await comparePair(resolve(requiredArg(args, "left")), resolve(pair), resolve(stringArg(args, "out") ?? "sequence-runs/paired"));
    return;
  }
  const configPath = resolve(requiredArg(args, "config"));
  const outputDir = resolve(stringArg(args, "out") ?? join("sequence-runs", basename(configPath, ".json")));
  const config = validateVisualSequenceConfig(JSON.parse(readFileSync(configPath, "utf8")));
  const width = Number(stringArg(args, "width") ?? 960);
  const height = Number(stringArg(args, "height") ?? 540);
  const timeoutMs = Number(stringArg(args, "timeout") ?? 180_000);
  mkdirSync(join(outputDir, "frames"), { recursive: true });
  mkdirSync(join(outputDir, "stats"), { recursive: true });
  if (config.captureDepth) mkdirSync(join(outputDir, "depth"), { recursive: true });

  const { browser, recipe } = await launchWebGPU();
  const consoleErrors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const url = clodUrl({
      scene: config.scene === "main" ? null : config.scene,
      seed: config.seed,
      cam: [
        (config.boot ?? config.start).p[0],
        (config.boot ?? config.start).p[1],
        (config.boot ?? config.start).p[2],
        (config.boot ?? config.start).yaw,
        (config.boot ?? config.start).pitch,
        (config.boot ?? config.start).fov ?? 55,
      ].join(","),
      hud: false,
      freeze: true,
      extra: {
        precisionDiag: "1",
        clouds: "0",
        froxels: "0",
        treeWind: "0",
        grassWind: "0",
        taa: "0",
        ...config.query,
      },
    });
    console.log(`[visual-sequence] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Boolean(window.__drusnielClod?.ready || window.__drusnielClod?.error),
      undefined,
      { timeout: timeoutMs, polling: 250 },
    ).catch(async () => {
      const state = await page.evaluate(() => ({
        progress: window.__drusnielClod?.progress ?? null,
        progressMsg: window.__drusnielClod?.progressMsg ?? "hook missing",
        error: window.__drusnielClod?.error ?? null,
      }));
      throw new Error(`timed out waiting for app readiness: ${JSON.stringify(state)}; console=${consoleErrors.join(" | ")}`);
    });
    const fatal = await page.evaluate(() => window.__drusnielClod?.error ?? null);
    if (fatal) throw new Error(`app reported fatal error: ${fatal}`);
    await page.waitForFunction(
      () => Boolean(window.__drusnielQa?.ready()),
      undefined,
      { timeout: timeoutMs, polling: 250 },
    ).catch(async () => {
      const blockers = await page.evaluate(() => window.__drusnielQa?.readinessBlockers() ?? ["QA hook missing"]);
      throw new Error(`timed out waiting for sequence readiness: ${blockers.join("; ")}`);
    });
    await page.evaluate(async (clockConfig) => {
      if (!window.__drusnielQa) throw new Error("QA hook is missing");
      await window.__drusnielQa.beginSequence(clockConfig);
    }, { frames: config.frames, stepSeconds: config.stepSeconds, path: { start: config.start, end: config.end } });
    await page.evaluate(async (frames) => window.__drusnielQa!.settle(frames), config.warmupFrames ?? 60);
    await page.evaluate(async () => window.__drusnielQa!.setDiagnosticBuffer("final"));
    if (config.setupAction) {
      await page.evaluate(async (action) => window.__drusnielQa!.runSequenceEvent(action), config.setupAction);
      if (config.boot && !sameConfiguredPose(config.boot, config.start)) {
        await page.evaluate(async () => window.__drusnielQa!.stepSequence(0, true));
      }
      await page.evaluate(async (frames) => window.__drusnielQa!.settle(frames), config.setupSettleFrames ?? 1);
    }

    const environment = await page.evaluate(() => window.__drusnielQa?.environment() ?? {});
    const movingPath = !sameConfiguredPose(config.start, config.end);
    const records: VisualSequenceFrameRecord[] = [];
    const frameStats: Array<{ counters: Record<string, number>; camera: CameraRecord }> = [];
    for (let index = 0; index < config.frames; index++) {
      if (config.eventFrame === index && config.eventAction) {
        await page.evaluate(async (action) => window.__drusnielQa!.runSequenceEvent(action), config.eventAction);
      }
      const state = await page.evaluate(
        async ({ frameIndex, applyPose }) => window.__drusnielQa!.stepSequence(frameIndex, applyPose),
        { frameIndex: index, applyPose: movingPath },
      );
      const stem = String(index).padStart(3, "0");
      const colorRelative = `frames/${stem}.png`;
      const colorDataUrl = await page.evaluate(async (frameIndex) => window.__drusnielQa!.captureScreenshot(`final-${frameIndex}`), index);
      writeFileSync(join(outputDir, colorRelative), decodeDataUrl(colorDataUrl));
      const depthRelative = config.captureDepth ? `depth/${stem}.png` : undefined;
      const captured = await page.evaluate(async () => ({
        stats: await window.__drusnielQa!.captureStats(),
        camera: window.__drusnielQa!.getCameraMatrices(),
      }));
      const statsRelative = `stats/${stem}.json`;
      writeJson(join(outputDir, statsRelative), captured);
      frameStats.push({ counters: captured.stats.counters, camera: captured.camera });
      records.push({ index, timeSeconds: state.timeSeconds, pose: state.pose, color: colorRelative, depth: depthRelative, stats: statsRelative });
    }
    if (config.captureDepth) {
      await page.evaluate(async () => window.__drusnielQa!.setDiagnosticBuffer("depth"));
      for (let index = 0; index < config.frames; index++) {
        await page.evaluate(
          async ({ frameIndex, applyPose }) => window.__drusnielQa!.stepSequence(frameIndex, applyPose),
          { frameIndex: index, applyPose: movingPath },
        );
        const dataUrl = await page.evaluate(async (frameIndex) => window.__drusnielQa!.captureScreenshot(`depth-${frameIndex}`), index);
        writeFileSync(join(outputDir, records[index]!.depth!), decodeDataUrl(dataUrl));
      }
      await page.evaluate(async () => window.__drusnielQa!.setDiagnosticBuffer("final"));
    }
    await page.evaluate(async () => window.__drusnielQa?.endSequence());

    const manifest: VisualSequenceManifest = {
      schemaVersion: 1,
      id: config.id,
      mode: config.mode,
      createdAt: new Date().toISOString(),
      commit: currentCommit(),
      url,
      environment: { ...environment, launch: recipe },
      config,
      frames: records,
    };
    writeJson(join(outputDir, "sequence.json"), manifest);
    const colorPlanes = await Promise.all(records.map((record) => readPlane(join(outputDir, record.color))));
    const temporal = temporalMetrics(colorPlanes);
    const events: VisualSequenceEvent[] = [];
    for (let index = 1; index < colorPlanes.length; index++) {
      const components = detectPopComponents(colorPlanes[index - 1]!, colorPlanes[index]!, index, 0.12, 8);
      for (const component of components.slice(0, 20)) events.push({
        frame: index,
        name: config.eventFrame === index ? config.eventName ?? "controlled-transition" : "visual-residual",
        bounds: { x: component.x, y: component.y, width: component.width, height: component.height },
        area: component.area,
        peakDelta: component.peakDelta,
        duration: 1,
        counters: transitionCounters(frameStats[index]?.counters ?? {}),
      });
    }
    writeJson(join(outputDir, "events.json"), events);

    const reprojection = config.captureDepth
      ? await calculateReprojection(outputDir, records, colorPlanes, frameStats)
      : [];
    const eventResidual = config.eventFrame && config.eventFrame > 0 ? temporal.adjacent[config.eventFrame - 1] ?? null : null;
    const eventPopEvents = config.eventFrame === undefined ? 0 : events.filter((event) => event.frame === config.eventFrame).length;
    const gateViolations = evaluateThresholds(config.thresholds, temporal, events.length, reprojection, eventResidual, eventPopEvents, frameStats);
    const summary = {
      schemaVersion: 1,
      id: config.id,
      mode: config.mode,
      frameCount: records.length,
      static_temporal_variance: config.mode === "static" ? temporal : null,
      transition_residual: config.mode === "transition" ? temporal : null,
      moving_residual: config.mode === "moving" ? temporal : null,
      reprojected_colour_residual: reprojection,
      popEvents: events.length,
      eventResidual,
      eventPopEvents,
      consoleErrors,
      thresholds: config.thresholds ?? null,
      gateViolations,
      passed: consoleErrors.length === 0 && gateViolations.length === 0,
    };
    writeJson(join(outputDir, "summary.json"), summary);
    writeFileSync(join(outputDir, "report.md"), reportMarkdown(summary, relative(process.cwd(), outputDir)));
    console.log(`[visual-sequence] wrote ${outputDir} passed=${summary.passed}`);
    if (!summary.passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

interface CameraRecord { viewProjection: number[]; viewProjectionInverse: number[]; near: number; far: number }

function evaluateThresholds(
  thresholds: VisualSequenceManifest["config"]["thresholds"],
  temporal: ReturnType<typeof temporalMetrics>,
  popEvents: number,
  reprojection: readonly { meanLuma: number; validRatio: number }[],
  eventResidual: { meanLuma: number; p95Luma: number; changedRatio: number } | null,
  eventPopEvents: number,
  frameStats: readonly { counters: Record<string, number> }[],
): string[] {
  if (!thresholds) return [];
  const violations: string[] = [];
  const maximumReprojected = reprojection.length > 0 ? Math.max(...reprojection.map((item) => item.meanLuma)) : 0;
  const minimumValidRatio = reprojection.length > 0 ? Math.min(...reprojection.map((item) => item.validRatio)) : 1;
  if (thresholds.meanLuma !== undefined && temporal.meanLuma > thresholds.meanLuma) violations.push(`meanLuma ${temporal.meanLuma} > ${thresholds.meanLuma}`);
  if (thresholds.maxP95Luma !== undefined && temporal.maxP95Luma > thresholds.maxP95Luma) violations.push(`maxP95Luma ${temporal.maxP95Luma} > ${thresholds.maxP95Luma}`);
  if (thresholds.maxChangedRatio !== undefined && temporal.maxChangedRatio > thresholds.maxChangedRatio) violations.push(`maxChangedRatio ${temporal.maxChangedRatio} > ${thresholds.maxChangedRatio}`);
  if (thresholds.popEvents !== undefined && popEvents > thresholds.popEvents) violations.push(`popEvents ${popEvents} > ${thresholds.popEvents}`);
  if (thresholds.eventMeanLuma !== undefined && (eventResidual?.meanLuma ?? 0) > thresholds.eventMeanLuma) violations.push(`eventMeanLuma ${eventResidual?.meanLuma ?? 0} > ${thresholds.eventMeanLuma}`);
  if (thresholds.eventP95Luma !== undefined && (eventResidual?.p95Luma ?? 0) > thresholds.eventP95Luma) violations.push(`eventP95Luma ${eventResidual?.p95Luma ?? 0} > ${thresholds.eventP95Luma}`);
  if (thresholds.eventChangedRatio !== undefined && (eventResidual?.changedRatio ?? 0) > thresholds.eventChangedRatio) violations.push(`eventChangedRatio ${eventResidual?.changedRatio ?? 0} > ${thresholds.eventChangedRatio}`);
  if (thresholds.eventPopEvents !== undefined && eventPopEvents > thresholds.eventPopEvents) violations.push(`eventPopEvents ${eventPopEvents} > ${thresholds.eventPopEvents}`);
  if (thresholds.maxReprojectedMeanLuma !== undefined && maximumReprojected > thresholds.maxReprojectedMeanLuma) violations.push(`maxReprojectedMeanLuma ${maximumReprojected} > ${thresholds.maxReprojectedMeanLuma}`);
  if (thresholds.minReprojectedValidRatio !== undefined && minimumValidRatio < thresholds.minReprojectedValidRatio) violations.push(`minReprojectedValidRatio ${minimumValidRatio} < ${thresholds.minReprojectedValidRatio}`);
  for (const [counter, maximum] of Object.entries(thresholds.counterMax ?? {})) {
    const observed = Math.max(...frameStats.map((frame) => frame.counters[counter] ?? 0));
    if (observed > maximum) violations.push(`counterMax.${counter} ${observed} > ${maximum}`);
  }
  return violations;
}

async function calculateReprojection(
  outputDir: string,
  records: readonly VisualSequenceFrameRecord[],
  colors: readonly ImagePlane[],
  stats: readonly { camera: CameraRecord }[],
): Promise<Array<{ frame: number; meanLuma: number; edgeMean: number; validRatio: number; disoccludedRatio: number }>> {
  const depth = await Promise.all(records.map((record) => readDepth(join(outputDir, record.depth!))));
  return colors.slice(1).map((current, offset) => {
    const frame = offset + 1;
    const result = reprojectedResidual({
      previousColor: colors[offset]!,
      currentColor: current,
      previousDepth: depth[offset]!,
      currentDepth: depth[frame]!,
      previousViewProjection: stats[offset]!.camera.viewProjection,
      currentViewProjectionInverse: stats[frame]!.camera.viewProjectionInverse,
      depthTolerance: 0.02,
    });
    return { frame, meanLuma: result.residual.meanLuma, edgeMean: result.residual.edgeMean, validRatio: result.validRatio, disoccludedRatio: result.disoccludedRatio };
  });
}

async function comparePair(leftDir: string, rightDir: string, outputDir: string): Promise<void> {
  const left = JSON.parse(readFileSync(join(leftDir, "sequence.json"), "utf8")) as VisualSequenceManifest;
  const right = JSON.parse(readFileSync(join(rightDir, "sequence.json"), "utf8")) as VisualSequenceManifest;
  if (left.frames.length !== right.frames.length) throw new Error("paired sequences have different frame counts");
  mkdirSync(outputDir, { recursive: true });
  const frames = [];
  for (let index = 0; index < left.frames.length; index++) {
    const a = await readPlane(join(leftDir, left.frames[index]!.color));
    const b = await readPlane(join(rightDir, right.frames[index]!.color));
    frames.push({ frame: index, ...residualMetrics(a, b) });
  }
  const summary = {
    schemaVersion: 1,
    mode: "paired",
    left: left.id,
    right: right.id,
    paired_residual: frames,
    maxMeanLuma: Math.max(...frames.map((frame) => frame.meanLuma)),
    maxChangedRatio: Math.max(...frames.map((frame) => frame.changedRatio)),
    passed: true,
  };
  writeJson(join(outputDir, "summary.json"), summary);
  writeFileSync(join(outputDir, "report.md"), reportMarkdown(summary, relative(process.cwd(), outputDir)));
  console.log(`[visual-sequence] wrote paired comparison ${outputDir}`);
}

async function readPlane(path: string): Promise<ImagePlane> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), channels: 4 };
}

async function readDepth(path: string): Promise<Float32Array> {
  const plane = await readPlane(path);
  const result = new Float32Array(plane.width * plane.height);
  for (let p = 0; p < result.length; p++) {
    const high = plane.data[p * 4] ?? 255;
    const low = plane.data[p * 4 + 1] ?? 255;
    result[p] = (high + low / 255) / 256;
  }
  return result;
}

function transitionCounters(counters: Record<string, number>): Record<string, number> {
  const patterns = ["ready", "ownership", "revision", "fallback", "pending", "inflight", "holes", "overlap"];
  return Object.fromEntries(Object.entries(counters).filter(([key]) => patterns.some((pattern) => key.toLowerCase().includes(pattern))));
}

function reportMarkdown(summary: object, artifactPath: string): string {
  const passed = (summary as { passed?: boolean }).passed !== false;
  return `# Visual sequence report\n\n- Artifact: \`${artifactPath.replaceAll("\\\\", "/")}\`\n- Result: **${passed ? "PASS" : "FAIL"}**\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`;
}

function currentCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function sameConfiguredPose(a: VisualSequenceManifest["config"]["start"], b: VisualSequenceManifest["config"]["end"]): boolean {
  return a.p.every((value, index) => value === b.p[index])
    && a.yaw === b.yaw
    && a.pitch === b.pitch
    && (a.fov ?? 60) === (b.fov ?? 60);
}

function decodeDataUrl(dataUrl: string): Buffer {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("expected PNG data URL");
  return Buffer.from(dataUrl.slice(prefix.length), "base64");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv: readonly string[]): Args {
  const result: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;
    const [inlineKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) result[inlineKey!] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1]!.startsWith("--")) result[inlineKey!] = argv[++index]!;
    else result[inlineKey!] = true;
  }
  return result;
}

function stringArg(args: Args, name: string): string | undefined { return typeof args[name] === "string" ? args[name] : undefined; }
function requiredArg(args: Args, name: string): string { const value = stringArg(args, name); if (!value) throw new Error(`--${name} is required`); return value; }

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
