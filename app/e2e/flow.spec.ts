import { expect, test } from "@playwright/test";
import fs from "node:fs";

// テストは書いた順に 1 つずつ実行する（前のテストで保存した記録を後のテストで使う）
test.describe.configure({ mode: "serial" });
const SHOTS = process.env.SHOTS_DIR; // 指定したときだけ画面を保存する（資料用）
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }
};
import Database from "better-sqlite3";

test("ログイン → レベル選択 → 10 問 → 結果表示、logs に 10 行保存される", async ({ page }) => {
  await page.goto("/");
  await shot(page, "01-login");
  await page.getByPlaceholder("例: y220020").fill("y220020");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByText("高木勇輔（y220020）")).toBeVisible();

  await shot(page, "02-level-select");
  await page.getByRole("button", { name: "人差し指の練習" }).click();
  const input = page.getByLabel("入力");

  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`${i} / 10 問`)).toBeVisible();
    const target = (await page.getByLabel("出題").getAttribute("data-text")) ?? "";
    // 3 問目だけ 1 文字目を打ち間違える。それ以外は正しく打つ。
    const typed = i === 3 ? "x" + target.slice(1) : target;
    await input.pressSequentially(typed, { delay: 20 });
    if (i === 3) await shot(page, "03-play");
    await input.press("Enter");
  }

  await expect(page.getByRole("heading", { name: "結果：人差し指の練習" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(11); // 見出し + 10 問
  await shot(page, "04-result");

  const db = new Database("/tmp/typing-e2e.db", { readonly: true });
  const rows = db.prepare("SELECT question_num, target, typed, start_time, end_time FROM logs ORDER BY question_num").all() as {
    question_num: number;
    target: string;
    typed: string;
    start_time: string;
    end_time: string;
  }[];
  db.close();
  expect(rows.map((r) => r.question_num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(rows[2].typed).toBe("x" + rows[2].target.slice(1));
  for (const r of rows) {
    expect(r.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r.end_time >= r.start_time).toBe(true);
  }
  // 画面の正確率は DB の値から計算したものと同じ
  const total = rows.reduce((n, r) => n + Array.from(r.target).length, 0);
  const correct = total - 1;
  await expect(page.getByText(`${((correct / total) * 100).toFixed(1)}%`).first()).toBeVisible();
});

test("未登録の学籍番号はエラー表示", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("nobody");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByText("その学籍番号は登録されていません")).toBeVisible();
});

test("学生はこれまでの記録（推移・苦手な文字・指）を見られる。再読み込みしてもログインが続く", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("y220020");
  await page.getByRole("button", { name: "はじめる" }).click();
  // ログインが終わって（トークンを保存して）から再読み込みする。終わる前に読み直すと、ログイン前の画面に戻る
  await expect(page.getByText("高木勇輔（y220020）")).toBeVisible();
  await page.reload();
  await expect(page.getByText("高木勇輔（y220020）")).toBeVisible();
  await page.getByRole("button", { name: "これまでの記録を見る" }).click();
  await expect(page.getByRole("heading", { name: "これまでの記録" })).toBeVisible();
  await expect(page.getByRole("img", { name: "WPMの推移" })).toBeVisible();
  await expect(page.getByRole("img", { name: "正確率の推移" })).toBeVisible();
  await expect(page.getByText("間違えやすい文字")).toBeVisible();
  // 1 つ目のテストで 3 問目の 1 文字目を x と打った。レベル 1 は f / j だけなので、左右どちらかの人差し指にミスが出る
  await expect(page.getByText(/人差し指（[LR]2）/).first()).toBeVisible();
  await shot(page, "05-my-analysis");
  await page.getByRole("button", { name: "表で見る" }).first().click();
  await expect(page.getByRole("columnheader", { name: "プレイ" })).toBeVisible();

  // 戻る: 画面のボタン（上と下の 2 つ）でも、ブラウザの「戻る」でも、レベル選択に戻る（アプリの外に出ない）
  await expect(page.getByRole("button", { name: "レベル選択に戻る" })).toHaveCount(2);
  await page.getByRole("button", { name: "レベル選択に戻る" }).first().click();
  await expect(page.getByRole("button", { name: "これまでの記録を見る" })).toBeVisible();
  await page.getByRole("button", { name: "これまでの記録を見る" }).click();
  await expect(page.getByRole("heading", { name: "これまでの記録" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "これまでの記録を見る" })).toBeVisible();
  await expect(page.getByText("高木勇輔（y220020）")).toBeVisible();
});

