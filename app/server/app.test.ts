import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { openDb, type DB } from "./db";
import { initDb } from "./initDb";
import { pickQuestions } from "./questions";

let dir: string;
let db: DB;
let app: ReturnType<typeof createApp>;
// テストの時計。プレイ開始は 01:00:00、記録の保存時は 01:01:00 になるよう startSession で進める
let clock = Date.parse("2026-10-16T01:00:00.000Z");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-test-"));
  const file = path.join(dir, "test.db");
  initDb(file);
  db = openDb(file);
  clock = Date.parse("2026-10-16T01:00:00.000Z");
  app = createApp(db, { teachers: TEACHERS, ai: null, now: () => clock, auth: { mode: "local" } });
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const TEACHERS = { ids: ["t001"] };

async function loginAs(id: string): Promise<string> {
  const res = await request(app).post("/api/login").send({ id });
  expect(res.status).toBe(200);
  return res.body.token;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function startSession(token: string, levelId = 1, keyboardId: number | null = 1) {
  clock = Date.parse("2026-10-16T01:00:00.000Z");
  const res = await request(app).post("/api/sessions").set(auth(token)).send({ levelId, keyboardId });
  expect(res.status).toBe(200);
  clock = Date.parse("2026-10-16T01:01:00.000Z");
  return res.body as { sessionId: string; questions: string[] };
}

const logBody = (sessionId: string, over: Record<string, unknown> = {}) => ({
  sessionId,
  questionNum: 1,
  typed: "jkjj",
  startTime: "2026-10-16T01:00:00.000Z",
  endTime: "2026-10-16T01:00:04.000Z",
  ...over,
});
const logCount = () => (db.prepare("SELECT count(*) c FROM logs").get() as { c: number }).c;

describe("開発用 DB", () => {
  it("初期データが タイピング.db と同じ件数で、logs は空", () => {
    const count = (t: string) => (db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
    expect([count("users"), count("stages"), count("levels"), count("keyboards"), count("keys"), count("logs")]).toEqual([2, 2, 3, 2, 92, 0]);
  });
  it("外部キーが有効", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("POST /api/login", () => {
  it("登録済みの学籍番号でログインでき、トークンを返す", async () => {
    const res = await request(app).post("/api/login").send({ id: "y220020" });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: "y220020", name: "高木勇輔", role: "student" });
    expect(res.body.token).toMatch(/^[0-9a-f]{48}$/);
  });
  it("前後の空白は無視する", async () => {
    expect((await request(app).post("/api/login").send({ id: " y220020 " })).status).toBe(200);
  });
  it("未登録は 404", async () => {
    expect((await request(app).post("/api/login").send({ id: "nobody" })).status).toBe(404);
  });
  it("教員は ID だけで teacher でログインできる（合言葉なし。2026-11-13）", async () => {
    const res = await request(app).post("/api/login").send({ id: "t001" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("teacher");
    expect((await request(app).post("/api/login").send({ id: "y220020" })).body.user.role).toBe("student");
  });
  it("教員も学生の画面で練習でき、記録は教員の ID で残る。学生一覧・課題・クラス全体の苦手には入らない", async () => {
    const t = auth(await loginAs("t001"));
    expect((await request(app).get("/api/stages").set(t)).status).toBe(200);
    const s = (await request(app).post("/api/sessions").set(t).send({ levelId: 1 })).body;
    expect(s.questions).toHaveLength(10);
    const saved = await request(app)
      .post("/api/logs")
      .set(t)
      .send(logBody(s.sessionId, { typed: "x" }));
    expect(saved.status).toBe(201);
    expect(db.prepare("SELECT user_id FROM logs").get()).toEqual({ user_id: "t001" });
    expect((await request(app).get(`/api/sessions/${s.sessionId}/result`).set(t)).status).toBe(200);
    expect((await request(app).get("/api/me/analysis").set(t)).body.sessions).toHaveLength(1);
    // 教員の画面の集計には出ない
    const students = (await request(app).get("/api/teacher/students").set(t)).body as { id: string }[];
    expect(students.map((u) => u.id)).not.toContain("t001");
    expect((await request(app).get("/api/teacher/class-weakness").set(t)).body.students).toBe(0);
    // 学生は教員の API を使えない（これまでどおり）
    expect(
      (
        await request(app)
          .get("/api/teacher/students")
          .set(auth(await loginAs("y220020")))
      ).status,
    ).toBe(403);
  });
  it("ログアウトするとトークンは使えなくなる", async () => {
    const token = await loginAs("y220020");
    expect((await request(app).get("/api/me").set(auth(token))).status).toBe(200);
    expect((await request(app).post("/api/logout").set(auth(token))).status).toBe(204);
    expect((await request(app).get("/api/me").set(auth(token))).status).toBe(401);
  });
});

describe("GET /api/stages", () => {
  it("sort_order 順にステージとレベルを返す", async () => {
    const res = await request(app).get("/api/stages");
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(["ホームポジション基礎", "英単語・短文"]);
    expect(res.body[0].levels.map((l: { title: string }) => l.title)).toEqual(["人差し指の練習", "中指の練習"]);
    expect(res.body[1].levels.map((l: { title: string }) => l.title)).toEqual(["英単語 10"]);
  });
  it("sort_order を変えると並びが変わる（id には依存しない）", async () => {
    db.prepare("UPDATE stages SET sort_order = 0 WHERE id = 2").run();
    const res = await request(app).get("/api/stages");
    expect(res.body[0].title).toBe("英単語・短文");
  });
});

describe("GET /api/me/keyboards", () => {
  it("自分の is_active = 1 のキーボードだけ返す", async () => {
    const token = await loginAs("y220020");
    expect((await request(app).get("/api/me/keyboards").set(auth(token))).body).toEqual([{ id: 1, name: "Keyball44", layout: "keyball44" }]);
    db.prepare("UPDATE keyboards SET is_active = 0 WHERE id = 1").run();
    // 有効なキーボードがなくなったら、標準のキーボードを作る（削除したキーボードは返さない）
    const after = (await request(app).get("/api/me/keyboards").set(auth(token))).body as { id: number; name: string }[];
    expect(after.map((k) => k.name)).toEqual(["標準のキーボード（JIS 配列）"]);
    expect(after[0].id).not.toBe(1);
  });
  it("ログインしていなければ 401", async () => {
    expect((await request(app).get("/api/me/keyboards")).status).toBe(401);
  });
});

describe("学生: キーボードの設定（追加・名前の変更・割り当て・削除）", () => {
  const settings = async (h: Record<string, string>) => (await request(app).get("/api/me/keyboard-settings").set(h)).body;
  it("標準の割り当て（Keyball44）で追加し、一覧と練習の選択に出る", async () => {
    const h = auth(await loginAs("sample"));
    const res = await request(app).post("/api/me/keyboards").set(h).send({ name: "自宅の US 配列" });
    expect(res.status).toBe(201);
    const s = await settings(h);
    const added = s.keyboards.find((k: { id: number }) => k.id === res.body.id);
    expect(added).toMatchObject({ name: "自宅の US 配列", used: false });
    expect(added.keys).toHaveLength(s.defaultKeys.length);
    expect((await request(app).get("/api/me/keyboards").set(h)).body.map((k: { name: string }) => k.name)).toContain("自宅の US 配列");
  });
  it("キーボードが 1 台もない人（教員・全部削除した学生）には、標準のキーボード（JIS 配列）を最初から用意する", async () => {
    const t = auth(await loginAs("t001"));
    const list = (await request(app).get("/api/me/keyboards").set(t)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "標準のキーボード（JIS 配列）", layout: "jis" });
    const keys = (await settings(t)).keyboards[0].keys as { char: string; finger: string }[];
    expect(keys.find((k) => k.char === "F")?.finger).toBe("L2");
    // 2 回目以降は増やさない
    expect((await request(app).get("/api/me/keyboards").set(t)).body).toHaveLength(1);
    // 学生が全部削除したら、次に開いたとき標準のキーボードができる
    const h = auth(await loginAs("sample"));
    for (const k of (await request(app).get("/api/me/keyboards").set(h)).body) await request(app).delete(`/api/me/keyboards/${k.id}`).set(h);
    expect((await settings(h)).keyboards.map((k: { name: string }) => k.name)).toEqual(["標準のキーボード（JIS 配列）"]);
  });
  it("ひな形（JIS・US・空）と自由な配列で追加でき、キーの少ないキーボードや同時押しも登録できる（2026-11-13）", async () => {
    const h = auth(await loginAs("sample"));
    const add = async (b: object) => (await request(app).post("/api/me/keyboards").set(h).send(b)).body.id as number;
    const keysOf = async (id: number) => (await settings(h)).keyboards.find((k: { id: number }) => k.id === id);
    const jis = await keysOf(await add({ name: "学校の JIS", layout: "jis" }));
    expect(jis.layout).toBe("jis");
    expect(jis.keys.find((k: { char: string }) => k.char === "F").finger).toBe("L2");
    expect(jis.keys.find((k: { char: string }) => k.char === "@")).toBeTruthy(); // JIS にだけあるキー
    const us = await keysOf(await add({ name: "自宅の US", layout: "us" }));
    expect(us.keys.find((k: { char: string }) => k.char === "'")).toBeTruthy();
    expect(us.keys.find((k: { char: string }) => k.char === "@")).toBeUndefined();
    // 自由な配列は空から始め、キーの少ないキーボード（例: 左手用のパッド）を登録する。同時押しは L5+L2
    const freeId = await add({ name: "左手デバイス", layout: "free" });
    expect((await keysOf(freeId)).keys).toEqual([]);
    const keys = [
      { char: "A", finger: "L5" },
      { char: "S", finger: "L4" },
      { char: "Ctrl+C", finger: "L5+L2" },
      { char: "Fn", finger: "L1" },
    ];
    expect((await request(app).patch(`/api/me/keyboards/${freeId}`).set(h).send({ keys })).status).toBe(204);
    expect((await keysOf(freeId)).keys).toEqual(keys);
    // 練習の画面には layout と keys が届く
    const s = (await request(app).post("/api/sessions").set(h).send({ levelId: 1, keyboardId: freeId })).body;
    expect(s.layout).toBe("free");
    expect(s.keys).toHaveLength(4);
    // 不正なひな形・並びは断る
    expect((await request(app).post("/api/me/keyboards").set(h).send({ name: "x", template: "dvorak" })).status).toBe(400);
    expect((await request(app).post("/api/me/keyboards").set(h).send({ name: "x", layout: "dvorak" })).status).toBe(400);
  });
  it("自分のキーボードを写して追加できる。他人のキーボードは写せない", async () => {
    const h = auth(await loginAs("y220020"));
    db.prepare("UPDATE keys SET finger = 'R3' WHERE keyboard_id = 1 AND char = 'J'").run();
    const res = await request(app).post("/api/me/keyboards").set(h).send({ name: "写し", copyFrom: 1 });
    expect(res.status).toBe(201);
    const keys = (await settings(h)).keyboards.find((k: { id: number }) => k.id === res.body.id).keys;
    expect(keys.find((k: { char: string }) => k.char === "J").finger).toBe("R3");
    const other = await request(app).post("/api/me/keyboards").set(h).send({ name: "x", copyFrom: 2 });
    expect(other.status).toBe(400);
    expect(other.body.error).toContain("写し元のキーボードが見つかりません"); // 削除した・別の人のキーボードを写そうとしたとき
  });
  it("名前と割り当てを変えられる。指の形（L1〜R5、+ で同時押し）と重複を確かめる", async () => {
    const h = auth(await loginAs("y220020"));
    const id = (await request(app).post("/api/me/keyboards").set(h).send({ name: "学校の JIS" })).body.id;
    const keys = [
      { char: "J", finger: "r2" },
      { char: "Ctrl+C", finger: "L5+L3" },
    ];
    expect((await request(app).patch(`/api/me/keyboards/${id}`).set(h).send({ name: "学校の JIS 配列", keys })).status).toBe(204);
    const kb = (await settings(h)).keyboards.find((k: { id: number }) => k.id === id);
    expect(kb).toMatchObject({
      name: "学校の JIS 配列",
      keys: [
        { char: "J", finger: "R2" },
        { char: "Ctrl+C", finger: "L5+L3" },
      ],
    });
    for (const bad of [
      [{ char: "J", finger: "R6" }],
      [
        { char: "J", finger: "R2" },
        { char: "J", finger: "R3" },
      ],
      [],
      [{ char: "", finger: "L1" }],
    ])
      expect((await request(app).patch(`/api/me/keyboards/${id}`).set(h).send({ keys: bad })).status).toBe(400);
    expect((await request(app).patch(`/api/me/keyboards/${id}`).set(h).send({ name: " " })).status).toBe(400);
  });
  it("練習の記録があるキーボードは、割り当てを変えられない（409）が、名前の変更と削除はできる。削除しても記録と指の分析は残る", async () => {
    const token = await loginAs("y220020");
    const h = auth(token);
    const s = await startSession(token, 1, 1);
    expect((await request(app).post("/api/logs").set(h).send(logBody(s.sessionId))).status).toBe(201);
    const before = (await request(app).get("/api/me/analysis").set(h)).body.fingers;
    expect((await settings(h)).keyboards[0].used).toBe(true);
    expect(
      (
        await request(app)
          .patch("/api/me/keyboards/1")
          .set(h)
          .send({ keys: [{ char: "J", finger: "L1" }] })
      ).status,
    ).toBe(409);
    expect((await request(app).patch("/api/me/keyboards/1").set(h).send({ name: "研究室の Keyball44" })).status).toBe(204);
    expect((await request(app).delete("/api/me/keyboards/1").set(h)).status).toBe(204);
    expect((await request(app).get("/api/me/keyboards").set(h)).body.map((k: { id: number }) => k.id)).not.toContain(1);
    expect((db.prepare("SELECT is_active FROM keyboards WHERE id = 1").get() as { is_active: number }).is_active).toBe(0);
    expect((await request(app).get("/api/me/analysis").set(h)).body.fingers).toEqual(before);
    expect(logCount()).toBe(1);
    // 削除したキーボードでは練習を始められない
    expect((await request(app).post("/api/sessions").set(h).send({ levelId: 1, keyboardId: 1 })).status).toBe(400);
  });
  it("キーの並び（jis・us・keyball44）: 追加で選べ、写すと元の並び、記録があっても変えられ、プレイ開始の返事に付く", async () => {
    const token = await loginAs("y220020");
    const h = auth(token);
    expect((await settings(h)).keyboards[0].layout).toBe("keyball44");
    const us = (await request(app).post("/api/me/keyboards").set(h).send({ name: "US", layout: "us" })).body.id;
    expect((await request(app).post("/api/me/keyboards").set(h).send({ name: "x", layout: "dvorak" })).status).toBe(400);
    const copy = (await request(app).post("/api/me/keyboards").set(h).send({ name: "写し", copyFrom: us })).body.id;
    const kb = async (id: number) => (await settings(h)).keyboards.find((k: { id: number }) => k.id === id);
    expect((await kb(us)).layout).toBe("us");
    expect((await kb(copy)).layout).toBe("us");
    // 記録のあるキーボード（1）でも並びは変えられる（指の分析には使わないため）
    const s = await startSession(token, 1, 1);
    expect((await request(app).post("/api/logs").set(h).send(logBody(s.sessionId))).status).toBe(201);
    expect((await request(app).patch("/api/me/keyboards/1").set(h).send({ layout: "jis" })).status).toBe(204);
    expect((await kb(1)).layout).toBe("jis");
    clock = Date.parse("2026-10-16T01:00:00.000Z");
    const started = (await request(app).post("/api/sessions").set(h).send({ levelId: 1, keyboardId: us })).body;
    expect(started.layout).toBe("us");
    expect(started.keys.length).toBeGreaterThan(0);
  });
  it("他人のキーボードは変更・削除できない（404）。教員も自分のキーボードを使える（2026-11-13 から学生の画面で練習できる）", async () => {
    const h = auth(await loginAs("y220020"));
    expect((await request(app).patch("/api/me/keyboards/2").set(h).send({ name: "x" })).status).toBe(404);
    expect((await request(app).delete("/api/me/keyboards/2").set(h)).status).toBe(404);
    const t = auth(await loginAs("t001"));
    expect((await request(app).get("/api/me/keyboard-settings").set(t)).status).toBe(200);
    expect((await request(app).patch("/api/me/keyboards/2").set(t).send({ name: "x" })).status).toBe(404); // 学生のキーボードは触れない
  });
});

describe("レベルの合格の目安と、課題", () => {
  const T = async () => auth(await loginAs("t001"));
  // 10 問すべて正しく打つ（正確率 100%）。typed を変えると正確率を下げられる
  async function playAll(token: string, levelId: number, wrong = 0) {
    const s = await startSession(token, levelId, 1);
    for (let i = 0; i < 10; i++) {
      const target = s.questions[i];
      const typed = i < wrong ? "#".repeat(Array.from(target).length) : target;
      const t0 = Date.parse("2026-10-16T01:00:00.000Z") + i * 2000;
      const r = await request(app)
        .post("/api/logs")
        .set(auth(token))
        .send(logBody(s.sessionId, { questionNum: i + 1, typed, startTime: new Date(t0).toISOString(), endTime: new Date(t0 + 1000).toISOString() }));
      expect(r.status).toBe(201);
    }
  }
  it("教員が合格の目安を設定・解除でき、学生の一覧に目安と合格したかが出る（目安なしは自由に練習）", async () => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/levels/1").set(h).send({ pass_accuracy: 0.95 })).status).toBe(204);
    expect((await request(app).patch("/api/teacher/levels/1").set(h).send({ pass_accuracy: 1.5 })).status).toBe(400);
    const token = await loginAs("y220020");
    const level = async () => (await request(app).get("/api/stages").set(auth(token))).body[0].levels[0];
    expect(await level()).toMatchObject({ id: 1, pass_accuracy: 0.95, passed: false });
    await playAll(token, 1);
    expect(await level()).toMatchObject({ passed: true });
    // ログインしていなくても一覧は見られる（合格は false）
    expect((await request(app).get("/api/stages")).body[0].levels[0].passed).toBe(false);
    expect((await request(app).patch("/api/teacher/levels/1").set(h).send({ pass_accuracy: null })).status).toBe(204);
    expect(await level()).toMatchObject({ pass_accuracy: null, passed: false });
  });
  it("教員が課題を出し、学生は自分の進み具合を、教員は学生ごとの達成を見られる。編集・削除もできる", async () => {
    const h = await T();
    clock = Date.parse("2026-10-16T00:30:00.000Z"); // 課題を出す時刻（練習の 01:00 より前）
    const body = { title: "人差し指を 2 回", levelId: 1, dueAt: "2026-10-31T14:59:59.999Z", requiredPlays: 2, minAccuracy: 0.9 };
    const created = await request(app).post("/api/teacher/assignments").set(h).send(body);
    expect(created.status).toBe(201);
    const token = await loginAs("y220020");
    const mine = async () => (await request(app).get("/api/me/assignments").set(auth(token))).body;
    expect(await mine()).toMatchObject([{ title: "人差し指を 2 回", levelTitle: "人差し指の練習", done: 0, required: 2, achieved: false }]);
    await playAll(token, 1);
    await playAll(token, 1, 3); // 正確率 70% は数えない
    expect((await mine())[0]).toMatchObject({ done: 1, achieved: false });
    await playAll(token, 1);
    expect((await mine())[0]).toMatchObject({ done: 2, achieved: true });
    const t = (await request(app).get("/api/teacher/assignments").set(h)).body;
    expect(t[0]).toMatchObject({ achievedCount: 1 });
    expect(t[0].students.find((u: { id: string }) => u.id === "y220020")).toMatchObject({ achieved: true });
    expect(t[0].students.find((u: { id: string }) => u.id === "sample")).toMatchObject({ achieved: false, done: 0 });
    // 編集（必要な回数を 5 に）・削除
    expect((await request(app).patch(`/api/teacher/assignments/${created.body.id}`).set(h).send({ requiredPlays: 5 })).status).toBe(204);
    expect((await mine())[0]).toMatchObject({ done: 2, required: 5, achieved: false });
    expect((await request(app).delete(`/api/teacher/assignments/${created.body.id}`).set(h)).status).toBe(204);
    expect(await mine()).toEqual([]);
  });
  it("課題の入力を確かめる。学生は課題を出せない", async () => {
    const h = await T();
    const ok = { title: "x", levelId: 1, dueAt: "2026-10-31T00:00:00.000Z", requiredPlays: 1 };
    for (const over of [{ title: "" }, { levelId: 999 }, { dueAt: "2026-10-31" }, { requiredPlays: 0 }, { minAccuracy: 2 }])
      expect(
        (
          await request(app)
            .post("/api/teacher/assignments")
            .set(h)
            .send({ ...ok, ...over })
        ).status,
      ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/teacher/assignments")
          .set(auth(await loginAs("y220020")))
          .send(ok)
      ).status,
    ).toBe(403);
  });
});

describe("POST /api/sessions", () => {
  it("session_id と 10 問を返し、DB には書かない", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.questions).toHaveLength(10);
    expect(logCount()).toBe(0);
  });
  it("存在しないレベルは 404", async () => {
    const token = await loginAs("y220020");
    expect((await request(app).post("/api/sessions").set(auth(token)).send({ levelId: 999 })).status).toBe(404);
  });
  it("他人のキーボードや無効なキーボードは 400", async () => {
    const token = await loginAs("y220020");
    expect((await request(app).post("/api/sessions").set(auth(token)).send({ levelId: 1, keyboardId: 2 })).status).toBe(400);
    db.prepare("UPDATE keyboards SET is_active = 0 WHERE id = 1").run();
    expect((await request(app).post("/api/sessions").set(auth(token)).send({ levelId: 1, keyboardId: 1 })).status).toBe(400);
  });
  it("ログインなしは 401、教員は練習を始められる", async () => {
    expect((await request(app).post("/api/sessions").send({ levelId: 1 })).status).toBe(401);
    const t = await loginAs("t001");
    expect((await request(app).post("/api/sessions").set(auth(t)).send({ levelId: 1 })).status).toBe(200);
  });
});

