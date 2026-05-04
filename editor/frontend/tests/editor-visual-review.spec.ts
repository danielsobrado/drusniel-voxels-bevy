import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

type Capture = {
  readonly section: string;
  readonly name: string;
  readonly path: string;
};

const reviewRoot = resolve(process.cwd(), process.env.VISUAL_REVIEW_DIR ?? "review-screenshots");
const runId = process.env.VISUAL_REVIEW_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = join(reviewRoot, runId);

const captureReviewScreenshot = async (page: Page, captures: Capture[], section: string, name: string) => {
  const path = join(runRoot, section, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  expect(statSync(path).size).toBeGreaterThan(20_000);
  captures.push({ section, name, path });
};

const captureReviewLocatorScreenshot = async (locator: Locator, captures: Capture[], section: string, name: string) => {
  const path = join(runRoot, section, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await locator.screenshot({ path });
  expect(statSync(path).size).toBeGreaterThan(10_000);
  captures.push({ section, name, path });
};

const openDockTab = async (page: Page, title: string, visibleTestId: string) => {
  await page.locator(".dockview-react").getByText(title, { exact: true }).first().click();
  await expect(page.getByTestId(visibleTestId)).toBeVisible();
};

const runPaletteCommand = async (page: Page, search: string, commandId: string) => {
  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill(search);
  await page.getByTestId("command-palette").locator(`[data-command-id="${commandId}"]`).click();
};

const writeManifest = (captures: readonly Capture[]) => {
  mkdirSync(runRoot, { recursive: true });
  const lines = [
    "# Editor Visual Review",
    "",
    `Run: ${runId}`,
    `Screenshot root: ${relative(process.cwd(), runRoot)}`,
    "",
    "Review these captures in order while checking for clipped text, missing state changes, broken mock runtime responses, and controls that look enabled while commands are pending.",
    "",
    ...captures.map((capture, index) => `${index + 1}. ${capture.section}/${capture.name}.png`),
    "",
  ];
  writeFileSync(join(runRoot, "MANIFEST.md"), lines.join("\n"));
};

test("@visual-review captures editor functionality screenshots in mock runtime", async ({ page }) => {
  const captures: Capture[] = [];

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "[data-sonner-toaster] { display: none !important; }" });
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("runtime-connection-state")).toHaveText("mock");
  await expect(page.getByTestId("bevy-canvas-host")).toBeVisible();
  await captureReviewScreenshot(page, captures, "00-shell", "01-editor-shell-overview");

  await page.locator('[data-tool-id="paint"]').click();
  await expect(page.getByTestId("viewport-voxel-paint-toolbar")).toBeVisible();
  await page.getByTestId("viewport-brush-shape").selectOption("Sphere");
  await page.getByTestId("viewport-brush-radius").fill("12");
  await page.getByTestId("viewport-brush-strength").fill("0.67");
  await page.getByTestId("viewport-brush-falloff").selectOption("constant");
  await page.getByTestId("viewport-brush-target-face").selectOption("side");
  await expect(page.getByTestId("viewport-active-mode")).toHaveText("Mode voxel_paint");
  await captureReviewScreenshot(page, captures, "01-voxel-paint", "01-brush-controls");

  await runPaletteCommand(page, "unbreakable", "editor.area.createUnbreakableBox");
  await expect(page.getByTestId("current-selection-label")).toHaveText("Unbreakable Box 4");
  await expect(page.getByTestId("inspector-area")).toBeVisible();
  await page.getByTestId("inspector-area-bounds-min-x").fill("24");
  await page.getByTestId("inspector-area-bounds-min-y").fill("12");
  await page.getByTestId("inspector-area-bounds-min-z").fill("48");
  await page.getByTestId("inspector-area-priority").fill("88");
  await page.getByTestId("inspector-area-rules-canMine").setChecked(false);
  await page.getByTestId("inspector-area-rules-canPlace").setChecked(false);
  await page.getByTestId("inspector-area-rules-canEditWater").setChecked(false);
  await expect(page.locator('[data-testid^="viewport-area-overlay-"]').filter({ hasText: "Unbreakable Box 4" })).toBeVisible();
  await captureReviewScreenshot(page, captures, "02-protected-areas", "01-created-and-edited-area");

  await runPaletteCommand(page, "validate selected protected area", "editor.area.validateSelectedRuntime");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.area.validateSelectedRuntime");
  await runPaletteCommand(page, "query selected area center rules", "editor.area.querySelectedCenterRuntime");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.area.querySelectedCenterRuntime");
  await openDockTab(page, "Agent Workbench", "panel-agent-workbench");
  await expect(page.getByTestId("agent-section-timeline")).toContainText("Voxel edit blocked by protected area");
  await captureReviewScreenshot(page, captures, "02-protected-areas", "02-runtime-validation-and-agent-timeline");

  await page.getByTestId("outliner-item-water-water-lk-03").dispatchEvent("click");
  await expect(page.getByTestId("inspector-water")).toBeVisible();
  await page.getByTestId("inspector-water-debug-mode").selectOption("ReflectionOnly");
  await page.getByTestId("viewport-water-open-reflection-debug").click();
  await expect(page.getByTestId("viewport-water-overlay")).toContainText("Mode:");
  await page.getByTestId("inspector-water-run-probe").click();
  await expect(page.locator("[data-testid='inspector-water-visual-probe']")).toContainText("Reflection eligible");
  await captureReviewScreenshot(page, captures, "03-water", "01-reflection-debug-and-probe");
  await page.getByTestId("inspector-water-visual-probe").scrollIntoViewIfNeeded();
  await captureReviewLocatorScreenshot(page.getByTestId("panel-inspector"), captures, "03-water", "02-water-probe-inspector-detail");

  await openDockTab(page, "Texture Atlas", "panel-texture-atlas");
  await page.getByTestId("atlas-tile-7").click();
  await page.getByTestId("atlas-assign-grass-side").click();
  await expect(page.getByTestId("block-preview-grass")).toContainText("side: tile-7");
  await expect(page.getByTestId("atlas-dirty-state")).toHaveText("yes");
  await captureReviewScreenshot(page, captures, "04-atlas", "01-atlas-mapping-dirty");
  await page.getByTestId("atlas-rebuild").click();
  await expect(page.getByTestId("atlas-dirty-state")).toHaveText("no");
  await page.getByTestId("atlas-save").click();
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.atlas.saveMapping");
  await captureReviewScreenshot(page, captures, "04-atlas", "02-atlas-rebuilt-and-saved");
  await page.getByTestId("atlas-yaml-preview").scrollIntoViewIfNeeded();
  await captureReviewLocatorScreenshot(page.getByTestId("panel-texture-atlas"), captures, "04-atlas", "03-atlas-yaml-preview-detail");

  await openDockTab(page, "Asset Browser", "panel-asset-browser");
  await page.getByTestId("asset-browser-prop-asset-rock-01").click();
  await page.getByTestId("outliner-item-chunk-chunk-1-0").click();
  await runPaletteCommand(page, "prop brush", "editor.props.selectPropBrush");
  await runPaletteCommand(page, "scatter props", "editor.props.scatterOnSelection");
  await expect(page.getByTestId("inspector-prop")).toBeVisible();
  await captureReviewScreenshot(page, captures, "05-props", "01-prop-brush-scatter-result");

  await openDockTab(page, "Profiler", "panel-profiler");
  await page.getByTestId("profiler-render-quality").selectOption("Performance100");
  await expect(page.getByTestId("profiler-prop-lod-distance-scale")).toContainText("1.8");
  await captureReviewScreenshot(page, captures, "06-profiler", "01-render-quality-performance100");

  await openDockTab(page, "Graphics Capabilities", "panel-graphics-capabilities");
  await expect(page.getByTestId("profiler-ray-tracing")).toBeVisible();
  await captureReviewScreenshot(page, captures, "06-profiler", "02-graphics-capabilities");

  await openDockTab(page, "Console", "panel-console");
  await expect(page.getByTestId("panel-console")).toContainText("Editor shell booted");
  await captureReviewScreenshot(page, captures, "07-console", "01-console-and-command-history");

  await openDockTab(page, "Agent Workbench", "panel-agent-workbench");
  await page.locator('[data-testid="agent-section-suggested-commands"]').locator('[data-command-id="editor.agent.observeScreen"]').click();
  await page.locator('[data-testid="agent-section-suggested-commands"]').locator('[data-command-id="editor.agent.generatePlaywrightTest"]').click();
  await expect(page.getByTestId("agent-section-test-results")).toContainText("mock-protected-area-workflow.spec.ts");
  await captureReviewScreenshot(page, captures, "08-agent-workbench", "01-agent-observation-and-generated-test");
  await page.getByTestId("agent-section-test-results").scrollIntoViewIfNeeded();
  await captureReviewLocatorScreenshot(page.getByTestId("panel-agent-workbench"), captures, "08-agent-workbench", "02-generated-test-results-detail");

  writeManifest(captures);
});
