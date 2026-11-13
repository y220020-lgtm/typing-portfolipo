// AI モックの問題の作り方。指示文（levels.prompt）から、種類・使うキー・長さ・個数を読み取って問題を作る。
// 本物の AI のように文章を理解するわけではない（読み取るのは下に書いた言葉だけ）。依存パッケージなし。

// ---- 問題の候補 ----
const ENGLISH_WORDS = [
  "cat", "dog", "sun", "red", "box", "cup", "pen", "map", "hat", "egg", "bus", "car", "sky", "sea", "ice", "key",
  "book", "tree", "fish", "bird", "milk", "door", "hand", "rain", "snow", "star", "moon", "desk", "lamp", "game",
  "bread", "chair", "plant", "ocean", "tiger", "pizza", "money", "sugar", "train", "lemon", "apple", "water", "music", "happy", "green", "river",
  "school", "friend", "animal", "summer", "winter", "garden", "planet", "orange", "family", "flower",
  "keyboard", "computer", "important", "beautiful", "education", "telephone", "adventure", "different", "knowledge", "elephant", "mountain", "language",
  "environment", "information", "communication", "temperature", "development", "technology", "experience", "understand",
];
const CAPITAL_WORDS = [
  "Japan", "Tokyo", "Kyoto", "Osaka", "China", "India", "Italy", "Spain", "Paris", "London", "Monday", "Friday", "Sunday",
  "January", "April", "August", "October", "December", "America", "Canada", "Brazil", "Germany", "France", "England",
  "Australia", "Wednesday", "Saturday", "September", "November", "February",
  "May", "June", "July", "March", "Korea", "Egypt", "Peru", "Rome", "Nara", "Tuesday", "Thursday", "Hokkaido",
];
const ENGLISH_SENTENCES = [
  "I am happy.", "It is red.", "We can run.", "He has a pen.", "She is kind.", "I like cats.", "It is cold.",
  "This is my book.", "I go to school.", "The sun is hot.", "We play soccer.", "I drink water.", "She reads a book.",
  "The cat is on the desk.", "I eat bread every day.", "My friend likes music.", "We study English at school.",
  "The train is very fast.", "I want to see the sea.", "It is a beautiful day.", "Please open the door.",
  "Practice makes perfect.", "Typing every day is important.", "The quick brown fox jumps.", "I will try my best today.",
  "I can swim.", "You are tall.", "Look at me.", "Come here.", "I see a dog.", "We are friends.", "It is my pen.",
  "The sky is blue.", "I love music.", "He runs fast.", "She can sing well.", "Let us go home.",
  "My mother cooks dinner.", "We went to the park.", "I have two brothers.", "The museum opens at nine.",
  "Can you help me, please?", "I am learning to type.", "This keyboard is very nice.", "Thank you for your help.",
];
const ROMAJI_WORDS = [
  "neko", "inu", "sora", "umi", "yama", "kawa", "hana", "mizu", "hi", "ki", "te", "me",
  "sakura", "tomodachi", "gakkou", "sensei", "kuruma", "densha", "ringo", "mikan", "tamago", "gohan", "asahi", "yoru",
  "konnichiha", "arigatou", "ohayou", "sayounara", "taipingu", "kiibo-do", "benkyou", "renshuu", "tanoshii", "ganbaru",
  "kaze", "ame", "yuki", "hoshi", "tsuki", "hon", "kasa", "tokei", "megane", "kaban", "enpitsu", "tsukue",
  "toshokan", "jitensha", "hikouki", "daigakusei", "tanjoubi", "shinkansen",
];
const ROMAJI_SENTENCES = [
  "ohayou gozaimasu", "arigatou gozaimasu", "kyou ha hare desu", "neko ga suki desu", "gakkou ni ikimasu",
  "mizu wo nomimasu", "sakura ga kirei desu", "tomodachi to asobu", "mainichi renshuu suru", "taipingu ha tanoshii",
  "ashita ha ame desu", "hon wo yomimasu", "gohan wo tabemasu", "densha de ikimasu", "yoroshiku onegaishimasu",
  "inu ga hashiru", "sora ga aoi", "hana ga saku", "ame ga furu", "kaze ga fuku", "umi ni iku", "yama ni noboru",
  "tomodachi ni au", "ongaku wo kiku", "shashin wo toru", "kouen de asobu", "uta wo utau", "e wo kaku",
  "toshokan de hon wo kariru", "shinkansen de kyouto ni iku", "mainichi sukoshi zutsu renshuu suru",
  "kyou ha totemo atsui desu", "ashita mo ganbarimashou", "nihongo wo benkyou shimasu", "kiibo-do de moji wo utsu",
];
const HIRAGANA = [
  "あい", "いえ", "うみ", "えき", "おと", "かさ", "きく", "そら", "はな", "やま", "ねこ", "いぬ", "みず", "ほし", "つき",
  "さくら", "ともだち", "がっこう", "たまご", "りんご", "みかん", "でんしゃ", "くるま", "ひこうき", "おはよう", "ありがとう",
  "こんにちは", "さようなら", "たのしい", "がんばる", "べんきょう", "れんしゅう",
  "かぜ", "あめ", "ゆき", "ほん", "かさ", "とけい", "めがね", "かばん", "えんぴつ", "つくえ", "おんがく", "しゃしん",
  "としょかん", "じてんしゃ", "たんじょうび", "しんかんせん", "だいがくせい", "おべんとう",
];
const KATAKANA = [
  "パン", "ペン", "バス", "ガム", "ケーキ", "ゲーム", "テレビ", "ノート", "ピアノ", "カメラ", "トマト", "メロン", "バナナ", "ミルク",
  "ラジオ", "ドア", "ベッド", "ボール", "コップ", "シャツ", "ホテル", "スープ", "チーズ", "ジュース",
  "パソコン", "キーボード", "タイピング", "サッカー", "プログラム", "スマートフォン", "インターネット", "コンピューター", "アイスクリーム", "チョコレート",
  "テニス", "マウス", "メール", "ギター", "カレー", "ラーメン", "レモン", "ポスター", "エレベーター", "レストラン",
];
const KANJI = [
  "山", "川", "空", "海", "花", "本", "犬", "猫", "水", "火", "木", "金", "土", "雨", "雪",
  "日本", "学校", "先生", "友達", "電車", "時間", "天気", "勉強", "練習", "毎日", "入力", "文字", "漢字", "東京", "京都", "大阪", "家族", "音楽", "写真",
  "図書館", "自転車", "大学生", "新幹線", "誕生日", "春夏秋冬", "一石二鳥", "情報処理",
  "月", "星", "風", "朝", "夜", "駅", "町", "人間", "世界", "自然", "教室", "授業", "宿題", "試験", "季節", "料理",
  "美術館", "遊園地", "動物園", "郵便局", "一期一会", "日進月歩",
];
const JAPANESE_SENTENCES = [
  "おはようございます。", "ありがとうございます。", "今日は晴れです。", "猫が好きです。", "学校に行きます。", "水を飲みます。",
  "桜がきれいです。", "毎日練習します。", "タイピングは楽しい。", "明日は雨です。", "本を読みます。", "ご飯を食べます。",
  "電車で行きます。", "よろしくお願いします。", "がんばって練習しよう。", "東京は大きな町です。",
  "空が青い。", "犬が走る。", "花が咲く。", "雨が降る。", "音楽を聞きます。", "写真を撮ります。",
  "友達と公園で遊びました。", "毎日少しずつ練習しましょう。", "図書館で本を借りました。", "新幹線で京都に行きました。",
  "風が吹く。", "星が光る。", "鳥が飛ぶ。", "雪が降る。", "海は広い。", "山は高い。", "朝ご飯を食べる。",
  "宿題を終えました。", "駅で友達を待つ。", "授業が始まります。", "今日はとても暑いです。", "明日もがんばりましょう。",
  "日本語を勉強しています。", "キーボードで文字を打つ。",
];
const NUMBERS = [
  "12", "345", "2026", "100", "7:30", "10:15", "3.14", "1,000", "2026/10/16", "090-1234", "50%", "1 2 3",
  "365 days", "24 hours", "60 min", "1st", "2nd", "3rd", "No.5", "1+1=2", "10-3=7", "2*3=6",
  "7", "42", "99", "4th", "5th", "8:00", "12:45", "0.5", "1/2", "3/4", "1998", "2001", "100 yen", "10 km", "5 kg",
  "2026/4/1", "1,234,567", "03-1234-5678", "8:30 a.m.", "Room 101",
];
const SYMBOLS = [
  ",", ".", ";", "/", "a, b", "x.y", "a;b", "a/b", "1, 2, 3", "end.", "yes; no", "and/or", "A.B.C.", "hi, all.",
  "(a)", "[b]", "a-b", "a_b", "a+b", "a=b", "\"hi\"", "'ok'", "x: 1", "a & b", "#tag", "@name", "50%", "$10",
  "!", "?", ":", "a!", "b?", "{c}", "<d>", "a*b", "a~b", "a|b", "(1, 2)", "[a, b]", "{x: 1}", "a.b.c", "e-mail",
  "http://a.b", "user@mail", "C:/dir/file", "(a + b) * c", "\"Hello, world!\"",
];
const PROGRAM_LINES = [
  "x = 1;", "y = x + 2;", "let a = 10;", "const b = 20;", "print(x)", "i++;", "return a;", "if (x > 0)",
  "for (i = 0; i < 10; i++)", "while (true)", "def add(a, b):", "return a + b", "console.log(x);", "int n = 5;",
  "s = \"hello\"", "arr = [1, 2, 3]", "obj = { a: 1 }", "a == b", "x != y", "import os",
  "x++;", "y--;", "a = b;", "n = 0;", "s += 1;", "x * 2", "a > b", "f(x)", "pass", "break;", "else:", "x = []",
  "let s = \"\";", "const n = 100;", "return x * y;", "if (a == b) {", "print(\"hello\")",
  "for i in range(10):", "x = input()", "list.append(1)", "function add(a, b) {", "console.log(\"done\");",
];

