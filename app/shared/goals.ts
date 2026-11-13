// レベルの合格と課題の達成の判定。DB には結果を保存せず、logs から毎回計算する（データベース仕様書 🅲）。
// 画面とサーバーで同じ計算を使う。
import type { SessionSummary } from "./analysis";

export const FULL_PLAY = 10; // 合格・課題に数えるのは、10 問すべてを解いたプレイだけ（途中でやめたプレイは数えない）

// そのプレイがレベルの合格か（合格の目安がないレベルは、いつも false = 自由に練習するレベル）
export function passed(s: Pick<SessionSummary, "questions" | "accuracy">, passAccuracy: number | null): boolean {
  return passAccuracy !== null && s.questions >= FULL_PLAY && s.accuracy >= passAccuracy;
}

export interface Assignment {
  id: number;
  title: string;
  levelId: number;
  dueAt: string; // ISO8601・UTC
  requiredPlays: number;
  minAccuracy: number | null; // 課題の正確率の条件。null ならレベルの合格の目安（それもなければ、10 問解けば数える）
  createdAt: string;
}

export interface AssignmentProgress {
  done: number; // 条件を満たしたプレイの数
  required: number;
  achieved: boolean;
  overdue: boolean; // 締め切りを過ぎて、未達成
  threshold: number | null; // 実際に使った正確率の条件
}

// 課題の進み具合: 課題を出した時刻から締め切りまでに、そのレベルで、条件を満たしたプレイの数
export function assignmentProgress(
  a: Assignment,
  sessions: Pick<SessionSummary, "levelId" | "startedAt" | "questions" | "accuracy">[],
  levelPassAccuracy: number | null,
  now: number,
): AssignmentProgress {
  const threshold = a.minAccuracy ?? levelPassAccuracy;
  const from = Date.parse(a.createdAt);
  const to = Date.parse(a.dueAt);
  const done = sessions.filter((s) => {
    const t = Date.parse(s.startedAt);
    return s.levelId === a.levelId && t >= from && t <= to && s.questions >= FULL_PLAY && (threshold === null || s.accuracy >= threshold);
  }).length;
  const achieved = done >= a.requiredPlays;
  return { done: Math.min(done, a.requiredPlays), required: a.requiredPlays, achieved, overdue: !achieved && now > to, threshold };
}
