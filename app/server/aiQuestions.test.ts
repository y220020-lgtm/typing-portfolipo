import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiQuestionSource, aiConfigFromEnv, buildMessages, isTypable, parseQuestions, type AiConfig } from "./aiQuestions";
import { createApp } from "./app";
import { openDb } from "./db";
import { initDb } from "./initDb";

// 本物の AI には送信しない。fetch を偽物に差し替えて確かめる。
const CONFIG: AiConfig = { baseUrl: "http://ai.test/v1", apiKey: "test-key", model: "m", cacheSeconds: 60, timeoutMs: 1000 };
const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "Content-Type": "application/json" } });

describe("aiConfigFromEnv", () => {
  it("AI_BASE_URL と AI_MODEL がなければ null（固定問題を使う）", () => {
    expect(aiConfigFromEnv({})).toBeNull();
    expect(aiConfigFromEnv({ AI_BASE_URL: "http://x" })).toBeNull();
  });
  it("設定を読む（末尾の / は除く、キャッシュ既定 1 時間）", () => {
    expect(aiConfigFromEnv({ AI_BASE_URL: "http://x/v1/", AI_MODEL: "m" })).toEqual({
      baseUrl: "http://x/v1",
      apiKey: null,
      model: "m",
      cacheSeconds: 3600,
      timeoutMs: 15000,
      disableThinking: false,
      maxTokens: undefined,
    });
  });
  it("AI_DISABLE_THINKING=1 と AI_MAX_TOKENS のときだけ、考える部分を止める指定と長さの上限を送る", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    };
    const on = aiConfigFromEnv({ AI_BASE_URL: "http://x/v1", AI_MODEL: "m", AI_DISABLE_THINKING: "1", AI_MAX_TOKENS: "1500" })!;
    const off = aiConfigFromEnv({ AI_BASE_URL: "http://x/v1", AI_MODEL: "m" })!;
    await new AiQuestionSource(on, fetchMock as never).chat([{ role: "user", content: "x" }], "t");
    await new AiQuestionSource(off, fetchMock as never).chat([{ role: "user", content: "x" }], "t");
    expect(bodies[0]).toMatchObject({ max_tokens: 1500, chat_template_kwargs: { enable_thinking: false } });
    expect(bodies[1]).not.toHaveProperty("max_tokens");
    expect(bodies[1]).not.toHaveProperty("chat_template_kwargs");
  });
});

describe("parseQuestions", () => {
  it("JSON 配列を読む（前後に説明があってもよい）", () => {
    expect(parseQuestions('はい。\n["fjfj", "jfjf"]\n以上です')).toEqual(["fjfj", "jfjf"]);
  });
  it("JSON 配列がなければ空（推測で読み取らず、固定問題に任せる）", () => {
    expect(parseQuestions("1. apple\n2) water\n- light")).toEqual([]);
    expect(parseQuestions("[壊れた")).toEqual([]);
  });
  it("コードブロック・末尾カンマ・前置きの [10] があっても配列だけを読む", () => {
    expect(parseQuestions('```json\n[\n  "asdf",\n  "jkl;",\n]\n```')).toEqual(["asdf", "jkl;"]);
    expect(parseQuestions('Here are [10] items: ["asdf","jkl;"]')).toEqual(["asdf", "jkl;"]);
  });
  it("打てない文字・長すぎる・空・重複・文字列以外は除く（日本語は受け付ける）", () => {
    expect(parseQuestions(JSON.stringify(["ok", "日本語", "a".repeat(41), "", "ok", 3, "two words"]))).toEqual(["ok", "日本語", "two words"]);
  });
  it("日本語の文字（ひらがな・カタカナ・漢字・句読点・括弧・全角の空白）は受け付ける", () => {
    for (const q of [
      "さくら",
      "キーボード",
      "日本",
      "人々",
      "おはようございます。",
      "「はい」と言った。",
      "本当？",
      "すごい！",
      "東京　大阪",
      "ガッコウ",
      "ヴァイオリン",
    ])
      expect(isTypable(q), q).toBe(true);
  });
  it("全角の英数字・絵文字・制御文字・41 文字以上は受け付けない（長さは見た目の文字数）", () => {
    for (const q of ["Ａｂｃ", "１２３", "🍣", "a\tb", "a\nb", "あ".repeat(41), ""]) expect(isTypable(q), q).toBe(false);
    expect(isTypable("あ".repeat(40))).toBe(true);
  });
});

describe("buildMessages", () => {
  it("levels.prompt を user として送る", () => {
    const m = buildMessages("人差し指の練習を作って");
    expect(m[1]).toEqual({ role: "user", content: "人差し指の練習を作って" });
    expect(m[0].role).toBe("system");
  });
});

