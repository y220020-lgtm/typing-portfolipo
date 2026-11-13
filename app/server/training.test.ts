import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiQuestionSource, type AiConfig } from "./aiQuestions";
import { createApp } from "./app";
import { openDb, type DB } from "./db";
import { initDb } from "./initDb";
import { charStats } from "../shared/analysis";
import {
  STAGES,
  buildTrainingMessages,
  completeTraining,
  fallbackTraining,
  fingerName,
  stageOf,
  parseTrainingReply,
  summarizeWeakness,
} from "./training";

const log = (target: string, typed: string, sec = 2) => ({
  target,
  typed,
  start_time: "2026-10-23T01:00:00.000Z",
  end_time: new Date(Date.parse("2026-10-23T01:00:00.000Z") + sec * 1000).toISOString(),
});

describe("弱点の要約", () => {
  const logs = [log("fjfj", "fkfk"), log("jjff", "kjff"), log("dk", "dk"), log("a", "s")];
  const w = summarizeWeakness(logs, charStats(logs), []);
  it("2 回以上出た文字だけを苦手とする（1 回だけの a は入れない）", () => {
    expect(w.weakChars.map((c) => c.char)).toEqual(["j"]);
    expect(w.weakChars[0]).toMatchObject({ misses: 3, attempts: 4, missRate: 0.75 });
  });
  it("問題数・正確率・間違いの例", () => {
    expect(w.questions).toBe(4);
    expect(w.accuracy).toBeCloseTo(7 / 11);
    expect(w.mistakes).toEqual([
      { target: "fjfj", typed: "fkfk" },
      { target: "jjff", typed: "kjff" },
      { target: "a", typed: "s" },
    ]);
    expect(w.japanese).toBe(false);
  });
  it("LLM への指示に、要約（苦手な文字・正確率）を入れる", () => {
    const m = buildTrainingMessages(w);
    expect(m[0].role).toBe("system");
    expect(m[1].content).toContain('"苦手な文字":[{"char":"j"');
    expect(m[1].content).toContain('"正確率":0.636');
  });
});

describe("LLM の返答の読み取り", () => {
  it("分析文と問題を読む（前後の文やコードブロックがあってもよい）", () => {
    expect(parseTrainingReply('はい\n```json\n{"analysis":"j が苦手","questions":["jjj","juj","jj"]}\n```')).toEqual({
      analysis: "j が苦手",
      questions: ["jjj", "juj", "jj"],
    });
  });
  it("打てない文字・長すぎる問題・重複は捨てる。問題が 1 つもなければ null", () => {
    expect(parseTrainingReply(JSON.stringify({ analysis: "x", questions: ["ok", "ok", "🍣", "a".repeat(41)] }))?.questions).toEqual(["ok"]);
    expect(parseTrainingReply(JSON.stringify({ analysis: "x", questions: ["🍣"] }))).toBeNull();
    expect(parseTrainingReply("わかりません")).toBeNull();
  });
});

describe("難しさの段階（正確さを優先して段階的に）", () => {
  it("正確率 90% 未満や初回は 1、95% 以上で 3 回以上なら 3、それ以外は 2", () => {
    expect(stageOf(0.99, 0)).toBe(1);
    expect(stageOf(0.85, 10)).toBe(1);
    expect(stageOf(0.92, 1)).toBe(2);
    expect(stageOf(0.96, 2)).toBe(2);
    expect(stageOf(0.96, 3)).toBe(3);
  });
  it("LLM への指示に、段階・文字数・内容と「実際にある単語・語句・短い文」「長さに変化」を入れる", () => {
    const w = { ...summarizeWeakness([log("jj", "kk"), log("jj", "kk")], charStats([log("jj", "kk"), log("jj", "kk")]), []), stage: 2 as const };
    const [sys, user] = buildTrainingMessages(w);
    expect(user.content).toContain("6〜18 文字");
    expect(user.content).toContain("標準");
    expect(sys.content).toContain("実際にある単語・語句・短い文");
    expect(sys.content).toContain("長さに変化");
  });
  it("規則の問題: 段階の文字数に収まる単語・語句で、苦手な文字を含み、1〜3 文字の並びにならない。後半は前半より長め", () => {
    const base = summarizeWeakness([log("jj", "kk"), log("jj", "kk")], charStats([log("jj", "kk"), log("jj", "kk")]), []);
    for (const stage of [1, 2, 3] as const) {
      const qs = completeTraining([], { ...base, stage });
      expect(new Set(qs).size).toBe(10);
      for (const q of qs) {
        expect(q.length).toBeGreaterThanOrEqual(STAGES[stage].min);
        expect(q.length).toBeLessThanOrEqual(STAGES[stage].max);
        expect(q).toContain("j");
      }
      const avg = (a: string[]) => a.reduce((n, q) => n + q.length, 0) / a.length;
      expect(avg(qs.slice(5))).toBeGreaterThanOrEqual(avg(qs.slice(0, 5)));
    }
    // 段階 3 は空白を含む語句・文
    expect(completeTraining([], { ...base, stage: 3 }).some((q) => q.includes(" "))).toBe(true);
  });
  it("LLM の問題が段階より短すぎれば除き、規則の問題で補う（10 問・重複なし）", () => {
    const w = { ...summarizeWeakness([log("jj", "kk"), log("jj", "kk")], charStats([log("jj", "kk"), log("jj", "kk")]), []), stage: 2 as const };
    const qs = completeTraining(["jj", "ju", "jump over", "major key"], w);
    expect(qs.slice(0, 2)).toEqual(["jump over", "major key"]);
    expect(qs).toHaveLength(10);
    expect(new Set(qs).size).toBe(10);
    expect(qs.every((q) => q.length >= 4)).toBe(true);
  });
});

