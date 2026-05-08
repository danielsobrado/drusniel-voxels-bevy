import { expect, test } from "@playwright/test";

test("editor shell renders", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("editor-menubar")).toBeVisible();
  await expect(page.getByTestId("main-toolbar")).toBeVisible();
  await expect(page.getByTestId("dock-layout")).toBeVisible();

  await expect(page.getByTestId("panel-viewport")).toBeVisible();
  await expect(page.getByTestId("bevy-canvas-host")).toBeVisible();
  await expect(page.getByTestId("panel-world-outliner")).toBeVisible();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();
  await expect(page.getByTestId("panel-asset-browser")).toBeVisible();
  await expect(page.getByTestId("bottom-dock")).toBeVisible();

  await expect(page.getByText("Console").first()).toBeVisible();
  await expect(page.getByText("Profiler").first()).toBeVisible();
  await expect(page.getByText("Agent Workbench").first()).toBeVisible();
});

test("selecting a mocked outliner item updates the inspector header", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("panel-world-outliner")).toBeVisible();
  await page.locator('[data-testid="outliner-item-chunk-chunk-1-0"]').click();
  await expect(page.getByTestId("inspector-selection-header")).toHaveText("Chunk 1,0");
});

test("water inspector and viewport debug controls update mocked water runtime state", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("panel-world-outliner")).toBeVisible();

  await page.getByTestId("outliner-item-water-water-lk-03").dispatchEvent("click");
  await expect(page.getByTestId("inspector-water")).toBeVisible();
  await expect(page.getByTestId("inspector-water-kind")).toHaveValue("Lake");

  await page.getByTestId("inspector-water-debug-mode").selectOption("Mask");
  await expect(page.getByTestId("inspector-water-debug-mode")).toHaveValue("Mask");
  await page.getByTestId("viewport-water-open-reflection-debug").click();
  await expect(page.getByTestId("viewport-water-overlay")).toContainText("Mode:");

  await page.getByTestId("inspector-water-run-probe").click();
  const visualProbeOutput = page.locator("[data-testid='inspector-water-visual-probe']").locator(".inspector-section-body");
  await expect(visualProbeOutput).toContainText("Nearest body");
  await expect(visualProbeOutput).toContainText("Lake");
  await expect(visualProbeOutput).toContainText("Reflection eligible");

  await page.getByTestId("water-preset-river").click();
  await expect(page.getByTestId("inspector-water-kind")).toHaveValue("River");
  await expect(page.getByTestId("inspector-water-wave-amplitude")).toHaveValue("0.64");

  await expect(page.getByRole("button", { name: "Open reflection debug overlay" })).toBeVisible();
  await expect(page.getByTestId("inspector-water-run-probe")).toBeVisible();
  await expect(page.getByTestId("viewport-water-run-probe")).toBeVisible();
});

test("command palette creates an unbreakable protected area and toggles chunk bounds", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("protected-area-count")).toHaveText("3");
  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill("unbreakable");
  await page
    .getByTestId("command-palette")
    .locator('[data-command-id="editor.area.createUnbreakableBox"]')
    .click();

  await expect(page.getByTestId("protected-area-count")).toHaveText("4");
  await expect(page.getByTestId("current-selection-label")).toHaveText("Unbreakable Box 4");
  await expect(page.getByTestId("inspector-selection-header")).toHaveText("Unbreakable Box 4");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.area.createUnbreakableBox");

  await expect(page.getByTestId("chunk-bounds-state")).toHaveText("on");
  await page.locator('[data-command-id="editor.view.toggleChunkBounds"]').first().click();
  await expect(page.getByTestId("chunk-bounds-state")).toHaveText("off");
});

