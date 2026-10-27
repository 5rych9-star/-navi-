import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const tilePattern = "https://maps.gsi.go.jp/xyz/seamlessphoto/**";
const fixtureTile =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d5ded0"/><path d="M0 128H256M128 0V256" stroke="#fff" stroke-width="8"/></svg>';
const testLocation = { latitude: 33.58642, longitude: 131.19876, accuracy: 12 };

async function provideFixtureTiles(page: Page) {
  const requests: string[] = [];
  await page.route(tilePattern, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: fixtureTile,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  return requests;
}

async function instrumentNativeGeolocation(page: Page) {
  await page.addInitScript(() => {
    const state = { calls: 0, cleared: [] as number[] };
    Object.defineProperty(window, "__gpsTest", { value: state });
    const watch = navigator.geolocation.watchPosition.bind(
      navigator.geolocation,
    );
    const clear = navigator.geolocation.clearWatch.bind(navigator.geolocation);
    Object.defineProperty(navigator.geolocation, "watchPosition", {
      configurable: true,
      value: (...args: Parameters<Geolocation["watchPosition"]>) => {
        state.calls += 1;
        return watch(...args);
      },
    });
    Object.defineProperty(navigator.geolocation, "clearWatch", {
      configurable: true,
      value: (id: number) => {
        state.cleared.push(id);
        clear(id);
      },
    });
  });
}

async function gpsState(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __gpsTest: { calls: number; cleared: number[] } })
        .__gpsTest,
  );
}

async function ownStoredData(page: Page) {
  return page.evaluate(() => ({
    profile: localStorage.getItem("nakatsu-profile-v1"),
    trips: localStorage.getItem("nakatsu-trips-v1"),
  }));
}

async function allStoredData(page: Page) {
  return page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
}

test("航空写真のfixtureタイルと現在地は明示操作で開始し、現在地を自動保存しない", async ({
  page,
  context,
}) => {
  const tiles = await provideFixtureTiles(page);
  await instrumentNativeGeolocation(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(testLocation);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "航空写真を表示", exact: true }),
  ).toBeVisible();
  expect(tiles).toEqual([]);
  expect((await gpsState(page)).calls).toBe(0);
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });

  await page
    .getByRole("button", { name: "航空写真を表示", exact: true })
    .click();
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  expect(
    tiles.every((url) =>
      /^https:\/\/maps\.gsi\.go\.jp\/xyz\/seamlessphoto\/\d+\/\d+\/\d+\.jpg$/.test(
        url,
      ),
    ),
  ).toBe(true);
  await expect(
    page.getByRole("link", { name: /国土地理院|地理院タイル/ }).first(),
  ).toBeVisible();
  expect((await gpsState(page)).calls).toBe(0);
  await page.getByRole("button", { name: "現在地を表示", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "現在地の表示を停止", exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await gpsState(page)).calls).toBe(1);
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });
  await expect(
    page.getByRole("button", { name: "現在地に戻る", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".aerial-current-icon")).toHaveCount(1);
  await expect(
    page.getByText("この端末に表示中", { exact: true }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(await allStoredData(page)).toEqual({ local: {}, session: {} });
  await page.getByRole("button", { name: "現在地に戻る", exact: true }).click();
  await page
    .getByRole("button", { name: "現在地の表示を停止", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "現在地を表示", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".aerial-current-icon")).toHaveCount(0);
  await expect
    .poll(async () => (await gpsState(page)).cleared.length)
    .toBeGreaterThan(0);
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });

  // Starting a fresh display is explicit; leaving the map screen must release it.
  const clearedBeforeNavigation = (await gpsState(page)).cleared.length;
  await page.getByRole("button", { name: "現在地を表示", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "現在地に戻る", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "使い方", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect
    .poll(async () => (await gpsState(page)).cleared.length)
    .toBeGreaterThan(clearedBeforeNavigation);
  expect(await allStoredData(page)).toEqual({ local: {}, session: {} });
  await page.reload();
  expect((await gpsState(page)).calls).toBe(0);
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });
  expect(errors).toEqual([]);
});