describe("日本語中心の学生はローマ字で出題（キーごとに分析できるように）", () => {
  it("指示に「ローマ字で出題」を入れ、規則の問題はローマ字（半角の小文字と空白）", () => {
    const w = {
      ...summarizeWeakness([log("さくら", "さくや"), log("さくら", "さくや")], charStats([log("さくら", "さくや"), log("さくら", "さくや")]), []),
      stage: 2 as const,
    };
    expect(w.japanese).toBe(true);
    const user = buildTrainingMessages(w)[1].content;
    expect(user).toContain('"ローマ字で出題":true');
    const qs = completeTraining([], { ...w, weakChars: [{ char: "k", missRate: 0.5, misses: 2, attempts: 4 }] });
    expect(qs).toHaveLength(10);
    expect(qs.every((q) => /^[a-z ]+$/.test(q))).toBe(true);
  });
});

describe("LLM に渡す指の名前", () => {
  it("L2・R5 などの記号を、学生に分かる名前にして渡す（分析文に記号が出ないように）", () => {
    expect(fingerName("R2")).toBe("右人差し指");
    expect(fingerName("L5")).toBe("左小指");
    expect(fingerName("X9")).toBe("X9");
    const w = summarizeWeakness([log("jj", "kk"), log("jj", "kk")], charStats([log("jj", "kk"), log("jj", "kk")]), []);
    const user = buildTrainingMessages({ ...w, weakFingers: [{ finger: "R2", missRate: 0.5 }] })[1].content;
    expect(user).toContain("右人差し指");
    expect(user).not.toContain("R2");
  });
});

describe("出題を 10 問のすべて異なる問題にする（completeTraining）", () => {
  const w = () => summarizeWeakness([log("jj", "kk"), log("jj", "kk")], charStats([log("jj", "kk"), log("jj", "kk")]), []);
  const tenUnique = (qs: string[]) => {
    expect(qs).toHaveLength(10);
    expect(new Set(qs).size).toBe(10);
  };
  it("正常: LLM の 10 問がすべて異なれば、そのままの順番で使う", () => {
    const qs = ["ja", "jb", "jc", "jd", "je", "jf", "jg", "jh", "ji", "jk"];
    expect(completeTraining(qs, w())).toEqual(qs);
  });
  it("重複: 重なった問題は除き、足りない分を苦手な文字を含む規則の問題で補う", () => {
    // 2026-10-23 に研究室の Qwen が返した形（3 問が 2 回ずつ）
    const qs = ["fdfdj", "djfkd", "dkfdj", "jfkdf", "jdjfk", "fjdkf", "fdjfk", "fdfdj", "djfkd", "dkfdj"];
    const r = completeTraining(qs, w());
    tenUnique(r);
    expect(r.slice(0, 7)).toEqual(["fdfdj", "djfkd", "dkfdj", "jfkdf", "jdjfk", "fjdkf", "fdjfk"]);
    expect(r.slice(7).every((q) => q.includes("j"))).toBe(true);
  });
  it("不足: 3 問しかなければ 7 問を補う。1 問もなくても 10 問になる", () => {
    const r = completeTraining(["jjjj", "juju", "jkjk"], w());
    tenUnique(r);
    expect(r.slice(0, 3)).toEqual(["jjjj", "juju", "jkjk"]);
    tenUnique(completeTraining([], w()));
  });
  it("10 問より多ければ、先頭の異なる 10 問だけ", () => {
    const qs = Array.from({ length: 15 }, (_, i) => `j${i}`);
    expect(completeTraining(qs, w())).toEqual(qs.slice(0, 10));
  });
  it("ランダムが同じ値しか返さなくても、10 問すべて異なる", () => {
    tenUnique(completeTraining(["jj"], w(), () => 0));
    tenUnique(completeTraining(["fj"], null, () => 0));
  });
});