test("protected area command workflow creates, edits, and deletes an area", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible();

  const initialAreaCount = Number.parseInt((await page.getByTestId("protected-area-count").textContent()) ?? "0", 10);
  const createdAreaLabel = "Unbreakable Box 4";
  const outlinerArea = page.locator('[data-testid^="outliner-item-area-"]').filter({ hasText: createdAreaLabel });
  const viewportAreaOverlay = page.locator('svg [data-testid^="viewport-area-overlay-"]').filter({ hasText: createdAreaLabel });

  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill("unbreakable");
  await page
    .getByTestId("command-palette")
    .locator('[data-command-id="editor.area.createUnbreakableBox"]')
    .click();

  await expect(page.getByTestId("protected-area-count")).toHaveText(String(initialAreaCount + 1));
  await expect(page.getByTestId("current-mode")).toHaveText("area");
  await expect(page.getByTestId("viewport-active-mode")).toHaveText("Mode area");
  await expect(outlinerArea).toBeVisible();
  await expect(viewportAreaOverlay).toBeVisible();
  await expect(page.getByTestId("inspector-area")).toBeVisible();

  await page.getByTestId("outliner-item-area-createUnbreakableBox-4-visibility").click();
  await expect(viewportAreaOverlay).not.toBeVisible();
  await page.getByTestId("outliner-item-area-createUnbreakableBox-4-visibility").click();
  await expect(viewportAreaOverlay).toBeVisible();

  await page.getByTestId("inspector-area-bounds-min-x").fill("30");
  await page.getByTestId("inspector-area-bounds-min-y").fill("14");
  await page.getByTestId("inspector-area-bounds-min-z").fill("70");
  await page.getByTestId("inspector-area-priority").fill("77");
  await expect(page.getByTestId("inspector-area-bounds-min-x")).toHaveValue("30");
  await expect(page.getByTestId("inspector-area-priority")).toHaveValue("77");

  await page.getByTestId("inspector-area-rules-canMine").setChecked(false);
  await page.getByTestId("inspector-area-rules-canPlace").setChecked(true);
  await page.getByTestId("inspector-area-rules-canPaint").setChecked(false);
  await expect(page.getByTestId("inspector-area-rules-canMine")).not.toBeChecked();
  await expect(page.getByTestId("inspector-area-rules-canPlace")).toBeChecked();
  await expect(page.getByTestId("inspector-area-rules-canPaint")).not.toBeChecked();

  await page.getByTestId("outliner-item-area-createUnbreakableBox-4-lock").click();
  await expect(page.getByTestId("inspector-area-name")).toBeDisabled();
  await expect(page.getByTestId("viewport-area-priority")).toBeDisabled();
  await page.getByTestId("outliner-item-area-createUnbreakableBox-4-lock").click();
  await expect(page.getByTestId("inspector-area-name")).toBeEnabled();

  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill("delete selected area");
  await page
    .getByTestId("command-palette")
    .locator('[data-command-id="editor.area.deleteSelected"]')
    .click();

  await expect(page.getByTestId("inspector-area")).not.toBeVisible();
  await expect(page.getByTestId("current-mode")).toHaveText("select");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.area.deleteSelected");
  await expect(outlinerArea).not.toBeVisible();
  await expect(viewportAreaOverlay).not.toBeVisible();
});

test("advertised editor keyboard shortcuts run commands", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await page.keyboard.press("Control+S");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.file.save");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+O");
  await fileChooserPromise;
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.file.openWorld");

  const initialAreaCount = Number.parseInt((await page.getByTestId("protected-area-count").textContent()) ?? "0", 10);
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Run editor command...").fill("unbreakable");
  await page
    .getByTestId("command-palette")
    .locator('[data-command-id="editor.area.createUnbreakableBox"]')
    .click();
  await expect(page.getByTestId("protected-area-count")).toHaveText(String(initialAreaCount + 1));

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("protected-area-count")).toHaveText(String(initialAreaCount));

  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByTestId("protected-area-count")).toHaveText(String(initialAreaCount + 1));
});

test("texture atlas assignment updates mappings and rebuild state", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const textureTab = page.locator('.dockview-react').getByText("Texture Atlas", { exact: true }).first();
  await textureTab.click();
  await expect(page.getByTestId("panel-texture-atlas")).toBeVisible();

  await page.getByTestId("atlas-tile-7").click();
  await expect(page.getByTestId("atlas-selected-tile-label")).toContainText("tile-7");

  await page.getByTestId("atlas-assign-grass-side").click();
  await expect(page.getByTestId("block-preview-grass")).toContainText("side: tile-7");
  await expect(page.getByTestId("atlas-dirty-state")).toHaveText("yes");

  await page.getByTestId("atlas-rebuild").click();
  await expect(page.getByTestId("atlas-dirty-state")).toHaveText("no");

  await page.getByTestId("atlas-save").click();
  const yaml = await page.getByTestId("atlas-yaml-preview").textContent();
  expect(yaml).toContain("grass:");
  expect(yaml).toContain("side: tile-7");
  expect(yaml).toContain("dirt:");
  expect(yaml).toContain("rock:");
  expect(yaml).toContain("sand:");
  expect(yaml).toContain("top:");
});