test("教員は学生一覧・学生ごとの分析・CSV を使える", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("t001");
  await page.getByRole("button", { name: "はじめる" }).click();

  await expect(page.getByRole("heading", { name: "学生一覧" })).toBeVisible();
  // 学生の画面に切り替えて練習の画面を見て、教員の画面に戻れる（合言葉なし。2026-11-13）
  await page.getByRole("button", { name: "練習（学生の画面）" }).click();
  await expect(page.getByRole("button", { name: /人差し指の練習/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "学生の学習状況" }).click();
  await expect(page.getByRole("heading", { name: "学生一覧" })).toBeVisible();
  const row = page.getByRole("row", { name: /y220020/ });
  await expect(row.getByRole("cell").nth(2)).toHaveText("1"); // プレイ 1 回
  await expect(row.getByRole("cell").nth(3)).toHaveText("10"); // 10 問
  await shot(page, "06-teacher-students");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "記録を CSV で保存" }).click();
  const file = await (await download).path();
  const csv = fs.readFileSync(file, "utf8");
  expect(csv.split("\r\n").filter((l) => l !== "")).toHaveLength(11); // 見出し + 10 行

  await row.getByRole("button", { name: "y220020" }).click();
  await expect(page.getByRole("heading", { name: "高木勇輔（y220020）の学習状況" })).toBeVisible();
  await expect(page.getByRole("img", { name: "WPMの推移" })).toBeVisible();
  await shot(page, "07-teacher-detail");
});

test("教員は学生を追加・名前の変更・削除でき、一覧を並べ替え・検索できる", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("t001");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByRole("heading", { name: "学生一覧" })).toBeVisible();
  const idsInTable = async () => (await page.locator(".student-table tbody tr td:first-child").allTextContents()).map((t) => t.trim());

  // 追加: 3 人まとめて（区切りはカンマ・タブ・空白）
  await page.getByLabel("追加する学生").fill("y230018,山田 太郎\ny230028\t佐藤 花子\nY230049 鈴木");
  await expect(page.getByRole("button", { name: "3 人を追加" })).toBeEnabled();
  await page.getByRole("button", { name: "3 人を追加" }).click();
  await expect(page.getByText("3 人を追加しました")).toBeVisible();
  await expect(page.getByLabel("追加する学生")).toHaveValue("");
  expect(await idsInTable()).toEqual(["sample", "y220020", "y230018", "y230028", "y230049"]);

  // 重複: すでにある学籍番号が 1 人でもあれば、誰も追加しない
  await page.getByLabel("追加する学生").fill("y230054,田中\ny230018,山田（2 回目）");
  await page.getByRole("button", { name: "2 人を追加" }).click();
  await expect(page.getByText(/誰も追加していません/)).toBeVisible();
  expect(await idsInTable()).not.toContain("y230054");

  // 並べ替え: 見出しのボタンを押す。名前の昇順・降順、問題数の多い順
  const head = (name: string | RegExp) => page.locator(".student-table thead").getByRole("button", { name });
  await head(/^名前/).click();
  const byName = await idsInTable();
  await expect(head(/^名前 ▲/)).toBeVisible();
  await head(/^名前/).click();
  await expect(head(/^名前 ▼/)).toBeVisible();
  expect(await idsInTable()).toEqual([...byName].reverse());
  await head(/^問題数/).click();
  await expect(head(/^問題数 ▼/)).toBeVisible();
  expect((await idsInTable())[0]).toBe("y220020"); // 1 つ目のテストで 10 問打った
  await head(/^学籍番号/).click();
  expect(await idsInTable()).toEqual(["sample", "y220020", "y230018", "y230028", "y230049"]);

  // 検索
  await page.getByLabel("学生を検索").fill("y2300");
  expect(await idsInTable()).toEqual(["y230018", "y230028", "y230049"]);
  await page.getByLabel("学生を検索").fill("佐藤");
  expect(await idsInTable()).toEqual(["y230028"]);
  await expect(page.getByText("1 人（全 5 人中）")).toBeVisible();
  await page.getByLabel("学生を検索").fill("");

  // 追加した学生で、すぐログインできる
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto("/");
  await sp.getByPlaceholder("例: y220020").fill("y230018");
  await sp.getByRole("button", { name: "はじめる" }).click();
  await expect(sp.getByText("山田 太郎（y230018）")).toBeVisible();
  await ctx.close();

  // 名前の変更
  page.once("dialog", (d) => d.accept("山田 一郎"));
  await page
    .getByRole("row", { name: /y230018/ })
    .getByRole("button", { name: "名前を変更" })
    .click();
  await expect(page.getByText("y230018 の名前を「山田 一郎」に変えました")).toBeVisible();
  await expect(page.getByRole("row", { name: /y230018/ }).getByText("山田 一郎")).toBeVisible();

  // 削除: 記録のない学生は削除できる。記録のある学生には削除ボタンが出ない
  await expect(page.getByRole("row", { name: /y220020/ }).getByRole("button", { name: "削除" })).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("row", { name: /y230049/ })
    .getByRole("button", { name: "削除" })
    .click();
  await expect(page.getByText("鈴木（y230049）を削除しました")).toBeVisible();
  expect(await idsInTable()).not.toContain("y230049");
  // 表は枠の幅に収まる（横にスクロールしないと見えない列がない）
  const fits = await page.locator(".table-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
  await shot(page, "09-teacher-students-manage");
});

