// レベルごとの「出してよい問題」の決まり。
// AI は指示（levels.prompt）を守らないことがある（2026-11-13 確認: 「上の段」に zxcvbn や asdf jkl;、「人差し指」に jklasdf が出た）。
// そこで、レベル名と指示文から決まりを決め、AI の問題をこの決まりで選び直し、足りない分はこの決まりに合う問題で補う。
// 決まりは、レベル名・指示文の言葉（「上の段」「人差し指」「ひらがな」など）から読み取る。教員が後から作ったレベルにも効くように、id では決めない。

export interface LevelRule {
  name: string;
  hint: string; // AI への指示に書き添える文
  accepts: (q: string) => boolean;
  pool: () => string[]; // AI が使えない・足りないときの問題
  keys?: string; // キーの練習のレベルで、使ってよいキー（苦手を補う問題を規則で作るときに使う）
}

const ROWS = { top: "qwertyuiop", bottom: "zxcvbnm,./" };
// ホームポジションの指ごとのキー
const HOME_FINGERS: { word: RegExp; name: string; keys: string }[] = [
  { word: /人差し指/, name: "人差し指", keys: "fj" },
  { word: /中指/, name: "中指", keys: "dk" },
  { word: /薬指/, name: "薬指", keys: "sl" },
  { word: /小指/, name: "小指", keys: "a;" },
];
// ホームポジション以外も含めた、指ごとの担当キー
const ALL_FINGER_KEYS: Record<string, string> = { 人差し指: "fjrtgyhuvbnm", 中指: "dkeic,", 薬指: "slwox.", 小指: "a;qpz/" };

const chars = (q: string) => Array.from(q.replace(/ /g, ""));
const spaced = (keys: string) => Array.from(keys).join(" ");

// keys のキー（と空白）だけでできている
function onlyKeys(keys: string) {
  return (q: string) => chars(q).length > 0 && chars(q).every((c) => keys.includes(c));
}

// keys の文字を並べた練習問題（3〜6 文字。2 種類以上の文字を使う）を作る
export function drillPool(keys: string, n = 12, random = Math.random): string[] {
  const ks = Array.from(keys);
  const out = new Set<string>();
  for (let tries = 0; out.size < n && tries < n * 50; tries++) {
    const size = 3 + Math.floor(random() * 4);
    let s = "";
    for (let i = 0; i < size; i++) s += ks[Math.floor(random() * ks.length)];
    if (ks.length === 1 || new Set(s).size > 1) out.add(s);
  }
  return [...out];
}

function keyRule(name: string, keys: string, hint: string, accepts = onlyKeys(keys)): LevelRule {
  return { name, hint, accepts, pool: () => drillPool(keys), keys };
}

function listRule(name: string, hint: string, accepts: (q: string) => boolean, list: string[]): LevelRule {
  return { name, hint, accepts, pool: () => list };
}

