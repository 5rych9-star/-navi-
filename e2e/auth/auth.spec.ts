import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { searchJourneys } from "../../src/lib/transit";
import type { Profile, SavedTrip } from "../../src/lib/storage";

// These public configuration values, users, passwords, and unsigned JWT-like
// responses are deliberate fixtures. Every provider request is intercepted.
// They test the real Supabase SDK/UI, not the database's actual RLS policies.
const PROVIDER = "https://auth-fixture.supabase.co";
const FIXTURE_PASSWORD = "FIXTURE_ONLY_NotARealPassword_123!";
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const EMAIL_A = "owner-a@example.test";
const EMAIL_B = "owner-b@example.test";
const SESSION_KEY = "nakatsu-auth-auth-fixture.supabase.co-v1";
const accountKey = (owner: string) => `nakatsu-account-travel-v2:${owner}`;

type Row = { user_id: string; profile: Profile | null; trips: SavedTrip[] };
const profileA: Profile = {
  nickname: "利用者A",
  home: {
    id: "account-a-home",
    label: "Aさんの非公開の自宅",
    lat: 33.5856,
    lng: 131.1964,
  },
};
const profileB: Profile = {
  nickname: "利用者B",
  home: {
    id: "account-b-home",
    label: "Bさんの非公開の自宅",
    lat: 33.5665,
    lng: 131.2047,
  },
};
const guestProfile: Profile = {
  nickname: "以前のゲスト",
  home: {
    id: "old-guest",
    label: "以前の端末内の自宅",
    lat: 33.5752,
    lng: 131.1737,
  },
};

function trip(profile: Profile, destinationId: string): SavedTrip {
  return {
    id: `fixture-${profile.home.id}`,
    profile,
    journey: searchJourneys({
      home: profile.home,
      destinationId,
      date: "2026-11-20",
      arrivalTime: "10:00",
    })[0],
    date: "2026-11-20",
    createdAt: "2026-10-27T00:00:00.000Z",
    status: "saved",
  };
}

function user(id: string) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: id === OWNER_B ? EMAIL_B : EMAIL_A,
    email_confirmed_at: "2026-10-27T00:00:00.000Z",
    confirmed_at: "2026-10-27T00:00:00.000Z",
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-10-27T00:00:00.000Z",
    updated_at: "2026-10-27T00:00:00.000Z",
    is_anonymous: false,
  };
}

