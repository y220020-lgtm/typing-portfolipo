import { describe, expect, it } from "vitest";
import { UNKNOWN_FINGER, charStats, csvCell, fingerStats, keyNameOf, summarizeSessions, type AnalysisLog } from "./analysis";

const log = (over: Partial<AnalysisLog>): AnalysisLog => ({
  session_id: "s1",
  level_id: 1,
  keyboard_id: 1,
  question_num: 1,
  target: "ffff",
  typed: "ffff",
  start_time: "2026-06-01T10:00:00",
  end_time: "2026-06-01T10:00:03",
  ...over,
});

// タイピング.db のデモデータ 5 件（logs id 1〜5）と同じ内容
const demo: AnalysisLog[] = [
  log({
    session_id: "demo-y220020-001",
    question_num: 1,
    target: "ffff",
    typed: "ffff",
    start_time: "2026-06-01T10:00:00",
    end_time: "2026-06-01T10:00:03",
  }),
  log({
    session_id: "demo-y220020-001",
    question_num: 2,
    target: "jjjj",
    typed: "jkjj",
    start_time: "2026-06-01T10:00:05",
    end_time: "2026-06-01T10:00:09",
  }),
  log({
    session_id: "demo-y220020-001",
    question_num: 3,
    target: "type",
    typed: "type",
    start_time: "2026-06-01T10:00:11",
    end_time: "2026-06-01T10:00:14",
  }),
  log({
    session_id: "demo-sample-001",
    keyboard_id: 2,
    question_num: 1,
    target: "aaaa",
    typed: "aaaa",
    start_time: "2026-06-01T11:00:00",
    end_time: "2026-06-01T11:00:02",
  }),
  log({
    session_id: "demo-sample-001",
    keyboard_id: 2,
    question_num: 2,
    target: "test",
    typed: "tset",
    start_time: "2026-06-01T11:00:04",
    end_time: "2026-06-01T11:00:07",
  }),
];

describe("summarizeSessions", () => {
  it("プレイごとにまとめ、開始が古い順に並べる", () => {
    const s = summarizeSessions([...demo].reverse());
    expect(s.map((x) => x.sessionId)).toEqual(["demo-y220020-001", "demo-sample-001"]);
    expect(s[0]).toMatchObject({ questions: 3, correctChars: 11, totalChars: 12, seconds: 10, startedAt: "2026-06-01T10:00:00" });
    expect(s[1]).toMatchObject({ questions: 2, correctChars: 6, totalChars: 8, seconds: 5 });
  });
  it("記録がなければ空", () => {
    expect(summarizeSessions([])).toEqual([]);
  });
});

describe("charStats", () => {
  it("文字ごとの出題回数とミス回数", () => {
    const s = charStats(demo);
    const j = s.find((x) => x.char === "j")!;
    expect(j).toEqual({ char: "j", attempts: 4, misses: 1, missRate: 0.25 });
    // test → tset: e と s を間違えた。t は 3 回出題（type 1 + test 2）でミスなし
    expect(s.find((x) => x.char === "e")).toEqual({ char: "e", attempts: 2, misses: 1, missRate: 0.5 });
    expect(s.find((x) => x.char === "t")).toEqual({ char: "t", attempts: 3, misses: 0, missRate: 0 });
    // ミス率の高い順
    expect(s[0].missRate).toBeGreaterThanOrEqual(s[s.length - 1].missRate);
  });
});

describe("keyNameOf", () => {
  it("keys.char の表記に直す", () => {
    expect(keyNameOf("f")).toBe("F");
    expect(keyNameOf(";")).toBe("KC_SCLN");
    expect(keyNameOf("/")).toBe("KC_SLSH");
    expect(keyNameOf(" ")).toBe("Space");
    expect(keyNameOf(",")).toBe(",");
  });
});

describe("fingerStats", () => {
  const keys = [
    { keyboard_id: 1, char: "F", finger: "L2" },
    { keyboard_id: 1, char: "J", finger: "R2" },
    { keyboard_id: 2, char: "J", finger: "R9" },
  ];
  it("そのプレイのキーボードの keys で文字を指に対応させる", () => {
    const s = fingerStats([log({ target: "ffjj", typed: "ffjk" }), log({ keyboard_id: 2, target: "j", typed: "j" })], keys);
    expect(s.find((x) => x.finger === "R2")).toEqual({ finger: "R2", attempts: 2, misses: 1, missRate: 0.5 });
    expect(s.find((x) => x.finger === "L2")).toEqual({ finger: "L2", attempts: 2, misses: 0, missRate: 0 });
    expect(s.find((x) => x.finger === "R9")).toEqual({ finger: "R9", attempts: 1, misses: 0, missRate: 0 });
  });
  it("キーボード未指定や keys にない文字は「不明」", () => {
    const s = fingerStats([log({ keyboard_id: null, target: "f", typed: "x" }), log({ target: "z", typed: "z" })], keys);
    expect(s).toEqual([{ finger: UNKNOWN_FINGER, attempts: 2, misses: 1, missRate: 0.5 }]);
  });
});

describe("csvCell", () => {
  it("カンマ・引用符・改行は引用符で囲む", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });
  it("数式として実行される文字で始まる文字列は ' を付ける（数値は付けない）", () => {
    expect(csvCell('=HYPERLINK("http://x","a")')).toBe(`"'=HYPERLINK(""http://x"",""a"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-x")).toBe("'-x");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell(-1.5)).toBe("-1.5");
  });
});