describe("POST /api/logs", () => {
  it("1 問分を保存する。出題・レベル・キーボード・ユーザーはサーバーが決めた値になる", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token, 1, 1);
    const res = await request(app)
      .post("/api/logs")
      .set(auth(token))
      // 画面から余計な値を送っても使わない
      .send({ ...logBody(s.sessionId), userId: "sample", target: "zzzz", levelId: 3, keyboardId: 2 });
    expect(res.status).toBe(201);
    expect(
      db.prepare("SELECT session_id, user_id, level_id, keyboard_id, question_num, target, typed, start_time, end_time FROM logs").get(),
    ).toEqual({
      session_id: s.sessionId,
      user_id: "y220020",
      level_id: 1,
      keyboard_id: 1,
      question_num: 1,
      target: s.questions[0],
      typed: "jkjj",
      start_time: "2026-10-16T01:00:00.000Z",
      end_time: "2026-10-16T01:00:04.000Z",
    });
  });
  it("キーボードを指定しなければ NULL で保存", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token, 1, null);
    expect((await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId))).status).toBe(201);
    expect((db.prepare("SELECT keyboard_id FROM logs").get() as { keyboard_id: null }).keyboard_id).toBeNull();
  });
  it("typed は空文字でもよい（何も打たずに Enter）", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(token))
          .send(logBody(s.sessionId, { typed: "" }))
      ).status,
    ).toBe(201);
  });
  it("同じ問題を 2 回送っても 1 行だけ（再送対策）", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    const first = await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId));
    const second = await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ id: first.body.id, duplicate: true });
    expect(logCount()).toBe(1);
  });
  it.each([
    ["日時がミリ秒・UTC 形式でない", { startTime: "2026-10-16T01:00:00" }],
    ["終了が開始より前", { endTime: "2026-10-16T00:59:59.000Z" }],
    ["問題番号が 0", { questionNum: 0 }],
    ["問題番号が出題数より大きい", { questionNum: 11 }],
    ["typed が文字列でない", { typed: 1 }],
  ])("%s なら 400", async (_name, over) => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    expect((await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId, over))).status).toBe(400);
    expect(logCount()).toBe(0);
  });
  it("知らないプレイ・他人のプレイは 404", async () => {
    const mine = await loginAs("y220020");
    const other = await loginAs("sample");
    const s = await startSession(mine);
    expect((await request(app).post("/api/logs").set(auth(mine)).send(logBody("unknown"))).status).toBe(404);
    expect((await request(app).post("/api/logs").set(auth(other)).send(logBody(s.sessionId))).status).toBe(404);
    expect(logCount()).toBe(0);
  });
  it("ログインなしは 401", async () => {
    expect((await request(app).post("/api/logs").send(logBody("x"))).status).toBe(401);
  });
});