const ENGLISH_WORDS = ["apple", "water", "light", "music", "happy", "green", "table", "smile", "house", "dream", "river", "cloud"];
const LONG_WORDS = [
  "different",
  "adventure",
  "beautiful",
  "important",
  "knowledge",
  "education",
  "telephone",
  "computer",
  "mountain",
  "language",
  "elephant",
  "keyboard",
];
const CAPITAL_WORDS = ["Japan", "Tokyo", "Kyoto", "Osaka", "Monday", "Friday", "Sunday", "April", "August", "Canada", "France", "Italy"];
const ENGLISH_SENTENCES = [
  "I am happy.",
  "It is red.",
  "We can run.",
  "She is kind.",
  "I like cats.",
  "This is my book.",
  "I go to school.",
  "The sun is hot.",
  "We play soccer.",
  "I drink water.",
  "The sky is blue.",
  "He runs fast.",
];
const ROMAJI_WORDS = ["sakura", "neko", "inu", "sora", "umi", "yama", "hana", "mizu", "tomodachi", "gakkou", "kuruma", "densha"];
const ROMAJI_SENTENCES = [
  "kyou ha hare desu",
  "neko ga suki desu",
  "gakkou ni ikimasu",
  "mizu wo nomimasu",
  "hon wo yomimasu",
  "gohan wo tabemasu",
  "sora ga aoi",
  "hana ga saku",
  "ame ga furu",
  "umi ni iku",
  "densha de ikimasu",
  "uta wo utau",
];
const HIRAGANA = ["あさ", "いぬ", "うみ", "かさ", "そら", "はな", "やま", "ねこ", "みず", "ほし", "さくら", "たまご"];
const KATAKANA = ["パン", "ペン", "バス", "ケーキ", "ゲーム", "テレビ", "ノート", "ピアノ", "カメラ", "トマト", "メロン", "バナナ"];
const KANJI = ["山", "川", "空", "海", "花", "本", "日本", "学校", "先生", "友達", "電車", "練習"];
const JAPANESE_SENTENCES = [
  "今日は晴れです。",
  "猫が好きです。",
  "学校に行きます。",
  "水を飲みます。",
  "本を読みます。",
  "空が青い。",
  "花が咲く。",
  "雨が降る。",
  "毎日練習します。",
  "電車で行きます。",
  "音楽を聞きます。",
  "明日は雨です。",
];
const NUMBERS = ["2026", "12:30", "3.14", "100", "7:45", "1998", "0.5", "1/2", "365 days", "24 hours", "No.5", "10 km"];
const SYMBOLS = ["a,s", "d.f", "j;k", "l/a", "as,df", "jk.l;", "f/j", "s;d", "k,l.", "a/s;", "fd,jk", "l.k/"];
const PROGRAM_LINES = [
  "x = 1;",
  "y = x + 2;",
  "print(x)",
  "if (a > b) {",
  "return 0;",
  'let s = "hi";',
  "i += 1",
  "for i in range(10):",
  "x = input()",
  "def f(a):",
  "console.log(x);",
  "int n = 5;",
];

const ascii = (q: string) => /^[\x20-\x7e]+$/.test(q);
const words = (q: string) => q.split(/ +/).filter((w) => w !== "");