function session(id: string) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, aud: "authenticated", role: "authenticated", email: user(id).email, iss: `${PROVIDER}/auth/v1`, iat: now, exp: now + 3600, session_id: "33333333-3333-4333-8333-333333333333" })}.Zml4dHVyZS1zaWduYXR1cmU`;
  return {
    access_token: token,
    token_type: "bearer",
    refresh_token: `fixture-refresh-${id}`,
    expires_in: 3600,
    expires_at: now + 3600,
    user: user(id),
  };
}

function requestUser(route: Route): string | null {
  try {
    const token = route
      .request()
      .headers()
      .authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    return [OWNER_A, OWNER_B].includes(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

async function fixtureProvider(page: Page) {
  const rows = new Map<string, Row>([
    [
      OWNER_A,
      {
        user_id: OWNER_A,
        profile: structuredClone(profileA),
        trips: [trip(profileA, "nakatsu-station")],
      },
    ],
    [
      OWNER_B,
      {
        user_id: OWNER_B,
        profile: structuredClone(profileB),
        trips: [trip(profileB, "city-hall")],
      },
    ],
  ]);
  const calls: {
    path: string;
    method: string;
    owner: string | null;
    queryOwner: string | null;
    url: string;
    body: string | null;
  }[] = [];
  const state = {
    failLoads: false,
    failDeletes: false,
    wrongOwner: false,
    invalidLogin: false,
  };
  const unexpected: string[] = [];

  await page.route(`${PROVIDER}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const owner = requestUser(route);
    calls.push({
      path: url.pathname,
      method,
      owner,
      queryOwner: url.searchParams.get("user_id"),
      url: request.url(),
      body: request.postData(),
    });
    const respond = (status: number, body?: unknown) =>
      route.fulfill({
        status,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        },
        ...(body === undefined
          ? {}
          : { contentType: "application/json", body: JSON.stringify(body) }),
      });
    if (method === "OPTIONS") {
      await respond(204);
      return;
    }
    if (url.pathname === "/auth/v1/token" && method === "POST") {
      const body = request.postDataJSON();
      if (state.invalidLogin) {
        await respond(400, {
          code: "invalid_credentials",
          error_code: "invalid_credentials",
          msg: "Fixture invalid credentials",
        });
        return;
      }
      const id =
        body.email === EMAIL_B ||
        body.refresh_token === `fixture-refresh-${OWNER_B}`
          ? OWNER_B
          : OWNER_A;
      await respond(200, session(id));
      return;
    }
    if (url.pathname === "/auth/v1/signup" && method === "POST") {
      await respond(200, {
        ...user(OWNER_A),
        email_confirmed_at: null,
        confirmed_at: null,
        confirmation_sent_at: new Date().toISOString(),
      });
      return;
    }
    if (url.pathname === "/auth/v1/recover" && method === "POST") {
      await respond(200, {});
      return;
    }
    if (url.pathname === "/auth/v1/logout" && method === "POST") {
      await respond(204);
      return;
    }
    if (url.pathname === "/auth/v1/user" && owner) {
      await respond(200, user(owner));
      return;
    }
    if (url.pathname === "/rest/v1/user_travel_data") {
      if (!owner || url.searchParams.get("user_id") !== `eq.${owner}`) {
        await respond(403, {
          code: "42501",
          message: "Fixture ownership check failed",
        });
        return;
      }
      if (method === "GET") {
        if (state.failLoads) {
          await respond(503, {
            code: "fixture_unavailable",
            message: "Fixture unavailable",
          });
          return;
        }
        const row = rows.get(
          state.wrongOwner ? (owner === OWNER_A ? OWNER_B : OWNER_A) : owner,
        );
        const singular = request
          .headers()
          .accept?.includes("vnd.pgrst.object+json");
        await respond(200, singular ? (row ?? null) : row ? [row] : []);
        return;
      }
      if (["POST", "PATCH", "PUT"].includes(method)) {
        // Match the read/delete-only migration: even an older client cannot
        // store new home coordinates, labels, or itineraries on the server.
        await respond(403, {
          code: "42501",
          message: "Server writes disabled",
        });
        return;
      }
      if (method === "DELETE") {
        if (state.failDeletes) {
          await respond(503, { message: "Fixture deletion unavailable" });
          return;
        }
        rows.delete(owner);
        await respond(204);
        return;
      }
    }
    unexpected.push(`${method} ${url.pathname}`);
    await respond(404, { message: "Unexpected fixture endpoint" });
  });
  return { rows, calls, state, unexpected };
}

async function seedLegacyGuest(page: Page) {
  await page.addInitScript((profile) => {
    localStorage.setItem("nakatsu-profile-v1", JSON.stringify(profile));
    localStorage.setItem("unrelated-app-setting", "keep");
  }, guestProfile);
}

async function openLogin(page: Page) {
  await page
    .getByRole("button", { name: "ログイン", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "ログイン", exact: true }),
  ).toBeVisible();
  return dialog;
}

async function checkAuthAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .include(".auth-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function login(page: Page, email: string) {
  const dialog = await openLogin(page);
  await dialog.getByLabel("メールアドレス", { exact: true }).fill(email);
  await dialog.getByLabel("パスワード", { exact: true }).fill(FIXTURE_PASSWORD);
  await dialog
    .getByRole("button", { name: "ログインする", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}

async function browserStorage(page: Page) {
  return page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
}

async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: new RegExp(`^${name}\\s*\\d*$`) })
    .filter({ visible: true })
    .first()
    .click();
}

