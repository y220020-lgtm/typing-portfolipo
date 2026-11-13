import { describe, expect, it } from "vitest";
import { elapsedSeconds, isValidIsoUtcMs, scoreQuestion, scoreSession } from "./score";

const t = (start: string, end: string) => ({ start_time: start, end_time: end });

describe("scoreQuestion", () => {
  it("全部正しい", () => {
    const s = scoreQuestion({ target: "ffff", typed: "ffff", ...t("2026-06-01T10:00:00", "2026-06-01T10:00:03") });
    expect(s.correctChars).toBe(4);
    expect(s.accuracy).toBe(1);
    expect(s.seconds).toBe(3);
    expect(s.wpm).toBeCloseTo(16); // 4/5 語 ÷ 0.05 分
    expect(s.mistakes).toEqual([]);
  });

  it("デモデータ jjjj → jkjj は 2 文字目だけミス", () => {
    const s = scoreQuestion({ target: "jjjj", typed: "jkjj", ...t("2026-06-01T10:00:05", "2026-06-01T10:00:09") });
    expect(s.correctChars).toBe(3);
    expect(s.accuracy).toBe(0.75);
    expect(s.mistakes).toEqual([{ index: 1, expected: "j", actual: "k" }]);
  });

  it("入れ替わり test → tset は 2 文字ミス", () => {
    const s = scoreQuestion({ target: "test", typed: "tset", ...t("2026-06-01T11:00:04", "2026-06-01T11:00:07") });
    expect(s.correctChars).toBe(2);
    expect(s.mistakes.map((m) => m.index)).toEqual([1, 2]);
  });

  it("入力が短いと足りない文字は null のミス", () => {
    const s = scoreQuestion({ target: "abc", typed: "a", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") });
    expect(s.correctChars).toBe(1);
    expect(s.mistakes).toEqual([
      { index: 1, expected: "b", actual: null },
      { index: 2, expected: "c", actual: null },
    ]);
  });

  it("入力が長いと余分な文字はミスとして正確率を下げる", () => {
    const s = scoreQuestion({ target: "ab", typed: "abzz", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") });
    expect(s.correctChars).toBe(2);
    expect(s.extraChars).toBe(2);
    expect(s.accuracy).toBe(0.5);
    // ffff に ffffjjjjjjjj と打っても 100% にはならない
    expect(scoreQuestion({ target: "ffff", typed: "ffffjjjjjjjj", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") }).accuracy).toBeCloseTo(
      4 / 12,
    );
  });
  it("セッションの正確率も余分な文字を分母に含める", () => {
    const s = scoreSession([
      { target: "ab", typed: "abc", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") },
      { target: "cd", typed: "cd", ...t("2026-01-01T00:00:02Z", "2026-01-01T00:00:03Z") },
    ]);
    expect(s).toMatchObject({ correctChars: 4, totalChars: 4, extraChars: 1, accuracy: 0.8 });
  });

  it("日本語やサロゲートペアも 1 文字として数える", () => {
    const s = scoreQuestion({ target: "あい🍣", typed: "あい🍣", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:02Z") });
    expect(s.totalChars).toBe(3);
    expect(s.accuracy).toBe(1);
  });

  it("所要時間 0 秒なら WPM は 0", () => {
    const s = scoreQuestion({ target: "a", typed: "a", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z") });
    expect(s.wpm).toBe(0);
  });
});

describe("elapsedSeconds", () => {
  it("ミリ秒まで扱う", () => {
    expect(elapsedSeconds("2026-10-16T01:00:00.250Z", "2026-10-16T01:00:01.000Z")).toBeCloseTo(0.75);
  });
  it("タイムゾーンなしは UTC として扱う", () => {
    expect(elapsedSeconds("2026-06-01T10:00:00", "2026-06-01T10:00:00.500Z")).toBeCloseTo(0.5);
  });
  it("不正な形式はエラー", () => {
    expect(() => elapsedSeconds("abc", "2026-01-01T00:00:00Z")).toThrow();
  });
});

describe("scoreSession", () => {
  it("デモの y220020 セッション 3 問を合計する", () => {
    const s = scoreSession([
      { target: "ffff", typed: "ffff", ...t("2026-06-01T10:00:00", "2026-06-01T10:00:03") },
      { target: "jjjj", typed: "jkjj", ...t("2026-06-01T10:00:05", "2026-06-01T10:00:09") },
      { target: "type", typed: "type", ...t("2026-06-01T10:00:11", "2026-06-01T10:00:14") },
    ]);
    expect(s.questions).toBe(3);
    expect(s.correctChars).toBe(11);
    expect(s.totalChars).toBe(12);
    expect(s.seconds).toBe(10);
    expect(s.wpm).toBeCloseTo(13.2); // 11/5 語 ÷ (10/60) 分
  });
  it("0 問なら正確率 1・WPM 0", () => {
    expect(scoreSession([])).toMatchObject({ questions: 0, accuracy: 1, wpm: 0 });
  });
});

describe("isValidIsoUtcMs", () => {
  it("実在する日時だけ通す", () => {
    expect(isValidIsoUtcMs("2026-10-16T01:23:45.678Z")).toBe(true);
    expect(isValidIsoUtcMs("2028-02-29T00:00:00.000Z")).toBe(true);
    for (const bad of [
      "2026-02-31T00:00:00.000Z",
      "2026-02-29T00:00:00.000Z",
      "2026-01-01T25:00:00.000Z",
      "2026-01-01T00:61:00.000Z",
      "2026-10-16T01:23:45Z",
      "2026-10-16T01:23:45.678",
      1,
      null,
    ])
      expect(isValidIsoUtcMs(bad)).toBe(false);
  });
});

describe("壊れた日時の行", () => {
  it("集計を止めず、所要時間 0 秒として扱う", () => {
    const s = scoreSession([{ target: "ab", typed: "ab", start_time: "2026-02-31T25:61:61.000Z", end_time: "x" }]);
    expect(s).toMatchObject({ questions: 1, seconds: 0, wpm: 0, accuracy: 1 });
  });
});

describe("日本語の問題（文字/分・日本語の判定）", () => {
  it("1 分あたりの文字数は、正しく打てた文字数 ÷ 分", () => {
    const s = scoreQuestion({ target: "さくら", typed: "さくら", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:03Z") });
    expect(s.correctChars).toBe(3);
    expect(s.cpm).toBeCloseTo(60); // 3 文字 ÷ 0.05 分
    expect(s.japanese).toBe(true);
  });
  it("日本語の問題も 1 文字ずつ採点する（変換の結果で比べる）", () => {
    const s = scoreQuestion({ target: "おはようございます。", typed: "おはよございます。", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:05Z") });
    // 「う」が抜けたので、4 文字目以降は位置がずれてミスになる（位置ごとに比べる限界）
    expect(s.correctChars).toBe(3);
    expect(s.mistakes[0]).toEqual({ index: 3, expected: "う", actual: "ご" });
  });
  it("英字の問題は日本語ではない。半分以上が半角以外なら日本語", () => {
    expect(scoreQuestion({ target: "sakura", typed: "sakura", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") }).japanese).toBe(false);
    expect(scoreQuestion({ target: "東京 Tokyo", typed: "", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") }).japanese).toBe(false);
    expect(scoreQuestion({ target: "東京駅 A", typed: "", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") }).japanese).toBe(true);
  });
  it("プレイ全体では、出題された文字の半分以上が半角以外なら日本語", () => {
    const ja = scoreSession([
      { target: "ねこ", typed: "ねこ", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:02Z") },
      { target: "いぬ", typed: "いぬ", ...t("2026-01-01T00:00:03Z", "2026-01-01T00:00:05Z") },
    ]);
    expect(ja.japanese).toBe(true);
    expect(ja.cpm).toBeCloseTo(60); // 4 文字 ÷ (4 秒 / 60)
    const en = scoreSession([{ target: "neko", typed: "neko", ...t("2026-01-01T00:00:00Z", "2026-01-01T00:00:02Z") }]);
    expect(en.japanese).toBe(false);
  });
  it("0 問なら日本語ではなく、文字/分は 0", () => {
    expect(scoreSession([])).toMatchObject({ japanese: false, cpm: 0 });
  });
});