// レベル名・指示文から決まりを決める（詳しいものから順に調べる）。当てはまらなければ null（決まりなしで、これまでどおり出す）
export function ruleFor(level: { title: string; prompt: string }): LevelRule | null {
  const title = level.title;
  const text = `${level.title} ${level.prompt}`;
  if (/苦手克服/.test(title)) return null;
  if (/上の段/.test(text))
    return keyRule("上の段", ROWS.top, `上の段（${spaced(ROWS.top)}）のキーだけを使う（ホームポジションなどほかのキーは使わない）。`);
  if (/下の段/.test(text))
    return keyRule("下の段", ROWS.bottom, `下の段（${spaced(ROWS.bottom)}）のキーだけを使う（ホームポジションなどほかのキーは使わない）。`);
  if (/全部の段|アルファベット全体/.test(text))
    return keyRule("全部の段", "abcdefghijklmnopqrstuvwxyz", "半角の小文字のアルファベットだけを使う。", (q) => /^[a-z]+( [a-z]+)*$/.test(q));
  const finger = HOME_FINGERS.find((f) => f.word.test(title)) ?? HOME_FINGERS.find((f) => f.word.test(level.prompt));
  if (finger) {
    const keys = /ホームポジション/.test(text) ? finger.keys : ALL_FINGER_KEYS[finger.name];
    return keyRule(finger.name, keys, `${spaced(keys)} のキーだけを使う（ほかのキーは使わない）。`);
  }
  if (/ホームポジション/.test(text)) return keyRule("ホームポジション", "asdfjkl;", "a s d f j k l ; のキーだけを使う。");
  if (/大文字/.test(text)) return listRule("大文字", "大文字で始まる英単語だけ。", (q) => /^[A-Z][a-z]+$/.test(q), CAPITAL_WORDS);
  if (/ローマ字/.test(text) && /短文|文/.test(title))
    return listRule(
      "ローマ字の短文",
      "ローマ字（半角の小文字）の語を空白で区切った短い文。",
      (q) => /^[a-z-]+( [a-z-]+)+$/.test(q),
      ROMAJI_SENTENCES,
    );
  if (/ローマ字/.test(text)) return listRule("ローマ字", "ローマ字（半角の小文字）の 1 語。", (q) => /^[a-z-]+$/.test(q), ROMAJI_WORDS);
  if (/ひらがな/.test(text)) return listRule("ひらがな", "ひらがなだけ。", (q) => /^[ぁ-ゖー]+$/.test(q), HIRAGANA);
  if (/カタカナ/.test(text)) return listRule("カタカナ", "カタカナだけ。", (q) => /^[ァ-ヺー]+$/.test(q), KATAKANA);
  if (/漢字の単語/.test(text) || /^漢字$/.test(title)) return listRule("漢字", "漢字だけの単語。", (q) => /^[一-鿿々]+$/.test(q), KANJI);
  if (/日本語/.test(text))
    return listRule(
      "日本語",
      "漢字・ひらがな・カタカナと句読点の文（英数字は使わない）。",
      (q) => /^[^\x20-\x7e]+$/.test(q) && /[ぁ-ゖァ-ヺ一-鿿]/.test(q),
      JAPANESE_SENTENCES,
    );
  if (/英文/.test(text))
    return listRule(
      "英文",
      "3〜5 語の半角の英語の文。",
      (q) => ascii(q) && /^[A-Za-z]/.test(q) && words(q).length >= 3 && words(q).length <= 5,
      ENGLISH_SENTENCES,
    );
  if (/英単語/.test(text)) {
    const long = /長い|上級/.test(text);
    return listRule(
      "英単語",
      long ? "半角の小文字の、8 文字以上の英単語 1 語。" : "半角の小文字の英単語 1 語。",
      (q) => /^[a-z]+$/.test(q) && (!long || q.length >= 8),
      long ? LONG_WORDS : ENGLISH_WORDS,
    );
  }
  if (/プログラム|プログラミング/.test(text)) return listRule("プログラミング", "半角の英数字と記号だけ。", ascii, PROGRAM_LINES);
  if (/数字/.test(text)) return listRule("数字", "半角の数字を必ず含める（英数字と記号は半角）。", (q) => /\d/.test(q), NUMBERS);
  if (/記号/.test(text) || /, \. ; \//.test(text))
    return listRule("記号", "半角の , . ; / のどれかを必ず含める。", (q) => ascii(q) && /[,.;/]/.test(q), SYMBOLS);
  return null;
}

// AI の問題（generated。なければ null）から、決まりに合うものだけを残し、足りなければ決まりに合う問題で補う
// （補うのは足りない数だけ。AI の問題が抜け落ちないようにする）
export function questionPool(
  rule: LevelRule | null,
  generated: string[] | null,
  need: number,
  random = Math.random,
): { pool: string[]; fromAi: boolean } {
  if (!rule) return { pool: generated ?? [], fromAi: !!generated };
  const ok = (generated ?? []).filter((q) => rule.accepts(q));
  const pool = [...ok];
  const extra = rule.pool().filter((q) => !pool.includes(q) && rule.accepts(q));
  while (pool.length < need && extra.length > 0) pool.push(extra.splice(Math.floor(random() * extra.length), 1)[0]);
  return { pool, fromAi: ok.length > 0 };
}

// 苦手を補う問題を規則で作る（AI が使えない・足りないとき）。
// キーの練習のレベルは、範囲のキーの並びに、範囲内の苦手な文字を多く入れる。それ以外は、決まりの問題から苦手な文字を含むものを先に選ぶ
export function weakPool(rule: LevelRule, weak: string[], random = Math.random): string[] {
  if (rule.keys) {
    const inRange = weak.filter((c) => rule.keys!.includes(c));
    if (inRange.length === 0) return rule.pool();
    // 苦手な文字を 2 回分、範囲の全部のキーを 1 回分入れた袋から引く（苦手な文字が約半分以上になる）
    const bag = inRange.join("") + inRange.join("") + rule.keys;
    return drillPool(bag, 12, random).filter((q) => inRange.some((c) => q.includes(c)) && rule.accepts(q));
  }
  const pool = rule.pool();
  const hit = pool.filter((q) => weak.some((c) => q.toLowerCase().includes(c.toLowerCase())));
  return [...hit, ...pool.filter((q) => !hit.includes(q))];
}