test("SDKの新規登録は確認メール待ちとなり、自動ログインやパスワード保存をしない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  await seedLegacyGuest(page);
  await page.goto("/");
  await expect(
    page.getByText("以前のゲストさんのご自宅", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("以前の端末内の自宅", { exact: true }),
  ).toHaveCount(0);
  const dialog = await openLogin(page);
  await dialog.getByRole("button", { name: "新規登録", exact: true }).click();
  await checkAuthAccessibility(page);
  await dialog.getByLabel("メールアドレス", { exact: true }).fill(EMAIL_A);
  await dialog.getByLabel("パスワード", { exact: true }).fill(FIXTURE_PASSWORD);
  await dialog
    .getByLabel("パスワード（確認）", { exact: true })
    .fill("Fixture_Mismatch_123!");
  await dialog
    .getByRole("button", { name: "アカウントを作成する", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "確認用のパスワードが一致しません",
  );
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/signup")),
  ).toHaveLength(0);
  await dialog
    .getByLabel("パスワード（確認）", { exact: true })
    .fill(FIXTURE_PASSWORD);
  await dialog
    .getByRole("button", { name: "アカウントを作成する", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "確認メールをご確認ください",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  expect(
    fixture.calls.filter(
      (call) => call.path.endsWith("/signup") && call.method === "POST",
    ),
  ).toHaveLength(1);
  expect(
    fixture.calls.filter((call) => call.path.startsWith("/rest/")),
  ).toHaveLength(0);
  const storage = await browserStorage(page);
  expect(storage.session[SESSION_KEY]).toBeUndefined();
  expect(JSON.stringify(storage)).not.toContain(FIXTURE_PASSWORD);
  await confirmation
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ログイン", exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test("旧サーバーデータを本人の端末へ移して削除し、更新・再読込・利用者切替でも位置を送らない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  await seedLegacyGuest(page);
  await page.goto("/");
  await login(page, EMAIL_A);
  await expect(
    page.getByRole("heading", { name: "利用者Aさんのご自宅", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ご自宅の登録を確認・変更", exact: true })
    .click();
  const home = page.getByRole("dialog", {
    name: "ご自宅の登録を変更",
    exact: true,
  });
  await home.getByLabel("お名前（ニックネーム）").fill("利用者A更新");
  await home.getByLabel("場所の呼び名（任意）").fill("更新したAの非公開自宅");
  await home
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await expect(home).not.toBeVisible();
  expect(fixture.rows.has(OWNER_A)).toBe(false);
  const storage = await browserStorage(page);
  expect(JSON.stringify(storage)).not.toContain(FIXTURE_PASSWORD);
  expect(storage.local[accountKey(OWNER_A)]).toContain("更新したAの非公開自宅");
  expect(storage.local[accountKey(OWNER_A)]).toContain("利用者A更新");
  expect(storage.session[SESSION_KEY]).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "利用者A更新さんのご自宅", exact: true }),
  ).toBeVisible();
  await navigate(page, "おでかけ予定");
  await expect(
    page.getByRole("article").filter({ hasText: "中津駅" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ログイン", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/利用者A更新|更新したAの非公開自宅/)).toHaveCount(
    0,
  );
  const signedOutStorage = await browserStorage(page);
  expect(signedOutStorage.session[SESSION_KEY]).toBeUndefined();
  expect(signedOutStorage.local["unrelated-app-setting"]).toBe("keep");
  await login(page, EMAIL_B);
  await expect(
    page.getByRole("heading", { name: "利用者Bさんのご自宅", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/利用者A更新|更新したAの非公開自宅|以前の端末内の自宅/),
  ).toHaveCount(0);
  await navigate(page, "おでかけ予定");
  await expect(
    page.getByRole("article").filter({ hasText: "中津市役所" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("article").filter({ hasText: "中津駅" }),
  ).toHaveCount(0);
  expect(fixture.rows.has(OWNER_B)).toBe(false);
  const dataCalls = fixture.calls.filter((call) =>
    call.path.startsWith("/rest/"),
  );
  expect(dataCalls.some((call) => call.method === "DELETE")).toBe(true);
  for (const call of dataCalls) {
    expect(call.queryOwner).toBe(`eq.${call.owner}`);
    expect(["GET", "DELETE", "OPTIONS"]).toContain(call.method);
    expect(call.body).toBeNull();
  }
  for (const privateValue of [
    profileA.home.label,
    profileB.home.label,
    "更新したAの非公開自宅",
    String(profileA.home.lat),
    String(profileA.home.lng),
  ]) {
    expect(JSON.stringify(fixture.calls)).not.toContain(privateValue);
  }
  expect(fixture.unexpected).toEqual([]);
});

test("認証エラーと再設定メールを実SDK経由で扱い、成功を装わず秘密を保存しない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  fixture.state.invalidLogin = true;
  await page.goto("/");
  const dialog = await openLogin(page);
  await dialog.getByLabel("メールアドレス", { exact: true }).fill(EMAIL_A);
  await dialog.getByLabel("パスワード", { exact: true }).fill(FIXTURE_PASSWORD);
  await dialog
    .getByRole("button", { name: "ログインする", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "メールアドレスまたはパスワードをご確認ください",
  );
  expect((await browserStorage(page)).session[SESSION_KEY]).toBeUndefined();
  expect(
    fixture.calls.filter((call) => call.path.startsWith("/rest/")),
  ).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "パスワードを忘れた方", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "再設定メールを送る", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "メールをご確認ください", exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.filter(
      (call) => call.path.endsWith("/recover") && call.method === "POST",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(await browserStorage(page))).not.toContain(
    FIXTURE_PASSWORD,
  );
  expect(fixture.unexpected).toEqual([]);
});

test("旧サーバーの移行失敗を知らせ、他人やゲストの情報を表示しない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  fixture.state.failLoads = true;
  await seedLegacyGuest(page);
  await page.goto("/");
  await login(page, EMAIL_A);
  await expect(
    page.getByText(
      /旧サーバー|以前のサーバー|サーバー.*削除|サーバー.*移行|登録情報を読み込めませんでした|ご自宅と予定を読み込めませんでした/,
    ),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(
      /以前のゲストさんのご自宅|以前の端末内の自宅|利用者Aさんのご自宅|利用者Bさんのご自宅/,
    ),
  ).toHaveCount(0);
  fixture.state.failLoads = false;
  fixture.state.wrongOwner = true;
  const readsBeforeRetry = fixture.calls.filter(
    (call) => call.path.startsWith("/rest/") && call.method === "GET",
  ).length;
  await page
    .getByRole("button", { name: "登録情報を再読み込み", exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixture.calls.filter(
          (call) => call.path.startsWith("/rest/") && call.method === "GET",
        ).length,
    )
    .toBeGreaterThan(readsBeforeRetry);
  await expect(
    page.getByText(
      /旧サーバー|以前のサーバー|サーバー.*削除|サーバー.*移行|登録情報を読み込めませんでした|ご自宅と予定を読み込めませんでした/,
    ),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(
      /利用者Bさんのご自宅|Bさんの非公開の自宅|以前の端末内の自宅/,
    ),
  ).toHaveCount(0);
  fixture.state.wrongOwner = false;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "利用者Aさんのご自宅", exact: true }),
  ).toBeVisible();
  expect((await browserStorage(page)).local[accountKey(OWNER_A)]).toContain(
    "Aさんの非公開の自宅",
  );
  expect(fixture.rows.has(OWNER_A)).toBe(false);
  expect(fixture.unexpected).toEqual([]);
});

test("同じブラウザの別タブで別アカウントにログインしても相互にセッションを上書きしない", async ({
  page,
  context,
}) => {
  const fixtureA = await fixtureProvider(page);
  await page.goto("/");
  await login(page, EMAIL_A);
  await expect(
    page.getByRole("heading", { name: "利用者Aさんのご自宅", exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  try {
    const fixtureB = await fixtureProvider(other);
    await other.goto("/");
    await expect(
      other.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    await expect(
      other.getByText(/利用者Aさんのご自宅|Aさんの非公開の自宅/),
    ).toHaveCount(0);
    await login(other, EMAIL_B);
    await expect(
      other.getByRole("heading", { name: "利用者Bさんのご自宅", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "利用者Aさんのご自宅", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/利用者Bさんのご自宅|Bさんの非公開の自宅/),
    ).toHaveCount(0);
    expect((await browserStorage(page)).session[SESSION_KEY]).toContain(
      OWNER_A,
    );
    expect((await browserStorage(other)).session[SESSION_KEY]).toContain(
      OWNER_B,
    );
    await other
      .getByRole("button", { name: "ログアウト", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "利用者Aさんのご自宅", exact: true }),
    ).toBeVisible();
    expect((await browserStorage(page)).session[SESSION_KEY]).toContain(
      OWNER_A,
    );
    expect(fixtureA.unexpected).toEqual([]);
    expect(fixtureB.unexpected).toEqual([]);
  } finally {
    await other.close();
  }
});

test("回復メールのURLを実SDKで処理し、新パスワード送信後にURLと保存領域へ秘密を残さない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  const recoverySession = session(OWNER_A);
  const hash = new URLSearchParams({
    access_token: recoverySession.access_token,
    refresh_token: recoverySession.refresh_token,
    token_type: "bearer",
    expires_in: "3600",
    type: "recovery",
  });
  await page.goto(`/#${hash}`);
  const dialog = page.getByRole("dialog", {
    name: "新しいパスワードを設定",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  const newPassword = `${FIXTURE_PASSWORD}_Updated`;
  await dialog
    .getByLabel("新しいパスワード", { exact: true })
    .fill(newPassword);
  await dialog
    .getByLabel("新しいパスワード（確認）", { exact: true })
    .fill(newPassword);
  await dialog
    .getByRole("button", { name: "パスワードを変更する", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "パスワードを変更しました", exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.filter(
      (call) =>
        call.path === "/auth/v1/user" &&
        call.method === "PUT" &&
        call.owner === OWNER_A,
    ),
  ).toHaveLength(1);
  const storage = JSON.stringify(await browserStorage(page));
  expect(storage).not.toContain(FIXTURE_PASSWORD);
  expect(storage).not.toContain(newPassword);
  expect(fixture.unexpected).toEqual([]);
});

test("認証用のセッション保存が拒否されても以前の端末内データを表示しない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  await seedLegacyGuest(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException(
          "Fixture session storage denied",
          "SecurityError",
        );
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "ログイン", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/以前のゲストさんのご自宅|以前の端末内の自宅/),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const loginDialog = page.getByRole("dialog", {
    name: "ログイン",
    exact: true,
  });
  await expect(loginDialog).toBeVisible();
  await expect(loginDialog.getByRole("alert")).toContainText("セッション保存");
  await expect(
    page.getByRole("dialog", { name: "ご自宅を登録しましょう", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("nakatsu-profile-v1") ?? "null"),
    ),
  ).toEqual(guestProfile);
  expect(fixture.calls).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("新しい自宅と予定は端末にだけ保存し、座標・呼び名・経路IDをサーバーに送らない", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  fixture.rows.clear();
  await page.goto("/");
  await login(page, EMAIL_A);
  await page
    .getByRole("button", { name: "ご自宅を登録する", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "ご自宅を登録しましょう" });
  await dialog.getByLabel("お名前（ニックネーム）").fill("端末の利用者");
  await dialog.getByRole("button", { name: "大貞周辺", exact: true }).click();
  await dialog.getByLabel("場所の呼び名（任意）").fill("端末だけの非公開住所");
  await dialog
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("行きたい場所").selectOption("nakatsu-hospital");
  await page.getByLabel("おでかけの日").fill("2026-11-20");
  await page.getByLabel("着きたい時刻").fill("10:00");
  await page.getByRole("button", { name: "この条件で経路をさがす" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: "お迎えのある経路" })
    .first()
    .getByRole("button", { name: "この経路を見る" })
    .click();
  await page.getByRole("button", { name: "申込内容の確認へ" }).click();
  const booking = page.getByRole("dialog", { name: "お迎えの申込内容を確認" });
  await booking.getByRole("checkbox").check();
  await booking.getByRole("button", { name: "体験用の予定を保存する" }).click();
  await expect(page.getByRole("article")).toContainText("中津市立中津市民病院");

  const saved = (await browserStorage(page)).local[accountKey(OWNER_A)];
  expect(saved).toContain("端末だけの非公開住所");
  expect(saved).toContain("33.5665");
  expect(saved).toContain("131.2047");
  expect(saved).toContain("nakatsu-hospital");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "端末の利用者さんのご自宅" }),
  ).toBeVisible();
  await navigate(page, "おでかけ予定");
  await expect(page.getByRole("article")).toContainText("中津市立中津市民病院");
  expect(fixture.rows.size).toBe(0);
  expect(
    fixture.calls.filter(
      (call) =>
        call.path.startsWith("/rest/") &&
        !["GET", "DELETE", "OPTIONS"].includes(call.method),
    ),
  ).toEqual([]);
  const sent = JSON.stringify(fixture.calls);
  for (const value of [
    "端末だけの非公開住所",
    "端末の利用者",
    "33.5665",
    "131.2047",
    "osada-33.566500-131.204700",
  ]) {
    expect(sent).not.toContain(value);
  }
  expect(fixture.unexpected).toEqual([]);
});

test("端末保存が拒否されたら旧サーバー行を削除せず、移行の失敗を知らせる", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("nakatsu-account-travel-v2:")) {
        throw new DOMException(
          "Fixture device storage denied",
          "QuotaExceededError",
        );
      }
      return original.call(this, key, value);
    };
  });
  await page.goto("/");
  await login(page, EMAIL_A);
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
  expect(fixture.rows.get(OWNER_A)?.profile).toEqual(profileA);
  expect(fixture.calls.filter((call) => call.method === "DELETE")).toEqual([]);
  expect(
    (await browserStorage(page)).local[accountKey(OWNER_A)],
  ).toBeUndefined();
  expect(fixture.unexpected).toEqual([]);
});

