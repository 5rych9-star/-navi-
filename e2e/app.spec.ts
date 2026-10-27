import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Map interaction tests use a deterministic fixture, not actual aerial imagery.
async function fixtureAerialTiles(page: Page) {
  await page.route("https://maps.gsi.go.jp/xyz/seamlessphoto/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d5ded0"/></svg>',
    }),
  );
}

async function registerHome(page: Page, nickname = "なかつ花子") {
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "ご自宅を登録しましょう" });
  await dialog.getByLabel("お名前（ニックネーム）").fill(nickname);
  await dialog.getByRole("button", { name: "沖代町周辺", exact: true }).click();
  await dialog
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: `${nickname}さんのご自宅` }),
  ).toBeVisible();
}

async function navigate(page: Page, label: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: new RegExp(`^${label}\\s*\\d*$`) })
    .filter({ visible: true })
    .first()
    .click();
}

test("自宅登録から申込体験、予定の再表示、乗り換え案内と削除まで使える", async ({
  page,
}) => {
  const outgoingWrites: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      outgoingWrites.push(request.url());
  });
  await page.goto("/");
  await registerHome(page);
  await page
    .getByRole("button", { name: /中津市民病院.*通院・お見舞い/ })
    .click();
  await expect(page.getByLabel("行きたい場所")).toHaveValue("nakatsu-hospital");
  await page.getByLabel("おでかけの日").fill("2026-11-20");
  await page.getByLabel("着きたい時刻").fill("10:00");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "中津市立中津市民病院への経路",
    }),
  ).toBeVisible();
  const demandJourney = page
    .getByRole("article")
    .filter({ hasText: "お迎えのある経路" })
    .first();
  await expect(demandJourney).toContainText("デマンドバス");
  await expect(demandJourney).toContainText("500円");
  await demandJourney.getByRole("button", { name: "この経路を見る" }).click();
  await page.getByRole("button", { name: "申込内容の確認へ" }).click();
  const booking = page.getByRole("dialog", { name: "お迎えの申込内容を確認" });
  await expect(booking).toContainText("実際の予約は送信されません。");
  await expect(booking).toContainText("なかつ花子さん");
  const saveButton = booking.getByRole("button", {
    name: "体験用の予定を保存する",
  });
  await expect(saveButton).toBeDisabled();
  await booking.getByRole("checkbox").check();
  await saveButton.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "おでかけ予定", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toContainText("体験用・予約未送信");
  expect(outgoingWrites).toEqual([]);

  // A fresh document must recover the profile and plan from this browser.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "なかつ花子さんのご自宅" }),
  ).toBeVisible();
  await navigate(page, "おでかけ予定");
  const savedJourney = page
    .getByRole("article")
    .filter({ hasText: "中津市立中津市民病院" });
  await expect(savedJourney).toContainText("11月20日");
  await savedJourney
    .getByRole("button", { name: "乗り換え案内を見る" })
    .click();
  await page.getByRole("button", { name: "乗り換え案内をはじめる" }).click();
  const guidance = page.locator("#guidance");
  await expect(guidance).toContainText("手順 1 / 4");
  await expect(
    guidance.getByRole("button", { name: "ひとつ前へ" }),
  ).toBeDisabled();
  await expect(
    guidance.getByRole("heading", { name: "お迎え場所へ" }),
  ).toBeVisible();
  await guidance.getByRole("button", { name: "次の手順へ" }).click();
  await expect(
    guidance.getByRole("heading", { name: "デマンドバス", exact: true }),
  ).toBeVisible();
  await guidance.getByRole("button", { name: "次の手順へ" }).click();
  await expect(
    guidance.getByRole("heading", { name: "路線バス", exact: true }),
  ).toBeVisible();
  await guidance.getByRole("button", { name: "次の手順へ" }).click();
  await expect(
    guidance.getByRole("heading", { name: "目的地へ歩く" }),
  ).toBeVisible();
  await guidance.getByRole("button", { name: "到着を確認する" }).click();
  await expect(
    guidance.getByRole("heading", { name: "目的地に到着です。" }),
  ).toBeVisible();
  await guidance.getByRole("button", { name: "おでかけ予定へ戻る" }).click();
  await page
    .getByRole("button", { name: "中津市立中津市民病院の予定を削除" })
    .click();
  await expect(
    page.getByRole("heading", { name: "次のおでかけを、さがしてみませんか？" }),
  ).toBeVisible();
  await page.reload();
  await navigate(page, "おでかけ予定");
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("未登録時は自宅登録を案内し、運行前の時刻には経路なしを表示する", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await expect(
    page.getByRole("dialog", { name: "ご自宅を登録しましょう" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await registerHome(page);
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "行きたい場所を選んでください。",
  );
  await expect(page.getByLabel("行きたい場所")).toBeFocused();
  await page.getByLabel("行きたい場所").selectOption("nakatsu-station");
  await page.getByLabel("着きたい時刻").fill("06:00");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await expect(
    page.getByRole("heading", { name: "この時刻に到着する経路がありません" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "時刻を変えてさがす" }).click();
  await page.getByLabel("着きたい時刻").fill("10:00");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
});

test("地図をキーボードで設定し、登録情報だけを削除できる", async ({ page }) => {
  await fixtureAerialTiles(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("unrelated-app-setting", "keep"),
  );
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("お名前（ニックネーム）").fill("地図の利用者");
  await dialog
    .getByRole("button", { name: "航空写真を表示", exact: true })
    .click();
  const map = dialog.getByRole("group", {
    name: "自宅を選ぶ航空写真地図",
    exact: false,
  });
  await map.focus();
  await map.press("ArrowLeft");
  await map.press("ArrowUp");
  await expect(dialog.getByText(/中心の十字を自宅に合わせ/)).toBeVisible();
  await map.press("Enter");
  await expect(dialog.getByLabel("場所の呼び名（任意）")).toHaveValue(
    "地図で選んだご自宅",
  );
  await dialog
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "地図の利用者さんのご自宅" }),
  ).toBeVisible();
  await navigate(page, "使い方");
  await page.getByRole("button", { name: "登録情報を削除する" }).click();
  const deleteDialog = page.getByRole("dialog", {
    name: "登録情報を削除しますか？",
  });
  await deleteDialog.getByRole("button", { name: "残しておく" }).click();
  await page.getByRole("button", { name: "登録情報を削除する" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "すべて削除する" })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "まずは、ご自宅の登録から" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("unrelated-app-setting")),
  ).toBe("keep");
});