describe("AiQuestionSource", () => {
  it("chat/completions を呼び、結果をキャッシュする", async () => {
    const fetchMock = vi.fn(async () => reply('["fjfj","jfjf"]'));
    let now = 0;
    const src = new AiQuestionSource(CONFIG, fetchMock, () => now);
    expect(await src.questionsFor(1, "p")).toEqual(["fjfj", "jfjf"]);
    expect(await src.questionsFor(1, "p")).toEqual(["fjfj", "jfjf"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ai.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string).model).toBe("m");
    // 期限が切れたら問い合わせ直す
    now = 61_000;
    await src.questionsFor(1, "p");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("レベルごとに別々にキャッシュする", async () => {
    const fetchMock = vi.fn(async () => reply('["a"]'));
    const src = new AiQuestionSource(CONFIG, fetchMock);
    await src.questionsFor(1, "p");
    await src.questionsFor(2, "q");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("同時の問い合わせは 1 回にまとめる", async () => {
    const fetchMock = vi.fn(async () => reply('["a"]'));
    const src = new AiQuestionSource(CONFIG, fetchMock);
    await Promise.all([src.questionsFor(1, "p"), src.questionsFor(1, "p")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["HTTP エラー", async () => reply("", 500)],
    ["通信エラー", async () => Promise.reject(new Error("down"))],
    ["使える問題がない", async () => reply('["ＡＢＣ","🍣"]')],
    ["形式が違う", async () => new Response("{}", { status: 200 })],
  ])("%s なら null（キャッシュしない）", async (_name, impl) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(impl);
    const src = new AiQuestionSource(CONFIG, fetchMock as never);
    expect(await src.questionsFor(1, "p")).toBeNull();
    expect(await src.questionsFor(1, "p")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // どの失敗でも警告ログを出す（運用中に AI が使えていないことに気づけるように）
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("forget と問い合わせ中の結果", () => {
  it("問い合わせ中に指示文が変わったら、古い結果はキャッシュしない", async () => {
    let release: (r: Response) => void = () => undefined;
    const calls: string[] = [];
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const prompt = JSON.parse(init.body as string).messages[1].content as string;
      calls.push(prompt);
      if (prompt === "old") return new Promise<Response>((r) => (release = r));
      return Promise.resolve(reply('["new"]'));
    });
    const src = new AiQuestionSource(CONFIG, fetchMock as never);
    const oldRun = src.questionsFor(1, "old");
    src.forget(1); // 教員が指示文を変えた
    expect(await src.questionsFor(1, "new")).toEqual(["new"]);
    release(reply('["old"]'));
    await oldRun;
    expect(await src.questionsFor(1, "new")).toEqual(["new"]);
    expect(calls).toEqual(["old", "new"]);
  });
});

describe("POST /api/sessions と AI", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function setup(fetchImpl: () => Promise<Response>) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-ai-"));
    const file = path.join(dir, "t.db");
    initDb(file);
    const db = openDb(file);
    const fetchMock = vi.fn(fetchImpl);
    const app = createApp(db, {
      teachers: { ids: [], passcode: null },
      ai: new AiQuestionSource(CONFIG, fetchMock as never),
      auth: { mode: "local" },
    });
    const token = (await request(app).post("/api/login").send({ id: "y220020" })).body.token;
    return { db, app, token, fetchMock };
  }

  it("AI の問題で出題し、そのまま logs に保存される。levels.prompt を送る", async () => {
    const { db, app, token, fetchMock } = await setup(async () => reply('["alpha","beta","gamma"]'));
    const res = await request(app)
      .post("/api/sessions")
      .set({ Authorization: `Bearer ${token}` })
      .send({ levelId: 3 });
    expect(res.body.source).toBe("ai");
    expect(res.body.questions).toHaveLength(10);
    // AI の 3 問は全部出し、足りない 7 問はレベルの決まりに合う問題で補う（同じ問題を繰り返さない）
    expect(res.body.questions).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
    expect(new Set(res.body.questions).size).toBe(10);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content).toMatch(/^タイピング初心者向けの短い英単語を10個生成してください。\n守ること: /);
    await request(app)
      .post("/api/logs")
      .set({ Authorization: `Bearer ${token}` })
      .send({ sessionId: res.body.sessionId, questionNum: 1, typed: "x", startTime: res.body.serverTime, endTime: new Date().toISOString() });
    expect((db.prepare("SELECT target FROM logs").get() as { target: string }).target).toBe(res.body.questions[0]);
    db.close();
  });
  it("レベルの決まりに合わない AI の問題は出さない（人差し指の練習に asdf などを出さない）", async () => {
    const { db, app, token } = await setup(async () => reply('["fjfj","jklasdf","asdf jkl;","ffjj","dk"]'));
    const res = await request(app)
      .post("/api/sessions")
      .set({ Authorization: `Bearer ${token}` })
      .send({ levelId: 1 });
    expect(res.body.source).toBe("ai");
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions.every((q: string) => /^[fj]+$/.test(q))).toBe(true);
    db.close();
  });
  it("AI が失敗したら固定問題で出題する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db, app, token } = await setup(async () => reply("", 503));
    const res = await request(app)
      .post("/api/sessions")
      .set({ Authorization: `Bearer ${token}` })
      .send({ levelId: 3 });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fixed");
    expect(res.body.questions).toHaveLength(10);
    warn.mockRestore();
    db.close();
  });
});