describe("規則での問題（LLM が使えないとき）", () => {
  it("10 問で、どの問題も苦手な文字を含む", () => {
    const w = summarizeWeakness([log("jj", "kk"), log("jj", "kk")], charStats([log("jj", "kk"), log("jj", "kk")]), []);
    const r = fallbackTraining(w)!;
    expect(r.questions).toHaveLength(10);
    expect(r.questions.every((q) => q.includes("j"))).toBe(true);
  });
  it("苦手な文字がなければ null", () => {
    const w = summarizeWeakness([log("ab", "ab")], charStats([log("ab", "ab")]), []);
    expect(fallbackTraining(w)).toBeNull();
  });
});

describe("POST /api/training/next", () => {
  let dir: string;
  let db: DB;
  afterEach(() => {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const CONFIG: AiConfig = { baseUrl: "http://ai.test/v1", apiKey: "secret-key", model: "m", cacheSeconds: 60, timeoutMs: 1000 };
  function setup(reply: (() => Promise<Response>) | null) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-train-"));
    initDb(path.join(dir, "t.db"));
    db = openDb(path.join(dir, "t.db"));
    const fetchMock = reply ? vi.fn(reply) : null;
    const app = createApp(db, {
      teachers: { ids: [], passcode: null },
      ai: fetchMock ? new AiQuestionSource(CONFIG, fetchMock as never) : null,
      auth: { mode: "local" },
    });
    return { app, fetchMock };
  }
  const login = async (app: ReturnType<typeof createApp>) => (await request(app).post("/api/login").send({ id: "y220020" })).body.token as string;
  // 1 問だけ記録する（j を k と打ち間違える）
  async function playOne(app: ReturnType<typeof createApp>, token: string, typed: (q: string) => string) {
    const s = (
      await request(app)
        .post("/api/training/next")
        .set({ Authorization: `Bearer ${token}` })
        .send({})
    ).body;
    for (let i = 0; i < 2; i++)
      await request(app)
        .post("/api/logs")
        .set({ Authorization: `Bearer ${token}` })
        .send({
          sessionId: s.sessionId,
          questionNum: i + 1,
          typed: typed(s.questions[i]),
          startTime: s.serverTime,
          endTime: new Date().toISOString(),
        });
    return s;
  }
  const reply = (content: string) => async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "Content-Type": "application/json" } });

  it("記録がない学生は、ホームポジションの問題から始める（LLM は呼ばない）", async () => {
    const { app, fetchMock } = setup(reply("{}"));
    const res = await request(app)
      .post("/api/training/next")
      .set({ Authorization: `Bearer ${await login(app)}` })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.weakness).toBeNull();
    expect(res.body.level.title).toBe("苦手克服トレーニング");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("記録があれば、弱点の要約を LLM に送り、LLM の問題と分析を返す。API キーはヘッダーだけ", async () => {
    const { app, fetchMock } = setup(reply('{"analysis":"j が苦手です","questions":["jjjj","juju","jkjk"]}'));
    const token = await login(app);
    await playOne(app, token, (q) => q.replace(/j/g, "k"));
    const res = await request(app)
      .post("/api/training/next")
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(res.body.source).toBe("ai");
    expect(res.body.analysis).toBe("j が苦手です");
    // LLM の 3 問をそのまま先頭に使い、足りない 7 問を規則で補う（10 問すべて異なる）
    expect(res.body.questions.slice(0, 3)).toEqual(["jjjj", "juju", "jkjk"]);
    expect(new Set(res.body.questions).size).toBe(10);
    const init = (fetchMock!.mock.calls.at(-1) as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(String(init.body)).not.toContain("secret-key");
    expect(String(init.body)).toContain("苦手な文字");
  });
  it("LLM が失敗したら、苦手な文字で規則的に作る", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { app } = setup(async () => new Response("", { status: 500 }));
    const token = await login(app);
    // 最初の問題は既存のレベルからランダムに選ばれるので、何も打たずに全文字をミスにする（どの文字が出ても苦手になる）
    await playOne(app, token, () => "");
    await playOne(app, token, () => "");
    const res = await request(app)
      .post("/api/training/next")
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(res.body.source).toBe("rule");
    const weak: string[] = res.body.weakness.weakChars.map((c: { char: string }) => c.char);
    expect(weak.length).toBeGreaterThan(0);
    expect(res.body.questions.every((q: string) => weak.some((c) => q.includes(c)))).toBe(true);
    warn.mockRestore();
  });
  it("記録は専用のレベルに入り、そのレベルは学生のレベル一覧に出ない。教員の管理画面には出る", async () => {
    const { app } = setup(null);
    const token = await login(app);
    await playOne(app, token, (q) => q);
    const n = db.prepare("SELECT count(*) c FROM logs l JOIN levels v ON v.id = l.level_id WHERE v.title = '苦手克服トレーニング'").get();
    expect(n).toEqual({ c: 2 });
    const titles = ((await request(app).get("/api/stages")).body as { levels: { title: string }[] }[]).flatMap((s) => s.levels.map((l) => l.title));
    expect(titles).not.toContain("苦手克服トレーニング");
    // 2 回目以降も同じレベルを使う（増やさない）
    await request(app)
      .post("/api/training/next")
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(db.prepare("SELECT count(*) c FROM levels WHERE title = '苦手克服トレーニング'").get()).toEqual({ c: 1 });
  });
});