describe("GET /api/sessions/:sessionId/result", () => {
  async function playThree() {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    const typed = [s.questions[0], "x" + s.questions[1].slice(1), s.questions[2]];
    const times = [
      ["2026-10-16T01:00:00.000Z", "2026-10-16T01:00:03.000Z"],
      ["2026-10-16T01:00:05.000Z", "2026-10-16T01:00:09.000Z"],
      ["2026-10-16T01:00:11.000Z", "2026-10-16T01:00:14.000Z"],
    ];
    for (let i = 0; i < 3; i++)
      await request(app)
        .post("/api/logs")
        .set(auth(token))
        .send(logBody(s.sessionId, { questionNum: i + 1, typed: typed[i], startTime: times[i][0], endTime: times[i][1] }));
    return { token, s };
  }
  it("保存した記録からスコアを計算する", async () => {
    const { token, s } = await playThree();
    const res = await request(app).get(`/api/sessions/${s.sessionId}/result`).set(auth(token));
    expect(res.status).toBe(200);
    const total = s.questions.slice(0, 3).reduce((n, q) => n + q.length, 0);
    expect(res.body.summary).toMatchObject({ questions: 3, correctChars: total - 1, totalChars: total, seconds: 10 });
    expect(res.body.summary.wpm).toBeCloseTo((total - 1) / 5 / (10 / 60));
    expect(res.body.questions[1].mistakes).toEqual([{ index: 0, expected: s.questions[1][0], actual: "x" }]);
  });
  it("他の学生の結果は見られない（404）。教員は見られる", async () => {
    const { s } = await playThree();
    const other = await loginAs("sample");
    expect((await request(app).get(`/api/sessions/${s.sessionId}/result`).set(auth(other))).status).toBe(404);
    const teacher = await loginAs("t001");
    expect((await request(app).get(`/api/sessions/${s.sessionId}/result`).set(auth(teacher))).status).toBe(200);
  });
  it("記録がなければ 404", async () => {
    const token = await loginAs("y220020");
    expect((await request(app).get("/api/sessions/none/result").set(auth(token))).status).toBe(404);
  });
});