test("現在地を自宅にするには下書きの明示登録が必要で別のブラウザ利用者には共有されない", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await provideFixtureTiles(page);
  await instrumentNativeGeolocation(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(testLocation);
  await page.goto("/");
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "ご自宅を登録しましょう" });
  await dialog.getByLabel("お名前（ニックネーム）").fill("GPS体験の利用者");
  await dialog
    .getByRole("button", { name: "航空写真を表示", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "現在地を表示", exact: true })
    .click();
  const useLocation = dialog.getByRole("button", {
    name: "現在地を自宅に設定",
    exact: true,
  });
  await expect(useLocation).toBeEnabled();
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });
  await useLocation.click();
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });
  await dialog
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const profile = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("nakatsu-profile-v1") ?? "null"),
  );
  expect(profile).toMatchObject({
    nickname: "GPS体験の利用者",
    home: { lat: testLocation.latitude, lng: testLocation.longitude },
  });
  await expect
    .poll(async () => (await gpsState(page)).cleared.length)
    .toBeGreaterThan(0);
  await page.reload();
  expect((await gpsState(page)).calls).toBe(0);
  await expect(
    page.getByRole("heading", { name: "GPS体験の利用者さんのご自宅" }),
  ).toBeVisible();

  const other = await browser.newContext({ baseURL, locale: "ja-JP" });
  try {
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    expect(await ownStoredData(otherPage)).toEqual({
      profile: null,
      trips: null,
    });
    await expect(
      otherPage.getByRole("heading", { name: "まずは、ご自宅の登録から" }),
    ).toBeVisible();
    await expect(otherPage.getByText("GPS体験の利用者")).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("位置情報の許可拒否を案内し、取得監視を解除して自宅情報を保存しない", async ({
  page,
}) => {
  await provideFixtureTiles(page);
  await page.addInitScript(() => {
    const state = { calls: 0, cleared: [] as number[] };
    Object.defineProperty(window, "__gpsTest", { value: state });
    Object.defineProperty(navigator.geolocation, "watchPosition", {
      configurable: true,
      value: (_success: PositionCallback, fail: PositionErrorCallback) => {
        state.calls += 1;
        fail({
          code: 1,
          message: "Test permission denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
        return 71;
      },
    });
    Object.defineProperty(navigator.geolocation, "clearWatch", {
      configurable: true,
      value: (id: number) => state.cleared.push(id),
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  expect((await gpsState(page)).calls).toBe(0);
  await page
    .getByRole("button", { name: "航空写真を表示", exact: true })
    .click();
  await page.getByRole("button", { name: "現在地を表示", exact: true }).click();
  await expect(
    page.getByText(/現在地の利用が許可されていません/),
  ).toBeVisible();
  expect(await gpsState(page)).toEqual({ calls: 1, cleared: [71] });
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });
  expect(errors).toEqual([]);
});

test("航空写真のfixture読込失敗を表示し、再読み込み操作で回復できる", async ({
  page,
}) => {
  let fail = true;
  let attempts = 0;
  await page.route(tilePattern, async (route) => {
    attempts += 1;
    if (fail) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: fixtureTile,
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "航空写真を表示", exact: true })
    .click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(
    page.getByText(/航空写真.*(?:読み込めません|読み込みに失敗)/),
  ).toBeVisible();
  const failedAttempts = attempts;
  fail = false;
  await page
    .getByRole("button", { name: /再読み込み|もう一度読み込む|再試行/ })
    .click();
  await expect.poll(() => attempts).toBeGreaterThan(failedAttempts);
  await expect(
    page.getByText(/航空写真.*(?:読み込めません|読み込みに失敗)/),
  ).not.toBeVisible();
  expect(await ownStoredData(page)).toEqual({ profile: null, trips: null });
});
