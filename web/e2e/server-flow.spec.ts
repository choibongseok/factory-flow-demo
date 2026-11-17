import { expect, test } from "@playwright/test";
import { DEGRADED, mockBackend, READY, STARTING } from "./mock";

// Static frontend + backend flow, against a mocked server (page.route / routeWebSocket).

test("E2E-07 waking panel walks through the stages and gives way to live data", async ({ page }) => {
  const mock = await mockBackend(page, { status: (n) => (n === 1 ? null : n <= 3 ? STARTING : READY) });
  await page.goto("/");
  const panel = page.getByTestId("wake-panel");
  await expect(panel).toContainText("무료 티어 서버 켜는 중");
  await expect(panel).toHaveAttribute("data-stage", "wait_server");
  // while waking: amber "waking" badge, and the server-side nodes are waiting (grey), never failed (red)
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "waking");
  await expect(page.getByTestId("source-badge")).toContainText("서버 켜는 중");
  await expect(page.locator('[data-testid="topo-node"][data-node="api"]')).toHaveAttribute("data-state", "wait");
  await expect(panel).toHaveAttribute("data-stage", "starting", { timeout: 8000 });
  await expect(page.getByTestId("wake-checks")).toContainText("MQTT");
  await expect(page.getByTestId("wake-elapsed")).toBeVisible();
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "live");
  await expect(page.getByTestId("source-badge")).toContainText("실시간 서버");
  await expect(page.locator('[data-testid="topo-node"][data-node="api"]')).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("server-dot")).toContainText("서버 정상");
  expect(mock.wsConnections).toBeGreaterThan(0);
  await expect(page.getByTestId("hex-tile")).toHaveCount(2);
});

test("E2E-08 no answer within the timeout shows retry and simulation choices, not a silent fallback", async ({ page }) => {
  await mockBackend(page, { status: null }, { wakeTimeoutMs: 3000 });
  await page.goto("/");
  const panel = page.getByTestId("wake-panel");
  await expect(panel).toHaveAttribute("data-phase", "timeout", { timeout: 8000 });
  await expect(panel).toContainText("서버가 아직 켜지지 않았습니다");
  await expect(panel.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "브라우저 시뮬레이션으로 보기" })).toBeVisible();
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "waking"); // not switched to the simulation on its own
});

test("E2E-09 retry after a timeout connects once the server is up", async ({ page }) => {
  const mock = await mockBackend(page, { status: null }, { wakeTimeoutMs: 3000 });
  await page.goto("/");
  await expect(page.getByTestId("wake-panel")).toHaveAttribute("data-phase", "timeout", { timeout: 8000 });
  mock.status = READY;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByTestId("wake-panel")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "live");
});

test("E2E-10 choosing the browser simulation after a timeout keeps a visible source notice", async ({ page }) => {
  await mockBackend(page, { status: null }, { wakeTimeoutMs: 3000 });
  await page.goto("/");
  await page.getByRole("button", { name: "브라우저 시뮬레이션으로 보기" }).click({ timeout: 8000 });
  await expect(page.getByTestId("wake-panel")).toBeHidden();
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "sim");
  await expect(page.getByTestId("sim-notice")).toContainText("실제 서버 데이터가 아닙니다");
  await expect(page.getByTestId("hex-tile")).toHaveCount(10);
});

test("E2E-11 a dropped connection shows the reconnect banner, then recovers", async ({ page }) => {
  const mock = await mockBackend(page, { status: READY });
  await page.goto("/");
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "live", { timeout: 8000 });
  await expect(page.getByTestId("wake-panel")).toBeHidden();
  mock.dropSocket();
  await expect(page.getByTestId("reconnect-banner")).toContainText("서버 연결 끊김, 다시 연결하는 중");
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", "reconnecting");
  await expect(page.getByTestId("reconnect-banner")).toBeHidden({ timeout: 10_000 });
  expect(mock.wsConnections).toBe(2);
});

test("E2E-12 a degraded server names the failing check and offers retry", async ({ page }) => {
  await mockBackend(page, { status: DEGRADED });
  await page.goto("/");
  const panel = page.getByTestId("wake-panel");
  await expect(panel).toHaveAttribute("data-stage", "degraded", { timeout: 8000 });
  await expect(panel).toContainText("MQTT: error");
  await expect(page.locator('[data-testid="topo-node"][data-node="mq"]')).toHaveAttribute("data-state", "bad");
  await expect(panel.getByRole("button", { name: "다시 시도" })).toBeVisible();
});