// キーボードの段と指（ホームポジションの標準の割り当て）
const ROWS = {
  home: "asdfjkl;",
  top: "qwertyuiop",
  bottom: "zxcvbnm,./",
};
const FINGERS = [
  { match: /人差し指|index/i, keys: "fjrtgyhuvbnm" },
  { match: /中指|middle/i, keys: "dkeic," },
  { match: /薬指|ring/i, keys: "slwox." },
  { match: /小指|pinky|little/i, keys: "a;qpz/" },
];
const HOME_INDEX = { 人差し指: "fj", 中指: "dk", 薬指: "sl", 小指: "a;" };

// ---- 指示文の読み取り ----
const LONG = /長い|長め|長文|上級|難し|long|hard|advanced/i;
const SHORT = /短い|短め|初心者|初級|簡単|やさし|short|easy|beginner/i;

export function readLength(prompt) {
  // 「3〜6文字」「3-6文字」「3〜5語」
  const range = /(\d+)\s*[〜~\-ー－]\s*(\d+)\s*(文字|字|語)/.exec(prompt);
  if (range) return { min: Number(range[1]), max: Number(range[2]), unit: range[3] === "語" ? "word" : "char" };
  // 「5文字の」「3語の」（ちょうどその長さ）。「40文字以内」「10文字以下」は上限なので、ここでは使わない
  const one = /(\d+)\s*(文字|字|語)(?!\s*(以内|以下|まで))/.exec(prompt);
  if (one) return { min: Number(one[1]), max: Number(one[1]), unit: one[2] === "語" ? "word" : "char" };
  if (LONG.test(prompt)) return "long";
  if (SHORT.test(prompt)) return "short";
  return "middle";
}