describe("学習分析と教員の API", () => {
  // y220020 が 1 プレイで 2 問（2 問目の 1 文字目だけミス）
  async function play() {
    const token = await loginAs("y220020");
    const s = await startSession(token, 1, 1);
    await request(app)
      .post("/api/logs")
      .set(auth(token))
      .send(logBody(s.sessionId, { questionNum: 1, typed: s.questions[0] }));
    await request(app)
      .post("/api/logs")
      .set(auth(token))
      .send(
        logBody(s.sessionId, {
          questionNum: 2,
          typed: "x" + s.questions[1].slice(1),
          startTime: "2026-10-16T01:00:05.000Z",
          endTime: "2026-10-16T01:00:08.000Z",
        }),
      );
    return { token, s };
  }

  it("学生は自分の分析を見られる（推移・文字・指）", async () => {
    const { token, s } = await play();
    const res = await request(app).get("/api/me/analysis").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0]).toMatchObject({ sessionId: s.sessionId, questions: 2, levelTitle: "人差し指の練習" });
    const first = s.questions[1][0];
    expect(res.body.chars.find((c: { char: string }) => c.char === first).misses).toBe(1);
    // レベル 1 の問題は f と j だけ。Keyball44 の keys では F = L2、J = R2
    expect(res.body.fingers.map((f: { finger: string }) => f.finger).sort()).toEqual(["L2", "R2"]);
    expect(res.body.fingers.reduce((n: number, f: { misses: number }) => n + f.misses, 0)).toBe(1);
  });
  it("記録がなくても分析は空で返る", async () => {
    const token = await loginAs("sample");
    const res = await request(app).get("/api/me/analysis").set(auth(token));
    expect(res.body).toMatchObject({ sessions: [], chars: [], fingers: [], total: { questions: 0 } });
  });
  it("教員は学生一覧と学生ごとの分析を見られる", async () => {
    await play();
    const t = await loginAs("t001");
    const list = await request(app).get("/api/teacher/students").set(auth(t));
    expect(list.status).toBe(200);
    expect(list.body.map((u: { id: string }) => u.id)).toEqual(["sample", "y220020"]);
    expect(list.body[1]).toMatchObject({ sessions: 1, questions: 2, lastPlayed: "2026-10-16T01:00:08.000Z" });
    expect(list.body[0]).toMatchObject({ sessions: 0, questions: 0, lastPlayed: null });
    const one = await request(app).get("/api/teacher/students/y220020/analysis").set(auth(t));
    expect(one.body.user).toEqual({ id: "y220020", name: "高木勇輔" });
    expect(one.body.sessions).toHaveLength(1);
    expect((await request(app).get("/api/teacher/students/nobody/analysis").set(auth(t))).status).toBe(404);
  });
  it("教員は CSV を取り出せる（生データとスコア）", async () => {
    const { s } = await play();
    const t = await loginAs("t001");
    const res = await request(app).get("/api/teacher/logs.csv").set(auth(t));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.startsWith("\uFEFFid,session_id,user_id")).toBe(true);
    const lines = res.text.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1].split(",").slice(0, 3)).toEqual(["1", s.sessionId, "y220020"]);
    // 最後の 3 列は 正確率・WPM・文字/分（文字/分 は後から足した列なので最後）
    const n = s.questions[0].length;
    expect(lines[1].endsWith(",1.0000," + (n / 5 / (4 / 60)).toFixed(2) + "," + (n / (4 / 60)).toFixed(1))).toBe(true);
    expect(lines[0].endsWith(",accuracy,wpm,cpm")).toBe(true);
  });
  it("学生は教員の API を使えない（403）、ログインなしは 401", async () => {
    const token = await loginAs("y220020");
    for (const url of ["/api/teacher/students", "/api/teacher/students/y220020/analysis", "/api/teacher/logs.csv"]) {
      expect((await request(app).get(url).set(auth(token))).status).toBe(403);
      expect((await request(app).get(url)).status).toBe(401);
    }
    const t = await loginAs("t001");
    expect((await request(app).get("/api/me/analysis").set(auth(t))).status).toBe(200); // 教員も自分の練習の分析を見られる
  });
});