describe("POST /api/levels/:id/training（レベルごとの苦手克服）", () => {
  let dir: string;
  let db: DB;
  afterEach(() => {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const CONFIG: AiConfig = { baseUrl: "http://ai.test/v1", apiKey: "k", model: "m", cacheSeconds: 60, timeoutMs: 1000 };
  const reply = (content: string) => async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "Content-Type": "application/json" } });
  function setup(r: (() => Promise<Response>) | null) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-lvtrain-"));
    initDb(path.join(dir, "t.db"));
    db = openDb(path.join(dir, "t.db"));
    // 上の段のレベルを足す（試作品と同じ指示文）
    db.prepare("INSERT INTO levels (id, stage_id, sort_order, title, description, prompt) VALUES (9, 1, 9, '上の段', 'Q W E R T Y U I O P', ?)").run(
      "上の段（q w e r t y u i o p）のキーだけを使った短い入力を10個生成してください。",
    );
    const fetchMock = r ? vi.fn(r) : null;
    const app = createApp(db, {
      teachers: { ids: [], passcode: null },
      ai: fetchMock ? new AiQuestionSource(CONFIG, fetchMock as never) : null,
      auth: { mode: "local" },
    });
    return { app, fetchMock };
  }
  const H = async (app: ReturnType<typeof createApp>) => ({
    Authorization: `Bearer ${(await request(app).post("/api/login").send({ id: "y220020" })).body.token}`,
  });
  // 上の段を 1 回解き、3 問とも ooo と打つ（出題の文字の多くを間違える）
  async function playTop(app: ReturnType<typeof createApp>, h: Record<string, string>) {
    const s = (await request(app).post("/api/sessions").set(h).send({ levelId: 9 })).body;
    for (let i = 0; i < 3; i++)
      await request(app)
        .post("/api/logs")
        .set(h)
        .send({ sessionId: s.sessionId, questionNum: i + 1, typed: "ooo", startTime: s.serverTime, endTime: new Date().toISOString() });
    return s;
  }

  it("記録がなければ断る", async () => {
    const { app } = setup(null);
    const res = await request(app)
      .post("/api/levels/9/training")
      .set(await H(app))
      .send({});
    expect(res.status).toBe(400);
  });
  it("AI の問題のうちレベルの範囲の外のものは出さず、そのレベルの記録として 10 問出す。指示にレベルの範囲を入れる", async () => {
    const { app, fetchMock } = setup(reply('{"analysis":"p が苦手です","questions":["pppq","asdf","qpqp","zxcv","pope"]}'));
    const h = await H(app);
    await playTop(app, h);
    fetchMock!.mockClear();
    const res = await request(app).post("/api/levels/9/training").set(h).send({});
    expect(res.status).toBe(200);
    expect(res.body.level).toEqual({ id: 9, title: "上の段" });
    expect(res.body.source).toBe("ai");
    expect(res.body.analysis).toBe("p が苦手です");
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions.slice(0, 2)).toEqual(["pppq", "qpqp"]);
    expect(res.body.questions.every((q: string) => /^[qwertyuiop ]+$/.test(q))).toBe(true);
    const body = JSON.parse((fetchMock!.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content).toContain("上の段");
    expect(body.messages[0].content).toContain("q w e r t y u i o p");
  });
  it("AI がなくても、範囲の中で苦手な文字を含む問題を出す", async () => {
    const { app } = setup(null);
    const h = await H(app);
    await playTop(app, h);
    const res = await request(app).post("/api/levels/9/training").set(h).send({});
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("rule");
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions.every((q: string) => /^[qwertyuiop]+$/.test(q))).toBe(true);
    const weak = res.body.weakness.weakChars.map((c: { char: string }) => c.char).filter((c: string) => "qwertyuiop".includes(c));
    expect(weak.length).toBeGreaterThan(0);
    expect(res.body.questions.every((q: string) => weak.some((c: string) => q.includes(c)))).toBe(true);
  });
});
