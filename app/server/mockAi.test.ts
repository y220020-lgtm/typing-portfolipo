import { beforeEach, describe, expect, it } from "vitest";
// AI モック（container/mock-ai/generate.mjs）の問題の作り方のテスト
import {
  generate,
  generateTraining,
  isTrainingPrompt,
  readCount,
  readKeys,
  readKind,
  readLength,
  setRandom,
} from "../../container/mock-ai/generate.mjs";
import { buildTrainingMessages, parseTrainingReply } from "./training";

type Result = { kind: string; length: string; count: number; keys: string | null; questions: string[] };
const gen = (p: string) => generate(p) as Result;
const chars = (q: string) => Array.from(q);

// 乱数を固定して、結果を毎回同じにする
beforeEach(() => {
  let seed = 1;
  setRandom(() => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  });
});

const only = (questions: string[], allowed: string) => questions.every((q) => chars(q).every((c) => allowed.includes(c) || c === " "));

describe("指示文の読み取り", () => {
  it("個数: 「10個」「20問」。数字に個・問が付かなければ既定の 10", () => {
    expect(readCount("英単語を20個")).toBe(20);
    expect(readCount("5問作って")).toBe(5);
    expect(readCount("8つのキーだけを使った入力")).toBe(10);
    expect(readCount("英単語を100個")).toBe(50); // 上限 50
  });
  it("長さ: 短い・長い・範囲・ちょうど。「40文字以内」は長さの指定にしない", () => {
    expect(readLength("短い英単語")).toBe("short");
    expect(readLength("上級者向けの長い英単語")).toBe("long");
    expect(readLength("英単語")).toBe("middle");
    expect(readLength("3〜5語の英文")).toEqual({ min: 3, max: 5, unit: "word" });
    expect(readLength("5文字の英単語")).toEqual({ min: 5, max: 5, unit: "char" });
    expect(readLength("短い文を作って。各40文字以内にしてください。")).toBe("short");
  });
  it("キー: 括弧の中・空白で区切った並び。「,」「/」もキーとして読む。キーでない括弧は使わない", () => {
    expect(readKeys("薬指（s と l）を中心に")).toBe("sl");
    expect(readKeys("a s d f j k l ; の8つのキー")).toBe("asdfjkl;");
    expect(readKeys("下の段（z x c v b n m , . /）")).toBe("zxcvbnm,./");
    expect(readKeys("ローマ字（ヘボン式・小文字）で")).toBeNull();
    expect(readKeys("国名・曜日（Japan など）")).toBeNull();
  });
  it.each([
    ["ホームポジションの人差し指練習用の短い入力", "finger"],
    ["上の段（q w e r t y u i o p）を中心に", "row-top"],
    ["下の段（z x c v b n m , . /）を中心に", "row-bottom"],
    ["アルファベット全体を使った入力", "row-all"],
    ["タイピング上級者向けの長い英単語", "word"],
    ["大文字で始まる英単語（国名・曜日など）", "capital"],
    ["3〜5語の簡単な英文", "sentence"],
    ["日本語の簡単な単語を、ローマ字（ヘボン式・小文字）で", "romaji"],
    ["日本語の短い文を、ローマ字（ヘボン式・小文字）で", "romaji-sentence"],
    ["ひらがなの短い単語", "hiragana"],
    ["カタカナの単語", "katakana"],
    ["漢字の単語", "kanji"],
    ["日本語の短い文を10個", "japanese-sentence"],
    ["数字を含む短い入力（年号・時刻など）", "number"],
    [", . ; / を含む短い入力", "symbol"],
    ["短いプログラムの1行（例: x = 1;）", "program"],
    ["何か適当に", "home"],
    ["英単語を10個数えて", "word"], // 「個数」の「数」で数字にならない
  ])("種類: %s → %s", (prompt, kind) => {
    expect(readKind(prompt)).toBe(kind);
  });
});

