// 学習分析（logs から毎回計算する。DB には保存しない）
import { scoreQuestion, scoreSession, type LogRecord, type SessionScore } from "./score";

export interface AnalysisLog extends LogRecord {
  session_id: string;
  level_id: number;
  keyboard_id: number | null;
  question_num: number;
}

export interface KeyRow {
  keyboard_id: number;
  char: string;
  finger: string;
}

export interface SessionSummary extends SessionScore {
  sessionId: string;
  levelId: number;
  startedAt: string; // そのプレイで最初の問題の start_time
}

export interface CharStat {
  char: string;
  attempts: number; // 出題に含まれた回数
  misses: number; // そのうち打ち間違えた回数
  missRate: number;
}

export interface FingerStat {
  finger: string; // keys.finger（L1〜L5 / R1〜R5）。キーボード未指定や keys にない文字は「不明」
  attempts: number;
  misses: number;
  missRate: number;
}

export const UNKNOWN_FINGER = "不明";

// プレイ（session_id）ごとの成績。古い順。
export function summarizeSessions(logs: AnalysisLog[]): SessionSummary[] {
  const groups = new Map<string, AnalysisLog[]>();
  for (const log of logs) {
    const g = groups.get(log.session_id);
    if (g) g.push(log);
    else groups.set(log.session_id, [log]);
  }
  const result: SessionSummary[] = [];
  for (const [sessionId, g] of groups) {
    g.sort((a, b) => a.question_num - b.question_num);
    const startedAt = g.reduce((min, l) => (l.start_time < min ? l.start_time : min), g[0].start_time);
    result.push({ sessionId, levelId: g[0].level_id, startedAt, ...scoreSession(g) });
  }
  return result.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
}

// 出題された文字ごとのミス率。比べ方は scoreQuestion と同じ（同じ位置の文字を比べる）。
export function charStats(logs: LogRecord[]): CharStat[] {
  const stats = new Map<string, { attempts: number; misses: number }>();
  for (const log of logs) {
    const missed = new Set(scoreQuestion(log).mistakes.map((m) => m.index));
    Array.from(log.target).forEach((ch, i) => {
      const s = stats.get(ch) ?? { attempts: 0, misses: 0 };
      s.attempts++;
      if (missed.has(i)) s.misses++;
      stats.set(ch, s);
    });
  }
  return sortByMissRate(Array.from(stats, ([char, s]) => ({ char, ...s, missRate: s.misses / s.attempts })));
}

// 文字から keys.char の表記に直す（keys には英字は大文字、記号は KC_ 名で入っている）
const KEY_NAMES: Record<string, string> = { ";": "KC_SCLN", "/": "KC_SLSH", " ": "Space" };
export function keyNameOf(ch: string): string {
  return KEY_NAMES[ch] ?? ch.toUpperCase();
}

// 指ごとのミス率。そのプレイで使ったキーボード（logs.keyboard_id）の keys で、文字を指に対応させる。
export function fingerStats(logs: AnalysisLog[], keys: KeyRow[]): FingerStat[] {
  const fingerOf = new Map<string, string>();
  for (const k of keys) fingerOf.set(`${k.keyboard_id}:${k.char}`, k.finger);
  const stats = new Map<string, { attempts: number; misses: number }>();
  for (const log of logs) {
    const missed = new Set(scoreQuestion(log).mistakes.map((m) => m.index));
    Array.from(log.target).forEach((ch, i) => {
      const finger = log.keyboard_id === null ? UNKNOWN_FINGER : (fingerOf.get(`${log.keyboard_id}:${keyNameOf(ch)}`) ?? UNKNOWN_FINGER);
      const s = stats.get(finger) ?? { attempts: 0, misses: 0 };
      s.attempts++;
      if (missed.has(i)) s.misses++;
      stats.set(finger, s);
    });
  }
  return sortByMissRate(Array.from(stats, ([finger, s]) => ({ finger, ...s, missRate: s.misses / s.attempts })));
}

function sortByMissRate<T extends { missRate: number; attempts: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => b.missRate - a.missRate || b.attempts - a.attempts);
}

// CSV の 1 セルを作る（カンマ・改行・引用符を含む場合は引用符で囲む）。
// 文字列が = + - @ タブ CR で始まる場合は、Excel が数式として実行しないよう先頭に ' を付ける（数値はそのまま）。
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