describe("教員: ステージ・レベルの管理", () => {
  const T = async () => auth(await loginAs("t001"));

  it("一覧に prompt と記録件数が入る", async () => {
    const h = await T();
    const res = await request(app).get("/api/teacher/stages").set(h);
    expect(res.status).toBe(200);
    expect(res.body[0].levels[0]).toMatchObject({ id: 1, logCount: 0, prompt: expect.stringContaining("人差し指") });
  });
  it("ステージとレベルを追加でき、学生の一覧に sort_order 順で出る", async () => {
    const h = await T();
    const st = await request(app).post("/api/teacher/stages").set(h).send({ title: " 記号 ", description: "", sort_order: 0 });
    expect(st.status).toBe(201);
    const lv = await request(app)
      .post("/api/teacher/levels")
      .set(h)
      .send({ stage_id: st.body.id, title: "セミコロン", prompt: "; を含む練習を作って", sort_order: 1 });
    expect(lv.status).toBe(201);
    const stages = (await request(app).get("/api/stages")).body;
    expect(stages[0]).toMatchObject({ id: st.body.id, title: "記号", description: null });
    expect(stages[0].levels[0]).toMatchObject({ id: lv.body.id, title: "セミコロン" });
  });
  it("一部だけ更新できる（説明は空にすると NULL）", async () => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/levels/1").set(h).send({ sort_order: 9, description: "" })).status).toBe(204);
    expect(db.prepare("SELECT sort_order, title, description, prompt FROM levels WHERE id = 1").get()).toEqual({
      sort_order: 9,
      title: "人差し指の練習",
      description: null,
      prompt: "ホームポジションの人差し指練習用の短い入力を10個生成してください。",
    });
    expect((await request(app).patch("/api/teacher/stages/1").set(h).send({ title: "基礎" })).status).toBe(204);
    expect(db.prepare("SELECT title, description FROM stages WHERE id = 1").get() as object).toEqual({
      title: "基礎",
      description: "ホームポジションの基本を身につける",
    });
  });
  it.each([
    ["タイトルが空", "/api/teacher/levels", { stage_id: 1, title: " ", prompt: "p" }],
    ["prompt がない", "/api/teacher/levels", { stage_id: 1, title: "t" }],
    ["存在しないステージ", "/api/teacher/levels", { stage_id: 999, title: "t", prompt: "p" }],
    ["sort_order が整数でない", "/api/teacher/stages", { title: "t", sort_order: "1" }],
  ])("%s なら 400", async (_n, url, body) => {
    const h = await T();
    expect((await request(app).post(url).set(h).send(body)).status).toBe(400);
  });
  it("prompt を空に更新することはできない", async () => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/levels/1").set(h).send({ prompt: "" })).status).toBe(400);
  });
  it("削除: 記録のないレベル・ステージは行ごと消す。記録のあるレベルは記録を守るため行を残し、画面からだけ消す", async () => {
    const student = await loginAs("y220020");
    const s2 = await startSession(student, 1);
    expect((await request(app).post("/api/logs").set(auth(student)).send(logBody(s2.sessionId))).status).toBe(201);
    const h = await T();
    const rows = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    // 記録のないステージ 2（レベル 3 だけ）は、中のレベルごと行が消える
    expect((await request(app).delete("/api/teacher/stages/2").set(h)).status).toBe(204);
    expect(rows("SELECT count(*) c FROM stages WHERE id = 2")).toBe(0);
    expect(rows("SELECT count(*) c FROM levels WHERE id = 3")).toBe(0);
    // ステージ 1: 記録のないレベル 2 は消え、記録のあるレベル 1 とステージ 1 は行が残る（is_active = 0）
    expect((await request(app).delete("/api/teacher/stages/1").set(h)).status).toBe(204);
    expect(rows("SELECT count(*) c FROM levels WHERE id = 2")).toBe(0);
    expect(rows("SELECT count(*) c FROM levels WHERE id = 1 AND is_active = 0")).toBe(1);
    expect(rows("SELECT count(*) c FROM stages WHERE id = 1 AND is_active = 0")).toBe(1);
    // どちらの画面からも消える。もう一度削除しようとすると 404
    expect((await request(app).get("/api/teacher/stages").set(h)).body).toEqual([]);
    expect((await request(app).get("/api/stages")).body).toEqual([]);
    expect((await request(app).delete("/api/teacher/stages/1").set(h)).status).toBe(404);
    expect((await request(app).delete("/api/teacher/levels/1").set(h)).status).toBe(404);
    expect((await request(app).delete("/api/teacher/levels/999").set(h)).status).toBe(404);
    // 削除したステージにはレベルを追加できない
    expect((await request(app).post("/api/teacher/levels").set(h).send({ stage_id: 1, title: "x", prompt: "x" })).status).toBe(400);
    expect(logCount()).toBe(1);
  });
  it("学生は管理 API を使えない", async () => {
    const h = auth(await loginAs("y220020"));
    expect((await request(app).get("/api/teacher/stages").set(h)).status).toBe(403);
    expect((await request(app).post("/api/teacher/stages").set(h).send({ title: "x" })).status).toBe(403);
    expect((await request(app).delete("/api/teacher/levels/2").set(h)).status).toBe(403);
  });
});

