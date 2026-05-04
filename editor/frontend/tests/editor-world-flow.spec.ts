import { statSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const captureVerifiedScreenshot = async (page: Page, testInfo: TestInfo, name: string) => {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  expect(statSync(path).size).toBeGreaterThan(20_000);
  await testInfo.attach(name, { path, contentType: "image/png" });
};

test("loads a world, modifies editor state, saves, and visualizes the result", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("runtime-connection-state")).toHaveText("mock");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.file.loadDefaultWorld");
  await expect(page.getByTestId("dirty-state-label")).toHaveText("SAVED");
  await expect(page.getByTestId("bevy-canvas-host")).toBeVisible();
  await captureVerifiedScreenshot(page, testInfo, "01-loaded-world");

  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill("unbreakable");
  await page
    .getByTestId("command-palette")
    .locator('[data-command-id="editor.area.createUnbreakableBox"]')
    .click();

  await expect(page.getByTestId("protected-area-count")).toHaveText("4");
  await expect(page.getByTestId("current-selection-label")).toHaveText("Unbreakable Box 4");
  await expect(page.getByTestId("inspector-area")).toBeVisible();
  await expect(page.getByTestId("dirty-state-label")).toHaveText("DIRTY");
  await expect(page.locator('[data-testid^="viewport-area-overlay-"]').filter({ hasText: "Unbreakable Box 4" })).toBeVisible();

  await page.getByTestId("inspector-area-bounds-min-x").fill("24");
  await page.getByTestId("inspector-area-bounds-min-y").fill("12");
  await page.getByTestId("inspector-area-bounds-min-z").fill("48");
  await page.getByTestId("inspector-area-priority").fill("88");
  await page.getByTestId("inspector-area-rules-canMine").setChecked(false);
  await page.getByTestId("inspector-area-rules-canPlace").setChecked(false);
  await expect(page.getByTestId("inspector-area-priority")).toHaveValue("88");
  await captureVerifiedScreenshot(page, testInfo, "02-modified-protected-area");

  const textureTab = page.locator(".dockview-react").getByText("Texture Atlas", { exact: true }).first();
  await textureTab.click();
  await expect(page.getByTestId("panel-texture-atlas")).toBeVisible();
  await page.getByTestId("atlas-tile-7").click();
  await page.getByTestId("atlas-assign-grass-side").click();
  await expect(page.getByTestId("block-preview-grass")).toContainText("side: tile-7");
  await expect(page.getByTestId("atlas-dirty-state")).toHaveText("yes");
  await captureVerifiedScreenshot(page, testInfo, "03-visualized-atlas-edit");

  await page.getByTestId("atlas-save").click();
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.atlas.saveMapping");
  await expect(page.getByTestId("atlas-yaml-preview")).toContainText("side: tile-7");

  await page.getByRole("button", { name: "Save editor", exact: true }).click();
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.file.save");
  await expect(page.getByTestId("dirty-state-label")).toHaveText("SAVED");
  await captureVerifiedScreenshot(page, testInfo, "04-saved-editor-state");

  const agentTab = page.locator(".dockview-react").getByText("Agent Workbench", { exact: true }).first();
  await agentTab.click();
  await expect(page.getByTestId("panel-agent-workbench")).toBeVisible();
  await expect(page.getByTestId("agent-section-verification-checklist")).toContainText("Protected area created");
  await expect(page.getByTestId("agent-section-json-observation")).toContainText("activeMode");
  await captureVerifiedScreenshot(page, testInfo, "05-agent-verification");
});