test("教員はレベルを追加・編集・削除でき、学生の一覧に反映される。記録のあるレベルも削除でき、記録は残る", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("t001");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "ステージ・レベルの管理" }).click();
  await expect(page.getByRole("heading", { name: "ステージ・レベルの管理" })).toBeVisible();

  // ボタンは「削除」だけ（「非表示」「表示に戻す」は出さない）。記録のある「人差し指の練習」も「レベルを削除」
  const used = page.getByLabel("レベル 人差し指の練習");
  await expect(used.getByRole("button", { name: "レベルを削除" })).toBeVisible();
  await expect(page.getByRole("button", { name: /非表示|表示に戻す/ })).toHaveCount(0);
  await expect(page.getByText(/記録 \d+ 件/)).toHaveCount(0);
  await expect(page.getByText(/削除できません/)).toHaveCount(0);
  const stage1Box = page.getByLabel("ステージ ホームポジション基礎");
  await expect(stage1Box.getByRole("button", { name: "ステージを削除" })).toBeVisible();
  await expect(stage1Box.getByText("ステージ", { exact: true })).toBeVisible();
  await expect(used.getByText("レベル", { exact: true })).toBeVisible();

  // 保存: 変更がないときは押せない。変更すると押せ、結果は行のすぐ横に出る
  const mid = page.getByLabel("レベル 中指の練習");
  await expect(mid.getByRole("button", { name: "保存" })).toBeDisabled();
  await mid.getByLabel("レベルの説明").fill("D と K を中心に（変更）");
  await expect(mid.getByText("変更があります")).toBeVisible();
  await mid.getByRole("button", { name: "保存" }).click();
  const saved = page.getByLabel("レベル 中指の練習");
  await expect(saved.getByText("保存しました")).toBeVisible();
  await expect(saved.getByLabel("レベルの説明")).toHaveValue("D と K を中心に（変更）");
  await expect(saved.getByRole("button", { name: "保存" })).toBeDisabled();

  // ステージ 1 にレベルを追加
  const stage1 = page.locator(".manage-stage").first();
  await stage1.getByLabel("新しいレベル名").fill("薬指の練習");
  await stage1.getByLabel("新しいレベルの AI への指示文").fill("薬指の練習用の短い入力を10個生成してください。");
  await stage1.getByRole("button", { name: "レベルを追加" }).click();
  await expect(page.getByText("レベル「薬指の練習」を追加しました")).toBeVisible();
  await shot(page, "08-teacher-manage");

  // 学生の画面に出る
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto("/");
  await sp.getByPlaceholder("例: y220020").fill("sample");
  await sp.getByRole("button", { name: "はじめる" }).click();
  await expect(sp.getByRole("button", { name: "薬指の練習" })).toBeVisible();
  await ctx.close();

  // 記録のあるレベルを削除すると、管理と学生の画面から消える。記録は残る（データベースの行も残る）
  page.once("dialog", (d) => {
    expect(d.message()).toContain("練習の記録は残ります");
    void d.accept();
  });
  await page.getByLabel("レベル 人差し指の練習").getByRole("button", { name: "レベルを削除" }).click();
  await expect(page.getByText("レベル「人差し指の練習」を削除しました")).toBeVisible();
  await expect(page.getByLabel("レベル 人差し指の練習")).toHaveCount(0);

  // ステージを削除すると、中のレベルごと消える
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("ステージ 英単語・短文").getByRole("button", { name: "ステージを削除" }).click();
  await expect(page.getByText("ステージ「英単語・短文」を削除しました")).toBeVisible();
  await expect(page.getByLabel("ステージ 英単語・短文")).toHaveCount(0);
  await expect(page.getByLabel("レベル 英単語 10")).toHaveCount(0);

  const ctx2 = await browser.newContext();
  const sp2 = await ctx2.newPage();
  await sp2.goto("/");
  await sp2.getByPlaceholder("例: y220020").fill("sample");
  await sp2.getByRole("button", { name: "はじめる" }).click();
  await expect(sp2.getByRole("button", { name: "中指の練習" })).toBeVisible();
  await expect(sp2.getByRole("button", { name: "人差し指の練習" })).toHaveCount(0);
  await expect(sp2.getByRole("heading", { name: "英単語・短文" })).toHaveCount(0);
  await ctx2.close();

  // 記録のない追加レベルは削除できる
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("レベル 薬指の練習").getByRole("button", { name: "レベルを削除" }).click();
  await expect(page.getByText("レベル「薬指の練習」を削除しました")).toBeVisible();
  await expect(page.getByLabel("レベル 薬指の練習")).toHaveCount(0);
});