describe("レビュー指摘の回帰テスト（記録の信頼性・入力の検証）", () => {
  it("実在しない日時（2/31・25 時）は保存せず、教員の一覧・CSV は動き続ける", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    const bad = await request(app)
      .post("/api/logs")
      .set(auth(token))
      .send(logBody(s.sessionId, { startTime: "2026-02-31T25:61:61.000Z", endTime: "2026-02-31T26:00:00.000Z" }));
    expect(bad.status).toBe(400);
    expect(logCount()).toBe(0);
    const t = auth(await loginAs("t001"));
    expect((await request(app).get("/api/teacher/students").set(t)).status).toBe(200);
    expect((await request(app).get("/api/teacher/logs.csv").set(t)).status).toBe(200);
  });
  it("DB に壊れた日時の行があっても、分析・一覧・CSV は 500 にならない", async () => {
    db.prepare(
      "INSERT INTO logs (session_id,user_id,level_id,keyboard_id,question_num,target,typed,start_time,end_time) VALUES ('x','y220020',1,1,1,'ff','ff','broken','broken')",
    ).run();
    const t = auth(await loginAs("t001"));
    expect((await request(app).get("/api/teacher/students").set(t)).status).toBe(200);
    expect((await request(app).get("/api/teacher/students/y220020/analysis").set(t)).status).toBe(200);
    expect((await request(app).get("/api/teacher/logs.csv").set(t)).status).toBe(200);
  });
  it("問題番号は 1 から順番どおりだけ（飛ばし・先取りは 400）", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(token))
          .send(logBody(s.sessionId, { questionNum: 5 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(token))
          .send(logBody(s.sessionId, { questionNum: 1 }))
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(token))
          .send(logBody(s.sessionId, { questionNum: 3 }))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(token))
          .send(logBody(s.sessionId, { questionNum: 2, startTime: "2026-10-16T01:00:05.000Z", endTime: "2026-10-16T01:00:06.000Z" }))
      ).status,
    ).toBe(201);
    expect(logCount()).toBe(2);
  });
  it("プレイ開始より前・前の問題の終了より前・未来の時刻は 400", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token); // 開始 01:00:00、現在 01:01:00
    const send = (over: Record<string, unknown>) => request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId, over));
    expect((await send({ startTime: "2026-10-16T00:50:00.000Z" })).status).toBe(400);
    expect((await send({ endTime: "2026-10-16T02:00:00.000Z" })).status).toBe(400);
    expect((await send({ startTime: "2026-10-16T01:00:10.000Z", endTime: "2026-10-16T01:00:20.000Z" })).status).toBe(201);
    expect((await send({ questionNum: 2, startTime: "2026-10-16T01:00:00.000Z", endTime: "2026-10-16T01:00:30.000Z" })).status).toBe(400);
    expect(logCount()).toBe(1);
  });
  it("プレイの期限（2 時間）を過ぎると記録できない", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    clock = Date.parse("2026-10-16T03:00:01.000Z");
    expect((await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId))).status).toBe(404);
  });
  it("入力が長すぎると 400", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(token))
          .send(logBody(s.sessionId, { typed: "a".repeat(300) }))
      ).status,
    ).toBe(400);
  });
  it("プレイ中にレベルが削除されたら 409（500 にしない）", async () => {
    db.prepare("INSERT INTO levels (stage_id, sort_order, title, prompt) VALUES (1, 9, '一時', 'p')").run();
    const id = (db.prepare("SELECT max(id) m FROM levels").get() as { m: number }).m;
    const token = await loginAs("y220020");
    const s = await startSession(token, id);
    db.prepare("DELETE FROM levels WHERE id = ?").run(id);
    expect((await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId))).status).toBe(409);
  });
  it.each([[{}], [true], [[1, 2]], ["1"], [1.5], [-1]])("keyboardId = %j は 400（500 にしない）", async (kb) => {
    const token = await loginAs("y220020");
    const res = await request(app).post("/api/sessions").set(auth(token)).send({ levelId: 1, keyboardId: kb });
    expect(res.status).toBe(400);
  });
  it.each([[true], ["1"], [null], [1.5]])("levelId = %j は 400", async (lv) => {
    const token = await loginAs("y220020");
    expect((await request(app).post("/api/sessions").set(auth(token)).send({ levelId: lv })).status).toBe(400);
  });
  it("壊れた JSON は 400 で、スタックやパスを返さない", async () => {
    const res = await request(app).post("/api/login").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "リクエストの形式が不正です" });
    expect(res.text).not.toContain("/home/");
  });
  it("ログインは最後に使ってから 12 時間で切れる", async () => {
    const token = await loginAs("y220020");
    clock += 11 * 60 * 60 * 1000;
    expect((await request(app).get("/api/me").set(auth(token))).status).toBe(200);
    clock += 12 * 60 * 60 * 1000 + 1;
    expect((await request(app).get("/api/me").set(auth(token))).status).toBe(401);
  });
  it("プレイ開始時にサーバー時刻を返す", async () => {
    const token = await loginAs("y220020");
    const res = await request(app).post("/api/sessions").set(auth(token)).send({ levelId: 1 });
    expect(res.body.serverTime).toBe(new Date(clock).toISOString());
  });
});

