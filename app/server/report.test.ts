import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initDb } from "./initDb";
import { buildReport, sinceToUtc, toMarkdown } from "./report";

// タイピング.db と同じデモデータ 5 件を一時 DB に入れて集計する
function demoDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-report-"));
  const file = path.join(dir, "r.db");
  initDb(file);
  const db = new Database(file);
  const ins = db.prepare(
    "INSERT INTO logs (session_id,user_id,level_id,keyboard_id,question_num,target,typed,start_time,end_time) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  ins.run("demo-y220020-001", "y220020", 1, 1, 1, "ffff", "ffff", "2026-06-01T10:00:00", "2026-06-01T10:00:03");
  ins.run("demo-y220020-001", "y220020", 1, 1, 2, "jjjj", "jkjj", "2026-06-01T10:00:05", "2026-06-01T10:00:09");
  ins.run("demo-y220020-001", "y220020", 1, 1, 3, "type", "type", "2026-06-01T10:00:11", "2026-06-01T10:00:14");
  ins.run("demo-sample-001", "sample", 1, 2, 1, "aaaa", "aaaa", "2026-06-01T11:00:00", "2026-06-01T11:00:02");
  ins.run("demo-sample-001", "sample", 1, 2, 2, "test", "tset", "2026-06-01T11:00:04", "2026-06-01T11:00:07");
  return { db, dir };
}

describe("buildReport", () => {
  it("学生ごとの最初と最後のプレイ、全体を集計する", () => {
    const { db, dir } = demoDb();
    const r = buildReport(db);
    expect(r.users.map((u) => u.userId)).toEqual(["sample", "y220020"]);
    const y = r.users[1];
    expect(y).toMatchObject({ sessions: 1, questions: 3, totalAccuracy: 11 / 12 });
    expect(y.firstWpm).toBeCloseTo(13.2);
    expect(r.total.questions).toBe(5);
    // 指: J（R2）を 1 回、E（L3）と S（L4）を 1 回ずつ間違えた
    expect(r.fingers.find((f) => f.finger === "R2")?.misses).toBe(1);
    expect(toMarkdown(r)).toContain("| y220020 | 1 | 3 | 13.2 | 13.2 | 91.7% | 91.7% | 13.2 | 66 | 91.7% |");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("--since で期間を絞れる。記録がなければその旨を出す", () => {
    const { db, dir } = demoDb();
    expect(buildReport(db, "2026-06-01T10:30:00.000Z").users.map((u) => u.userId)).toEqual(["sample"]);
    expect(toMarkdown(buildReport(db, "2027-01-01"))).toContain("記録がありません");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("sinceToUtc", () => {
  it("日付だけなら日本時間の 0 時（UTC では前日 15 時）", () => {
    expect(sinceToUtc("2026-11-01")).toBe("2026-10-31T15:00:00.000Z");
  });
  it("時刻つきはそのまま、不正な形式はエラー", () => {
    expect(sinceToUtc("2026-11-01T00:00:00.000Z")).toBe("2026-11-01T00:00:00.000Z");
    expect(() => sinceToUtc("abc")).toThrow();
  });
});