test("スマートフォンの幅（390px）でも、主な画面が横にはみ出さない", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  // 画面全体が横にスクロールしない（はみ出す要素がない）
  const noOverflow = async (name: string) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${name} が横に ${over}px はみ出しています`).toBeLessThanOrEqual(0);
    await shot(page, `m-${name}`);
  };
  await page.goto("/");
  await expect(page.getByPlaceholder("例: y220020")).toBeVisible();
  await noOverflow("login");
  await page.getByPlaceholder("例: y220020").fill("y220020");
  await page.getByRole("button", { name: "はじめる" }).click();
  // 狭い画面ではヘッダーの名前を隠すので、トップのあいさつで確かめる
  await expect(page.getByText("こんにちは、高木勇輔 さん")).toBeVisible();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await noOverflow("top");
  await page.getByRole("button", { name: "中指の練習" }).click();
  await expect(page.getByText("1 / 10 問")).toBeVisible();
  await noOverflow("play");
  await page.getByRole("button", { name: "やめる（ここまでの記録は保存済み）" }).click();
  await page.getByRole("button", { name: "これまでの記録を見る" }).click();
  await expect(page.getByRole("heading", { name: "これまでの記録" })).toBeVisible();
  await noOverflow("analysis");
  await ctx.close();

  // 教員の画面
  const t = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await t.goto("/");
  await t.getByPlaceholder("例: y220020").fill("t001");
  await t.getByRole("button", { name: "はじめる" }).click();
  await expect(t.getByRole("heading", { name: "学生一覧" })).toBeVisible();
  const over = await t.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `教員の学生一覧が横に ${over}px はみ出しています`).toBeLessThanOrEqual(0);
  if (process.env.SHOTS_DIR) await t.screenshot({ path: `${process.env.SHOTS_DIR}/m-teacher.png`, fullPage: true });
  await t.getByRole("button", { name: "ステージ・レベルの管理" }).click();
  await expect(t.getByRole("heading", { name: "ステージ・レベルの管理" })).toBeVisible();
  const over2 = await t.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over2, `ステージ・レベルの管理が横に ${over2}px はみ出しています`).toBeLessThanOrEqual(0);
  if (process.env.SHOTS_DIR) await t.screenshot({ path: `${process.env.SHOTS_DIR}/m-manage.png`, fullPage: true });
});

test("Enter を連打しても 1 問 1 行。端末の時計が 10 分進んでいても記録できる", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // 端末の時計を 10 分進める
  await page.addInitScript(() => {
    const shift = 10 * 60 * 1000;
    const RealDate = Date;
    const realNow = RealDate.now.bind(RealDate);
    // @ts-expect-error 上書き
    globalThis.Date = class extends RealDate {
      constructor(...args: unknown[]) {
        // @ts-expect-error 可変長
        super(...(args.length ? args : [realNow() + shift]));
      }
      static now() {
        return realNow() + shift;
      }
    };
  });
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "中指の練習" }).click();
  const input = page.getByLabel("入力");
  await expect(page.getByText("1 / 10 問")).toBeVisible();
  const target = (await page.getByLabel("出題").getAttribute("data-text")) ?? "";
  await input.pressSequentially(target);
  // 保存の応答を 500ms 遅らせ、その間に Enter を何度も押す（保存中の Enter は無視されるはず）
  let posts = 0;
  await page.route("**/api/logs", async (route) => {
    posts++;
    await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await input.press("Enter");
  await input.press("Enter");
  await input.press("Enter");
  await expect(page.getByText("2 / 10 問")).toBeVisible();
  await expect(page.locator(".error")).toHaveCount(0);
  expect(posts).toBe(1);
  await ctx.close();

  const db = new Database("/tmp/typing-e2e.db", { readonly: true });
  const rows = db.prepare("SELECT question_num, start_time FROM logs WHERE user_id = 'sample'").all() as {
    question_num: number;
    start_time: string;
  }[];
  db.close();
  expect(rows.map((r) => r.question_num)).toEqual([1]);
  // 補正後の時刻はサーバーの時刻に近い（10 分ずれていない）
  expect(Math.abs(Date.parse(rows[0].start_time) - Date.now())).toBeLessThan(60_000);
});

// 苦手克服トレーニングで、問題が届くまで時間がかかっても（研究室の Qwen では 15 秒ほど）記録できる。
// 以前は往復の真ん中でサーバーが時刻を付けたとみなしていたため、端末の時計を待ち時間の半分だけ進めてしまい、
// 「endTime（未来の時刻）」で保存できなかった（2026-10-23 試作品）。ここでは返事を 12 秒遅らせて確かめる
test("苦手克服トレーニング: 問題が届くまで 12 秒かかっても、1 問目を保存して次へ進める", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/training/next", async (route) => {
    // LLM の待ち時間の代わりに、サーバーに届くのを 12 秒遅らせる（サーバーは待ったあと、返す直前に時刻を付ける）
    await new Promise((r) => setTimeout(r, 12_000));
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "トレーニングを始める" }).click();
  // 待っている間は、練習画面と同じ形のスケルトンと、実際の処理の手順を出す（「…しています」の 1 行だけにしない）
  const skeleton = page.getByRole("status", { name: "問題を準備しています" });
  await expect(skeleton).toBeVisible();
  await expect(skeleton.getByText("練習の記録を集計しています")).toBeVisible();
  await expect(skeleton.locator("li.now")).toHaveText("苦手に合わせた問題を作っています", { timeout: 8_000 });
  await expect(page.getByText("1 / 10 問")).toBeVisible({ timeout: 30_000 });
  await expect(skeleton).toHaveCount(0);
  const target = (await page.getByLabel("出題").getAttribute("data-text")) ?? "";
  await page.getByLabel("入力").pressSequentially(target, { delay: 5 });
  await page.getByLabel("入力").press("Enter");
  await expect(page.getByText("2 / 10 問")).toBeVisible();
  await expect(page.getByText(/保存できませんでした/)).toHaveCount(0);
});

// 空白は「␣」で表示し、打つのは半角スペース（判定・記録は元の文字のまま）。
// 固定問題には空白がないので、プレイ開始の返事の 1 問目を空白入りに差し替えて、表示と、入力・記録の文字を確かめる
test("出題の空白は ␣ で表示され、半角スペースを打つと正解の色になり、記録には半角スペースが入る", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.questions[0] = "ab cd";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();
  // 前のテストで「英単語・短文」のステージを削除しているので、残っている「中指の練習」を使う
  await page.getByRole("button", { name: "中指の練習" }).click();
  const target = page.getByLabel("出題");
  await expect(target).toHaveText("ab␣cd");
  await expect(target).toHaveAttribute("data-text", "ab cd");
  const saved = page.waitForRequest((r) => r.url().endsWith("/api/logs"));
  await page.getByLabel("入力").pressSequentially("ab cd", { delay: 5 });
  // 空白の位置も正解（ok）の色
  await expect(target.locator("span.space")).toHaveClass(/ok/);
  await page.getByLabel("入力").press("Enter");
  expect((await saved).postDataJSON().typed).toBe("ab cd");
});

// キーボードの設定（データベース仕様書 ④⑤）: 追加・割り当ての編集・練習で選べる・削除
test("学生はキーボードを追加し、キーと指の割り当てを変え、練習で選び、削除できる", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "キーボードの設定" }).click();
  await expect(page.getByRole("heading", { name: "キーボードの設定" })).toBeVisible();

  // US 配列の標準の割り当て・US 配列の並びで追加
  await page.getByPlaceholder("例: 学校の JIS キーボード").fill("自宅の US 配列");
  await page.getByLabel("キーの登録のしかた").selectOption("template:us");
  await page.getByLabel("追加するキーボードのキーの並び").selectOption("us");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText("キーボード「自宅の US 配列」を追加しました。")).toBeVisible();
  const box = page.getByLabel("キーボード 自宅の US 配列");

  // 割り当てを変える: カードを押して指のボタンで選ぶ。Y を右中指に、Fn を追加して左親指に
  await box.getByRole("button", { name: "割り当てを編集" }).click();
  await box.getByRole("button", { name: /^Y：/ }).click();
  const yPanel = box.getByRole("group", { name: "Y の指" });
  await yPanel.getByRole("button", { name: "右中指" }).click(); // 右人差し指 ＋ 右中指
  await yPanel.getByRole("button", { name: "右人差し指" }).click(); // 右中指だけ
  await box.getByLabel("追加するキー").fill("Fn");
  await box.getByRole("button", { name: "キーを追加" }).click();
  await box.getByRole("button", { name: /^Fn：/ }).click();
  const fnPanel = box.getByRole("group", { name: "Fn の指" });
  await fnPanel.getByRole("button", { name: "左親指" }).click();
  await fnPanel.getByRole("button", { name: "左人差し指" }).click();
  await box.getByRole("button", { name: "割り当てを保存" }).click();
  await expect(page.getByText("「自宅の US 配列」の割り当てを保存しました。")).toBeVisible();
  // 保存したあとも開いたまま。サーバーから読み直した値が出ている
  await expect(page.getByLabel("キーボード 自宅の US 配列").getByRole("button", { name: /^Y：R3（右中指）/ })).toBeVisible();
  await expect(page.getByLabel("キーボード 自宅の US 配列").getByRole("button", { name: /^Fn：L1（左親指）/ })).toBeVisible();

  // 練習の設定で選べ、練習中のキーボードが US 配列の形になる（` のキーがある）。指は設定どおり（Y は右中指）
  await page.getByRole("button", { name: "レベル選択に戻る" }).first().click();
  await expect(page.getByLabel("使うキーボード").locator("option", { hasText: "自宅の US 配列" })).toHaveCount(1);
  await page.getByLabel("使うキーボード").selectOption({ label: "自宅の US 配列" });
  await page.route("**/api/sessions", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.questions[0] = "yes";
    await route.fulfill({ response: res, json: body });
  });
  await page.getByRole("button", { name: "中指の練習" }).click();
  await expect(page.locator(".osk-board")).toHaveAttribute("data-layout", "us");
  await expect(page.locator(".osk-key", { hasText: "`" })).toHaveCount(1);
  await expect(page.getByRole("figure", { name: "次に打つキー" }).getByText("次は「y」：右中指（R3）")).toBeVisible();
  await page.unroute("**/api/sessions");
  await page.getByRole("button", { name: "やめる（ここまでの記録は保存済み）" }).click();

  // 削除すると選べなくなる
  await page.getByRole("button", { name: "キーボードの設定" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("キーボード 自宅の US 配列").getByRole("button", { name: "削除" }).click();
  await expect(page.getByText("キーボード「自宅の US 配列」を削除しました")).toBeVisible();
  await page.getByRole("button", { name: "レベル選択に戻る" }).first().click();
  await expect(page.getByLabel("使うキーボード").locator("option", { hasText: "自宅の US 配列" })).toHaveCount(0);
});