describe("ステージ・レベルの非表示（is_active）", () => {
  const T = async () => auth(await loginAs("t001"));
  const titles = async () =>
    ((await request(app).get("/api/stages")).body as { title: string; levels: { title: string }[] }[]).map((st) => [
      st.title,
      st.levels.map((l) => l.title),
    ]);

  it("初期データはすべて表示（is_active = 1）で、管理の一覧に is_active が入る", async () => {
    const res = await request(app)
      .get("/api/teacher/stages")
      .set(await T());
    expect(res.body.map((st: { is_active: number }) => st.is_active)).toEqual([1, 1]);
    expect(res.body[0].levels.map((l: { is_active: number }) => l.is_active)).toEqual([1, 1]);
  });
  it("非表示のレベルは学生の一覧に出ず、プレイを始められない。表示に戻すと出る", async () => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/levels/2").set(h).send({ is_active: 0 })).status).toBe(204);
    expect(await titles()).toEqual([
      ["ホームポジション基礎", ["人差し指の練習"]],
      ["英単語・短文", ["英単語 10"]],
    ]);
    const student = await loginAs("y220020");
    expect((await request(app).post("/api/sessions").set(auth(student)).send({ levelId: 2 })).status).toBe(404);
    // 管理の一覧からも消える（削除と同じ扱い）
    const admin = (await request(app).get("/api/teacher/stages").set(h)).body;
    expect(admin[0].levels.find((l: { id: number }) => l.id === 2)).toBeUndefined();
    expect((await request(app).patch("/api/teacher/levels/2").set(h).send({ is_active: 1 })).status).toBe(204);
    expect((await request(app).post("/api/sessions").set(auth(student)).send({ levelId: 2 })).status).toBe(200);
  });
  it("非表示のステージは、中のレベルごと学生の一覧に出ず、プレイを始められない", async () => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/stages/1").set(h).send({ is_active: 0 })).status).toBe(204);
    expect(await titles()).toEqual([["英単語・短文", ["英単語 10"]]]);
    const student = await loginAs("y220020");
    expect((await request(app).post("/api/sessions").set(auth(student)).send({ levelId: 1 })).status).toBe(404);
    expect((await request(app).post("/api/sessions").set(auth(student)).send({ levelId: 3 })).status).toBe(200);
  });
  it("記録のあるレベルを削除しても、記録は消えず、学習分析にも残る。始めたプレイは最後まで保存できる", async () => {
    const student = await loginAs("y220020");
    const s = await startSession(student, 1);
    expect((await request(app).post("/api/logs").set(auth(student)).send(logBody(s.sessionId))).status).toBe(201);
    const h = await T();
    expect((await request(app).delete("/api/teacher/levels/1").set(h)).status).toBe(204);
    // 削除した後でも、始めていたプレイの続きは保存できる
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(auth(student))
          .send(logBody(s.sessionId, { questionNum: 2, startTime: "2026-10-16T01:00:05.000Z", endTime: "2026-10-16T01:00:06.000Z" }))
      ).status,
    ).toBe(201);
    expect(logCount()).toBe(2);
    const a = (await request(app).get("/api/me/analysis").set(auth(student))).body;
    expect(a.sessions[0]).toMatchObject({ levelTitle: "人差し指の練習", questions: 2 });
    // 記録を守るため、レベルの行は残っている
    expect((db.prepare("SELECT is_active FROM levels WHERE id = 1").get() as { is_active: number }).is_active).toBe(0);
  });
  it.each([[2], ["0"], [true], [null]])("is_active = %j は 400", async (v) => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/levels/1").set(h).send({ is_active: v })).status).toBe(400);
    expect((await request(app).patch("/api/teacher/stages/1").set(h).send({ is_active: v })).status).toBe(400);
  });
  it("学生は非表示にできない", async () => {
    const student = auth(await loginAs("y220020"));
    expect((await request(app).patch("/api/teacher/levels/1").set(student).send({ is_active: 0 })).status).toBe(403);
  });
});