test("大きな文字とスマートフォン幅でも画面全体が横にはみ出さない", async ({
  page,
}) => {
  await page.goto("/");
  const textSize = page.getByRole("button", { name: "文字サイズ" });
  await expect(textSize).toHaveAttribute("aria-pressed", "false");
  await textSize.click();
  await expect(textSize).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await registerHome(page);
  await page.getByLabel("行きたい場所").selectOption("aeon-sanko");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("主要画面と登録・申込ダイアログにWCAGの自動検出違反がない", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const violations: {
    screen: string;
    id: string;
    impact: string | null | undefined;
    targets: string[][];
    summary: (string | undefined)[];
  }[] = [];
  async function checkAccessibility(screen: string) {
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    for (const violation of report.violations) {
      violations.push({
        screen,
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target.map(String)),
        summary: violation.nodes.map((node) => node.failureSummary),
      });
    }
  }

  await page.goto("/");
  await checkAccessibility("ホーム");
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const registration = page.getByRole("dialog", {
    name: "ご自宅を登録しましょう",
  });
  await expect(registration).toBeVisible();
  await checkAccessibility("自宅登録ダイアログ");
  await registration
    .getByLabel("お名前（ニックネーム）")
    .fill("使いやすさ確認");
  await registration
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await page.getByLabel("行きたい場所").selectOption("nakatsu-station");
  await page.getByLabel("着きたい時刻").fill("10:00");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "中津駅への経路" }),
  ).toBeVisible();
  await checkAccessibility("検索結果");
  await page
    .getByRole("article")
    .filter({ hasText: "お迎えのある経路" })
    .first()
    .getByRole("button", { name: "この経路を見る" })
    .click();
  await checkAccessibility("経路詳細");
  await page.getByRole("button", { name: "申込内容の確認へ" }).click();
  const booking = page.getByRole("dialog", { name: "お迎えの申込内容を確認" });
  await expect(booking).toBeVisible();
  await checkAccessibility("申込確認ダイアログ");
  await booking.getByRole("checkbox").check();
  await booking.getByRole("button", { name: "体験用の予定を保存する" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "おでかけ予定", exact: true }),
  ).toBeVisible();
  await checkAccessibility("保存した予定");
  await navigate(page, "使い方");
  await expect(
    page.getByRole("heading", { level: 1, name: "おでかけナビの使い方" }),
  ).toBeVisible();
  await checkAccessibility("使い方");
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

test("地域を選んだ直後に地図でEnterを押しても自宅の座標を変更しない", async ({
  page,
}) => {
  await fixtureAerialTiles(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "ご自宅を登録しましょう" });
  await dialog.getByLabel("お名前（ニックネーム）").fill("大貞の利用者");
  const area = dialog.getByRole("button", { name: "大貞周辺", exact: true });
  await area.click();
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await dialog
    .getByRole("button", { name: "航空写真を表示", exact: true })
    .click();
  const map = dialog.getByRole("group", {
    name: "自宅を選ぶ航空写真地図",
    exact: false,
  });
  await map.focus();
  await map.press("Enter");
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("場所の呼び名（任意）")).toHaveValue(
    "大貞周辺",
  );
  await dialog
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  const storedHome = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("nakatsu-profile-v1") ?? "null")?.home,
  );
  expect(storedHome).toEqual({
    id: "osada",
    label: "大貞周辺",
    lat: 33.5665,
    lng: 131.2047,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "大貞の利用者さんのご自宅" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ご自宅の登録を確認・変更" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "大貞周辺", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
