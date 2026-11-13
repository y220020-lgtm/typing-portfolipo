import { describe, expect, it } from "vitest";
import type { StudentRow } from "./api";
import { filterStudents, nextSort, parseStudentLines, sortStudents } from "./studentList";

const row = (id: string, name: string, questions: number, wpm: number, lastPlayed: string | null = null): StudentRow => ({
  id,
  name,
  sessions: questions > 0 ? 1 : 0,
  questions,
  lastPlayed,
  total: {
    questions,
    correctChars: 0,
    totalChars: 0,
    extraChars: 0,
    accuracy: questions > 0 ? wpm / 100 : 1,
    seconds: 0,
    wpm,
    cpm: wpm * 5,
    japanese: false,
  },
});
const rows = [
  row("y230018", "山田 太郎", 20, 30, "2026-10-16T05:00:00.000Z"),
  row("demo01", "デモ 学生", 50, 25, "2026-10-16T04:59:00.000Z"),
  row("sample", "サンプル", 0, 0),
  row("y220020", "高木勇輔", 28, 10, "2026-10-16T06:10:00.000Z"),
];
const ids = (r: StudentRow[]) => r.map((s) => s.id);

describe("並べ替え", () => {
  it("学籍番号の昇順・降順", () => {
    expect(ids(sortStudents(rows, { key: "id", dir: "asc" }))).toEqual(["demo01", "sample", "y220020", "y230018"]);
    expect(ids(sortStudents(rows, { key: "id", dir: "desc" }))).toEqual(["y230018", "y220020", "sample", "demo01"]);
  });
  it("WPM の高い順。練習していない学生は、どちらの向きでも最後", () => {
    expect(ids(sortStudents(rows, { key: "wpm", dir: "desc" }))).toEqual(["y230018", "demo01", "y220020", "sample"]);
    expect(ids(sortStudents(rows, { key: "wpm", dir: "asc" }))).toEqual(["y220020", "demo01", "y230018", "sample"]);
  });
  it("最後の練習の新しい順。練習していない学生は最後", () => {
    expect(ids(sortStudents(rows, { key: "lastPlayed", dir: "desc" }))).toEqual(["y220020", "y230018", "demo01", "sample"]);
  });
  it("問題数の多い順（0 も値として並ぶ）", () => {
    expect(ids(sortStudents(rows, { key: "questions", dir: "desc" }))).toEqual(["demo01", "y220020", "y230018", "sample"]);
  });
  it("元の配列は変えない", () => {
    const before = ids(rows);
    sortStudents(rows, { key: "wpm", dir: "desc" });
    expect(ids(rows)).toEqual(before);
  });
  it("同じ列を押すと向きが変わる。文字の列は昇順、数の列は降順から", () => {
    expect(nextSort({ key: "id", dir: "asc" }, "id")).toEqual({ key: "id", dir: "desc" });
    expect(nextSort({ key: "id", dir: "asc" }, "wpm")).toEqual({ key: "wpm", dir: "desc" });
    expect(nextSort({ key: "wpm", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("検索", () => {
  it("学籍番号か名前の一部（大文字・小文字は区別しない）", () => {
    expect(ids(filterStudents(rows, "y23"))).toEqual(["y230018"]);
    expect(ids(filterStudents(rows, "山田"))).toEqual(["y230018"]);
    expect(ids(filterStudents(rows, "DEMO"))).toEqual(["demo01"]);
    expect(ids(filterStudents(rows, " "))).toEqual(ids(rows));
    expect(filterStudents(rows, "zzz")).toEqual([]);
  });
});

describe("追加の入力の読み取り", () => {
  it("1 行に「学籍番号,名前」。カンマ・タブ・空白・全角の読点で区切れる。名前の空白は残す", () => {
    expect(parseStudentLines("y230018,山田 太郎\ny230028\t佐藤 花子\n\ny230049 鈴木\ny230054、田中")).toEqual({
      users: [
        { id: "y230018", name: "山田 太郎" },
        { id: "y230028", name: "佐藤 花子" },
        { id: "y230049", name: "鈴木" },
        { id: "y230054", name: "田中" },
      ],
      errors: [],
    });
  });
  it("名前のない行はエラー", () => {
    expect(parseStudentLines("y230018\ny230028,佐藤").errors).toEqual(["1 行目: 「学籍番号,名前」の形にしてください（y230018）"]);
  });
});
