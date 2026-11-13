import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

// AI モックにつないだ通し確認（playwright.mock.config.ts で実行する）
const AI = process.env.MOCK_AI_URL ?? "http://127.0.0.1:4999/v1";

test("AI モックが作った問題で 10 問を打ち、その問題が logs に保存される", async ({ page, request }) => {
  const health = await request.get(AI.replace(/\/v1$/, "/health"));
  expect(health.ok(), `AI モック（${AI}）が起動していません`).toBe(true);

  await page.goto("/");
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
    await input.pressSequentially(target, { delay: 10 });
    await input.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "結果：英単語 10" })).toBeVisible();

  // アプリの固定問題（apple, water ...）ではなく、AI モックの問題が出て、そのまま記録されている
  const FIXED = ["apple", "water", "light", "music", "happy", "green", "table", "smile", "house", "dream", "river", "cloud"];
  expect(shown.some((q) => FIXED.includes(q))).toBe(false);
  const db = new Database("/tmp/typing-e2e-mock.db", { readonly: true });
  const rows = db.prepare("SELECT target FROM logs ORDER BY question_num").all() as { target: string }[];
  db.close();
  expect(rows.map((r) => r.target)).toEqual(shown);
});

// 日本語とローマ字の出題（AI モックが作る）。管理画面でレベルを作り、学生として打つ
test("日本語（ひらがな）とローマ字のレベルを作り、AI モックの問題で打てる。日本語は 文字/分 で表示", async ({ page, browser }) => {
  // 教員: レベルを 2 つ作る（このテスト用の一時 DB）
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("t001");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "ステージ・レベルの管理" }).click();
  const stage = page.locator(".manage-stage").nth(1);
  for (const [title, prompt] of [
    ["ひらがな", "ひらがなの短い単語を10個生成してください。"],
    ["ローマ字", "日本語の簡単な単語を、ローマ字（ヘボン式・小文字）で10個生成してください。"],
  ]) {
    await stage.getByLabel("新しいレベル名").fill(title);
    await stage.getByLabel("新しいレベルの AI への指示文").fill(prompt);
    await stage.getByRole("button", { name: "レベルを追加" }).click();
    await expect(page.getByText(`レベル「${title}」を追加しました`)).toBeVisible();
  }

  // 学生: ひらがなのレベルで 10 問（3 問目だけ 1 文字目を間違える）
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto("/");
  await sp.getByPlaceholder("例: y220020").fill("sample");
  await sp.getByRole("button", { name: "はじめる" }).click();
  const started = sp.waitForResponse((r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST");
  await sp.getByRole("button", { name: "ひらがな" }).click();
  const session = await (await started).json();
  expect(session.source).toBe("ai");
  expect(session.questions.every((q: string) => /^[ぁ-ゟ]+$/.test(q))).toBe(true);
  const input = sp.getByLabel("入力");
  for (let i = 1; i <= 10; i++) {
    await expect(sp.getByText(`${i} / 10 問`)).toBeVisible();
    const target = (await sp.getByLabel("出題").getAttribute("data-text")) ?? "";
    expect(target).toBe(session.questions[i - 1]);
    const typed = i === 3 ? "ん" + Array.from(target).slice(1).join("") : target;
    await input.pressSequentially(typed, { delay: 5 });
    await input.press("Enter");
  }
  await expect(sp.getByRole("heading", { name: "結果：ひらがな" })).toBeVisible();
  // 日本語のプレイは 文字/分 を主に出す
  await expect(sp.getByText("文字/分", { exact: true })).toBeVisible();
  await expect(sp.getByText(/文字\/分 は、正しく打てた文字数/)).toBeVisible();
  // 記録: 打った日本語がそのまま保存され、3 問目のミスが 1 文字
  const db = new Database("/tmp/typing-e2e-mock.db", { readonly: true });
  const rows = db
    .prepare("SELECT l.target, l.typed FROM logs l JOIN levels v ON v.id = l.level_id WHERE v.title = 'ひらがな' ORDER BY l.question_num")
    .all() as { target: string; typed: string }[];
  db.close();
  expect(rows).toHaveLength(10);
  expect(rows[2].typed).toBe("ん" + Array.from(rows[2].target).slice(1).join(""));
  expect(rows.filter((r) => r.target !== r.typed)).toHaveLength(1);

  // ローマ字のレベルは、半角の小文字の問題
  await sp.getByRole("button", { name: "レベル選択に戻る" }).click();
  const started2 = sp.waitForResponse((r) => r.url().endsWith("/api/sessions") && r.request().method() === "POST");
  await sp.getByRole("button", { name: "ローマ字" }).click();
  const romaji = await (await started2).json();
  expect(romaji.questions.every((q: string) => /^[a-z-]+$/.test(q))).toBe(true);
  await ctx.close();
});

// 苦手克服トレーニング: 解く → サーバーが記録を分析して LLM（ここではモック）に送る → 次の問題が届く、を 2 周する
test("苦手克服トレーニング: 記録から苦手を分析し、苦手な文字を含む次の問題が届く", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();

  // （記録がないときの最初の問題は server/training.test.ts で確かめている。この学生は前のテストで記録がある）
  const countLogs = () => {
    const db = new Database("/tmp/typing-e2e-mock.db", { readonly: true });
    const r = db
      .prepare(
        "SELECT COUNT(*) AS n FROM logs JOIN levels ON levels.id = logs.level_id WHERE logs.user_id = 'sample' AND levels.title = '苦手克服トレーニング'",
      )
      .get() as { n: number };
    db.close();
    return r.n;
  };
  const before = countLogs();
  await page.getByRole("button", { name: "トレーニングを始める" }).click();
  const input = page.getByLabel("入力");
  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`${i} / 10 問`)).toBeVisible();
    const target = (await page.getByLabel("出題").getAttribute("data-text")) ?? "";
    // 最初の文字をわざと間違える（その文字が苦手として記録される）
    await input.pressSequentially("#" + target.slice(1), { delay: 5 });
    await input.press("Enter");
  }
  await expect(page.getByRole("heading", { name: /^結果：苦手克服トレーニング/ })).toBeVisible();

  // 2 周目: 結果画面から次へ。サーバーが分析した苦手な文字を、モックが問題に入れて返す
  const second = page.waitForResponse((r) => r.url().endsWith("/api/training/next"));
  await page.getByRole("button", { name: "苦手に合わせた次の問題へ" }).click();
  const body = await (await second).json();
  expect(body.source).toBe("ai");
  const weak: string[] = body.weakness.weakChars.map((c: { char: string }) => c.char);
  expect(weak.length).toBeGreaterThan(0);
  expect(body.questions.every((q: string) => weak.some((c) => q.includes(c)))).toBe(true);
  await expect(page.getByText("（モック）")).toBeVisible();
  await expect(page.getByText("1 / 10 問")).toBeVisible();

  // 記録は「苦手克服トレーニング」のレベルに保存され、学生のレベル一覧には出ない
  expect(countLogs() - before).toBe(10);
});
