import { expect, test } from "@playwright/test";

// Browser-simulation mode (no backend configured): the page must work with nothing else running.

test("E2E-01 dashboard renders all seven blocks in browser-simulation mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Factory Flow/ })).toBeVisible();
  await expect(page.getByTestId("mode-banner")).toContainText("정적 데모 모드");
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "sim");
  await expect(page.getByTestId("kpi-tile")).toHaveCount(5);
  await expect(page.locator(".chart")).toHaveCount(3);
  await expect(page.locator(".chart canvas").first()).toBeVisible();
  await expect(page.getByTestId("hex-tile")).toHaveCount(10);
  await expect(page.getByTestId("topo-node")).toHaveCount(6);
  for (const st of await page.getByTestId("topo-node").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")))) expect(st).toBe("ok");
  await expect(page.locator('[data-testid="topo-node"][data-node="api"]')).toContainText("브라우저 시뮬레이션");
  expect(await page.getByTestId("tail-row").count()).toBeGreaterThan(5);
  expect(await page.getByTestId("inv-row").count()).toBeGreaterThan(0);
  await expect(page.getByText("기초재고 미반영")).toBeVisible();
});

test("E2E-02 KPI values and the tail keep updating while live", async ({ page }) => {
  await page.goto("/");
  const stamp = page.getByTestId("last-updated");
  await expect(page.getByTestId("kpi-rate-value")).not.toHaveText("—");
  const firstStamp = await stamp.textContent();
  const firstRow = await page.getByTestId("tail-row").first().textContent();
  await expect.poll(async () => stamp.textContent(), { timeout: 6000 }).not.toBe(firstStamp);
  await expect.poll(async () => page.getByTestId("tail-row").first().textContent(), { timeout: 6000 }).not.toBe(firstRow);
  await expect(page.getByTestId("kpi-p95-value")).not.toHaveText("—");
});

test("E2E-03 clicking a device tile filters the event tail to that device", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator('[data-testid="hex-tile"][data-device="line-a/amr-01"]');
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  const rows = page.getByTestId("tail-row");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const dev of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-device")))) expect(dev).toBe("line-a/amr-01");
  await tile.click(); // click again clears the filter
  const devs = new Set(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-device"))));
  expect(devs.size).toBeGreaterThan(1);
});

test("E2E-04 pause freezes the view and resume restarts it", async ({ page }) => {
  await page.goto("/");
  const pause = page.getByTestId("pause-btn");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("last-updated")).toContainText("일시정지됨");
  const frozenRow = await page.getByTestId("tail-row").first().textContent();
  const frozenStamp = await page.getByTestId("last-updated").textContent();
  await page.waitForTimeout(2500);
  expect(await page.getByTestId("tail-row").first().textContent()).toBe(frozenRow);
  expect(await page.getByTestId("last-updated").textContent()).toBe(frozenStamp);
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => page.getByTestId("tail-row").first().textContent(), { timeout: 6000 }).not.toBe(frozenRow);
});

test("E2E-05 theme toggle switches between dark and light and changes the background", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(html).toHaveAttribute("data-theme", "dark");
  const dark = await bg();
  await page.getByTestId("theme-btn").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await bg()).not.toBe(dark);
  await page.getByTestId("theme-btn").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await bg()).toBe(dark);
});

test("E2E-06 line filter narrows tiles and KPIs to one line", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("line-filter").getByRole("radio", { name: "line-a" }).click();
  await expect(page.getByTestId("hex-tile")).toHaveCount(5);
  for (const dev of await page.getByTestId("hex-tile").evaluateAll((els) => els.map((e) => e.getAttribute("data-device")))) expect(dev).toMatch(/^line-a\//);
  await expect(page.locator('[data-kpi="online"]')).toContainText("5/5");
});

test("E2E-13 a light colour-scheme preference starts the dashboard in the light theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