// 練習画面: 画面のキーボード（次のキーと指）と、打っている最中の成績
test("練習画面に、次に打つキーと担当の指、打っている最中の成績が出る", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.questions[0] = "fj";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("y220020");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "中指の練習" }).click();
  const osk = page.getByRole("figure", { name: "次に打つキー" });
  // y220020 のキーボード（Keyball44）では F は L2
  await expect(osk.getByText("次は「f」：左人差し指（L2）")).toBeVisible();
  await page.getByLabel("入力").pressSequentially("f");
  await expect(osk.getByText("次は「j」：右人差し指（R2）")).toBeVisible();
  await expect(page.getByLabel("ここまでの成績").getByText("正確率")).toBeVisible();
  await expect(page.getByLabel("ここまでの成績")).toContainText("100.0%");
});

// 合格の目安・次のレベル・間違えた問題だけもう一度・課題
test("教員が合格の目安と課題を設定し、学生は課題を見て練習し、合格・次のレベル・間違えた問題の再挑戦ができる", async ({ page, browser }) => {
  // 教員: 「中指の練習」に合格の目安 90%、課題を出す
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("t001");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "ステージ・レベルの管理" }).click();
  const mid = page.getByLabel("レベル 中指の練習");
  await mid.getByLabel("合格の目安（正確率 %）").fill("90");
  await mid.getByRole("button", { name: "保存" }).click();
  await expect(page.getByLabel("レベル 中指の練習").getByText("保存しました")).toBeVisible();
  await page.getByRole("button", { name: "課題", exact: true }).click();
  await page.getByLabel("課題名").fill("中指を 1 回合格");
  await page.getByLabel("課題のレベル").selectOption({ label: "ホームポジション基礎 / 中指の練習（合格の目安 90%）" });
  await page.getByLabel("締め切り（この日の終わりまで）").fill("2099-12-31");
  await page.getByRole("button", { name: "課題を出す" }).click();
  await expect(page.getByText("課題「中指を 1 回合格」を出しました")).toBeVisible();

  // 学生: 課題と合格の目安が見える。1 問だけ間違えて 10 問（正確率 90% 以上で合格）
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto("/");
  await sp.getByPlaceholder("例: y220020").fill("sample");
  await sp.getByRole("button", { name: "はじめる" }).click();
  const task = sp.getByLabel("課題").getByRole("listitem").filter({ hasText: "中指を 1 回合格" });
  await expect(task).toContainText("0 / 1 回");
  await expect(sp.getByRole("button", { name: "中指の練習" })).toContainText("合格の目安 正確率 90%");
  await task.getByRole("button", { name: "練習する" }).click();
  for (let i = 1; i <= 10; i++) {
    await expect(sp.getByText(`${i} / 10 問`)).toBeVisible();
    const target = (await sp.getByLabel("出題").getAttribute("data-text")) ?? "";
    // 1 問目だけ、最後の文字を間違える
    await sp.getByLabel("入力").pressSequentially(i === 1 ? target.slice(0, -1) + "#" : target, { delay: 3 });
    await sp.getByLabel("入力").press("Enter");
  }
  await expect(sp.getByText("合格です")).toBeVisible();
  // 間違えた 1 問だけもう一度
  await sp.getByRole("button", { name: "間違えた問題だけもう一度（1 問）" }).click();
  await expect(sp.getByText("1 / 1 問")).toBeVisible();
  const again = (await sp.getByLabel("出題").getAttribute("data-text")) ?? "";
  await sp.getByLabel("入力").pressSequentially(again, { delay: 3 });
  await sp.getByLabel("入力").press("Enter");
  await expect(sp.getByRole("heading", { name: "結果：中指の練習" })).toBeVisible();
  await sp.getByRole("button", { name: "レベル選択に戻る" }).click();
  // 課題は達成、レベルは合格済み
  await expect(sp.getByLabel("課題").getByRole("listitem").filter({ hasText: "中指を 1 回合格" })).toContainText("達成");
  await expect(sp.getByRole("button", { name: "中指の練習" })).toContainText("合格済み");
  await ctx.close();

  // 教員: 達成状況に出る
  await page.reload();
  await page.getByRole("button", { name: "課題", exact: true }).click();
  const row = page.getByLabel("課題 中指を 1 回合格");
  await expect(row).toContainText("達成 1 /");
  await row.getByRole("button", { name: "達成状況・編集" }).click();
  await expect(row.getByRole("row").filter({ hasText: "sample" })).toContainText("達成");
});

