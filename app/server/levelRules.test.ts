import { describe, expect, it } from "vitest";
import { questionPool, ruleFor } from "./levelRules";

const lv = (title: string, prompt: string) => ({ title, prompt });
const TOP = lv("上の段", "上の段（q w e r t y u i o p）のキーだけを使った短い入力を10個生成してください。");
const INDEX = lv("人差し指の練習", "ホームポジションの人差し指練習用の短い入力を10個生成してください。");

describe("ruleFor", () => {
  it("上の段: 2026-11-13 に実際に出た、上の段以外の問題を外す", () => {
    const r = ruleFor(TOP)!;
    for (const q of ["zxcvbn", "zxcv bnm", "asdf jkl;", "asdf", "asdfghjkl;", "qazwsxedcr", "uiopasdfgh"]) expect(r.accepts(q), q).toBe(false);
    // ホームポジションのキーも混ぜない（2026-11-13 本人: 上の段は上の段だけ）
    for (const q of ["tyuiopasdf", "rfuiop", "qwertuiopa"]) expect(r.accepts(q), q).toBe(false);
    for (const q of ["qwerty", "qwert yuiop", "qwer", "tyuiop", "ioqotu"]) expect(r.accepts(q), q).toBe(true);
  });
  it("人差し指: f と j 以外を含む問題を外す", () => {
    const r = ruleFor(INDEX)!;
    for (const q of ["jklasdf", "asdf jkl;", "fs", "dj", "dk"]) expect(r.accepts(q), q).toBe(false);
    for (const q of ["fjjf", "jf", "ffjj"]) expect(r.accepts(q), q).toBe(true);
  });
  it("中指・薬指・小指・まとめ・下の段", () => {
    expect(ruleFor(lv("中指の練習", "ホームポジションの中指練習用の短い入力を10個生成してください。"))!.accepts("dfjk")).toBe(false);
    expect(ruleFor(lv("薬指の練習", "ホームポジションの薬指（s と l）を中心にした短い入力"))!.accepts("slls")).toBe(true);
    expect(ruleFor(lv("小指の練習", "ホームポジションの小指（a と ;）を中心にした短い入力"))!.accepts("a;sa")).toBe(false);
    const home = ruleFor(lv("ホームポジションのまとめ", "a s d f j k l ; の8つのキーだけを使った入力を10個生成してください。"))!;
    expect(home.accepts("asdf jkl;")).toBe(true);
    expect(home.accepts("qwer")).toBe(false);
    const bottom = ruleFor(lv("下の段", "下の段（z x c v b n m , . /）のキーだけを使った短い入力"))!;
    expect(bottom.accepts("zxcv bnm")).toBe(true);
    expect(bottom.accepts("zx,./")).toBe(true);
    expect(bottom.accepts("zxcvasdf")).toBe(false);
    expect(bottom.accepts("qwerty")).toBe(false);
  });
  it("文字の種類のレベル", () => {
    expect(ruleFor(lv("ひらがな", "ひらがなの短い単語を10個生成してください。"))!.accepts("カメラ")).toBe(false);
    expect(ruleFor(lv("カタカナ", "カタカナの単語を10個生成してください。"))!.accepts("カメラ")).toBe(true);
    expect(ruleFor(lv("漢字", "漢字の単語を10個生成してください。"))!.accepts("さくら")).toBe(false);
    expect(ruleFor(lv("英単語 20", "タイピング上級者向けの長い英単語を10個生成してください。"))!.accepts("plant")).toBe(false);
    expect(ruleFor(lv("短い英文", "3〜5語の簡単な英文"))!.accepts("I go to the park every day.")).toBe(false);
    expect(ruleFor(lv("数字", "数字を含む短い入力（年号・時刻など）を10個生成してください。"))!.accepts("No.1")).toBe(true);
    expect(ruleFor(lv("ローマ字の短文", "日本語の短い文を、ローマ字（ヘボン式・小文字）で10個"))!.accepts("今日は晴れ")).toBe(false);
  });
  it("決まりの予備の問題は、すべて決まりに合う", () => {
    for (const [t, p] of [
      ["上の段", ""],
      ["下の段", ""],
      ["人差し指の練習", "ホームポジションの"],
      ["小指の練習", "ホームポジションの"],
      ["全部の段", ""],
      ["大文字を含む単語", "大文字"],
      ["ローマ字の単語", "ローマ字"],
      ["ローマ字の短文", "ローマ字"],
      ["ひらがな", ""],
      ["カタカナ", ""],
      ["漢字", ""],
      ["日本語の短文", ""],
      ["短い英文", "英文"],
      ["英単語 10", "英単語"],
      ["英単語 20", "長い英単語"],
      ["数字", ""],
      ["記号", ", . ; /"],
      ["プログラミング", ""],
    ]) {
      const r = ruleFor(lv(t, p));
      expect(r, t).not.toBeNull();
      const pool = r!.pool();
      expect(pool.length, t).toBeGreaterThanOrEqual(10);
      expect(
        pool.filter((q) => !r!.accepts(q)),
        t,
      ).toEqual([]);
    }
  });
});

describe("questionPool", () => {
  it("合わない AI の問題を外し、足りなければ補う", () => {
    const { pool, fromAi } = questionPool(ruleFor(TOP), ["qwerty", "zxcvbn", "asdf"], 10);
    expect(pool[0]).toBe("qwerty");
    expect(pool).not.toContain("zxcvbn");
    expect(pool.length).toBeGreaterThanOrEqual(10);
    expect(fromAi).toBe(true);
  });
  it("AI がなくても、そのレベルの問題を出す", () => {
    const { pool, fromAi } = questionPool(ruleFor(TOP), null, 10);
    expect(pool.every((q) => ruleFor(TOP)!.accepts(q))).toBe(true);
    expect(fromAi).toBe(false);
  });
});
