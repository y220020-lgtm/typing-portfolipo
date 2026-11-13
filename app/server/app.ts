import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { pickFrom, pickQuestions, QUESTIONS_PER_SESSION } from "./questions";
import { questionPool, ruleFor, weakPool } from "./levelRules";
import { AiQuestionSource, aiConfigFromEnv } from "./aiQuestions";
import {
  TRAINING_QUESTIONS,
  buildLevelTrainingMessages,
  buildTrainingMessages,
  completeTraining,
  fallbackTraining,
  parseTrainingReply,
  summarizeWeakness,
} from "./training";
import { isValidIsoUtcMs, scoreQuestion, scoreSession, type LogRecord } from "../shared/score";
import { DEFAULT_KEYBOARD_NAME, DEFAULT_KEYS } from "./defaultKeys";
import { DEFAULT_PRACTICE_KEYBOARD, TEMPLATES, templateKeys, type Template } from "./keyTemplates";
import { charStats, csvCell, fingerStats, summarizeSessions, type AnalysisLog, type KeyRow } from "../shared/analysis";
import { assignmentProgress, passed, type Assignment } from "../shared/goals";
import {
  TokenStore,
  authModeFromEnv,
  readProxyIdentity,
  requireLogin,
  optionalLogin as optionalLoginOf,
  requireRole,
  teacherConfigFromEnv,
  type AuthMode,
  type AuthUser,
  type ProxyResolver,
  type TeacherConfig,
} from "./auth";

// 時刻の許容誤差（通信の遅れ・端末の時計のずれ）。画面はサーバー時刻との差を補正して送る。
const CLOCK_SLACK_MS = 5_000;
// プレイの有効期限（これを過ぎたプレイには記録を追加できない）
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
// 入力できる文字数の上限（出題の文字数 ＋ この値）
const MAX_EXTRA_TYPED = 200;

// 出題中のプレイ。問題文・レベル・キーボードはサーバーが決めて覚えておき、
// 記録の保存時にはここから取り出す（画面から送られた値は使わない）。
interface PlaySession {
  userId: string;
  levelId: number;
  keyboardId: number | null;
  questions: string[];
  startedAt: number; // サーバーがプレイを始めた時刻（ミリ秒）
  lastEnd: number; // 最後に保存した問題の end_time（ミリ秒）。まだなければ startedAt
  nextQuestion: number; // 次に保存できる問題番号（1 から順番どおり）
}

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

export interface AppOptions {
  teachers?: TeacherConfig;
  now?: () => number; // 現在時刻（テスト用に差し替えられる）
  auth?: AuthMode; // 省略時は環境変数（AUTH_MODE など）から作る
  ai?: AiQuestionSource | null; // 省略時は環境変数（AI_BASE_URL など）から作る。null なら AI を使わない
}

