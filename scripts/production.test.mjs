import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";

const directory = resolve(import.meta.dirname, "../dist");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

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
        assert.equal(tileRequests, 0, "航空写真は明示操作まで読み込まないこと");
        // Exercise the lazy Leaflet chunk from the deployed subdirectory too.
        // This is a fixture tile and simulated GPS, not a live GSI/device check.
        await page
          .getByRole("button", { name: "航空写真を表示", exact: true })
          .click();
        await page.locator(".leaflet-tile-loaded").first().waitFor();
        assert.ok(tileRequests > 0);
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
        assert.equal(await page.evaluate(() => localStorage.length), 0);
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