test("旧サーバーの削除失敗後も本人の端末保存を使え、再試行で古い情報を削除する", async ({
  page,
}) => {
  const fixture = await fixtureProvider(page);
  fixture.state.failDeletes = true;
  await page.goto("/");
  await login(page, EMAIL_A);
  await expect(
    page.getByRole("heading", { name: "利用者Aさんのご自宅", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
  expect((await browserStorage(page)).local[accountKey(OWNER_A)]).toContain(
    profileA.home.label,
  );
  expect(fixture.rows.has(OWNER_A)).toBe(true);
  await page
    .getByRole("button", { name: "ご自宅の登録を確認・変更", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "ご自宅の登録を変更",
    exact: true,
  });
  await dialog.getByLabel("お名前（ニックネーム）").fill("移行中の端末更新");
  await dialog
    .getByRole("button", { name: "この内容で登録する", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  fixture.state.failDeletes = false;
  await page
    .getByRole("button", { name: "登録情報を再読み込み", exact: true })
    .click();
  await expect.poll(() => fixture.rows.has(OWNER_A)).toBe(false);
  await expect(
    page.getByRole("heading", {
      name: "移行中の端末更新さんのご自宅",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    fixture.calls.filter(
      (call) =>
        call.path.startsWith("/rest/") &&
        ["POST", "PATCH", "PUT"].includes(call.method),
    ),
  ).toEqual([]);
});
