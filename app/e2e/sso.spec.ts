import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import { SSO } from "../playwright.sso.config";

// 研究室 Web サーバー経由・SSO（の代わり）での通し確認。playwright.sso.config.ts で実行する。
test.describe.configure({ mode: "serial" });

test("ログイン画面なしで SSO の本人として練習でき、/typing/ の下で記録が本人の名前で保存される", async ({ page, request }) => {
  expect(fs.existsSync("dist/index.html"), "先に npm run build を実行してください").toBe(true);
  const aiUp = (await request.get(SSO.ai.replace(/\/v1$/, "/health")).catch(() => null))?.ok() ?? false;

  await page.goto("/typing/");
  await expect(page.getByText("高木勇輔（y220020）")).toBeVisible();
  await expect(page.getByPlaceholder("例: y220020")).toHaveCount(0); // ログイン画面は出ない

  const started = page.waitForResponse((r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST");
  await page.getByRole("button", { name: "英単語 10" }).click();
  if (aiUp) expect((await (await started).json()).source).toBe("ai");
  const input = page.getByLabel("入力");
  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`${i} / 10 問`)).toBeVisible();
    await input.pressSequentially((await page.getByLabel("出題").getAttribute("data-text")) ?? "", { delay: 5 });
    await input.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "結果：英単語 10" })).toBeVisible();

  const db = new Database(SSO.db, { readonly: true });
  const rows = db.prepare("SELECT DISTINCT user_id FROM logs").all() as { user_id: string }[];
  const n = (db.prepare("SELECT count(*) c FROM logs").get() as { c: number }).c;
  db.close();
  expect(rows).toEqual([{ user_id: "y220020" }]);
  expect(n).toBe(10);
  test.info().annotations.push({ type: "AI モック", description: aiUp ? "接続あり（AI の問題で出題）" : "未起動（固定問題で出題）" });
});

test("プロキシを通さずアプリに直接、偽のメールのヘッダーを送っても拒否される", async ({ request }) => {
  const direct = `http://127.0.0.1:${SSO.appPort}/typing/api/me`;
  expect((await request.get(direct, { headers: { "X-Forwarded-Email": "sample@mail.example.ac.jp" } })).status()).toBe(401);
  expect((await request.get(direct, { headers: { "X-Forwarded-Email": "sample@mail.example.ac.jp", "X-Proxy-Secret": "guess" } })).status()).toBe(
    401,
  );
  // プロキシ経由で偽のヘッダーを送っても、プロキシが付け直すので本人のまま
  const viaProxy = await request.get("/typing/api/me", { headers: { "X-Forwarded-Email": "sample@mail.example.ac.jp" } });
  expect((await viaProxy.json()).id).toBe("y220020");
});

test("ログアウトは oauth2-proxy のログアウト（既定 /oauth2/sign_out）へ移る。/typing は /typing/ に移動する", async ({ page }) => {
  await page.goto("/typing");
  await expect(page).toHaveURL(/\/typing\/$/);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/oauth2\/sign_out$/);
  await expect(page.getByText("ログアウトしました")).toBeVisible();
});
