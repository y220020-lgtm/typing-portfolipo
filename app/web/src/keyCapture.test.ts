import { describe, expect, it } from "vitest";
import { keyNameOf } from "../../shared/analysis";
import {
  CAPTURE_STEPS,
  DIGIT_FINGER,
  buttonLabel,
  chordOf,
  conflictOf,
  fingerOfPosition,
  joinFingers,
  judge,
  keyNameOfStep,
  mergeCaptured,
} from "./keyCapture";

describe("キーを押して登録", () => {
  it("登録の順番は固定で、英字 A〜Z・数字・記号・特別なキーをすべて含み、重なりがない", () => {
    expect(CAPTURE_STEPS.slice(0, 26).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(CAPTURE_STEPS.slice(26, 36).join("")).toBe("1234567890");
    for (const c of ["-", ";", ",", ".", "/", "@", "Space", "Enter", "Backspace", "Tab"]) expect(CAPTURE_STEPS).toContain(c);
    expect(new Set(CAPTURE_STEPS.map(keyNameOfStep)).size).toBe(CAPTURE_STEPS.length);
  });
  it("どのボタンも登録に使える（F の登録で q を押してよい。Shift・Ctrl もふつうのボタン）。日本語入力中は知らせる", () => {
    expect(judge({ key: "q" })).toBe("ok");
    expect(judge({ key: "Enter" })).toBe("ok");
    expect(judge({ key: "Shift" })).toBe("ok");
    expect(judge({ key: "Control" })).toBe("ok");
    expect(judge({ key: "Process" })).toBe("ime");
    expect(judge({ key: "f", isComposing: true })).toBe("ime");
  });
  it("押したキーの位置から、標準の指を候補に出す", () => {
    expect(fingerOfPosition("KeyQ")).toBe("L5");
    expect(fingerOfPosition("KeyF")).toBe("L2");
    expect(fingerOfPosition("KeyJ")).toBe("R2");
    expect(fingerOfPosition("Space")).toBe("L1");
    expect(fingerOfPosition("F13")).toBeNull();
  });
  it("登録するキーの名前は、分析（keyNameOf）と同じ表記になる", () => {
    for (const s of CAPTURE_STEPS) expect(keyNameOfStep(s), s).toBe(s === "Space" ? keyNameOf(" ") : s.length === 1 ? keyNameOf(s) : s);
  });
  it("結果をいまの割り当てに重ねる: 登録した文字は指を置き換え、「ない」は外し、触れていないキー（Fn など）は残す", () => {
    const current = [
      { char: "F", finger: "L2" },
      { char: "Q", finger: "L5" },
      { char: "Fn", finger: "L1" },
    ];
    const captured = new Map<string, string | null>([
      ["F", "L5"],
      ["Q", null],
      ["KC_SCLN", "R5"],
    ]);
    expect(mergeCaptured(current, captured)).toEqual([
      { char: "Fn", finger: "L1" },
      { char: "F", finger: "L5" },
      { char: "KC_SCLN", finger: "R5" },
    ]);
  });
  it("同時押しはどんな組み合わせでもよく（A と B で C など）、押した順に関係なく同じ組み合わせになる。同じ組み合わせを別の文字に使うと重なり", () => {
    const b = (code: string, key: string) => ({ code, label: buttonLabel(code, key) });
    const q = chordOf([b("KeyQ", "q")]);
    const ab = chordOf([b("KeyA", "a"), b("KeyB", "b")]);
    const ba = chordOf([b("KeyB", "b"), b("KeyA", "a")]);
    const ctrlA = chordOf([b("ControlLeft", "Control"), b("KeyA", "a")]);
    expect(q).toMatchObject({ id: "KeyQ", label: "Q" });
    expect(ab.label).toBe("A + B");
    expect(ab.id).toBe(ba.id);
    expect(ctrlA.label).toBe("左Ctrl + A");
    expect(buttonLabel("Digit1", "!")).toBe("1"); // Shift で記号に変わっても位置の文字
    const used = new Map([
      ["KeyQ", "F"],
      [ab.id, "C"],
    ]);
    expect(conflictOf(used, q, "G")).toBe("F"); // F に使った q を G にも使おうとした
    expect(conflictOf(used, q, "F")).toBeNull(); // 同じ文字のやり直しはよい
    expect(conflictOf(used, ba, "D")).toBe("C"); // B と A の順でも同じ組み合わせ
    expect(conflictOf(used, ctrlA, "G")).toBeNull(); // 別の組み合わせ
  });
  it("指はボタンごとに、位置の標準の指を候補に出し、つないで保存する。数字キーで指を選べる", () => {
    expect(fingerOfPosition("ShiftLeft")).toBe("L5");
    expect(fingerOfPosition("ControlRight")).toBe("R5");
    expect(joinFingers(["L2", "R5"])).toBe("L2+R5");
    expect(joinFingers(["L2", "L2"])).toBe("L2");
    expect(DIGIT_FINGER["1"]).toBe("L5");
    expect(DIGIT_FINGER["0"]).toBe("R5");
    expect(new Set(Object.values(DIGIT_FINGER)).size).toBe(10);
  });
});