export function createApp(db: DB, options: AppOptions = {}) {
  const teachers = options.teachers ?? teacherConfigFromEnv();
  const aiConfig = aiConfigFromEnv();
  const ai = options.ai !== undefined ? options.ai : aiConfig ? new AiQuestionSource(aiConfig) : null;
  const now = options.now ?? Date.now;
  const tokens = new TokenStore(now);
  const auth = options.auth ?? authModeFromEnv();
  // SSO（proxy 方式）: 要求ごとに oauth2-proxy のヘッダーから本人を決める
  const proxy: ProxyResolver | undefined =
    auth.mode === "proxy"
      ? (req) => {
          const id = readProxyIdentity(auth, (name) => req.get(name));
          if (!id.ok) return { status: id.status, error: id.error };
          // 教員は users に登録しない前提。名前はメールの @ より前（学生と ID が重なっても学生の名前は使わない）
          if (id.kind === "teacher") return { user: { id: id.email, name: id.studentId, role: "teacher" } };
          const row = db.prepare("SELECT id, name FROM users WHERE id = ?").get(id.studentId) as { id: string; name: string } | undefined;
          if (!row) return { status: 403, error: `${id.studentId} は登録されていません。教員に登録を依頼してください` };
          return { user: { ...row, role: "student" } };
        }
      : undefined;
  const sessions = new Map<string, PlaySession>();
  // 期限切れのプレイを片付ける（プレイ開始のたびに行う。メモリが増え続けないように）
  function sweepSessions() {
    for (const [id, s] of sessions) if (now() - s.startedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  const login = requireLogin(tokens, proxy);
  const optionalLogin = optionalLoginOf(tokens, proxy);
  // 練習の API（レベル選択・プレイ・記録・キーボード・自分の分析）は、教員も学生の画面で使える
  const practiceRole = requireRole("student", "teacher");
  const student = (req: Request, res: Response, next: NextFunction) =>
    practiceRole(req, res, () => {
      if (req.user!.role === "teacher") insertTeacherUser.run(req.user!.id, req.user!.name);
      next();
    });
  const teacher = requireRole("teacher");

  // 教員の ID（ID のログインは TEACHER_IDS、SSO は TEACHER_EMAILS）。教員が学生の画面で練習した記録は、
  // 教員の画面の集計（学生一覧・課題・クラス全体の苦手）から除く（CSV は生データなので全部出す。user_id で見分けられる）
  const teacherIds = new Set([...teachers.ids, ...(auth.mode === "proxy" ? auth.teacherEmails : [])]);
  const isStudentId = (id: string) => !teacherIds.has(id);
  // 教員が練習の機能を使うとき、logs・keyboards の外部キーのために users に行を作る（名前は表示中の名前。初回だけ）
  const insertTeacherUser = db.prepare("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)");

  function keyboardUsable(keyboardId: number | null, userId: string): boolean {
    if (keyboardId === null) return true;
    return !!db.prepare("SELECT 1 FROM keyboards WHERE id = ? AND user_id = ? AND is_active = 1").get(keyboardId, userId);
  }

  // プレイを始める: 問題文・レベル・キーボードをサーバーが覚えておき、記録の保存時に使う
  function openSession(userId: string, level: { id: number; title: string }, keyboardId: number | null, questions: string[], source: string) {
    sweepSessions();
    const sessionId = randomUUID();
    const startedAt = now();
    sessions.set(sessionId, { userId, levelId: level.id, keyboardId, questions, startedAt, lastEnd: startedAt, nextQuestion: 1 });
    return {
      sessionId,
      level: { id: level.id, title: level.title },
      questions,
      source,
      serverTime: new Date(startedAt).toISOString(), // 画面はこれと自分の時計の差を補正して時刻を送る
      // 画面のキーボードの表示用: このプレイで使うキーボードのキーと指の割り当て（キーボードを選ばなければ空）
      keys:
        keyboardId === null
          ? []
          : (db.prepare("SELECT char, finger FROM keys WHERE keyboard_id = ?").all(keyboardId) as { char: string; finger: string }[]),
      layout:
        keyboardId === null
          ? "jis"
          : ((db.prepare("SELECT layout FROM keyboards WHERE id = ?").get(keyboardId) as { layout: string } | undefined)?.layout ?? "jis"),
    };
  }

  // 1 人分の学習分析（プレイごとの推移・苦手な文字・苦手な指）
  function analysisOf(userId: string) {
    const logs = db
      .prepare(
        `SELECT session_id, level_id, keyboard_id, question_num, target, typed, start_time, end_time
         FROM logs WHERE user_id = ? ORDER BY start_time, id`,
      )
      .all(userId) as AnalysisLog[];
    const keys = db
      .prepare("SELECT k.keyboard_id, k.char, k.finger FROM keys k JOIN keyboards b ON b.id = k.keyboard_id WHERE b.user_id = ?")
      .all(userId) as KeyRow[];
    const levels = db.prepare("SELECT id, title FROM levels").all() as { id: number; title: string }[];
    const levelTitle = new Map(levels.map((l) => [l.id, l.title]));
    return {
      total: scoreSession(logs),
      sessions: summarizeSessions(logs).map((s) => ({ ...s, levelTitle: levelTitle.get(s.levelId) ?? "" })),
      chars: charStats(logs),
      fingers: fingerStats(logs, keys),
    };
  }

  const app = express();
  app.use(express.json());

  // ログイン。学生は学籍番号（users に登録済み）だけで入れる（設計どおりパスワードなし）。
  // 教員は TEACHER_IDS に含まれる ID で入る（合言葉なし）。
  // 画面がログインの方式を知るため（proxy 方式ではログイン画面を出さない）
  app.get("/api/auth-mode", (_req, res) => res.json(auth.mode === "proxy" ? { mode: auth.mode, signOutUrl: auth.signOutUrl } : { mode: auth.mode }));

  app.post("/api/login", (req: Request, res: Response) => {
    if (auth.mode === "proxy") return res.status(404).json({ error: "大学のアカウントでログインしてください" });
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    const row = db.prepare("SELECT id, name FROM users WHERE id = ?").get(id) as { id: string; name: string } | undefined;
    let user: AuthUser;
    if (id !== "" && teachers.ids.includes(id)) {
      // 教員は TEACHER_IDS の ID だけで入れる（2026-11-13 本人の指示で合言葉をなくした）
      user = { id, name: row?.name ?? id, role: "teacher" };
    } else {
      if (!row) return res.status(404).json({ error: "その学籍番号は登録されていません" });
      user = { ...row, role: "student" };
    }
    res.json({ token: tokens.issue(user), user });
  });

  app.post("/api/logout", login, (req, res) => {
    // proxy 方式のログアウトは oauth2-proxy 側（/oauth2/sign_out）で行う
    if (req.token) tokens.revoke(req.token);
    res.status(204).end();
  });

  app.get("/api/me", login, (req, res) => res.json(req.user));

  // ステージとレベルの一覧（sort_order 順）。非表示（is_active = 0）のステージ・レベルは出さない
  app.get("/api/stages", optionalLogin, (req, res) => {
    const stages = db.prepare("SELECT id, title, description FROM stages WHERE is_active = 1 ORDER BY sort_order, id").all() as { id: number }[];
    const levels = db
      .prepare("SELECT id, stage_id, title, description, pass_accuracy FROM levels WHERE is_active = 1 ORDER BY sort_order, id")
      .all() as { id: number; stage_id: number; pass_accuracy: number | null }[];
    // ログイン中の学生なら、レベルごとに合格したか（logs から計算）
    const passedLevels = new Set<number>();
    if (req.user?.role === "student") {
      for (const s of analysisOf(req.user.id).sessions) {
        const pa = levels.find((l) => l.id === s.levelId)?.pass_accuracy ?? null;
        if (passed(s, pa)) passedLevels.add(s.levelId);
      }
    }
    res.json(
      stages.map((s) => ({
        ...s,
        levels: levels.filter((l) => l.stage_id === s.id).map((l) => ({ ...l, passed: passedLevels.has(l.id) })),
      })),
    );
  });

  // 自分の有効なキーボード
  app.get("/api/me/keyboards", login, student, (req, res) => {
    ensureKeyboard(req.user!.id);
    res.json(db.prepare("SELECT id, name, layout FROM keyboards WHERE user_id = ? AND is_active = 1 ORDER BY id").all(req.user!.id));
  });

  const bad = (res: Response, errors: string[]) => res.status(400).json({ error: `入力が不正です: ${errors.join(", ")}` });
  const insertKeyboard = db.prepare("INSERT INTO keyboards (user_id, name, is_active, layout) VALUES (?, ?, 1, ?)");
  // キーの並び（画面のキーボードの形）。keyboards.layout
  // free = 自由な配列（組み替えたキーボード・キーの少ないキーボードなど。画面には登録したキーを指ごとに並べて出す）
  const LAYOUTS = ["jis", "us", "keyball44", "free"] as const;
  const isLayout = (v: unknown): v is (typeof LAYOUTS)[number] => typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
  const insertKey = db.prepare("INSERT INTO keys (keyboard_id, char, finger) VALUES (?, ?, ?)");
  // 有効なキーボードが 1 台もない人（教員・キーボードを全部削除した学生など）には、最初から使える標準のキーボードを作る（2026-11-13 本人の指示）。
  // JIS 配列の標準の割り当て（keyTemplates.ts）。名前は DEFAULT_PRACTICE_KEYBOARD
  function ensureKeyboard(userId: string) {
    if (db.prepare("SELECT 1 FROM keyboards WHERE user_id = ? AND is_active = 1").get(userId)) return;
    db.transaction(() => {
      const kb = Number(insertKeyboard.run(userId, DEFAULT_PRACTICE_KEYBOARD, "jis").lastInsertRowid);
      for (const k of templateKeys("jis")) insertKey.run(kb, k.char, k.finger);
    })();
  }
  // ---- 学生: キーボードの設定（追加・名前の変更・削除・キーと指の割り当て） ----
  // データベース仕様書 ④⑤: キーボードはユーザーごとに持ち、名前は自由。削除は is_active = 0（記録を守るため行は残す）。
  // keys は文字と担当の指（L1〜L5 / R1〜R5。同時押しは L5+L2 のように + でつなぐ）。
  // 記録のあるキーボードの割り当ては変えない（過去の記録の指ごとの分析が変わってしまうため）。変えたいときは写して新しいキーボードにする。
  const FINGER = /^[LR][1-5](\+[LR][1-5])*$/;
  function myKeyboard(id: string, userId: string) {
    return db.prepare("SELECT id, name, layout FROM keyboards WHERE id = ? AND user_id = ? AND is_active = 1").get(id, userId) as
      { id: number; name: string; layout: string } | undefined;
  }
  const keyboardUsed = (id: number) => !!db.prepare("SELECT 1 FROM logs WHERE keyboard_id = ? LIMIT 1").get(id);
  function keyboardName(v: unknown): string | null {
    const name = typeof v === "string" ? v.trim() : "";
    return name !== "" && Array.from(name).length <= 50 ? name : null;
  }
  // keys の入力を確かめる（[{ char, finger }]。char は 1〜20 文字で重複なし、finger は上の形）
  function keyRows(v: unknown): { rows: { char: string; finger: string }[]; errors: string[] } {
    const errors: string[] = [];
    if (!Array.isArray(v) || v.length === 0 || v.length > 200) return { rows: [], errors: ["keys（1〜200 個）"] };
    const rows: { char: string; finger: string }[] = [];
    const seen = new Set<string>();
    for (const k of v as { char?: unknown; finger?: unknown }[]) {
      const char = typeof k?.char === "string" ? k.char.trim() : "";
      const finger = typeof k?.finger === "string" ? k.finger.trim().toUpperCase() : "";
      if (char === "" || Array.from(char).length > 20) errors.push(`キー「${String(k?.char ?? "")}」`);
      else if (seen.has(char)) errors.push(`キー「${char}」が重複しています`);
      if (!FINGER.test(finger)) errors.push(`キー「${char}」の指「${String(k?.finger ?? "")}」（L1〜L5・R1〜R5）`);
      seen.add(char);
      rows.push({ char, finger });
    }
    return { rows, errors };
  }
  const myKeysOf = (id: number) =>
    db.prepare("SELECT char, finger FROM keys WHERE keyboard_id = ? ORDER BY id").all(id) as { char: string; finger: string }[];

  // 一覧（キーの割り当てと、記録があるか＝割り当てを変えられるか）
  app.get("/api/me/keyboard-settings", login, student, (req, res) => {
    ensureKeyboard(req.user!.id);
    const list = db.prepare("SELECT id, name, layout FROM keyboards WHERE user_id = ? AND is_active = 1 ORDER BY id").all(req.user!.id) as {
      id: number;
      name: string;
      layout: string;
    }[];
    res.json({
      keyboards: list.map((k) => ({ ...k, used: keyboardUsed(k.id), keys: myKeysOf(k.id) })),
      defaultName: DEFAULT_KEYBOARD_NAME,
      defaultKeys: DEFAULT_KEYS.map(([char, finger]) => ({ char, finger })),
    });
  });
  // 追加。body: { name, layout?, copyFrom?: 自分のキーボードの id, template?: 初めの割り当て（keyball44・jis・us・empty） }
  // copyFrom があればその写し。なければ template（省略時は layout と同じ形のひな形、free なら空）
  app.post("/api/me/keyboards", login, student, (req, res) => {
    const name = keyboardName(req.body?.name);
    if (!name) return bad(res, ["name（1〜50 文字）"]);
    const from = req.body?.copyFrom;
    if (req.body?.layout !== undefined && !isLayout(req.body.layout)) return bad(res, ["layout（jis・us・keyball44・free）"]);
    const template = req.body?.template;
    if (template !== undefined && !(TEMPLATES as readonly string[]).includes(template)) return bad(res, ["template（keyball44・jis・us・empty）"]);
    let keys: { char: string; finger: string }[];
    let layout: string = req.body?.layout ?? "keyball44";
    if (from === undefined || from === null) keys = templateKeys(template ?? (layout === "free" ? "empty" : (layout as Template)));
    else {
      const src = isId(from) ? myKeyboard(String(from), req.user!.id) : undefined;
      if (!src)
        return res
          .status(400)
          .json({ error: "写し元のキーボードが見つかりません。削除された可能性があります。画面を再読み込みしてから、もう一度お試しください。" });
      keys = myKeysOf(src.id);
      layout = req.body?.layout ?? src.layout;
    }
    const id = db.transaction(() => {
      const kb = Number(insertKeyboard.run(req.user!.id, name, layout).lastInsertRowid);
      for (const k of keys) insertKey.run(kb, k.char, k.finger);
      return kb;
    })();
    res.status(201).json({ id });
  });
  // 名前・割り当ての変更。body: { name?, keys? }（keys は全部を置き換える。記録のあるキーボードは 409）
  app.patch("/api/me/keyboards/:id", login, student, (req, res) => {
    const kb = myKeyboard(String(req.params.id), req.user!.id);
    if (!kb) return res.status(404).json({ error: "キーボードが見つかりません" });
    const b = req.body ?? {};
    const name = b.name === undefined ? undefined : keyboardName(b.name);
    if (name === null) return bad(res, ["name（1〜50 文字）"]);
    // 並び（画面のキーボードの形）は指の分析に使わないので、記録があっても変えられる
    if (b.layout !== undefined && !isLayout(b.layout)) return bad(res, ["layout（jis・us・keyball44・free）"]);
    let rows: { char: string; finger: string }[] | undefined;
    if (b.keys !== undefined) {
      const r = keyRows(b.keys);
      if (r.errors.length) return bad(res, r.errors);
      if (keyboardUsed(kb.id))
        return res.status(409).json({ error: "練習の記録があるキーボードの割り当ては変えられません（写して新しいキーボードにしてください）" });
      rows = r.rows;
    }
    db.transaction(() => {
      if (name) db.prepare("UPDATE keyboards SET name = ? WHERE id = ?").run(name, kb.id);
      if (b.layout !== undefined) db.prepare("UPDATE keyboards SET layout = ? WHERE id = ?").run(b.layout, kb.id);
      if (rows) {
        db.prepare("DELETE FROM keys WHERE keyboard_id = ?").run(kb.id);
        for (const k of rows) insertKey.run(kb.id, k.char, k.finger);
      }
    })();
    res.status(204).end();
  });
  // 削除（is_active = 0。keys と記録は残し、過去の記録の指ごとの分析は変わらない）
  app.delete("/api/me/keyboards/:id", login, student, (req, res) => {
    const kb = myKeyboard(String(req.params.id), req.user!.id);
    if (!kb) return res.status(404).json({ error: "キーボードが見つかりません" });
    db.prepare("UPDATE keyboards SET is_active = 0 WHERE id = ?").run(kb.id);
    res.status(204).end();
  });

  // 1 回のプレイを始める: session_id と問題を返す（この時点では DB に書かない）
  // AI が使えるときは levels.prompt で生成した問題（キャッシュ）から、使えないときは固定問題から出す。
  app.post("/api/sessions", login, student, async (req, res) => {
    const levelId = req.body?.levelId;
    const keyboardId = req.body?.keyboardId ?? null;
    if (!isId(levelId)) return res.status(400).json({ error: "入力が不正です: levelId" });
    if (keyboardId !== null && !isId(keyboardId)) return res.status(400).json({ error: "入力が不正です: keyboardId" });
    // 非表示のレベルや、非表示のステージに属するレベルでは始められない
    const level = db
      .prepare(
        `SELECT v.id, v.title, v.prompt FROM levels v JOIN stages s ON s.id = v.stage_id
         WHERE v.id = ? AND v.is_active = 1 AND s.is_active = 1`,
      )
      .get(levelId) as { id: number; title: string; prompt: string } | undefined;
    if (!level) return res.status(404).json({ error: "レベルが見つかりません" });
    if (!keyboardUsable(keyboardId, req.user!.id)) return res.status(400).json({ error: "そのキーボードは使えません" });
    // 間違えた問題だけをもう一度: retryOf に自分の前のプレイを指定すると、そのプレイでミスのあった問題を出す
    const retryOf = req.body?.retryOf;
    if (retryOf !== undefined) {
      if (typeof retryOf !== "string") return res.status(400).json({ error: "入力が不正です: retryOf" });
      const prev = db
        .prepare("SELECT user_id, level_id, target, typed, start_time, end_time FROM logs WHERE session_id = ? ORDER BY question_num, id")
        .all(retryOf) as (LogRecord & { user_id: string; level_id: number })[];
      if (prev.length === 0 || prev[0].user_id !== req.user!.id || prev[0].level_id !== level.id)
        return res.status(404).json({ error: "前のプレイが見つかりません" });
      const missed = [...new Set(prev.filter((l) => scoreQuestion(l).accuracy < 1).map((l) => l.target))];
      if (missed.length === 0) return res.status(400).json({ error: "間違えた問題はありません" });
      return res.json(openSession(req.user!.id, level, keyboardId, missed, "retry"));
    }
    // レベルの決まり（使ってよい文字など）に合わない AI の問題は出さず、足りない分は決まりに合う問題で補う
    const rule = ruleFor(level);
    const prompt = rule ? `${level.prompt}\n守ること: ${rule.hint}` : level.prompt;
    const generated = ai ? await ai.questionsFor(level.id, prompt) : null;
    const { pool, fromAi } = questionPool(rule, generated, QUESTIONS_PER_SESSION);
    const questions = pool.length > 0 ? pickFrom(pool) : pickQuestions(level.id);
    res.json(openSession(req.user!.id, level, keyboardId, questions, fromAi ? "ai" : "fixed"));
  });

  // ---- 苦手克服トレーニング ----
  // 学生の記録から弱点を要約して LLM に送り、弱点を補う次の問題を作らせる（LLM が使えなければ、苦手な文字で規則的に作る）。
  // 記録の保存先は、専用のレベル「苦手克服トレーニング」（なければ作る。ステージごと非表示にして、学生のレベル一覧には出さない）。
  const TRAINING_STAGE = "苦手克服";
  const TRAINING_LEVEL = "苦手克服トレーニング";
  function trainingLevel(): { id: number; title: string } {
    const found = db
      .prepare("SELECT v.id, v.title FROM levels v JOIN stages s ON s.id = v.stage_id WHERE s.title = ? AND v.title = ?")
      .get(TRAINING_STAGE, TRAINING_LEVEL) as { id: number; title: string } | undefined;
    if (found) return found;
    return db.transaction(() => {
      const stage = Number(
        db
          .prepare("INSERT INTO stages (sort_order, title, description, is_active) VALUES (99, ?, ?, 0)")
          .run(TRAINING_STAGE, "学生ごとの弱点に合わせて自動で作る問題（「苦手克服トレーニング」の記録用）").lastInsertRowid,
      );
      const id = Number(
        db
          .prepare("INSERT INTO levels (stage_id, sort_order, title, description, prompt, is_active) VALUES (?, 1, ?, ?, ?, 1)")
          .run(
            stage,
            TRAINING_LEVEL,
            "弱点を分析して問題を作る",
            "学生の弱点の要約をもとに、弱点を補う練習問題を作る（指示はサーバーが学生ごとに作る）",
          ).lastInsertRowid,
      );
      return { id, title: TRAINING_LEVEL };
    })();
  }

  app.post("/api/training/next", login, student, async (req, res) => {
    const keyboardId = req.body?.keyboardId ?? null;
    if (keyboardId !== null && !isId(keyboardId)) return res.status(400).json({ error: "入力が不正です: keyboardId" });
    if (!keyboardUsable(keyboardId, req.user!.id)) return res.status(400).json({ error: "そのキーボードは使えません" });
    const a = analysisOf(req.user!.id);
    const recent = db
      .prepare("SELECT target, typed, start_time, end_time FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 50")
      .all(req.user!.id)
      .reverse() as LogRecord[];
    const level = trainingLevel();
    // まだ記録がなければ、弱点が分からないので、まずホームポジションの問題で記録を取る
    if (recent.length === 0) {
      const questions = pickQuestions(-1, TRAINING_QUESTIONS);
      return res.json({
        ...openSession(req.user!.id, level, keyboardId, completeTraining(questions, null), "fixed"),
        analysis: "まだ練習の記録がないので、まずはホームポジションの問題で記録を取ります。解き終わると、結果から苦手を分析して次の問題を作ります。",
        weakness: null,
      });
    }
    // トレーニングを解いた回数（プレイの数）。難しさの段階を決めるのに使う
    const rounds = (
      db.prepare("SELECT count(DISTINCT session_id) c FROM logs WHERE user_id = ? AND level_id = ?").get(req.user!.id, level.id) as { c: number }
    ).c;
    const w = summarizeWeakness(recent, a.chars, a.fingers, rounds);
    let result: { analysis: string; questions: string[] } | null = null;
    let source: "ai" | "rule" = "rule";
    if (ai) {
      const content = await ai.chat(buildTrainingMessages(w), "苦手克服の問題生成");
      result = content === null ? null : parseTrainingReply(content);
      if (result) source = "ai";
      else if (content !== null) console.warn("苦手克服の問題生成に失敗しました（返答から問題を読み取れません）");
    }
    result ??= fallbackTraining(w);
    // 苦手な文字がない（全部正解など）ときは、少し長めの通常の問題で続ける
    result ??= {
      analysis: "大きな苦手は見つかりませんでした。少し長めの問題で速さを伸ばしましょう。",
      questions: pickQuestions(3, TRAINING_QUESTIONS),
    };
    res.json({
      ...openSession(req.user!.id, level, keyboardId, completeTraining(result.questions, w), source),
      analysis: result.analysis,
      weakness: w,
    });
  });

  // レベルごとの苦手克服: そのレベルの最近の記録から弱点を分析し、そのレベルの範囲（levelRules の決まり）で苦手を補う問題を出す。
  // 記録はそのレベルの記録として保存する（合格・課題の数え方も通常のプレイと同じ）
  app.post("/api/levels/:id/training", login, student, async (req, res) => {
    const levelId = Number(req.params.id);
    const keyboardId = req.body?.keyboardId ?? null;
    if (!isId(levelId)) return res.status(400).json({ error: "入力が不正です: levelId" });
    if (keyboardId !== null && !isId(keyboardId)) return res.status(400).json({ error: "入力が不正です: keyboardId" });
    const level = db
      .prepare(
        `SELECT v.id, v.title, v.prompt FROM levels v JOIN stages s ON s.id = v.stage_id
         WHERE v.id = ? AND v.is_active = 1 AND s.is_active = 1`,
      )
      .get(levelId) as { id: number; title: string; prompt: string } | undefined;
    if (!level) return res.status(404).json({ error: "レベルが見つかりません" });
    if (!keyboardUsable(keyboardId, req.user!.id)) return res.status(400).json({ error: "そのキーボードは使えません" });
    const rule = ruleFor(level);
    // 分析には、そのレベルの範囲に合う問題の記録だけを使う（範囲の外の問題が出ていた頃の記録で、範囲の外の文字を苦手としない）
    const logs = (
      db
        .prepare(
          `SELECT session_id, level_id, keyboard_id, question_num, target, typed, start_time, end_time
           FROM logs WHERE user_id = ? AND level_id = ? ORDER BY id DESC`,
        )
        .all(req.user!.id, level.id) as AnalysisLog[]
    )
      .filter((l) => !rule || rule.accepts(l.target))
      .slice(0, 50)
      .reverse();
    if (logs.length === 0) return res.status(400).json({ error: "このレベルの記録がまだありません。先に一度解いてください" });
    const keys = db
      .prepare("SELECT k.keyboard_id, k.char, k.finger FROM keys k JOIN keyboards b ON b.id = k.keyboard_id WHERE b.user_id = ?")
      .all(req.user!.id) as KeyRow[];
    const rounds = (
      db.prepare("SELECT count(DISTINCT session_id) c FROM logs WHERE user_id = ? AND level_id = ?").get(req.user!.id, level.id) as { c: number }
    ).c;
    const summary = summarizeWeakness(logs, charStats(logs), fingerStats(logs, keys), rounds);
    // キーの練習のレベルでは、苦手な文字もそのレベルのキーに限る
    const w = rule?.keys ? { ...summary, weakChars: summary.weakChars.filter((c) => rule.keys!.includes(c.char)) } : summary;
    const weak = w.weakChars.map((c) => c.char);
    let analysis = "";
    let fromAi: string[] = [];
    if (ai) {
      const content = await ai.chat(
        buildLevelTrainingMessages(w, { title: level.title, prompt: level.prompt, hint: rule?.hint ?? null }),
        "レベルの苦手克服の問題生成",
      );
      const reply = content === null ? null : parseTrainingReply(content);
      if (reply) {
        analysis = reply.analysis;
        // レベルの範囲の外の問題は出さない
        fromAi = rule ? reply.questions.filter((q) => rule.accepts(q)) : reply.questions;
      } else if (content !== null) console.warn("レベルの苦手克服の問題生成に失敗しました（返答から問題を読み取れません）");
    }
    // 足りない分は、範囲の中で苦手な文字を含む問題（決まりのないレベルは通常の問題）で補う
    const extra = (rule ? weakPool(rule, weak) : pickQuestions(level.id)).filter((q) => !fromAi.includes(q));
    const pool = [...new Set([...fromAi, ...extra])].slice(0, QUESTIONS_PER_SESSION);
    // AI の問題を先に、規則の問題を後に（10 問に足りなければ繰り返す）
    const questions = pool.length >= QUESTIONS_PER_SESSION ? pool : [...pool, ...pickFrom(pool, QUESTIONS_PER_SESSION - pool.length)];
    if (!analysis)
      analysis =
        weak.length > 0
          ? `このレベルでは ${weak.slice(0, 5).join("・")} のミスが多めです。これらを多く含む問題で練習しましょう。`
          : "このレベルでは大きな苦手は見つかりませんでした。同じ範囲の問題で、速さを伸ばしましょう。";
    res.json({ ...openSession(req.user!.id, level, keyboardId, questions, fromAi.length > 0 ? "ai" : "rule"), analysis, weakness: w });
  });

  // 1 問分の記録を保存する（Enter で次の問題へ進んだとき）。logs は追加のみ（あとから直せない）ので、保存前に厳しく確かめる。
  // - 問題番号は 1 から順番どおり。出題文・レベル・キーボード・ユーザーはサーバーが覚えている値を使う
  // - 時刻は実在する日時で、プレイ開始（または前の問題の終了）以降、かつサーバーの現在時刻以前（許容誤差あり）
  // 同じプレイの同じ問題番号を 2 回送った場合（通信の再送など）は、新しい行を作らず既存の行を返す。
  app.post("/api/logs", login, student, (req, res) => {
    const b = req.body ?? {};
    const errors: string[] = [];
    if (typeof b.sessionId !== "string" || b.sessionId === "") errors.push("sessionId");
    if (!isId(b.questionNum)) errors.push("questionNum");
    if (typeof b.typed !== "string") errors.push("typed");
    if (!isValidIsoUtcMs(b.startTime)) errors.push("startTime");
    if (!isValidIsoUtcMs(b.endTime)) errors.push("endTime");
    if (errors.length === 0 && b.endTime < b.startTime) errors.push("endTime");
    if (errors.length > 0) return res.status(400).json({ error: `入力が不正です: ${errors.join(", ")}` });

    const existing = db
      .prepare("SELECT id FROM logs WHERE session_id = ? AND question_num = ? AND user_id = ?")
      .get(b.sessionId, b.questionNum, req.user!.id) as { id: number } | undefined;
    if (existing) return res.status(200).json({ id: existing.id, duplicate: true });

    const s = sessions.get(b.sessionId);
    if (!s || s.userId !== req.user!.id || now() - s.startedAt > SESSION_TTL_MS)
      return res.status(404).json({ error: "プレイが見つからないか、期限が切れています。レベル選択からやり直してください" });
    if (b.questionNum !== s.nextQuestion || b.questionNum > s.questions.length)
      return res.status(400).json({ error: `入力が不正です: questionNum（次は ${s.nextQuestion} 問目）` });
    const target = s.questions[b.questionNum - 1];
    if (Array.from(b.typed as string).length > Array.from(target).length + MAX_EXTRA_TYPED)
      return res.status(400).json({ error: "入力が不正です: typed（長すぎます）" });
    const start = Date.parse(b.startTime);
    const end = Date.parse(b.endTime);
    if (start < s.lastEnd - CLOCK_SLACK_MS) return res.status(400).json({ error: "入力が不正です: startTime（プレイ開始より前）" });
    if (end > now() + CLOCK_SLACK_MS) return res.status(400).json({ error: "入力が不正です: endTime（未来の時刻）" });
    // プレイ中にレベルが削除された場合など
    if (!db.prepare("SELECT 1 FROM levels WHERE id = ?").get(s.levelId)) {
      sessions.delete(b.sessionId);
      return res.status(409).json({ error: "このレベルは削除されました。レベル選択からやり直してください" });
    }

    const info = db
      .prepare(
        `INSERT INTO logs (session_id, user_id, level_id, keyboard_id, question_num, target, typed, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.sessionId, s.userId, s.levelId, s.keyboardId, b.questionNum, target, b.typed, b.startTime, b.endTime);
    s.nextQuestion++;
    s.lastEnd = Math.max(s.lastEnd, end);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // 1 回のプレイの結果（logs から計算する）。学生は自分のプレイだけ見られる。
  app.get("/api/sessions/:sessionId/result", login, (req, res) => {
    const logs = db
      .prepare(
        `SELECT user_id, question_num, target, typed, start_time, end_time FROM logs
         WHERE session_id = ? ORDER BY question_num, id`,
      )
      .all(req.params.sessionId) as (LogRecord & { user_id: string; question_num: number })[];
    if (logs.length === 0 || (req.user!.role === "student" && logs[0].user_id !== req.user!.id))
      return res.status(404).json({ error: "記録が見つかりません" });
    const summary = scoreSession(logs);
    const lv = db
      .prepare(
        "SELECT l.level_id, v.stage_id, v.sort_order, v.pass_accuracy FROM logs l JOIN levels v ON v.id = l.level_id WHERE l.session_id = ? LIMIT 1",
      )
      .get(req.params.sessionId) as { level_id: number; stage_id: number; sort_order: number; pass_accuracy: number | null } | undefined;
    // 次のレベル: 学生の一覧と同じ並び（ステージの表示順 → レベルの表示順）で、このレベルの次の表示中のレベル
    const order = db
      .prepare(
        `SELECT v.id, v.title FROM levels v JOIN stages s ON s.id = v.stage_id WHERE v.is_active = 1 AND s.is_active = 1
         ORDER BY s.sort_order, s.id, v.sort_order, v.id`,
      )
      .all() as { id: number; title: string }[];
    const at = order.findIndex((o) => o.id === lv?.level_id);
    res.json({
      summary,
      levelId: lv?.level_id ?? null,
      passAccuracy: lv?.pass_accuracy ?? null,
      passed: passed({ questions: logs.length, accuracy: summary.accuracy }, lv?.pass_accuracy ?? null),
      nextLevel: at >= 0 && at + 1 < order.length ? order[at + 1] : null,
      questions: logs.map((l) => ({ questionNum: l.question_num, target: l.target, typed: l.typed, ...scoreQuestion(l) })),
    });
  });

  // ---- 教員: ステージ・レベルの管理（表示順・タイトル・説明・AI への指示文・表示/非表示） ----
  // 削除: 記録（logs）のないレベルは行ごと消す。記録のあるレベルは、記録を守るため行を残して is_active = 0 にする
  // （logs は追加のみで消せず、レベルを参照しているため）。どちらも管理と学生の画面から消え、出題されない。
  // ステージの削除は、中のレベルを同じように削除し、記録のあるレベルが残らなければステージも行ごと消す（2026-10-23 本人の指示で「非表示」を「削除」に統一）。

  function text(v: unknown, required: boolean): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || (typeof v === "string" && v.trim() === "")) return required ? undefined : null;
    return typeof v === "string" ? v.trim() : undefined;
  }
  function stageInput(b: Record<string, unknown>, creating: boolean) {
    const errors: string[] = [];
    const title = text(b.title, true);
    const description = text(b.description, false);
    if ((creating || b.title !== undefined) && typeof title !== "string") errors.push("title");
    if (b.description !== undefined && description === undefined) errors.push("description");
    if (b.sort_order !== undefined && !Number.isInteger(b.sort_order)) errors.push("sort_order");
    if (b.is_active !== undefined && b.is_active !== 0 && b.is_active !== 1) errors.push("is_active");
    return { errors, title, description, sort_order: b.sort_order as number | undefined, is_active: b.is_active as 0 | 1 | undefined };
  }
  function levelInput(b: Record<string, unknown>, creating: boolean) {
    const base = stageInput(b, creating);
    const prompt = text(b.prompt, true);
    if ((creating || b.prompt !== undefined) && typeof prompt !== "string") base.errors.push("prompt");
    if ((creating || b.stage_id !== undefined) && !Number.isInteger(b.stage_id)) base.errors.push("stage_id");
    // 合格の目安（正確率。0 より大きく 1 以下）。null なら目安なし（自由に練習するレベル）
    const pa = b.pass_accuracy;
    if (pa !== undefined && pa !== null && !(typeof pa === "number" && pa > 0 && pa <= 1)) base.errors.push("pass_accuracy（0〜1）");
    return { ...base, prompt, stage_id: b.stage_id as number | undefined, pass_accuracy: pa as number | null | undefined };
  }
  const stageExists = (id: unknown) => db.prepare("SELECT 1 FROM stages WHERE id = ? AND is_active = 1").get(id) !== undefined;

  // 管理用の一覧（prompt と記録の件数も返す）
  app.get("/api/teacher/stages", login, teacher, (_req, res) => {
    const stages = db
      .prepare("SELECT id, sort_order, title, description, is_active FROM stages WHERE is_active = 1 ORDER BY sort_order, id")
      .all() as { id: number }[];
    const levels = db
      .prepare(
        `SELECT v.id, v.stage_id, v.sort_order, v.title, v.description, v.prompt, v.is_active, v.pass_accuracy,
                (SELECT count(*) FROM logs l WHERE l.level_id = v.id) AS logCount
         FROM levels v WHERE v.is_active = 1 ORDER BY v.sort_order, v.id`,
      )
      .all() as { stage_id: number }[];
    res.json(stages.map((s) => ({ ...s, levels: levels.filter((l) => l.stage_id === s.id) })));
  });

  app.post("/api/teacher/stages", login, teacher, (req, res) => {
    const v = stageInput(req.body ?? {}, true);
    if (v.errors.length) return bad(res, v.errors);
    const info = db
      .prepare("INSERT INTO stages (sort_order, title, description) VALUES (?, ?, ?)")
      .run(v.sort_order ?? 0, v.title, v.description ?? null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.patch("/api/teacher/stages/:id", login, teacher, (req, res) => {
    if (!stageExists(req.params.id)) return res.status(404).json({ error: "ステージが見つかりません" });
    const v = stageInput(req.body ?? {}, false);
    if (v.errors.length) return bad(res, v.errors);
    db.prepare(
      `UPDATE stages SET sort_order = coalesce(?, sort_order), title = coalesce(?, title),
       description = CASE WHEN ? THEN ? ELSE description END, is_active = coalesce(?, is_active) WHERE id = ?`,
    ).run(v.sort_order ?? null, v.title ?? null, v.description !== undefined ? 1 : 0, v.description ?? null, v.is_active ?? null, req.params.id);
    res.status(204).end();
  });

  app.delete("/api/teacher/stages/:id", login, teacher, (req, res) => {
    if (!db.prepare("SELECT 1 FROM stages WHERE id = ? AND is_active = 1").get(req.params.id))
      return res.status(404).json({ error: "ステージが見つかりません" });
    const ids = (db.prepare("SELECT id FROM levels WHERE stage_id = ?").all(req.params.id) as { id: number }[]).map((r) => r.id);
    db.transaction(() => {
      for (const id of ids) removeLevel(id);
      if (db.prepare("SELECT 1 FROM levels WHERE stage_id = ?").get(req.params.id))
        db.prepare("UPDATE stages SET is_active = 0 WHERE id = ?").run(req.params.id);
      else db.prepare("DELETE FROM stages WHERE id = ?").run(req.params.id);
    })();
    res.status(204).end();
  });

  app.post("/api/teacher/levels", login, teacher, (req, res) => {
    const v = levelInput(req.body ?? {}, true);
    if (v.errors.length) return bad(res, v.errors);
    if (!stageExists(v.stage_id)) return bad(res, ["stage_id"]);
    const info = db
      .prepare("INSERT INTO levels (stage_id, sort_order, title, description, prompt, pass_accuracy) VALUES (?, ?, ?, ?, ?, ?)")
      .run(v.stage_id, v.sort_order ?? 0, v.title, v.description ?? null, v.prompt, v.pass_accuracy ?? null);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.patch("/api/teacher/levels/:id", login, teacher, (req, res) => {
    if (!db.prepare("SELECT 1 FROM levels WHERE id = ?").get(req.params.id)) return res.status(404).json({ error: "レベルが見つかりません" });
    const v = levelInput(req.body ?? {}, false);
    if (v.errors.length) return bad(res, v.errors);
    if (v.stage_id !== undefined && !stageExists(v.stage_id)) return bad(res, ["stage_id"]);
    db.prepare(
      `UPDATE levels SET stage_id = coalesce(?, stage_id), sort_order = coalesce(?, sort_order), title = coalesce(?, title),
       description = CASE WHEN ? THEN ? ELSE description END, prompt = coalesce(?, prompt), is_active = coalesce(?, is_active),
       pass_accuracy = CASE WHEN ? THEN ? ELSE pass_accuracy END
       WHERE id = ?`,
    ).run(
      v.stage_id ?? null,
      v.sort_order ?? null,
      v.title ?? null,
      v.description !== undefined ? 1 : 0,
      v.description ?? null,
      v.prompt ?? null,
      v.is_active ?? null,
      v.pass_accuracy !== undefined ? 1 : 0,
      v.pass_accuracy ?? null,
      req.params.id,
    );
    // 指示文が変わったら、古い指示文で作った AI の問題は使わない
    if (v.prompt !== undefined) ai?.forget(Number(req.params.id));
    res.status(204).end();
  });

  app.delete("/api/teacher/levels/:id", login, teacher, (req, res) => {
    if (!db.prepare("SELECT 1 FROM levels WHERE id = ? AND is_active = 1").get(req.params.id))
      return res.status(404).json({ error: "レベルが見つかりません" });
    removeLevel(Number(req.params.id));
    res.status(204).end();
  });

  // レベルを削除する（記録があれば行を残して is_active = 0。なければ行ごと消し、AI の問題と始めていたプレイも消す）
  function removeLevel(id: number) {
    if (db.prepare("SELECT 1 FROM logs WHERE level_id = ? LIMIT 1").get(id)) {
      db.prepare("UPDATE levels SET is_active = 0 WHERE id = ?").run(id);
      return;
    }
    db.prepare("DELETE FROM levels WHERE id = ?").run(id);
    ai?.forget(id);
    for (const [sid, s] of sessions) if (s.levelId === id) sessions.delete(sid);
  }

  // ---- 課題（教員が出し、学生が見る）。達成は logs から毎回計算する（shared/goals.ts） ----
  // assignments: レベル・締め切り・必要な回数・正確率の条件。削除は is_active = 0
  type AssignmentRow = {
    id: number;
    title: string;
    level_id: number;
    due_at: string;
    required_plays: number;
    min_accuracy: number | null;
    created_at: string;
  };
  const toAssignment = (r: AssignmentRow): Assignment => ({
    id: r.id,
    title: r.title,
    levelId: r.level_id,
    dueAt: r.due_at,
    requiredPlays: r.required_plays,
    minAccuracy: r.min_accuracy,
    createdAt: r.created_at,
  });
  const activeAssignments = () =>
    (db.prepare("SELECT * FROM assignments WHERE is_active = 1 ORDER BY due_at, id").all() as AssignmentRow[]).map(toAssignment);
  const levelInfo = (id: number) =>
    db.prepare("SELECT id, title, pass_accuracy, is_active FROM levels WHERE id = ?").get(id) as
      { id: number; title: string; pass_accuracy: number | null; is_active: number } | undefined;
  function assignmentInput(b: Record<string, unknown>, creating: boolean) {
    const errors: string[] = [];
    const title = typeof b.title === "string" ? b.title.trim() : undefined;
    if ((creating || b.title !== undefined) && (!title || Array.from(title).length > 100)) errors.push("title（1〜100 文字）");
    if ((creating || b.levelId !== undefined) && !(isId(b.levelId) && levelInfo(b.levelId as number)?.is_active === 1)) errors.push("levelId");
    if ((creating || b.dueAt !== undefined) && !isValidIsoUtcMs(b.dueAt)) errors.push("dueAt");
    if (
      (creating || b.requiredPlays !== undefined) &&
      !(Number.isInteger(b.requiredPlays) && (b.requiredPlays as number) >= 1 && (b.requiredPlays as number) <= 100)
    )
      errors.push("requiredPlays（1〜100）");
    const ma = b.minAccuracy;
    if (ma !== undefined && ma !== null && !(typeof ma === "number" && ma > 0 && ma <= 1)) errors.push("minAccuracy（0〜1）");
    return {
      errors,
      title,
      levelId: b.levelId as number | undefined,
      dueAt: b.dueAt as string | undefined,
      requiredPlays: b.requiredPlays as number | undefined,
      minAccuracy: ma as number | null | undefined,
    };
  }
  const progressFor = (a: Assignment, userId: string) =>
    assignmentProgress(a, analysisOf(userId).sessions, levelInfo(a.levelId)?.pass_accuracy ?? null, now());

  // 教員: 課題の一覧（学生ごとの達成状況つき）
  app.get("/api/teacher/assignments", login, teacher, (_req, res) => {
    const students = (db.prepare("SELECT id, name FROM users ORDER BY id").all() as { id: string; name: string }[]).filter((u) => isStudentId(u.id));
    const sessionsOf = new Map(students.map((u) => [u.id, analysisOf(u.id).sessions]));
    res.json(
      activeAssignments().map((a) => {
        const lv = levelInfo(a.levelId);
        const rows = students.map((u) => ({ ...u, ...assignmentProgress(a, sessionsOf.get(u.id)!, lv?.pass_accuracy ?? null, now()) }));
        return { ...a, levelTitle: lv?.title ?? "", achievedCount: rows.filter((r) => r.achieved).length, students: rows };
      }),
    );
  });
  app.post("/api/teacher/assignments", login, teacher, (req, res) => {
    const v = assignmentInput(req.body ?? {}, true);
    if (v.errors.length) return bad(res, v.errors);
    const info = db
      .prepare("INSERT INTO assignments (title, level_id, due_at, required_plays, min_accuracy, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(v.title, v.levelId, v.dueAt, v.requiredPlays, v.minAccuracy ?? null, new Date(now()).toISOString());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  app.patch("/api/teacher/assignments/:id", login, teacher, (req, res) => {
    if (!db.prepare("SELECT 1 FROM assignments WHERE id = ? AND is_active = 1").get(req.params.id))
      return res.status(404).json({ error: "課題が見つかりません" });
    const v = assignmentInput(req.body ?? {}, false);
    if (v.errors.length) return bad(res, v.errors);
    db.prepare(
      `UPDATE assignments SET title = coalesce(?, title), level_id = coalesce(?, level_id), due_at = coalesce(?, due_at),
       required_plays = coalesce(?, required_plays), min_accuracy = CASE WHEN ? THEN ? ELSE min_accuracy END WHERE id = ?`,
    ).run(
      v.title ?? null,
      v.levelId ?? null,
      v.dueAt ?? null,
      v.requiredPlays ?? null,
      v.minAccuracy !== undefined ? 1 : 0,
      v.minAccuracy ?? null,
      req.params.id,
    );
    res.status(204).end();
  });
  app.delete("/api/teacher/assignments/:id", login, teacher, (req, res) => {
    if (!db.prepare("SELECT 1 FROM assignments WHERE id = ? AND is_active = 1").get(req.params.id))
      return res.status(404).json({ error: "課題が見つかりません" });
    db.prepare("UPDATE assignments SET is_active = 0 WHERE id = ?").run(req.params.id);
    res.status(204).end();
  });
  // 学生: 自分の課題と進み具合（削除されたレベルの課題は出さない）
  app.get("/api/me/assignments", login, student, (req, res) => {
    res.json(
      activeAssignments()
        .map((a) => ({ a, lv: levelInfo(a.levelId) }))
        .filter(({ lv }) => lv?.is_active === 1)
        .map(({ a, lv }) => ({ ...a, levelTitle: lv!.title, ...progressFor(a, req.user!.id) })),
    );
  });

  // 教員: クラス全体の苦手（全学生の記録をまとめた、文字ごと・指ごとのミス率。苦手克服トレーニングの記録も含む）
  app.get("/api/teacher/class-weakness", login, teacher, (_req, res) => {
    const all = db
      .prepare(
        "SELECT user_id, session_id, level_id, keyboard_id, question_num, target, typed, start_time, end_time FROM logs ORDER BY start_time, id",
      )
      .all() as (AnalysisLog & { user_id: string })[];
    const logs = all.filter((l) => isStudentId(l.user_id)); // 教員が練習した記録は除く
    const keys = db.prepare("SELECT keyboard_id, char, finger FROM keys").all() as KeyRow[];
    const students = new Set(logs.map((l) => l.user_id)).size;
    // 2 回以上出た文字だけ、空白は除く（苦手克服と同じ基準）
    res.json({
      students,
      chars: charStats(logs)
        .filter((c) => c.attempts >= 2 && c.char !== " ")
        .slice(0, 10),
      fingers: fingerStats(logs, keys),
    });
  });

  // 自分の学習分析（学生）
  app.get("/api/me/analysis", login, student, (req, res) => res.json(analysisOf(req.user!.id)));

  // 教員: 学生一覧（プレイ回数・問題数・最後に練習した日時・全体の成績）
  app.get("/api/teacher/students", login, teacher, (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.name, count(DISTINCT l.session_id) AS sessions, count(l.id) AS questions, max(l.end_time) AS lastPlayed
         FROM users u LEFT JOIN logs l ON l.user_id = u.id GROUP BY u.id ORDER BY u.id`,
      )
      .all() as { id: string; name: string; sessions: number; questions: number; lastPlayed: string | null }[];
    // 教員が練習のために自動で登録された行は、学生一覧に出さない
    const students = users.filter((u) => isStudentId(u.id));
    const logsOf = db.prepare("SELECT target, typed, start_time, end_time FROM logs WHERE user_id = ?");
    res.json(students.map((u) => ({ ...u, total: scoreSession(logsOf.all(u.id) as LogRecord[]) })));
  });

  // ---- 教員: 学生の追加・名前の変更・削除 ----
  // 学籍番号は半角の英数字・ハイフン・アンダースコア（32 文字まで、小文字にそろえる。SSO ではメールの @ より前と照合するため）。
  // 追加した学生には、標準のキーボードの設定（defaultKeys.ts）を付ける（指ごとのミス率に使う）。
  const STUDENT_ID = /^[a-z0-9_-]{1,32}$/;
  function userInput(b: Record<string, unknown>) {
    const id = typeof b.id === "string" ? b.id.trim().toLowerCase() : "";
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const errors: string[] = [];
    if (!STUDENT_ID.test(id)) errors.push(`学籍番号「${String(b.id ?? "")}」（半角の英数字・- _ で 32 文字まで）`);
    else if ([...teacherIds].map((t) => t.toLowerCase()).includes(id)) errors.push(`学籍番号「${id}」は教員の ID と同じです`);
    if (name === "" || Array.from(name).length > 50) errors.push(`名前「${String(b.name ?? "")}」（1〜50 文字）`);
    return { id, name, errors };
  }
  const insertUser = db.prepare("INSERT INTO users (id, name) VALUES (?, ?)");
  // まとめて追加: 全員を 1 つのトランザクションで登録する（途中の 1 人でも失敗したら誰も登録しない）
  const addUsers = db.transaction((rows: { id: string; name: string }[], withKeyboard: boolean) => {
    for (const r of rows) {
      insertUser.run(r.id, r.name);
      if (withKeyboard) {
        const kb = Number(insertKeyboard.run(r.id, DEFAULT_KEYBOARD_NAME, "keyball44").lastInsertRowid);
        for (const [char, finger] of DEFAULT_KEYS) insertKey.run(kb, char, finger);
      }
    }
  });

  // body: { users: [{ id, name }, ...], keyboard?: boolean（既定 true） }
  app.post("/api/teacher/users", login, teacher, (req, res) => {
    const list = req.body?.users;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500)
      return res.status(400).json({ error: "追加する学生を 1〜500 人で指定してください" });
    const withKeyboard = req.body?.keyboard !== false;
    const rows = list.map((u) => userInput(typeof u === "object" && u ? u : {}));
    const errors = rows.flatMap((r, i) => r.errors.map((e) => `${i + 1} 人目: ${e}`));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (r.id && seen.has(r.id)) errors.push(`${i + 1} 人目: 学籍番号「${r.id}」が重複しています`);
      seen.add(r.id);
    });
    const exists = db.prepare("SELECT 1 FROM users WHERE id = ?");
    rows.forEach((r, i) => {
      if (r.errors.length === 0 && exists.get(r.id)) errors.push(`${i + 1} 人目: 学籍番号「${r.id}」はすでに登録されています`);
    });
    if (errors.length > 0) return res.status(400).json({ error: `追加できません（誰も追加していません）: ${errors.join(" / ")}` });
    addUsers(
      rows.map(({ id, name }) => ({ id, name })),
      withKeyboard,
    );
    res.status(201).json({ added: rows.map((r) => r.id) });
  });

  app.patch("/api/teacher/users/:id", login, teacher, (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (name === "" || Array.from(name).length > 50) return res.status(400).json({ error: "名前は 1〜50 文字にしてください" });
    const info = db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "その学生は登録されていません" });
    res.status(204).end();
  });

  // 削除は練習の記録がない学生だけ（記録を守るため）。その学生のキーボードとキーの設定も一緒に消す
  const removeUser = db.transaction((id: string) => {
    db.prepare("DELETE FROM keys WHERE keyboard_id IN (SELECT id FROM keyboards WHERE user_id = ?)").run(id);
    db.prepare("DELETE FROM keyboards WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  });
  app.delete("/api/teacher/users/:id", login, teacher, (req, res) => {
    const id = req.params.id as string;
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) return res.status(404).json({ error: "その学生は登録されていません" });
    const n = (db.prepare("SELECT count(*) c FROM logs WHERE user_id = ?").get(id) as { c: number }).c;
    if (n > 0) return res.status(409).json({ error: "練習の記録がある学生は削除できません" });
    removeUser(id);
    res.status(204).end();
  });

  // 教員: 学生 1 人の学習分析
  app.get("/api/teacher/students/:userId/analysis", login, teacher, (req, res) => {
    const user = db.prepare("SELECT id, name FROM users WHERE id = ?").get(req.params.userId);
    if (!user) return res.status(404).json({ error: "その学生は登録されていません" });
    res.json({ user, ...analysisOf(req.params.userId as string) });
  });

  // 教員: logs の CSV（生データ ＋ その場で計算したスコア。Excel で開けるよう BOM 付き UTF-8）
  app.get("/api/teacher/logs.csv", login, teacher, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT l.id, l.session_id, l.user_id, u.name AS user_name, l.level_id, v.title AS level_title, l.keyboard_id,
                l.question_num, l.target, l.typed, l.start_time, l.end_time
         FROM logs l JOIN users u ON u.id = l.user_id JOIN levels v ON v.id = l.level_id ORDER BY l.id`,
      )
      .all() as (LogRecord & Record<string, unknown>)[];
    const header = [
      "id",
      "session_id",
      "user_id",
      "user_name",
      "level_id",
      "level_title",
      "keyboard_id",
      "question_num",
      "target",
      "typed",
      "start_time",
      "end_time",
      "seconds",
      "correct_chars",
      "total_chars",
      "accuracy",
      "wpm",
      "cpm",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const q = scoreQuestion(r);
      const values = [
        r.id,
        r.session_id,
        r.user_id,
        r.user_name,
        r.level_id,
        r.level_title,
        r.keyboard_id,
        r.question_num,
        r.target,
        r.typed,
        r.start_time,
        r.end_time,
        q.seconds,
        q.correctChars,
        q.totalChars,
        q.accuracy.toFixed(4),
        q.wpm.toFixed(2),
        q.cpm.toFixed(1),
      ];
      lines.push(values.map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="logs.csv"');
    res.send("\uFEFF" + lines.join("\r\n") + "\r\n");
  });

  // 存在しない API は JSON の 404
  app.use("/api", (_req, res) => res.status(404).json({ error: "見つかりません" }));

  // 想定外のエラー: 中身（スタックや内部のパス）は画面に返さず、サーバーのログにだけ出す
  app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 413) return res.status(status).json({ error: "リクエストの形式が不正です" });
    console.error(err);
    res.status(500).json({ error: "サーバーでエラーが起きました" });
  });

  return app;
}