describe("問題の作成（提案したレベルの指示文）", () => {
  it("指のレベルは、その指のキーだけ・短い（2 キーなので 2〜4 文字）・10 問すべて違う問題", () => {
    for (const [p, keys] of [
      ["ホームポジションの人差し指練習用の短い入力を10個生成してください。", "fj"],
      ["ホームポジションの中指練習用の短い入力を10個生成してください。", "dk"],
      ["ホームポジションの薬指（s と l）を中心にした短い入力を10個生成してください。", "sl"],
      ["ホームポジションの小指（a と ;）を中心にした短い入力を10個生成してください。", "a;"],
    ]) {
      const r = gen(p);
      expect(r.questions).toHaveLength(10);
      expect(only(r.questions, keys)).toBe(true);
      expect(r.questions.every((q) => chars(q).length >= 2 && chars(q).length <= 4)).toBe(true);
      expect(new Set(r.questions).size).toBe(10);
    }
  });
  it("キーの多い短い練習は 2〜3 文字のまま", () => {
    expect(gen("上の段（q w e r t y u i o p）を中心に、短い入力を10個").questions.every((q) => chars(q).length <= 3)).toBe(true);
  });
  it.each([
    "3〜5語の簡単な英文を10個生成してください。各40文字以内にしてください。",
    "日本語の簡単な単語を、ローマ字（ヘボン式・小文字）で10個生成してください。",
    "日本語の短い文を、ローマ字（ヘボン式・小文字）で10個生成してください。各40文字以内にしてください。",
    "ひらがなの短い単語を10個生成してください。",
    "カタカナの単語を10個生成してください。",
    "漢字の単語を10個生成してください。",
    "日本語の短い文を10個生成してください。",
    "数字を含む短い入力（年号・時刻など）を10個生成してください。",
    ", . ; / を含む短い入力を10個生成してください。",
    "短いプログラムの1行（例: x = 1;）を10個生成してください。各40文字以内にしてください。",
    "大文字で始まる英単語（国名・曜日など）を10個生成してください。",
    "タイピング上級者向けの長い英単語を10個生成してください。",
    "タイピング初心者向けの短い英単語を10個生成してください。",
  ])("10 問の中で同じ問題を出さない: %s", (p) => {
    expect(new Set(gen(p).questions).size).toBe(10);
  });
  it("「a s d f j k l ; の8つのキーだけ」は、その 8 キーだけで 10 問", () => {
    const r = gen("a s d f j k l ; の8つのキーだけを使った入力を10個生成してください。");
    expect(r.questions).toHaveLength(10);
    expect(only(r.questions, "asdfjkl;")).toBe(true);
  });
  it("上の段・下の段は、その段のキーだけ", () => {
    expect(only(gen("上の段（q w e r t y u i o p）を中心に、短い入力を10個").questions, "qwertyuiop")).toBe(true);
    const bottom = gen("下の段（z x c v b n m , . /）を中心に、短い入力を10個");
    expect(bottom.kind).toBe("row-bottom");
    expect(only(bottom.questions, "zxcvbnm,./")).toBe(true);
  });
  it("英単語: 短い < 中 < 長い。長い英単語は 8 文字以上", () => {
    const avg = (p: string) => gen(p).questions.reduce((n, q) => n + q.length, 0) / 10;
    const short = avg("タイピング初心者向けの短い英単語を10個生成してください。");
    const middle = avg("英単語を10個生成してください。");
    const long = avg("タイピング上級者向けの長い英単語を10個生成してください。");
    expect(short).toBeLessThan(middle);
    expect(middle).toBeLessThan(long);
    expect(gen("タイピング上級者向けの長い英単語を10個生成してください。").questions.every((q) => q.length >= 8)).toBe(true);
  });
  it("「5文字の英単語を20個」は、5 文字ちょうどで 20 問", () => {
    const r = gen("5文字の英単語を20個");
    expect(r.questions).toHaveLength(20);
    expect(r.questions.every((q) => q.length === 5)).toBe(true);
  });
  it("大文字の単語は大文字で始まる", () => {
    expect(gen("大文字で始まる英単語（国名・曜日など）を10個").questions.every((q) => /^[A-Z]/.test(q))).toBe(true);
  });
  it("英文は 3〜5 語", () => {
    const r = gen("3〜5語の簡単な英文を10個生成してください。各40文字以内にしてください。");
    expect(r.questions.every((q) => q.split(" ").length >= 3 && q.split(" ").length <= 5)).toBe(true);
  });
  it("ローマ字は小文字の英字と空白だけ（単語は空白なし、文は空白あり）", () => {
    const w = gen("日本語の簡単な単語を、ローマ字（ヘボン式・小文字）で10個生成してください。");
    expect(w.questions.every((q) => /^[a-z-]+$/.test(q))).toBe(true);
    const s = gen("日本語の短い文を、ローマ字（ヘボン式・小文字）で10個生成してください。");
    expect(s.questions.every((q) => /^[a-z]+( [a-z]+)+$/.test(q))).toBe(true);
  });
  it("ひらがな・カタカナ・漢字・日本語の文は、それぞれの文字", () => {
    expect(gen("ひらがなの短い単語を10個").questions.every((q) => /^[ぁ-ゟ]+$/.test(q))).toBe(true);
    expect(gen("カタカナの単語を10個").questions.every((q) => /^[゠-ヿ]+$/.test(q))).toBe(true);
    expect(gen("漢字の単語を10個").questions.every((q) => /^[一-鿿]+$/.test(q))).toBe(true);
    expect(gen("日本語の短い文を10個").questions.every((q) => q.endsWith("。"))).toBe(true);
  });
  it("数字の問題には数字が入る", () => {
    expect(gen("数字を含む短い入力（年号・時刻など）を10個").questions.every((q) => /\d/.test(q))).toBe(true);
  });
  it("記号の練習は、どの問題にも指定した記号が入る", () => {
    const r = gen(", . ; / を含む短い入力を10個生成してください。");
    expect(r.questions).toHaveLength(10);
    expect(r.questions.every((q) => /[,.;/]/.test(q))).toBe(true);
  });
  it("どの指示文でも、40 文字を超える問題は出さない", () => {
    for (const p of ["長い英文を50個", "長いプログラムの1行を50個", "長い日本語の文を50個", "長いローマ字の文を50個", "全部の段の長い入力を50個"])
      expect(gen(p).questions.every((q) => chars(q).length <= 40)).toBe(true);
  });
  it("キーの練習は、乱数が変われば問題も変わる", () => {
    const a = gen("アルファベット全体を使った入力を10個").questions.join();
    const b = gen("アルファベット全体を使った入力を10個").questions.join();
    expect(a).not.toBe(b);
  });
});