// 通常のレベルでも、問題が届くまで時間がかかる（AI につないだとき）と、以前は「未来の時刻」で保存できなかった（2026-10-23 試作品）
test("通常のレベル: 問題が届くまで 12 秒かかっても、1 問目を保存して次へ進める", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/sessions", async (route) => {
    await new Promise((r) => setTimeout(r, 12_000)); // サーバーに届くのを遅らせる（サーバーは待ったあと、返す直前に時刻を付ける）
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "中指の練習" }).click();
  await expect(page.getByText("1 / 10 問")).toBeVisible({ timeout: 30_000 });
  const target = (await page.getByLabel("出題").getAttribute("data-text")) ?? "";
  await page.getByLabel("入力").pressSequentially(target, { delay: 5 });
  await page.getByLabel("入力").press("Enter");
  await expect(page.getByText("2 / 10 問")).toBeVisible();
  await expect(page.getByText(/保存できませんでした/)).toHaveCount(0);
});

// ライト / ダークの切り替え: 右上のボタンで切り替わり、再読み込みしても保たれる。選んでいなければ端末の設定に合わせる
test("テーマの切り替え（ライト / ダーク）が保存され、再読み込み後も保たれる", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", /.+/); // まだ選んでいない（端末の設定）
  await page.getByRole("button", { name: "ダークモードにする" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  // 背景の色が暗くなる
  // 色はアニメーションで切り替わるので、変わり終わるまで待つ
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(10, 16, 40)");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "ライトモードにする" })).toBeVisible();
  // ログインした後の画面にも同じテーマ
  await page.getByPlaceholder("例: y220020").fill("sample");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.getByRole("button", { name: "トレーニングを始める" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "ライトモードにする" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await ctx.close();

  // 端末がダークの設定なら、選んでいなくてもダークの色
  const ctx2 = await browser.newContext({ colorScheme: "dark" });
  const p2 = await ctx2.newPage();
  await p2.goto("/");
  await expect.poll(() => p2.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(10, 16, 40)");
  await ctx2.close();
});

// 日本語の問題でも、画面のキーボードと次のかなのローマ字を案内する。多く打った文字は知らせる
test("日本語の問題: 次のかなのローマ字と最初のキーを案内し、出題より多く打つと知らせる", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.questions[0] = "コンピュータ";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await page.getByPlaceholder("例: y220020").fill("y220020");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "中指の練習" }).click();
  const osk = page.getByRole("figure", { name: "次に打つキー" });
  await expect(osk).toContainText("次は「コ」＝ ko");
  await expect(osk).toContainText("最初の「k」：右中指・R3"); // y220020 の Keyball44 では K は R3
  await page.getByLabel("入力").fill("コン");
  await expect(osk).toContainText("次は「ピュ」＝ pyu");
  await page.getByLabel("入力").fill("コンピューター");
  await expect(page.getByRole("status").filter({ hasText: "出題より 1 文字多く打っています（「ー」）" })).toBeVisible();
});