describe("教員: 学生の追加・名前の変更・削除", () => {
  const T = async () => auth(await loginAs("t001"));
  const users = () => (db.prepare("SELECT id, name FROM users ORDER BY id").all() as { id: string; name: string }[]).map((u) => u.id);

  it("1 人追加でき、すぐその学籍番号でログインできる。標準のキーボードの設定（46 キー）が付く", async () => {
    const res = await request(app)
      .post("/api/teacher/users")
      .set(await T())
      .send({ users: [{ id: " Y230018 ", name: " 山田 太郎 " }] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ added: ["y230018"] }); // 小文字にそろえ、前後の空白を除く
    expect(db.prepare("SELECT name FROM users WHERE id = 'y230018'").get()).toEqual({ name: "山田 太郎" });
    const kb = db.prepare("SELECT id, name, is_active FROM keyboards WHERE user_id = 'y230018'").all() as { id: number }[];
    expect(kb).toMatchObject([{ name: "Keyball44", is_active: 1 }]);
    expect((db.prepare("SELECT count(*) c FROM keys WHERE keyboard_id = ?").get(kb[0].id) as { c: number }).c).toBe(46);
    expect((await request(app).post("/api/login").send({ id: "y230018" })).status).toBe(200);
  });
  it("標準のキーボードの設定は、タイピング.db の既存のキーボードと同じ割り当て", async () => {
    await request(app)
      .post("/api/teacher/users")
      .set(await T())
      .send({ users: [{ id: "k1", name: "k" }] });
    const keysOf = (user: string) =>
      db.prepare("SELECT k.char, k.finger FROM keys k JOIN keyboards b ON b.id = k.keyboard_id WHERE b.user_id = ? ORDER BY k.id").all(user);
    expect(keysOf("k1")).toEqual(keysOf("y220020"));
  });
  it("キーボードの設定を付けずに追加することもできる", async () => {
    await request(app)
      .post("/api/teacher/users")
      .set(await T())
      .send({ users: [{ id: "nokb", name: "なし" }], keyboard: false });
    expect(db.prepare("SELECT count(*) c FROM keyboards WHERE user_id = 'nokb'").get()).toEqual({ c: 0 });
  });
  it("まとめて追加できる", async () => {
    const res = await request(app)
      .post("/api/teacher/users")
      .set(await T())
      .send({
        users: [
          { id: "a1", name: "A" },
          { id: "a2", name: "B" },
          { id: "a3", name: "C" },
        ],
      });
    expect(res.status).toBe(201);
    expect(users()).toEqual(["a1", "a2", "a3", "sample", "y220020"]);
  });
  it.each([
    [
      "すでに登録されている学籍番号",
      [
        { id: "a1", name: "A" },
        { id: "y220020", name: "重複" },
      ],
    ],
    [
      "同じ学籍番号が 2 回",
      [
        { id: "a1", name: "A" },
        { id: "A1", name: "A2" },
      ],
    ],
    [
      "使えない文字の学籍番号",
      [
        { id: "a1", name: "A" },
        { id: "山田", name: "X" },
      ],
    ],
    [
      "空の名前",
      [
        { id: "a1", name: "A" },
        { id: "a2", name: " " },
      ],
    ],
    [
      "教員の ID と同じ学籍番号",
      [
        { id: "a1", name: "A" },
        { id: "T001", name: "X" },
      ],
    ],
  ])("%s があれば 400 で、誰も追加しない", async (_n, list) => {
    const res = await request(app)
      .post("/api/teacher/users")
      .set(await T())
      .send({ users: list });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("誰も追加していません");
    expect(users()).toEqual(["sample", "y220020"]);
    expect(db.prepare("SELECT count(*) c FROM keyboards").get()).toEqual({ c: 2 });
  });
  it("0 人・501 人・形の違う指定は 400", async () => {
    const h = await T();
    expect((await request(app).post("/api/teacher/users").set(h).send({ users: [] })).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/teacher/users")
          .set(h)
          .send({ users: Array.from({ length: 501 }, (_, i) => ({ id: `u${i}`, name: "x" })) })
      ).status,
    ).toBe(400);
    expect((await request(app).post("/api/teacher/users").set(h).send({ id: "x", name: "x" })).status).toBe(400);
  });
  it("名前を変えられる", async () => {
    const h = await T();
    expect((await request(app).patch("/api/teacher/users/sample").set(h).send({ name: "サンプル 2" })).status).toBe(204);
    expect(db.prepare("SELECT name FROM users WHERE id = 'sample'").get()).toEqual({ name: "サンプル 2" });
    expect((await request(app).patch("/api/teacher/users/sample").set(h).send({ name: "" })).status).toBe(400);
    expect((await request(app).patch("/api/teacher/users/nobody").set(h).send({ name: "x" })).status).toBe(404);
  });
  it("記録のない学生は、キーボードの設定ごと削除できる。記録のある学生は削除できない（409）", async () => {
    const h = await T();
    await request(app)
      .post("/api/teacher/users")
      .set(h)
      .send({ users: [{ id: "del1", name: "消す" }] });
    expect((await request(app).delete("/api/teacher/users/del1").set(h)).status).toBe(204);
    expect(users()).toEqual(["sample", "y220020"]);
    expect(db.prepare("SELECT count(*) c FROM keyboards WHERE user_id = 'del1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT count(*) c FROM keys").get()).toEqual({ c: 92 }); // 元の 2 人分だけ残る
    // 記録のある学生
    const student = await loginAs("y220020");
    const s = await startSession(student);
    await request(app).post("/api/logs").set(auth(student)).send(logBody(s.sessionId));
    expect((await request(app).delete("/api/teacher/users/y220020").set(h)).status).toBe(409);
    expect(logCount()).toBe(1);
    expect((await request(app).delete("/api/teacher/users/nobody").set(h)).status).toBe(404);
  });
  it("学生は学生の追加・変更・削除をできない", async () => {
    const h = auth(await loginAs("y220020"));
    expect(
      (
        await request(app)
          .post("/api/teacher/users")
          .set(h)
          .send({ users: [{ id: "x", name: "x" }] })
      ).status,
    ).toBe(403);
    expect((await request(app).patch("/api/teacher/users/sample").set(h).send({ name: "x" })).status).toBe(403);
    expect((await request(app).delete("/api/teacher/users/sample").set(h)).status).toBe(403);
  });
});

describe("logs は追加のみ（トリガー）", () => {
  it("UPDATE と DELETE は DB が拒否する", async () => {
    const token = await loginAs("y220020");
    const s = await startSession(token);
    await request(app).post("/api/logs").set(auth(token)).send(logBody(s.sessionId));
    expect(logCount()).toBe(1);
    expect(() => db.prepare("UPDATE logs SET typed = 'x'").run()).toThrow(/追加のみ/);
    expect(() => db.prepare("DELETE FROM logs").run()).toThrow(/追加のみ/);
  });
});

describe("pickQuestions", () => {
  it("指定した数だけ返し、固定問題から選ぶ", () => {
    const q = pickQuestions(3, 10);
    expect(q).toHaveLength(10);
    expect(new Set(q).size).toBe(10); // 12 問から 10 問なので重複なし
  });
  it("固定問題のないレベルは予備の問題から出す", () => {
    expect(pickQuestions(999, 10)).toHaveLength(10);
  });
  it("数が問題数より多いときは繰り返す", () => {
    expect(pickQuestions(1, 30)).toHaveLength(30);
  });
});
