// スコア計算（DB には保存せず、logs の target / typed / start_time / end_time から毎回計算する）
// サーバーと画面の両方で同じ関数を使う。

export interface LogRecord {
  target: string;
  typed: string;
  start_time: string; // ISO8601（例: 2026-10-16T01:23:45.678Z）
  end_time: string;
}

export interface QuestionScore {
  correctChars: number; // target と同じ位置で一致した文字数
  totalChars: number; // target の文字数
  extraChars: number; // target より多く打った文字数（ミスとして数える）
  accuracy: number; // 正確率 0〜1 = correctChars ÷ (totalChars + extraChars)
  seconds: number; // 所要時間（秒）
  wpm: number; // 1 分あたりの語数（5 文字 = 1 語、正しく打てた文字のみ数える）
  cpm: number; // 1 分あたりの文字数（正しく打てた文字のみ数える。日本語の問題の速さに使う）
  japanese: boolean; // 出題の文字の半分以上が半角以外（ひらがな・漢字など）か
  mistakes: { index: number; expected: string; actual: string | null }[];
}

export interface SessionScore {
  questions: number;
  correctChars: number;
  totalChars: number;
  extraChars: number;
  accuracy: number;
  seconds: number;
  wpm: number;
  cpm: number;
  japanese: boolean; // 出題された文字の半分以上が半角以外か（画面で WPM と 文字/分 のどちらを主に出すか）
}

// 半角（英数字・記号・空白）以外の文字の数
const nonAscii = (chars: string[]) => chars.filter((c) => !/^[\x20-\x7e]$/.test(c)).length;

// 文字を位置ごとに比べる。typed が短い場合、足りない文字は actual = null のミスとして数える。
// typed が長い場合、余分な文字は extraChars として正確率の分母に加える（打ちすぎを減点する）。
// 位置ごとに比べるため、途中で 1 文字抜けたり増えたりすると、それ以降の文字もミスになる（仕様上の限界）。
export function scoreQuestion(log: LogRecord): QuestionScore {
  const target = Array.from(log.target);
  const typed = Array.from(log.typed);
  const mistakes: QuestionScore["mistakes"] = [];
  let correctChars = 0;
  target.forEach((expected, index) => {
    const actual = index < typed.length ? typed[index] : null;
    if (actual === expected) correctChars++;
    else mistakes.push({ index, expected, actual });
  });
  const seconds = safeSeconds(log.start_time, log.end_time);
  return {
    correctChars,
    totalChars: target.length,
    extraChars: Math.max(0, typed.length - target.length),
    accuracy: accuracyOf(correctChars, target.length + Math.max(0, typed.length - target.length)),
    seconds,
    wpm: wpm(correctChars, seconds),
    cpm: cpm(correctChars, seconds),
    japanese: target.length > 0 && nonAscii(target) * 2 >= target.length,
    mistakes,
  };
}

export function scoreSession(logs: LogRecord[]): SessionScore {
  let correctChars = 0;
  let totalChars = 0;
  let extraChars = 0;
  let seconds = 0;
  let nonAsciiChars = 0;
  for (const log of logs) {
    const q = scoreQuestion(log);
    nonAsciiChars += nonAscii(Array.from(log.target));
    correctChars += q.correctChars;
    totalChars += q.totalChars;
    extraChars += q.extraChars;
    seconds += q.seconds;
  }
  return {
    questions: logs.length,
    correctChars,
    totalChars,
    extraChars,
    accuracy: accuracyOf(correctChars, totalChars + extraChars),
    seconds,
    wpm: wpm(correctChars, seconds),
    cpm: cpm(correctChars, seconds),
    japanese: totalChars > 0 && nonAsciiChars * 2 >= totalChars,
  };
}

// タイムゾーン表記のない時刻（既存のデモデータ）は UTC として扱う。
export function elapsedSeconds(start: string, end: string): number {
  const ms = parseTime(end) - parseTime(start);
  if (Number.isNaN(ms)) throw new Error(`日時の形式が不正です: ${start} / ${end}`);
  return Math.max(0, ms / 1000);
}

// 集計用: 日時が読めない行（DB を直接編集した場合など）で集計全体を止めないよう、所要時間 0 秒として扱う
function safeSeconds(start: string, end: string): number {
  try {
    return elapsedSeconds(start, end);
  } catch {
    return 0;
  }
}

// ISO8601・UTC・ミリ秒の形式で、実在する日時か（2026-02-31 や 25 時などを拒否する）
export function isValidIsoUtcMs(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && new Date(t).toISOString() === s;
}

function parseTime(s: string): number {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  return Date.parse(hasZone ? s : `${s}Z`);
}

function accuracyOf(correct: number, denominator: number): number {
  return denominator === 0 ? 1 : correct / denominator;
}

function wpm(correctChars: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return correctChars / 5 / (seconds / 60);
}

function cpm(correctChars: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return correctChars / (seconds / 60);
}
