// 日本語の問題で、次に打つかなをローマ字にする（画面のキーボードの案内用）。
// 日本語入力（IME）で一般的な打ち方（ヘボン式に近い。例: し = shi、ちゃ = cha、ん = nn）を 1 つ示す。
// 漢字は読みが決まらないので null（呼び出し側で「読みを入力」と案内する）。
const BASE: Record<string, string> = {
  あ: "a",
  い: "i",
  う: "u",
  え: "e",
  お: "o",
  か: "ka",
  き: "ki",
  く: "ku",
  け: "ke",
  こ: "ko",
  が: "ga",
  ぎ: "gi",
  ぐ: "gu",
  げ: "ge",
  ご: "go",
  さ: "sa",
  し: "shi",
  す: "su",
  せ: "se",
  そ: "so",
  ざ: "za",
  じ: "ji",
  ず: "zu",
  ぜ: "ze",
  ぞ: "zo",
  た: "ta",
  ち: "chi",
  つ: "tsu",
  て: "te",
  と: "to",
  だ: "da",
  ぢ: "di",
  づ: "du",
  で: "de",
  ど: "do",
  な: "na",
  に: "ni",
  ぬ: "nu",
  ね: "ne",
  の: "no",
  は: "ha",
  ひ: "hi",
  ふ: "fu",
  へ: "he",
  ほ: "ho",
  ば: "ba",
  び: "bi",
  ぶ: "bu",
  べ: "be",
  ぼ: "bo",
  ぱ: "pa",
  ぴ: "pi",
  ぷ: "pu",
  ぺ: "pe",
  ぽ: "po",
  ま: "ma",
  み: "mi",
  む: "mu",
  め: "me",
  も: "mo",
  や: "ya",
  ゆ: "yu",
  よ: "yo",
  ら: "ra",
  り: "ri",
  る: "ru",
  れ: "re",
  ろ: "ro",
  わ: "wa",
  を: "wo",
  ん: "nn",
  ゔ: "vu",
  ぁ: "xa",
  ぃ: "xi",
  ぅ: "xu",
  ぇ: "xe",
  ぉ: "xo",
  ゃ: "xya",
  ゅ: "xyu",
  ょ: "xyo",
  っ: "xtu",
  ゎ: "xwa",
  ー: "-",
  "、": ",",
  "。": ".",
  "「": "[",
  "」": "]",
  "・": "/",
  "！": "!",
  "？": "?",
  "（": "(",
  "）": ")",
  "　": " ",
};
// 小さい ゃ ゅ ょ ぁ ぃ ぅ ぇ ぉ と組み合わせたときの打ち方
const COMBO: Record<string, string> = {
  きゃ: "kya",
  きゅ: "kyu",
  きょ: "kyo",
  ぎゃ: "gya",
  ぎゅ: "gyu",
  ぎょ: "gyo",
  しゃ: "sha",
  しゅ: "shu",
  しょ: "sho",
  しぇ: "she",
  じゃ: "ja",
  じゅ: "ju",
  じょ: "jo",
  じぇ: "je",
  ちゃ: "cha",
  ちゅ: "chu",
  ちょ: "cho",
  ちぇ: "che",
  ぢゃ: "dya",
  ぢゅ: "dyu",
  ぢょ: "dyo",
  にゃ: "nya",
  にゅ: "nyu",
  にょ: "nyo",
  ひゃ: "hya",
  ひゅ: "hyu",
  ひょ: "hyo",
  びゃ: "bya",
  びゅ: "byu",
  びょ: "byo",
  ぴゃ: "pya",
  ぴゅ: "pyu",
  ぴょ: "pyo",
  みゃ: "mya",
  みゅ: "myu",
  みょ: "myo",
  りゃ: "rya",
  りゅ: "ryu",
  りょ: "ryo",
  ふぁ: "fa",
  ふぃ: "fi",
  ふぇ: "fe",
  ふぉ: "fo",
  てぃ: "thi",
  でぃ: "dhi",
  でゅ: "dhu",
  とぅ: "twu",
  うぃ: "wi",
  うぇ: "we",
  うぉ: "who",
  ゔぁ: "va",
  ゔぃ: "vi",
  ゔぇ: "ve",
  ゔぉ: "vo",
  つぁ: "tsa",
};
const SMALL = new Set(Array.from("ゃゅょぁぃぅぇぉゎ"));
// カタカナをひらがなに（ー などの記号はそのまま）
const toHira = (c: string) => {
  const code = c.codePointAt(0)!;
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
};

export interface Syllable {
  kana: string; // 次に打つかな（例: 「ピュ」「ッパ」）
  romaji: string; // そのローマ字（例: pyu、ppa）
}

// target の index 番目から始まる、次の 1 音のかなとローマ字。漢字・英数字など、かなでなければ null
export function nextSyllable(target: string, index: number): Syllable | null {
  const chars = Array.from(target);
  const c = chars[index];
  if (c === undefined) return null;
  const h = toHira(c);
  const h2 = chars[index + 1] !== undefined ? toHira(chars[index + 1]) : "";
  // っ: 次の音の最初の子音を重ねる（例: っぱ = ppa）。次がなければ xtu
  if (h === "っ") {
    const after = nextSyllable(target, index + 1);
    if (after && /^[bcdfghjkmpqrstvwxz]/.test(after.romaji)) return { kana: c + after.kana, romaji: after.romaji[0] + after.romaji };
    return { kana: c, romaji: "xtu" };
  }
  if (h2 && SMALL.has(h2) && COMBO[h + h2]) return { kana: c + chars[index + 1], romaji: COMBO[h + h2] };
  // ん: 次が母音・な行・や行でなければ n 1 つでよいが、迷わないよう nn を示す
  const r = BASE[h];
  return r === undefined ? null : { kana: c, romaji: r };
}