test("voxel paint toolbar is available and updates brush controls", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('[data-tool-id="paint"]').click();

  await expect(page.getByTestId("viewport-active-mode")).toHaveText("Mode voxel_paint");
  await expect(page.getByTestId("viewport-voxel-paint-toolbar")).toBeVisible();

  await page.getByTestId("viewport-brush-shape").selectOption("Sphere");
  await expect(page.getByTestId("viewport-brush-shape")).toHaveValue("sphere");

  await page.getByTestId("viewport-brush-radius").fill("12");
  await expect(page.getByTestId("viewport-brush-radius")).toHaveValue("12");

  await page.getByTestId("viewport-brush-strength").fill("0.67");
  await expect(page.getByTestId("viewport-brush-strength")).toHaveValue("0.67");

  await page.getByTestId("viewport-brush-falloff").selectOption("constant");
  await expect(page.getByTestId("viewport-brush-falloff")).toHaveValue("constant");

  await page.getByTestId("viewport-brush-target-face").selectOption("side");
  await expect(page.getByTestId("viewport-brush-target-face")).toHaveValue("side");
});

test("prop mode places a selected prop directly in the viewport", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.locator('[data-tool-id="props"]').click();
  await expect(page.getByTestId("viewport-active-mode")).toHaveText("Mode props");

  const canvas = page.getByTestId("world-viewport-canvas");
  const initialBox = await canvas.boundingBox();
  if (!initialBox) {
    throw new Error("Viewport canvas is missing a bounding box.");
  }
  const canvasPoint = {
    x: initialBox.x + Math.min(260, initialBox.width - 20),
    y: initialBox.y + Math.max(10, initialBox.height - 50),
  };
  await page.mouse.dblclick(canvasPoint.x, canvasPoint.y);
  await expect(page.getByTestId("viewport-active-tool")).toHaveText("Tool props");
  await expect(page.getByTestId("viewport-tools")).toContainText("prop:");
  await expect(page.getByTestId("viewport-prop-toolbar")).toBeVisible();
  await expect(page.getByTestId("viewport-prop-rotate-key")).toHaveValue("shift");

  await page.getByTestId("viewport-prop-rotate-key").selectOption("alt");
  await expect(page.getByTestId("viewport-prop-rotate-key")).toHaveValue("alt");
  await page.getByTestId("viewport-prop-rotate-key").selectOption("shift");

  await page.mouse.move(canvasPoint.x, canvasPoint.y);
  await page.mouse.wheel(0, -120);
  await expect(page.getByTestId("viewport-prop-scale-value")).toContainText("Scale 1.19");

  const yawBeforeDrag = await page.getByTestId("viewport-prop-rotation-value").textContent();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Viewport canvas is missing a bounding box.");
  }
  await page.keyboard.down("Shift");
  await page.mouse.move(canvasPoint.x, canvasPoint.y);
  await page.mouse.down();
  await page.mouse.move(Math.min(box.x + box.width - 20, canvasPoint.x + 100), canvasPoint.y);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => page.getByTestId("viewport-prop-rotation-value").textContent()).not.toBe(yawBeforeDrag);
  await expect(page.getByTestId("dirty-state-label")).toHaveText("DIRTY");
});

test("profiler rendering and graphics debug workflow updates mocked runtime values and command history", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const profilerTab = page.locator(".dockview-react").getByText("Profiler", { exact: true }).first();
  await profilerTab.click();
  await expect(page.getByTestId("panel-profiler")).toBeVisible();
  await expect(page.getByTestId("render-timing-table")).toBeVisible();

  await page.getByTestId("profiler-render-quality").selectOption("Performance100");
  await expect(page.getByTestId("profiler-prop-lod-distance-scale")).toContainText("1.8");
  await expect(page.getByTestId("profiler-water-reflection-distance")).toContainText("220");
  await expect(page.getByTestId("profiler-shadow-quality-code")).toContainText("4");

  const graphicsTab = page.locator(".dockview-react").getByText("Graphics Capabilities", { exact: true }).first();
  await graphicsTab.click();
  await expect(page.getByTestId("panel-graphics-capabilities")).toBeVisible();
  await expect(page.getByTestId("profiler-ray-tracing")).toBeVisible();

  await profilerTab.click();
  await page.getByTestId("profiler-toggle-gtao").click();
  await page.getByTestId("profiler-toggle-god-rays").click();

  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.debug.toggleGodRays");
});