export function readCount(prompt) {
  const m = /(\d+)\s*(個|問|題|items?)/i.exec(prompt);
  const n = m ? Number(m[1]) : 10;
  return Math.min(50, Math.max(1, n));
}

// 「（s と l）」「(a s d f)」「キー: f j」のように書いたキー。1 文字の英字・数字・記号だけを拾う（「（ヘボン式）」のような括弧は使わない）
export function readKeys(prompt) {
  // 括弧の中、「キー:」の後ろ、または空白で区切った 1 文字の並び（例: a s d f j k l ;）
  const groups = [...prompt.matchAll(/[（(]([^）)]*)[）)]/g)].map((m) => m[1]);
  const after = /キー[はを：:]\s*([^\n。]*)/.exec(prompt);
  if (after) groups.push(after[1]);
  const bare = /(?:^|\s)((?:[a-z0-9;:,./\-]\s+){2,}[a-z0-9;:,./\-])(?=\s|の|を|だけ|と|$)/i.exec(prompt);
  if (bare) groups.push(bare[1]);
  for (const g of groups) {
    // 区切りは空白・読点・「と」・中黒・「や」だけ（「,」「/」はキーとして残す）
    const tokens = g.split(/[\s、と・]+|や|および/).filter((t) => t !== "");
    if (tokens.length > 0 && tokens.every((t) => /^[a-z0-9;:,./\-]$/i.test(t))) return [...new Set(tokens.map((t) => t.toLowerCase()))].join("");
  }
  return null;
}

