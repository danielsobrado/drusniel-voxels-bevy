import { expect, test } from "@playwright/test";

test("agent workbench runs a protected-area workflow and records live observations", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible();

  const agentTab = page.locator(".dockview-react").getByText("Agent Workbench", { exact: true }).first();
  await agentTab.click();
  await expect(page.getByTestId("panel-agent-workbench")).toBeVisible();

  const criticalPanelTestIds = [
    "agent-section-screen-understanding",
    "agent-section-current-selection",
    "agent-section-active-mode",
    "agent-section-active-tool",
    "agent-section-visible-panels",
    "agent-section-viewport",
    "agent-section-brush-state",
    "agent-section-dirty-state",
    "agent-section-warnings",
    "agent-section-suggested-commands",
    "agent-section-task-plan",
    "agent-section-timeline",
    "agent-section-verification-checklist",
    "agent-section-test-results",
    "agent-section-json-observation",
    "agent-section-screenshot-placeholders",
  ] as const;

  for (const testId of criticalPanelTestIds) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  await expect(page.getByTestId("agent-section-active-mode")).toBeVisible();
  await expect(page.getByTestId("agent-section-current-selection")).toBeVisible();

  const beforeOutlinerAreas = await page.locator('[data-testid^="outliner-item-area-"]').count();
  const beforeViewportOverlays = await page.locator('[data-testid^="viewport-area-overlay-"]').count();

  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill("unbreakable");
  await page.locator('[data-testid="command-palette"]').locator('[data-command-id="editor.area.createUnbreakableBox"]').click();

  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.area.createUnbreakableBox");
  await expect(page.getByTestId("current-mode")).toHaveText("area");
  await expect(page.getByTestId("agent-section-current-selection")).toContainText("area");
  await expect(page.getByTestId("agent-section-active-mode")).toContainText("area");

  const createdOutlinerArea = page.locator('[data-testid^="outliner-item-area-"]').filter({ hasText: "Unbreakable Box" });
  await expect(createdOutlinerArea).toBeVisible();

  const afterOutlinerAreas = await page.locator('[data-testid^="outliner-item-area-"]').count();
  const afterViewportOverlays = await page.locator('[data-testid^="viewport-area-overlay-"]').count();
  expect(afterOutlinerAreas).toBeGreaterThan(beforeOutlinerAreas);
  expect(afterViewportOverlays).toBeGreaterThan(beforeViewportOverlays);
  await expect(page.getByTestId("inspector-area")).toBeVisible();
  await expect(page.getByTestId("inspector-selection-header")).toContainText("Unbreakable Box");

  await page.getByTestId("inspector-area-bounds-min-x").fill("18");
  await page.getByTestId("inspector-area-priority").fill("77");
  await expect(page.getByTestId("inspector-area-bounds-min-x")).toHaveValue("18");
  await expect(page.getByTestId("inspector-area-priority")).toHaveValue("77");

  await page.getByTestId("inspector-area-rules-canMine").setChecked(false);
  await page.getByTestId("inspector-area-rules-canPlace").setChecked(true);
  await page.getByTestId("inspector-area-rules-canPaint").setChecked(false);

  await expect(page.getByTestId("inspector-area-rules-canMine")).not.toBeChecked();
  await expect(page.getByTestId("inspector-area-rules-canPlace")).toBeChecked();
  await expect(page.getByTestId("inspector-area-rules-canPaint")).not.toBeChecked();

  await page.locator('[data-testid="agent-section-suggested-commands"]').locator('[data-command-id="editor.agent.observeScreen"]').click();
  await expect(page.getByTestId("agent-section-timeline")).toContainText("Observed current editor screen");

  await page.locator('[data-testid="agent-section-suggested-commands"]').locator('[data-command-id="editor.agent.generatePlaywrightTest"]').click();
  await expect(page.getByTestId("agent-section-test-results")).toContainText("protected-area-workflow.spec.ts");
  await expect(page.getByTestId("agent-selection-summary")).toContainText("area");
});
