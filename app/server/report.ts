// 評価用の集計（卒業論文の評価の章で使う）。DB を読むだけで、書き込みはしない。
// 実行: DB_PATH=data/dev.db npm run report            （Markdown を画面に出す）
//       DB_PATH=... npm run report -- --since 2026-11-01  （日本時間でその日の 0 時以降の記録だけ）
// 集計方法はアプリの画面と同じ shared/score.ts・shared/analysis.ts を使う。
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { charStats, fingerStats, summarizeSessions, type AnalysisLog, type KeyRow } from "../shared/analysis";
import { scoreSession } from "../shared/score";
import { DEFAULT_DB_PATH } from "./db";

export interface UserReport {
  userId: string;
  name: string;
  sessions: number;
  questions: number;
  firstWpm: number;
  lastWpm: number;
  firstAccuracy: number;
  lastAccuracy: number;
  totalWpm: number;
  totalCpm: number;
  totalAccuracy: number;
}

// "2026-11-01" を日本時間（UTC+9）のその日 0 時として、logs と同じ UTC の ISO 形式に直す。
// 時刻まで書いた ISO 形式（例: 2026-11-01T00:00:00.000Z）はそのまま使う。
export function sinceToUtc(since: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    const t = Date.parse(`${since}T00:00:00+09:00`);
    if (Number.isNaN(t)) throw new Error(`日付の形式が不正です: ${since}`);
    return new Date(t).toISOString();
  }
  if (Number.isNaN(Date.parse(since))) throw new Error(`日付の形式が不正です: ${since}`);
  return since;
}

export function buildReport(db: Database.Database, sinceArg?: string) {
  const since = sinceArg ? sinceToUtc(sinceArg) : undefined;
  const users = db.prepare("SELECT id, name FROM users ORDER BY id").all() as { id: string; name: string }[];
  const where = since ? "AND start_time >= ?" : "";
  const logsOf = db.prepare(
    `SELECT session_id, level_id, keyboard_id, question_num, target, typed, start_time, end_time
     FROM logs WHERE user_id = ? ${where} ORDER BY start_time, id`,
  );
  const keys = db.prepare("SELECT keyboard_id, char, finger FROM keys").all() as KeyRow[];
  const rows: UserReport[] = [];
  const all: AnalysisLog[] = [];
  for (const u of users) {
    const logs = (since ? logsOf.all(u.id, since) : logsOf.all(u.id)) as AnalysisLog[];
    if (logs.length === 0) continue;
    all.push(...logs);
    const s = summarizeSessions(logs);
    const total = scoreSession(logs);
    rows.push({
      userId: u.id,
      name: u.name,
      sessions: s.length,
      questions: logs.length,
      firstWpm: s[0].wpm,
      lastWpm: s[s.length - 1].wpm,
      firstAccuracy: s[0].accuracy,
      lastAccuracy: s[s.length - 1].accuracy,
      totalWpm: total.wpm,
      totalCpm: total.cpm,
      totalAccuracy: total.accuracy,
    });
  }
  return { users: rows, chars: charStats(all), fingers: fingerStats(all, keys), total: scoreSession(all) };
}

const f1 = (x: number) => x.toFixed(1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function toMarkdown(r: ReturnType<typeof buildReport>, since?: string): string {
  const out: string[] = [];
  out.push(`# 集計結果${since ? `（${since} 以降。日付だけの指定は日本時間）` : ""}`, "");
  if (r.users.length === 0) return out.concat("記録がありません。", "").join("\n");
  out.push(
    `全体: ${r.users.length} 人・${r.total.questions} 問、WPM ${f1(r.total.wpm)}、文字/分 ${r.total.cpm.toFixed(0)}、正確率 ${pct(r.total.accuracy)}`,
    "",
  );
  out.push("## 学生ごと（最初のプレイと最後のプレイの比較）", "");
  out.push("| 学籍番号 | プレイ | 問題数 | WPM 最初 | WPM 最後 | 正確率 最初 | 正確率 最後 | WPM 全体 | 文字/分 全体 | 正確率 全体 |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const u of r.users)
    out.push(
      `| ${u.userId} | ${u.sessions} | ${u.questions} | ${f1(u.firstWpm)} | ${f1(u.lastWpm)} | ${pct(u.firstAccuracy)} | ${pct(u.lastAccuracy)} | ${f1(u.totalWpm)} | ${u.totalCpm.toFixed(0)} | ${pct(u.totalAccuracy)} |`,
    );
  out.push("", "## 間違えやすい文字（上位 10）", "", "| 文字 | ミス / 出題 | ミス率 |", "|---|---|---|");
  for (const c of r.chars.filter((c) => c.misses > 0).slice(0, 10))
    out.push(`| \`${c.char === " " ? "空白" : c.char}\` | ${c.misses} / ${c.attempts} | ${pct(c.missRate)} |`);
  out.push("", "## 指ごとのミス率", "", "| 指 | ミス / 出題 | ミス率 |", "|---|---|---|");
  for (const f of r.fingers) out.push(`| ${f.finger} | ${f.misses} / ${f.attempts} | ${pct(f.missRate)} |`);
  out.push("");
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--since");
  const since = i >= 0 ? process.argv[i + 1] : undefined;
  // 読み取り専用で開く（正本 タイピング.db を指定しても書き換えない）
  const db = new Database(process.env.DB_PATH ?? DEFAULT_DB_PATH, { readonly: true, fileMustExist: true });
  console.log(toMarkdown(buildReport(db, since), since));
  db.close();
}
