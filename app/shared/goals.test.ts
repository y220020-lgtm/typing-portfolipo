import { describe, expect, it } from "vitest";
import { assignmentProgress, passed, type Assignment } from "./goals";

const s = (startedAt: string, accuracy: number, questions = 10, levelId = 1) => ({ levelId, startedAt, questions, accuracy });

describe("レベルの合格", () => {
  it("10 問すべて解き、正確率が目安以上なら合格。目安のないレベルは合格にならない（自由に練習）", () => {
    expect(passed(s("2026-10-23T00:00:00Z", 0.95), 0.95)).toBe(true);
    expect(passed(s("2026-10-23T00:00:00Z", 0.949), 0.95)).toBe(false);
    expect(passed(s("2026-10-23T00:00:00Z", 1, 9), 0.95)).toBe(false);
    expect(passed(s("2026-10-23T00:00:00Z", 1), null)).toBe(false);
  });
});

describe("課題の進み具合", () => {
  const a: Assignment = {
    id: 1,
    title: "人差し指を 2 回",
    levelId: 1,
    dueAt: "2026-10-30T14:59:59.999Z",
    requiredPlays: 2,
    minAccuracy: 0.9,
    createdAt: "2026-10-23T00:00:00.000Z",
  };
  const now = Date.parse("2026-10-25T00:00:00Z");
  it("課題を出してから締め切りまでの、そのレベルで条件を満たしたプレイだけを数える", () => {
    const sessions = [
      s("2026-10-22T00:00:00Z", 1), // 課題を出す前
      s("2026-10-24T00:00:00Z", 0.85), // 正確率が足りない
      s("2026-10-24T01:00:00Z", 0.95, 5), // 途中でやめた
      s("2026-10-24T02:00:00Z", 0.95, 10, 2), // 別のレベル
      s("2026-10-24T03:00:00Z", 0.92), // 数える
    ];
    expect(assignmentProgress(a, sessions, null, now)).toEqual({ done: 1, required: 2, achieved: false, overdue: false, threshold: 0.9 });
    expect(assignmentProgress(a, [...sessions, s("2026-10-24T04:00:00Z", 1)], null, now).achieved).toBe(true);
  });
  it("締め切りを過ぎて未達成なら overdue。締め切り後のプレイは数えない", () => {
    const later = Date.parse("2026-11-01T00:00:00Z");
    const r = assignmentProgress(a, [s("2026-10-24T00:00:00Z", 1), s("2026-10-31T00:00:00Z", 1)], null, later);
    expect(r).toMatchObject({ done: 1, achieved: false, overdue: true });
  });
  it("課題に正確率の条件がなければレベルの合格の目安を使い、それもなければ 10 問解けば数える", () => {
    const b = { ...a, minAccuracy: null, requiredPlays: 1 };
    expect(assignmentProgress(b, [s("2026-10-24T00:00:00Z", 0.9)], 0.95, now).achieved).toBe(false);
    expect(assignmentProgress(b, [s("2026-10-24T00:00:00Z", 0.5)], null, now).achieved).toBe(true);
  });
});