describe("苦手克服トレーニング（サーバーの指示文をそのまま使う）", () => {
  const summary = {
    questions: 20,
    wpm: 30,
    accuracy: 0.8,
    weakChars: [
      { char: "q", missRate: 0.5, misses: 3, attempts: 6 },
      { char: "z", missRate: 0.4, misses: 2, attempts: 5 },
    ],
    weakFingers: [{ finger: "左小指", missRate: 0.3 }],
    mistakes: [{ target: "quiz", typed: "auiz" }],
    japanese: false,
    stage: 1 as const,
  };
  it("苦手な文字を含む単語の問題 10 問（段階 1 の 4〜10 文字）と分析文を返し、サーバーの読み取りで読める", () => {
    const prompt = buildTrainingMessages(summary)[1].content;
    expect(isTrainingPrompt(prompt)).toBe(true);
    expect(isTrainingPrompt("ホームポジションの練習を10個")).toBe(false);
    const r = generateTraining(prompt);
    const parsed = parseTrainingReply(JSON.stringify({ analysis: r.analysis, questions: r.questions }));
    expect(parsed).not.toBeNull();
    expect(parsed!.questions).toHaveLength(10);
    expect(parsed!.analysis).toContain("q");
    for (const q of parsed!.questions) {
      expect(q.length).toBeGreaterThanOrEqual(4);
      expect(q.length).toBeLessThanOrEqual(10);
      expect(/[qz]/.test(q)).toBe(true);
    }
    expect(new Set(parsed!.questions).size).toBe(10);
  });
  it("段階 3 では 10〜30 文字の、空白を含む語句・文になる", () => {
    const r = generateTraining(buildTrainingMessages({ ...summary, stage: 3 })[1].content);
    for (const q of r.questions) {
      expect(q.length).toBeGreaterThanOrEqual(10);
      expect(q.length).toBeLessThanOrEqual(30);
    }
    expect(r.questions.some((q: string) => q.includes(" "))).toBe(true);
  });
});
