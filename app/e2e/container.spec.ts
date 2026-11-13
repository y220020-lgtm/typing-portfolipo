import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";

// コンテナのアプリ（AUTH_MODE=local、INIT_DB=demo）＋ AI モックのコンテナでの通し確認
const DB = process.env.CONTAINER_DB ?? path.join(os.homedir(), "typing-data", "typing.db");

test("コンテナのアプリで、AI モックの問題で 10 問を打ち、記録がコンテナの外の DB に保存される", async ({ page, request }) => {
  const mode = await (await request.get("api/auth-mode")).json();
  expect(mode.mode, "このテストは AUTH_MODE=local のコンテナ用").toBe("local");

  const before = (() => {
    const db = new Database(DB, { readonly: true });
    const n = (db.prepare("SELECT count(*) c FROM logs").get() as { c: number }).c;
    db.close();
    return n;
  })();

  await page.goto("./");
  await page.getByPlaceholder("例: y220020").fill("y220020");
  await page.getByRole("button", { name: "はじめる" }).click();
  const started = page.waitForResponse((r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST");
  await page.getByRole("button", { name: "英単語 10" }).click();
  expect((await (await started).json()).source).toBe("ai");
  const input = page.getByLabel("入力");
  const shown: string[] = [];
  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`${i} / 10 問`)).toBeVisible();
    const target = (await page.getByLabel("出題").getAttribute("data-text")) ?? "";
    shown.push(target);
    await input.pressSequentially(target, { delay: 5 });
    await input.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "結果：英単語 10" })).toBeVisible();

  const db = new Database(DB, { readonly: true });
  const rows = db.prepare("SELECT user_id, target FROM logs ORDER BY id DESC LIMIT 10").all() as { user_id: string; target: string }[];
  const after = (db.prepare("SELECT count(*) c FROM logs").get() as { c: number }).c;
  db.close();
  expect(after - before).toBe(10);
  expect(rows.reverse().map((r) => r.target)).toEqual(shown);
  expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(["y220020"]));
});
