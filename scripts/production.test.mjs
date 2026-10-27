import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";

const directory = process.env.PRODUCTION_DIST_DIR
  ? resolve(process.env.PRODUCTION_DIST_DIR)
  : resolve(import.meta.dirname, "../dist");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Exercise configured builds without a real project, password or email send.
// The actual SDK still parses the fixture session and makes the scoped calls.
async function mockAccountService(page) {
  const owner = "11111111-1111-4111-8111-111111111111";
  const dataWrites = [];
  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (status, body) =>
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
    if (request.method() === "OPTIONS") return reply(204);
    const user = {
      id: owner,
      aud: "authenticated",
      role: "authenticated",
      email: "production-fixture@example.test",
      email_confirmed_at: "2026-10-27T00:00:00Z",
      created_at: "2026-10-27T00:00:00Z",
      updated_at: "2026-10-27T00:00:00Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
    };
    if (url.pathname === "/auth/v1/token") {
      const now = Math.floor(Date.now() / 1000);
      const encode = (value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: owner, aud: "authenticated", role: "authenticated", iss: `${url.origin}/auth/v1`, iat: now, exp: now + 3600, session_id: "33333333-3333-4333-8333-333333333333" })}.Zml4dHVyZS1vbmx5`;
      return reply(200, {
        access_token: token,
        refresh_token: "production-fixture-refresh",
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: "bearer",
        user,
      });
    }
    if (url.pathname === "/auth/v1/user") return reply(200, user);
    if (url.pathname === "/auth/v1/logout") return reply(204);
    if (
      url.pathname === "/rest/v1/user_travel_data" &&
      url.searchParams.get("user_id") === `eq.${owner}`
    ) {
      if (request.method() === "GET") return reply(200, []);
      if (["POST", "PATCH", "PUT"].includes(request.method())) {
        dataWrites.push(request.method());
        return reply(403, { message: "Server writes disabled" });
      }
      if (request.method() === "DELETE") return reply(204);
    }
    return reply(404, { message: "Unexpected fixture endpoint" });
  };
  await page.route("**/auth/v1/**", routeHandler);
  await page.route("**/rest/v1/user_travel_data*", routeHandler);
  return { dataWrites };
}

// No SPA fallback: missing assets and requests outside the Pages prefix must
// fail, just as they do on GitHub Pages. Each prefix gets a separate server.
function staticServer(prefix) {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (!pathname.startsWith(prefix)) {
        response.writeHead(404).end();
        return;
      }
      const relativePath = pathname.slice(prefix.length) || "index.html";
      const filename = resolve(directory, relativePath);
      if (!filename.startsWith(directory + sep)) {
        response.writeHead(404).end();
        return;
      }
      const content = await readFile(filename);
      response.writeHead(200, {
        "Content-Type":
          contentTypes[extname(filename)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
}

test("公開用ビルドがルートと GitHub Pages のパスで表示・検索できる", async (t) => {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());

  for (const prefix of ["/", "/-navi-/"]) {
    await t.test(`公開パス ${prefix}`, async () => {
      const server = staticServer(prefix);
      await new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", done);
      });
      const context = await browser.newContext({
        locale: "ja-JP",
        timezoneId: "Asia/Tokyo",
        permissions: ["geolocation"],
        geolocation: { latitude: 33.58642, longitude: 131.19876, accuracy: 12 },
      });
      try {
        const page = await context.newPage();
        const account = await mockAccountService(page);
        let tileRequests = 0;
        await page.route(
          "https://maps.gsi.go.jp/xyz/seamlessphoto/**",
          async (route) => {
            tileRequests += 1;
            await route.fulfill({
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d5ded0"/></svg>',
              headers: { "access-control-allow-origin": "*" },
            });
          },
        );
        const errors = [];
        const failedAssets = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 400)
            failedAssets.push(
              `${response.status()} ${new URL(response.url()).pathname}`,
            );
        });
        const response = await page.goto(
          `http://127.0.0.1:${server.address().port}${prefix}`,
          { waitUntil: "networkidle" },
        );
        assert.equal(response.status(), 200);
        assert.deepEqual(
          failedAssets,
          [],
          "公開 HTML が参照するファイルをすべて取得できること",
        );
        assert.deepEqual(
          errors,
          [],
          "本番 JavaScript に実行時エラーがないこと",
        );
        await page
          .getByRole("heading", { name: "どこへおでかけしますか？" })
          .waitFor({ timeout: 5000 });
        await page
          .getByRole("region", { name: "ログイン状態" })
          .getByRole("button", { name: "ログイン", exact: true })
          .click();
        const authDialog = page.getByRole("dialog");
        if (
          await authDialog
            .getByRole("heading", { name: "ログインの準備中", exact: true })
            .count()
        ) {
          await authDialog
            .getByRole("button", { name: "ログイン画面を閉じる" })
            .click();
        } else {
          await authDialog
            .getByLabel("メールアドレス", { exact: true })
            .fill("production-fixture@example.test");
          await authDialog
            .getByLabel("パスワード", { exact: true })
            .fill("FIXTURE_ONLY_Production_123!");
          await authDialog
            .getByRole("button", { name: "ログインする", exact: true })
            .click();
          await page
            .getByRole("button", { name: "ログアウト", exact: true })
            .waitFor();
          await page
            .getByRole("status")
            .filter({ hasText: "ご自身の登録情報を読み込んでいます" })
            .waitFor({ state: "detached" });
        }
        assert.equal(tileRequests, 0, "航空写真は明示操作まで読み込まないこと");
        // Exercise the lazy Leaflet chunk from the deployed subdirectory too.
        // This is a fixture tile and simulated GPS, not a live GSI/device check.
        await page
          .getByRole("button", { name: "航空写真を表示", exact: true })
          .click();
        await page.locator(".leaflet-tile-loaded").first().waitFor();
        assert.ok(tileRequests > 0);
        const storageBeforeGps = await page.evaluate(() => ({ ...localStorage }));
        await page
          .getByRole("button", { name: "現在地を表示", exact: true })
          .click();
        await page
          .getByRole("button", { name: "現在地に戻る", exact: true })
          .waitFor();
        assert.equal(await page.locator(".aerial-current-icon").count(), 1);
        await page
          .getByRole("button", { name: "現在地の表示を停止", exact: true })
          .click();
        await page
          .locator(".aerial-current-icon")
          .waitFor({ state: "detached" });
        assert.deepEqual(
          await page.evaluate(() => ({ ...localStorage })),
          storageBeforeGps,
          "GPS表示は端末保存を書き換えないこと",
        );
        await page
          .getByRole("button", { name: "航空写真を非表示", exact: true })
          .click();

        await page
          .getByRole("button", { name: "ご自宅を登録する", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "ご自宅を登録しましょう",
        });
        await dialog
          .getByLabel("お名前（ニックネーム）")
          .fill("サンプル利用者");
        await dialog
          .getByRole("button", { name: "この内容で登録する" })
          .click();
        await page.getByLabel("行きたい場所").selectOption("nakatsu-station");
        await page.getByLabel("着きたい時刻").fill("10:00");
        await page
          .getByRole("button", { name: "この条件で経路をさがす" })
          .click();
        await page
          .getByRole("heading", { name: "中津駅への経路", exact: true })
          .waitFor();
        assert.ok((await page.getByRole("article").count()) > 0);
        assert.deepEqual(account.dataWrites, [], "自宅や経路をサーバーに保存しないこと");
        assert.deepEqual(errors, []);
        assert.deepEqual(failedAssets, []);
      } finally {
        await context.close();
        await new Promise((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
    });
  }
});
