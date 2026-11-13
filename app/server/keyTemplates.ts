// キーボードを追加するときの、初めの割り当て（ひな形）。追加したあと、キーの追加・外す・指の変更は自由にできる。
// - keyball44: 正本のキーボードと同じ 46 キー（defaultKeys.ts）
// - jis / us: 一般的なタッチタイピングの指の割り当て（数字・記号の段まで）
// - empty: キーなし（キーの少ないキーボードや、組み替えたキーボードを一から登録する）
import { DEFAULT_KEYS } from "./defaultKeys";

export const TEMPLATES = ["keyball44", "jis", "us", "empty"] as const;
// キーボードが 1 台もない人に最初から用意するキーボードの名前（JIS 配列の標準の割り当て）
export const DEFAULT_PRACTICE_KEYBOARD = "標準のキーボード（JIS 配列）";
export type Template = (typeof TEMPLATES)[number];

// 文字の段と、左から順の担当の指（タッチタイピングの標準的な分け方）
const STANDARD_FINGERS = ["L5", "L4", "L3", "L2", "L2", "R2", "R2", "R3", "R4", "R5", "R5", "R5", "R5"];
const ROWS: Record<"jis" | "us", string[][]> = {
  jis: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "^", "¥"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "@", "["],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "KC_SCLN", ":", "]"],
    ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "KC_SLSH", "\\"],
  ],
  us: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "KC_SCLN", "'"],
    ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "KC_SLSH"],
  ],
};
const COMMON: [string, string][] = [
  ["Space", "L1"],
  ["Enter", "R5"],
  ["Backspace", "R5"],
  ["Tab", "L5"],
  ["Esc", "L5"],
  ["Shift(L)", "L5"],
  ["Shift(R)", "R5"],
];

export function templateKeys(t: Template): { char: string; finger: string }[] {
  if (t === "empty") return [];
  if (t === "keyball44") return DEFAULT_KEYS.map(([char, finger]) => ({ char, finger }));
  const keys = ROWS[t].flatMap((row) => row.map((char, i) => ({ char, finger: STANDARD_FINGERS[i] })));
  // 数字の段は 1 つ左にずれるので、1 は小指・2 は薬指…（6 は左の人差し指まで）。標準の表に合わせて直す
  const num: Record<string, string> = {
    "1": "L5",
    "2": "L4",
    "3": "L3",
    "4": "L2",
    "5": "L2",
    "6": "L2",
    "7": "R2",
    "8": "R3",
    "9": "R4",
    "0": "R5",
  };
  return [...keys.map((k) => ({ ...k, finger: num[k.char] ?? k.finger })), ...COMMON.map(([char, finger]) => ({ char, finger }))];
}