// 種類の判定（詳しいものから順に調べる）
const KINDS = [
  { kind: "program", match: /プログラ|コード|program|code|javascript|python/i },
  { kind: "romaji-sentence", match: /(短文|長文|文章|文を|フレーズ|sentence)[^。]*ローマ字|ローマ字[^。]*(短文|長文|文章|文を|フレーズ|sentence)|romaji.*sentence/i },
  { kind: "romaji", match: /ローマ字|romaji/i },
  { kind: "japanese-sentence", match: /日本語[^。]*(短文|長文|文章|文を|フレーズ)|(漢字|かな)[^。]*(文|まじり)/ },
  { kind: "kanji", match: /漢字/ },
  { kind: "katakana", match: /カタカナ|片仮名/ },
  { kind: "hiragana", match: /ひらがな|平仮名|かな|日本語/ },
  { kind: "row-top", match: /上の段|上段|top row|qwerty/i },
  { kind: "row-bottom", match: /下の段|下段|bottom row/i },
  { kind: "number", match: /数字|number|digit/i },
  { kind: "symbol", match: /記号|symbol|punctuation|(^|\s)[,.;:/!?'"()\[\]{}<>@#$%&*+=_-](\s+[,.;:/!?'"()\[\]{}<>@#$%&*+=_-]){1,}(\s|$)/i },
  { kind: "capital", match: /大文字|国名|曜日|月の名前|capital/i },
  { kind: "sentence", match: /英文|文章|短文|長文|sentence/i },
  { kind: "word", match: /英単語|単語|word/i },
  { kind: "finger", match: /人差し指|中指|薬指|小指|index|middle|ring|pinky|little/i },
  { kind: "row-all", match: /全部の段|全体|すべての段|全ての段|アルファベット|alphabet/i },
  { kind: "home", match: /ホームポジション|home/i },
];

export function readKind(prompt) {
  return (KINDS.find((k) => k.match.test(prompt)) ?? { kind: "home" }).kind;
}

// ---- 問題の作成 ----
let rng = Math.random;
export function setRandom(fn) {
  rng = fn;
}
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const len = (s) => Array.from(s).length;
const words = (s) => s.trim().split(/\s+/).length;

// 長さの指定に合う候補を選ぶ。短い・中・長いは、limits（短いの上限・長いの下限）があればそれで、
// なければ候補を長さで並べて 3 つに分ける
function byLength(pool, length, measure = len, limits = null) {
  if (limits && typeof length === "string") {
    const [shortMax, longMin] = limits;
    const fit = pool.filter((p) =>
      length === "short" ? measure(p) <= shortMax : length === "long" ? measure(p) >= longMin : measure(p) > shortMax && measure(p) < longMin,
    );
    if (fit.length > 0) return fit;
  }
  if (typeof length === "object") {
    const fit = pool.filter((p) => {
      const n = length.unit === "word" ? words(p) : measure(p);
      return n >= length.min && n <= length.max;
    });
    return fit.length > 0 ? fit : pool;
  }
  const sorted = [...pool].sort((a, b) => measure(a) - measure(b));
  const third = Math.ceil(sorted.length / 3);
  if (length === "short") return sorted.slice(0, third);
  if (length === "long") return sorted.slice(sorted.length - third);
  return sorted.slice(third, sorted.length - third).length > 0 ? sorted.slice(third, sorted.length - third) : sorted;
}

// 候補から n 問。なるべく重複させず、候補が足りなければ繰り返して n 問にそろえる
function choose(pool, n) {
  const out = [];
  while (out.length < n && pool.length > 0) out.push(...shuffle(pool).slice(0, n - out.length));
  return out;
}

// キーの並びの練習を n 問。長さは短い 2〜3、中 4〜6、長い 7〜10 文字、または指定どおり
function drill(keys, length, n) {
  const [lo, hi] =
    typeof length === "object" && length.unit === "char"
      ? [length.min, length.max]
      : length === "short"
        ? // キーが少ない（2〜3 個）と 2〜3 文字では組み合わせが足りず同じ問題が出るので、4 文字まで広げる
          [2, Array.from(keys).length <= 3 ? 4 : 3]
        : length === "long"
          ? [7, 10]
          : [4, 6];
  const chars = Array.from(keys);
  const out = new Set();
  for (let tries = 0; out.size < n && tries < n * 50; tries++) {
    const size = lo + Math.floor(rng() * (hi - lo + 1));
    let s = "";
    for (let i = 0; i < size; i++) s += pick(chars);
    // 長い練習は、途中に空白を入れて読みやすくする
    if (size >= 7 && !keys.includes(" ")) s = s.slice(0, Math.ceil(size / 2)) + " " + s.slice(Math.ceil(size / 2));
    if (chars.length === 1 || new Set(Array.from(s.replace(/ /g, ""))).size > 1) out.add(s);
  }
  // 組み合わせが足りない（2 キーで 2〜3 文字など）ときは、繰り返して n 問にそろえる
  return choose([...out], n);
}

// 記号の練習: ホームの文字の間に、指定した記号を少なくとも 1 つ入れる
function symbolDrill(symbols, length, n) {
  const marks = Array.from(symbols).filter((c) => !/[a-z0-9]/i.test(c));
  if (marks.length === 0) return drill(symbols, length, n);
  return drill("asdfjkl", length, n).map((q) => {
    const chars = Array.from(q);
    const at = 1 + Math.floor(rng() * Math.max(1, chars.length - 1));
    chars.splice(at, 0, pick(marks));
    return chars.join("");
  });
}

function fingerKeys(prompt) {
  // ホームポジションの指だけなら、その 2 キー。そうでなければ、その指の担当キー全部
  const found = FINGERS.filter((f) => f.match.test(prompt));
  if (found.length === 0) return ROWS.home;
  const homeOnly = /ホームポジション|home/i.test(prompt);
  return found
    .map((f) => {
      const name = Object.keys(HOME_INDEX).find((k) => f.match.test(k));
      return homeOnly && name ? HOME_INDEX[name] : f.keys;
    })
    .join("");
}

export function generate(prompt) {
  const kind = readKind(prompt);
  const length = readLength(prompt);
  const n = readCount(prompt);
  const keys = readKeys(prompt);
  let questions;
  switch (kind) {
    case "word":
      // 英単語: 短い = 4 文字以下、長い = 8 文字以上、中 = 5〜7 文字
      questions = choose(byLength(ENGLISH_WORDS, length, len, [4, 8]), n);
      break;
    case "capital":
      questions = choose(byLength(CAPITAL_WORDS, length), n);
      break;
    case "sentence":
      questions = choose(byLength(ENGLISH_SENTENCES, length), n);
      break;
    case "romaji":
      questions = choose(byLength(ROMAJI_WORDS, length), n);
      break;
    case "romaji-sentence":
      questions = choose(byLength(ROMAJI_SENTENCES, length), n);
      break;
    case "hiragana":
      questions = choose(byLength(HIRAGANA, length), n);
      break;
    case "katakana":
      questions = choose(byLength(KATAKANA, length), n);
      break;
    case "kanji":
      questions = choose(byLength(KANJI, length), n);
      break;
    case "japanese-sentence":
      questions = choose(byLength(JAPANESE_SENTENCES, length), n);
      break;
    case "number":
      questions = keys ? drill(keys, length, n) : choose(byLength(NUMBERS, length), n);
      break;
    case "symbol":
      questions = keys ? symbolDrill(keys, length, n) : choose(byLength(SYMBOLS, length), n);
      break;
    case "program":
      questions = choose(byLength(PROGRAM_LINES, length), n);
      break;
    case "finger":
      questions = drill(keys ?? fingerKeys(prompt), length, n);
      break;
    case "row-top":
      questions = drill(keys ?? ROWS.top + "fj", length, n);
      break;
    case "row-bottom":
      questions = drill(keys ?? ROWS.bottom + "fj", length, n);
      break;
    case "row-all":
      questions = drill(keys ?? "abcdefghijklmnopqrstuvwxyz", length, n);
      break;
    default:
      questions = drill(keys ?? ROWS.home, length, n);
  }
  // 40 文字を超える問題は出さない（アプリの条件）
  questions = questions.filter((q) => len(q) <= 40);
  return { kind, length: typeof length === "object" ? `${length.min}-${length.max}${length.unit}` : length, count: n, keys, questions };
}

// 苦手克服トレーニング（app/server/training.ts の指示文）: 要約 JSON を読み、{analysis, questions} を返す。
// 本物の LLM の代わりに、要約に書かれた苦手な文字・正確率だけを使って作る
const HIRAGANA_WORDS_FOR_TRAINING = "あさ あめ いぬ うみ えき かぜ くつ こども さくら すし そら たまご つくえ てがみ とけい ねこ はな ひかり ふね ほし まど みず もり やま ゆき りんご がっこう でんしゃ べんきょう".split(" ");

export function isTrainingPrompt(prompt) {
  return prompt.includes("苦手克服トレーニング用");
}

export function generateTraining(prompt) {
  let summary = {};
  try {
    summary = JSON.parse(prompt.slice(prompt.indexOf("{")));
  } catch {
    // 読めなければ苦手なしとして扱う
  }
  const weak = (summary["苦手な文字"] ?? []).map((c) => c.char).filter((c) => typeof c === "string" && c.length > 0);
  const fingers = (summary["苦手な指"] ?? []).map((f) => f.finger);
  const accuracy = typeof summary["正確率"] === "number" ? summary["正確率"] : 1;
  const wpm = typeof summary["WPM"] === "number" ? summary["WPM"] : 0;
  const japanese = summary["日本語中心"] === true;
  // 「難しさ」の文字数（例: "4〜10 文字"）に合わせ、苦手な文字を含む単語をつなぐ（本物の LLM の代わり）
  const m = /(\d+)〜(\d+)/.exec(String(summary["難しさ"]?.["文字数"] ?? ""));
  const [lo, hi] = m ? [Number(m[1]), Number(m[2])] : accuracy < 0.9 ? [4, 10] : [6, 18];
  const pool = japanese ? HIRAGANA_WORDS_FOR_TRAINING : ENGLISH_WORDS;
  const sep = japanese ? "" : " ";
  const hasWeak = (w) => weak.some((c) => w.includes(c.toLowerCase()) || w.includes(c));
  const withWeak = weak.length > 0 ? pool.filter(hasWeak) : pool;
  const words = withWeak.length > 0 ? withWeak : pool;
  const out = new Set();
  for (let tries = 0; out.size < 10 && tries < 2000; tries++) {
    let s = pick(words);
    while (Array.from(s).length < lo) {
      const next = s + sep + pick(rng() < 0.5 ? words : pool);
      if (Array.from(next).length > hi) break;
      s = next;
    }
    const n = Array.from(s).length;
    if (n >= lo && n <= hi) out.add(s);
  }
  // 苦手な文字を含む単語が少なく 10 問に届かないときは、苦手な文字で始めた単語の組み合わせで補う
  for (let tries = 0; out.size < 10 && tries < 2000; tries++) {
    let s = (weak.length > 0 ? pick(weak).toLowerCase() : "") + pick(pool);
    while (Array.from(s).length < lo) s += sep + pick(pool);
    if (Array.from(s).length <= hi) out.add(s);
  }
  const questions = [...out].slice(0, 10);
  const parts = [];
  if (weak.length > 0) parts.push(`苦手な文字は ${weak.slice(0, 4).join("・")} です`);
  if (fingers.length > 0) parts.push(`${fingers[0]}のミスが多めです`);
  parts.push(`正確率 ${(accuracy * 100).toFixed(0)}%、${wpm.toFixed(0)} WPM`);
  const analysis = `${parts.join("。")}。${accuracy < 0.9 ? "短い問題で正確さを優先しましょう。" : "少し長い問題で速さも伸ばしましょう。"}（モック）`;
  return { kind: "training", length: `${lo}-${hi}`, analysis, questions };
}
