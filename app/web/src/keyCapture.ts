// 「キーを押して登録」: 画面に文字を 1 つずつ出し、その文字を打つのに使うキーを押してもらって、その文字として登録する。
// 押したキーが何の文字を出すかは問わない（例: 「F」が出ているときに q の位置のキーを押すと、そのキーを F として登録する）。
// キーを組み替えたキーボード・キーの少ないキーボード（ないキーは飛ばす）でも、自分の使い方どおりに登録できる。
// 同時押しは、押したボタンをすべて離したときに、それまで押していたボタンの組み合わせを 1 つとして登録する（例: A と B を一緒に押して C）。
// Shift・Ctrl などもふつうのボタンとして扱うので、どんな組み合わせでもよい。
// ブラウザでは押した指は分からないので、指はボタンごとに画面で選ぶ。押したボタンの位置から、標準の指を候補に出す。
// Fn など、ブラウザに届かないキーは「割り当てを編集」で手で追加する。

// 登録の順番（固定）: 英字（A〜Z）→ 数字（1〜0）→ 記号 → 特別なキー
export const CAPTURE_STEPS: string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."1234567890".split(""),
  ..."-^\\@[;:],./=`'".split(""),
  "Space",
  "Enter",
  "Backspace",
  "Tab",
];

// 画面での表記
const SHOWN: Record<string, string> = { Space: "スペース" };
export const stepLabel = (step: string) => SHOWN[step] ?? step;

// 登録する keys.char の名前（分析と同じ規則: 英字は大文字、; / 空白は内部の名前。shared/analysis.ts の keyNameOf と同じ）
export function keyNameOfStep(step: string): string {
  if (step === ";") return "KC_SCLN";
  if (step === "/") return "KC_SLSH";
  return step;
}

// 押したキーの扱い: 登録に使えるなら "ok"、日本語入力中なら "ime"、ブラウザが名前を出せないキーなら "ignore"
export function judge(e: { key: string; isComposing?: boolean }): "ok" | "ime" | "ignore" {
  if (e.isComposing || e.key === "Process") return "ime";
  if (["Dead", "Unidentified"].includes(e.key)) return "ignore";
  return "ok";
}

// 押したボタンの位置（KeyboardEvent の code）から、標準のタッチタイピングの指を候補に出す（分からない位置は null）
const POSITION_FINGER: Record<string, string> = {
  Backquote: "L5",
  Digit1: "L5",
  Digit2: "L4",
  Digit3: "L3",
  Digit4: "L2",
  Digit5: "L2",
  Digit6: "L2",
  Digit7: "R2",
  Digit8: "R3",
  Digit9: "R4",
  Digit0: "R5",
  Minus: "R5",
  Equal: "R5",
  IntlYen: "R5",
  KeyQ: "L5",
  KeyW: "L4",
  KeyE: "L3",
  KeyR: "L2",
  KeyT: "L2",
  KeyY: "R2",
  KeyU: "R2",
  KeyI: "R3",
  KeyO: "R4",
  KeyP: "R5",
  BracketLeft: "R5",
  BracketRight: "R5",
  Backslash: "R5",
  KeyA: "L5",
  KeyS: "L4",
  KeyD: "L3",
  KeyF: "L2",
  KeyG: "L2",
  KeyH: "R2",
  KeyJ: "R2",
  KeyK: "R3",
  KeyL: "R4",
  Semicolon: "R5",
  Quote: "R5",
  KeyZ: "L5",
  KeyX: "L4",
  KeyC: "L3",
  KeyV: "L2",
  KeyB: "L2",
  KeyN: "R2",
  KeyM: "R2",
  Comma: "R3",
  Period: "R4",
  Slash: "R5",
  IntlRo: "R5",
  Space: "L1",
  Enter: "R5",
  Backspace: "R5",
  Tab: "L5",
  CapsLock: "L5",
  Escape: "L5",
  ShiftLeft: "L5",
  ShiftRight: "R5",
  ControlLeft: "L5",
  ControlRight: "R5",
  AltLeft: "L1",
  AltRight: "R1",
  MetaLeft: "L1",
  MetaRight: "R1",
};
export const fingerOfPosition = (code: string): string | null => POSITION_FINGER[code] ?? null;

// ボタン 1 つの表示名（位置 code から。Shift などで文字が変わっても同じ名前にする）
const CODE_NAMES: Record<string, string> = {
  ShiftLeft: "左Shift",
  ShiftRight: "右Shift",
  ControlLeft: "左Ctrl",
  ControlRight: "右Ctrl",
  AltLeft: "左Alt",
  AltRight: "右Alt",
  MetaLeft: "左Win",
  MetaRight: "右Win",
  Space: "スペース",
  CapsLock: "CapsLock",
};
export function buttonLabel(code: string, key: string): string {
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return describeKey(key);
}

// 押したボタンの組み合わせ（1 つ以上）。同じ組み合わせは押した順に関係なく同じ id になる
export interface Chord {
  id: string; // 例: "KeyQ"、"KeyA+KeyB"、"ControlLeft+KeyA"
  buttons: { code: string; label: string }[];
  label: string; // 画面用: 例 "Q"、"A + B"
}
export function chordOf(buttons: { code: string; label: string }[]): Chord {
  const sorted = [...buttons].sort((a, b) => a.code.localeCompare(b.code));
  return { id: sorted.map((b) => b.code).join("+"), buttons, label: buttons.map((b) => b.label).join(" + ") };
}

// 指の表記をつなぐ（ボタンごとの指。同じ指は 1 本にまとめる。例: L2+R5）
export const joinFingers = (fingers: string[]) => [...new Set(fingers)].join("+");

// 指を数字キーで選ぶ: 1〜5 = 左小指〜左親指、6〜0 = 右親指〜右小指（キーボードの並びと同じ向き）
export const DIGIT_FINGER: Record<string, string> = {
  "1": "L5",
  "2": "L4",
  "3": "L3",
  "4": "L2",
  "5": "L1",
  "6": "R1",
  "7": "R2",
  "8": "R3",
  "9": "R4",
  "0": "R5",
};

// すでに別の文字に登録したボタン（組み合わせ）か（同じ登録の中で、組み合わせの id → 文字）
export function conflictOf(used: Map<string, string>, chord: Chord, step: string): string | null {
  const other = used.get(chord.id);
  return other !== undefined && other !== step ? other : null;
}

// 押したキーの説明（画面用）。文字を出すキーはその文字、ほかはキーの名前
export function describeKey(key: string): string {
  if (key === " ") return "スペース";
  return key.length === 1 ? key.toUpperCase() : key;
}

// これまでの登録（keys）に、今回の結果を重ねる。指が null の文字は「ない」として外す
export function mergeCaptured(current: { char: string; finger: string }[], captured: Map<string, string | null>): { char: string; finger: string }[] {
  const out = current.filter((k) => !captured.has(k.char));
  for (const [char, finger] of captured) if (finger !== null) out.push({ char, finger });
  return out;
}
